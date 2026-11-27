use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use crate::inspector;
use crate::models::{CommandConflict, ParkedEntry, PathEntryInfo};
use crate::registry::expand_env_vars;

/// Normalize a Windows path for duplicate comparison:
/// trim, lowercase, convert `/` to `\`, collapse duplicate internal `\`, preserve UNC `\\`,
/// and strip trailing `\` except on drive roots like `c:\`.
pub fn normalize_path(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let replaced = trimmed.replace('/', "\\").to_lowercase();
    let is_unc = replaced.starts_with("\\\\");

    let mut collapsed = String::with_capacity(replaced.len());
    let mut prev_slash = false;
    for (idx, ch) in replaced.chars().enumerate() {
        if ch == '\\' {
            if is_unc && idx < 2 {
                collapsed.push(ch);
                prev_slash = true;
                continue;
            }
            if !prev_slash {
                collapsed.push(ch);
            }
            prev_slash = true;
        } else {
            collapsed.push(ch);
            prev_slash = false;
        }
    }

    // Keep drive root trailing slash (e.g., "c:\"), strip others.
    let bytes = collapsed.as_bytes();
    if bytes.len() == 3 && bytes[1] == b':' && bytes[2] == b'\\' {
        return collapsed;
    }
    while collapsed.ends_with('\\') && collapsed.len() > 2 {
        // Don't strip UNC root "\\"
        if collapsed == "\\\\" {
            break;
        }
        collapsed.pop();
    }
    collapsed
}

/// Detect whether a string contains a `%VAR%` environment variable token.
pub fn has_env_var_token(s: &str) -> bool {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            if let Some(end_rel) = bytes[i + 1..].iter().position(|&b| b == b'%') {
                if end_rel > 0 {
                    let inner = &s[i + 1..i + 1 + end_rel];
                    if inner
                        .chars()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '(' | ')' | ' '))
                    {
                        return true;
                    }
                }
                i += end_rel + 2;
                continue;
            }
        }
        i += 1;
    }
    false
}

fn build_entry_info(
    raw: &str,
    seen_user_raw: &HashSet<String>,
    seen_user_exp: &HashSet<String>,
    system_raw: &HashSet<String>,
    system_exp: &HashSet<String>,
    check_user_dup: bool,
) -> PathEntryInfo {
    let trimmed = raw.trim();
    let has_whitespace_or_quotes =
        trimmed != raw || trimmed.starts_with('"') || trimmed.ends_with('"');

    let expanded = expand_env_vars(trimmed);
    let has_vars = has_env_var_token(trimmed);
    let has_unresolved_vars = has_env_var_token(&expanded);

    let normalized = normalize_path(trimmed);
    let normalized_expanded = normalize_path(&expanded);

    let (exists, is_file_not_dir) = if expanded.trim().is_empty() || has_unresolved_vars {
        (false, false)
    } else {
        let p = Path::new(expanded.trim());
        match std::fs::metadata(p) {
            Ok(meta) => {
                if meta.is_dir() {
                    (true, false)
                } else {
                    (false, true)
                }
            }
            Err(_) => (false, false),
        }
    };

    let is_duplicate_in_user = check_user_dup
        && !normalized.is_empty()
        && (seen_user_raw.contains(&normalized) || seen_user_exp.contains(&normalized_expanded));

    let is_duplicate_in_system = !normalized.is_empty()
        && (system_raw.contains(&normalized) || system_exp.contains(&normalized_expanded));

    PathEntryInfo {
        raw: raw.to_string(),
        expanded,
        has_vars,
        has_unresolved_vars,
        exists,
        is_file_not_dir,
        is_duplicate_in_user,
        is_duplicate_in_system,
        is_same_target_duplicate: false,
        has_whitespace_or_quotes,
        normalized,
        normalized_expanded,
        shadowed_commands: Vec::new(),
        shadowed_count: 0,
        winning_conflict_commands: Vec::new(),
        winning_conflict_count: 0,
        conflicting_dirs: Vec::new(),
    }
}

#[derive(Default)]
struct EntryConflictAccum {
    shadowed: Vec<String>,
    winning: Vec<String>,
    other_dirs: Vec<String>,
}

impl EntryConflictAccum {
    fn push_other_dir(&mut self, dir: &str) {
        if !self.other_dirs.iter().any(|d| d == dir) {
            self.other_dirs.push(dir.to_string());
        }
    }
}

