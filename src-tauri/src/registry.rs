use std::io;
use windows_sys::Win32::System::Environment::ExpandEnvironmentStringsW;
use windows_sys::Win32::UI::WindowsAndMessaging::{
    SendMessageTimeoutW, HWND_BROADCAST, SMTO_ABORTIFHUNG, WM_SETTINGCHANGE,
};
use winreg::enums::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, KEY_READ, REG_EXPAND_SZ, REG_SZ};
use winreg::{RegKey, RegValue};

use crate::models::RegValueKind;

const USER_ENV_SUBKEY: &str = "Environment";
const SYSTEM_ENV_SUBKEY: &str = r"SYSTEM\CurrentControlSet\Control\Session Manager\Environment";

/// Decode a UTF-16LE registry byte slice into a Rust String, stopping at the first NUL terminator.
pub fn decode_utf16le(bytes: &[u8]) -> String {
    let mut u16s = Vec::with_capacity(bytes.len() / 2);
    for chunk in bytes.chunks_exact(2) {
        let code = u16::from_le_bytes([chunk[0], chunk[1]]);
        if code == 0 {
            break;
        }
        u16s.push(code);
    }
    String::from_utf16_lossy(&u16s)
}

/// Encode a Rust String into NUL-terminated UTF-16LE bytes for Win32 Registry values.
pub fn encode_utf16le_nul(s: &str) -> Vec<u8> {
    let mut bytes = Vec::with_capacity((s.len() + 1) * 2);
    for code in s.encode_utf16() {
        bytes.extend_from_slice(&code.to_le_bytes());
    }
    bytes.extend_from_slice(&0u16.to_le_bytes());
    bytes
}

/// Split a semicolon-delimited Windows PATH string into non-empty entries.
pub fn split_path_string(raw: &str) -> Vec<String> {
    raw.split(';')
        .filter(|segment| !segment.trim().is_empty())
        .map(|segment| segment.to_string())
        .collect()
}

/// Expand Windows %VAR% tokens using Win32 ExpandEnvironmentStringsW.
pub fn expand_env_vars(raw: &str) -> String {
    if raw.is_empty() || !raw.contains('%') {
        return raw.to_string();
    }
    let wide: Vec<u16> = raw.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let needed = ExpandEnvironmentStringsW(wide.as_ptr(), std::ptr::null_mut(), 0);
        if needed == 0 {
            return raw.to_string();
        }
        let mut buf = vec![0u16; needed as usize];
        let written = ExpandEnvironmentStringsW(wide.as_ptr(), buf.as_mut_ptr(), needed);
        if written == 0 {
            return raw.to_string();
        }
        let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..len])
    }
}

fn read_path_from_key(root: &RegKey, subkey: &str) -> Result<(Vec<String>, RegValueKind), String> {
    let env_key = match root.open_subkey_with_flags(subkey, KEY_READ) {
        Ok(k) => k,
        Err(e) if e.kind() == io::ErrorKind::NotFound => {
            return Ok((Vec::new(), RegValueKind::Missing));
        }
        Err(e) => return Err(format!("Failed to open registry key '{}': {}", subkey, e)),
    };

    match env_key.get_raw_value("Path") {
        Ok(val) => {
            let kind = match val.vtype {
                REG_EXPAND_SZ => RegValueKind::ExpandSz,
                REG_SZ => RegValueKind::Sz,
                _ => RegValueKind::Sz,
            };
            let decoded = decode_utf16le(&val.bytes);
            Ok((split_path_string(&decoded), kind))
        }
        Err(e) if e.kind() == io::ErrorKind::NotFound => Ok((Vec::new(), RegValueKind::Missing)),
        Err(e) => Err(format!("Failed to read 'Path' from '{}': {}", subkey, e)),
    }
}

/// Read User PATH from HKCU\Environment\Path without requiring Administrator rights.
pub fn read_user_path() -> Result<(Vec<String>, RegValueKind), String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    read_path_from_key(&hkcu, USER_ENV_SUBKEY)
}