fn annotate_conflicts(
    user_infos: &mut [PathEntryInfo],
    system_infos: &mut [PathEntryInfo],
    conflicts: &[CommandConflict],
) {
    let mut map: HashMap<(String, usize), EntryConflictAccum> = HashMap::new();

    for conflict in conflicts {
        if conflict.is_noise {
            continue;
        }
        let Some(winner) = conflict.occurrences.first() else {
            continue;
        };
        for occ in &conflict.occurrences[1..] {
            map.entry((winner.source.clone(), winner.path_index))
                .or_default()
                .push_other_dir(&occ.dir_raw);

            let shadowed_acc = map
                .entry((occ.source.clone(), occ.path_index))
                .or_default();
            shadowed_acc.shadowed.push(conflict.command.clone());
            shadowed_acc.push_other_dir(&winner.dir_raw);
        }
        map.entry((winner.source.clone(), winner.path_index))
            .or_default()
            .winning
            .push(conflict.command.clone());
    }

    for (idx, info) in user_infos.iter_mut().enumerate() {
        if let Some(acc) = map.get(&("user".to_string(), idx)) {
            info.shadowed_count = acc.shadowed.len();
            info.shadowed_commands = acc.shadowed.iter().take(12).cloned().collect();
            info.winning_conflict_count = acc.winning.len();
            info.winning_conflict_commands = acc.winning.iter().take(12).cloned().collect();
            info.conflicting_dirs = acc.other_dirs.iter().take(6).cloned().collect();
        }
    }

    for (idx, info) in system_infos.iter_mut().enumerate() {
        if let Some(acc) = map.get(&("system".to_string(), idx)) {
            info.shadowed_count = acc.shadowed.len();
            info.shadowed_commands = acc.shadowed.iter().take(12).cloned().collect();
            info.winning_conflict_count = acc.winning.len();
            info.winning_conflict_commands = acc.winning.iter().take(12).cloned().collect();
            info.conflicting_dirs = acc.other_dirs.iter().take(6).cloned().collect();
        }
    }
}

/// Validate active User PATH, Parked User PATH, System PATH, and cross-directory executable conflicts.
pub fn validate_entries(
    active_user: &[String],
    parked: &[ParkedEntry],
    system: &[String],
) -> (
    Vec<PathEntryInfo>,
    Vec<PathEntryInfo>,
    Vec<PathEntryInfo>,
    usize,
    Vec<CommandConflict>,
) {
    let mut system_raw_set = HashSet::new();
    let mut system_exp_set = HashSet::new();
    let mut all_canonical_targets: HashSet<PathBuf> = HashSet::new();
    let empty_set = HashSet::new();

    let mut system_infos = Vec::with_capacity(system.len());
    for entry in system {
        let mut info = build_entry_info(
            entry,
            &empty_set,
            &empty_set,
            &empty_set,
            &empty_set,
            false,
        );
        let exact_dup_in_sys = !info.normalized.is_empty()
            && (system_raw_set.contains(&info.normalized)
                || system_exp_set.contains(&info.normalized_expanded));
        if info.exists {
            if let Ok(canon) = std::fs::canonicalize(info.expanded.trim()) {
                if !all_canonical_targets.insert(canon) && !exact_dup_in_sys {
                    info.is_same_target_duplicate = true;
                }
            }
        }
        if !info.normalized.is_empty() {
            system_raw_set.insert(info.normalized.clone());
        }
        if !info.normalized_expanded.is_empty() {
            system_exp_set.insert(info.normalized_expanded.clone());
        }
        system_infos.push(info);
    }

    let mut seen_user_raw = HashSet::new();
    let mut seen_user_exp = HashSet::new();
    let mut user_infos = Vec::with_capacity(active_user.len());

    for entry in active_user {
        let mut info = build_entry_info(
            entry,
            &seen_user_raw,
            &seen_user_exp,
            &system_raw_set,
            &system_exp_set,
            true,
        );
        if info.exists {
            if let Ok(canon) = std::fs::canonicalize(info.expanded.trim()) {
                let is_exact_dup = info.is_duplicate_in_user || info.is_duplicate_in_system;
                if !all_canonical_targets.insert(canon) && !is_exact_dup {
                    info.is_same_target_duplicate = true;
                }
            }
        }
        if !info.normalized.is_empty() {
            seen_user_raw.insert(info.normalized.clone());
        }
        if !info.normalized_expanded.is_empty() {
            seen_user_exp.insert(info.normalized_expanded.clone());
        }
        user_infos.push(info);
    }

    let mut parked_infos = Vec::with_capacity(parked.len());
    for entry in parked {
        let info = build_entry_info(
            &entry.raw,
            &seen_user_raw,
            &seen_user_exp,
            &system_raw_set,
            &system_exp_set,
            true,
        );
        parked_infos.push(info);
    }

    let conflicts = inspector::scan_path_conflicts(active_user, system);
    annotate_conflicts(&mut user_infos, &mut system_infos, &conflicts);

    let raw_char_length = active_user.join(";").chars().count();
    (user_infos, parked_infos, system_infos, raw_char_length, conflicts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_path_handles_slashes_case_and_drive_roots() {
        assert_eq!(normalize_path(r"C:/Tools\Bin\"), r"c:\tools\bin");
        assert_eq!(normalize_path(r"C:\"), r"c:\");
        assert_eq!(normalize_path(r"\\Server\Share\Folder\"), r"\\server\share\folder");
        assert_eq!(normalize_path(r#" "C:\Program Files\\App\" "#), r"c:\program files\app");
    }

    #[test]
    fn env_var_token_detection_works() {
        assert!(has_env_var_token(r"%USERPROFILE%\bin"));
        assert!(has_env_var_token(r"%ProgramFiles(x86)%\Tool"));
        assert!(!has_env_var_token(r"C:\Tools\100%Real"));
        assert!(!has_env_var_token(r"C:\Tools\bin"));
    }

    #[test]
    fn validate_entries_detects_user_and_system_duplicates() {
        let user = vec![
            r"C:\Alpha\Bin".to_string(),
            r"c:/alpha/bin/".to_string(),
            r"C:\SysTool".to_string(),
        ];
        let system = vec![r"C:\SysTool\".to_string()];
        let (user_infos, _, sys_infos, len, _) = validate_entries(&user, &[], &system);

        assert_eq!(sys_infos.len(), 1);
        assert!(!user_infos[0].is_duplicate_in_user);
        assert!(user_infos[1].is_duplicate_in_user);
        assert!(user_infos[2].is_duplicate_in_system);
        assert_eq!(len, user.join(";").chars().count());
    }

    #[test]
    fn validate_entries_annotates_cross_directory_conflicts() {
        let base = std::env::temp_dir().join(format!("wpm_val_conf_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let d1 = base.join("node_v20");
        let d2 = base.join("node_v22");
        std::fs::create_dir_all(&d1).unwrap();
        std::fs::create_dir_all(&d2).unwrap();
        std::fs::write(d1.join("node.exe"), b"20").unwrap();
        std::fs::write(d2.join("node.exe"), b"22").unwrap();

        let user = vec![
            d1.to_string_lossy().to_string(),
            d2.to_string_lossy().to_string(),
        ];
        let (user_infos, _, _, _, conflicts) = validate_entries(&user, &[], &[]);

        assert_eq!(conflicts.len(), 1);
        assert_eq!(conflicts[0].command, "node");
        assert_eq!(user_infos[0].winning_conflict_count, 1);
        assert_eq!(user_infos[0].winning_conflict_commands, vec!["node"]);
        assert_eq!(user_infos[1].shadowed_count, 1);
        assert_eq!(user_infos[1].shadowed_commands, vec!["node"]);

        let _ = std::fs::remove_dir_all(base);
    }

    #[test]
    fn validate_entries_ignores_noise_when_annotating_rows() {
        let base = std::env::temp_dir().join(format!("wpm_val_noise_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&base);
        let d1 = base.join("ToolA");
        let d2 = base.join("ToolB");
        std::fs::create_dir_all(&d1).unwrap();
        std::fs::create_dir_all(&d2).unwrap();
        std::fs::write(d1.join("unins000.exe"), b"1").unwrap();
        std::fs::write(d2.join("unins000.exe"), b"2").unwrap();

        let user = vec![
            d1.to_string_lossy().to_string(),
            d2.to_string_lossy().to_string(),
        ];
        let (user_infos, _, _, _, conflicts) = validate_entries(&user, &[], &[]);

        assert_eq!(conflicts.len(), 1);
        assert!(conflicts[0].is_noise);
        assert_eq!(user_infos[0].winning_conflict_count, 0);
        assert_eq!(user_infos[1].shadowed_count, 0);

        let _ = std::fs::remove_dir_all(base);
    }
}