/// Read System PATH from HKLM\...\Environment\Path in read-only mode.
pub fn read_system_path() -> Result<Vec<String>, String> {
    let hklm = RegKey::predef(HKEY_LOCAL_MACHINE);
    let (entries, _) = read_path_from_key(&hklm, SYSTEM_ENV_SUBKEY)?;
    Ok(entries)
}

/// Determine the appropriate Registry value type: always REG_EXPAND_SZ when %...% exists or preferred.
pub fn resolve_write_reg_kind(entries: &[String], prefer_expand_sz: bool) -> RegValueKind {
    let contains_vars = entries.iter().any(|e| e.contains('%'));
    if contains_vars || prefer_expand_sz {
        RegValueKind::ExpandSz
    } else {
        RegValueKind::Sz
    }
}

/// Write User PATH to HKCU\Environment\Path.
pub fn write_user_path(entries: &[String], prefer_expand_sz: bool) -> Result<RegValueKind, String> {
    let hkcu = RegKey::predef(HKEY_CURRENT_USER);
    let (env_key, _) = hkcu
        .create_subkey(USER_ENV_SUBKEY)
        .map_err(|e| format!("Failed to open HKCU\\Environment for writing: {}", e))?;

    let joined = entries.join(";");
    let kind = resolve_write_reg_kind(entries, prefer_expand_sz);
    let vtype = match kind {
        RegValueKind::ExpandSz | RegValueKind::Missing => REG_EXPAND_SZ,
        RegValueKind::Sz => REG_SZ,
    };

    let reg_val = RegValue {
        bytes: encode_utf16le_nul(&joined),
        vtype,
    };

    env_key
        .set_raw_value("Path", &reg_val)
        .map_err(|e| format!("Failed to write HKCU\\Environment\\Path: {}", e))?;

    Ok(kind)
}

/// Broadcast WM_SETTINGCHANGE ("Environment") so new Explorer/terminal processes pick up changes.
pub fn broadcast_env_change() -> bool {
    let env_wide: Vec<u16> = "Environment\0".encode_utf16().collect();
    let mut result: usize = 0;
    let ret = unsafe {
        SendMessageTimeoutW(
            HWND_BROADCAST,
            WM_SETTINGCHANGE,
            0,
            env_wide.as_ptr() as isize,
            SMTO_ABORTIFHUNG,
            5000,
            &mut result,
        )
    };
    ret != 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16le_roundtrip_preserves_text_and_unicode() {
        let original = r"%USERPROFILE%\bin;C:\Tools\Café";
        let bytes = encode_utf16le_nul(original);
        assert_eq!(bytes.last(), Some(&0));
        assert_eq!(decode_utf16le(&bytes), original);
    }

    #[test]
    fn split_path_skips_empty_segments() {
        let parsed = split_path_string(r"C:\A;;C:\B; ;%USERPROFILE%\bin;");
        assert_eq!(parsed, vec![r"C:\A", r"C:\B", r"%USERPROFILE%\bin"]);
    }

    #[test]
    fn write_reg_kind_never_downgrades_when_vars_present() {
        let entries = vec![r"%LOCALAPPDATA%\Programs".to_string()];
        assert_eq!(resolve_write_reg_kind(&entries, false), RegValueKind::ExpandSz);
        assert_eq!(resolve_write_reg_kind(&[], true), RegValueKind::ExpandSz);
        assert_eq!(
            resolve_write_reg_kind(&[r"C:\Tools".to_string()], false),
            RegValueKind::Sz
        );
    }

    #[test]
    fn expand_env_vars_handles_plain_and_known_vars() {
        assert_eq!(expand_env_vars(r"C:\Plain\Path"), r"C:\Plain\Path");
        let expanded = expand_env_vars(r"%SystemRoot%\System32");
        assert!(!expanded.is_empty());
        assert!(!expanded.to_lowercase().contains("%systemroot%"));
    }
}
