use chrono::Local;
use reqwest::header::{ACCEPT, USER_AGENT};
use serde::Deserialize;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use crate::models::{AppInfo, UpdateCheckResult};
use crate::storage::StorageManager;

pub const APP_NAME: &str = "WindowsPathManager";
pub const APP_VERSION: &str = env!("CARGO_PKG_VERSION");
pub const DEVELOPER_NAME: &str = "AKZ Team";
pub const DEVELOPER_EMAIL: &str = "aozora@botsec.dev";
pub const WEBSITE_URL: &str = "https://botsec.dev";
pub const TELEGRAM_URL: &str = "https://t.me/AozoraKZ";
pub const GITHUB_REPO_URL: &str = "https://github.com/aozora-kenzu/Windows-Path-Manager";
pub const GITHUB_LATEST_RELEASE_API: &str =
    "https://api.github.com/repos/aozora-kenzu/Windows-Path-Manager/releases/latest";
pub const LICENSE_TEXT: &str = "MIT License (Copyright © 2026 AKZ Team)";
pub const BUILT_WITH_TEXT: &str = "Rust + Tauri v2 + React + TypeScript";

const MIN_EXE_SIZE_BYTES: usize = 100 * 1024;

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubAsset {
    pub name: String,
    pub browser_download_url: String,
    pub size: u64,
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    tag_name: String,
    html_url: String,
    #[serde(default)]
    body: String,
    #[serde(default)]
    assets: Vec<GitHubAsset>,
}

pub fn build_app_info(storage: &StorageManager) -> AppInfo {
    let app_folder = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_string_lossy().to_string()))
        .unwrap_or_default();

    AppInfo {
        name: APP_NAME.to_string(),
        version: format!("v{}", APP_VERSION),
        developer: DEVELOPER_NAME.to_string(),
        email: DEVELOPER_EMAIL.to_string(),
        website: WEBSITE_URL.to_string(),
        telegram: TELEGRAM_URL.to_string(),
        github_repo: GITHUB_REPO_URL.to_string(),
        license: LICENSE_TEXT.to_string(),
        built_with: BUILT_WITH_TEXT.to_string(),
        app_folder,
        data_folder: storage.base_dir.to_string_lossy().to_string(),
    }
}

/// Remove any leftover `<exe>.old` left behind by a previous portable self-update.
pub fn cleanup_old_exe_on_startup() {
    let Ok(exe_path) = std::env::current_exe() else {
        return;
    };
    let old_path = append_exe_suffix(&exe_path, ".old");
    if !old_path.exists() {
        return;
    }
    std::thread::spawn(move || {
        for _ in 0..5 {
            if fs::remove_file(&old_path).is_ok() || !old_path.exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(300));
        }
    });
}

fn append_exe_suffix(path: &Path, suffix: &str) -> PathBuf {
    let file_name = path
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "WindowsPathManager.exe".to_string());
    path.with_file_name(format!("{}{}", file_name, suffix))
}

pub fn parse_semver(tag: &str) -> Option<(u64, u64, u64)> {
    let cleaned = tag.trim().trim_start_matches(['v', 'V']);
    let core = cleaned.split(['-', '+']).next()?.trim();
    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    Some((major, minor, patch))
}

pub fn is_newer_version(current: &str, latest: &str) -> bool {
    match (parse_semver(current), parse_semver(latest)) {
        (Some(cur), Some(lat)) => lat > cur,
        _ => false,
    }
}

pub fn select_portable_exe_asset(assets: &[GitHubAsset]) -> Option<GitHubAsset> {
    if let Some(exact) = assets
        .iter()
        .find(|a| a.name.eq_ignore_ascii_case("WindowsPathManager.exe"))
    {
        return Some(exact.clone());
    }
    assets
        .iter()
        .find(|a| a.name.to_ascii_lowercase().ends_with(".exe"))
        .cloned()
}

pub fn is_allowed_download_url(url: &str) -> bool {
    let Ok(parsed) = reqwest::Url::parse(url) else {
        return false;
    };
    if parsed.scheme() != "https" {
        return false;
    }
    let Some(host) = parsed.host_str().map(|h| h.to_ascii_lowercase()) else {
        return false;
    };
    host == "github.com"
        || host.ends_with(".github.com")
        || host == "githubusercontent.com"
        || host.ends_with(".githubusercontent.com")
}

pub async fn check_app_update() -> Result<UpdateCheckResult, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

    let resp = client
        .get(GITHUB_LATEST_RELEASE_API)
        .header(USER_AGENT, format!("{}/{}", APP_NAME, APP_VERSION))
        .header(ACCEPT, "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| format!("Failed to reach GitHub Releases: {}", e))?;

    let checked_at = Local::now().format("%H:%M:%S").to_string();
    let current_version = format!("v{}", APP_VERSION);

    if resp.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(UpdateCheckResult {
            current_version: current_version.clone(),
            latest_version: current_version.clone(),
            has_update: false,
            release_url: format!("{}/releases", GITHUB_REPO_URL),
            release_notes: String::new(),
            asset_name: None,
            asset_download_url: None,
            asset_size: None,
            checked_at,
            status_message: format!("No GitHub release published yet ({})", current_version),
        });
    }

    if !resp.status().is_success() {
        return Err(format!("GitHub API returned HTTP {}", resp.status()));
    }

    let release: GitHubRelease = resp
        .json()
        .await
        .map_err(|e| format!("Failed to parse GitHub release JSON: {}", e))?;

    let has_update = is_newer_version(APP_VERSION, &release.tag_name);
    let latest_version = if release.tag_name.starts_with(['v', 'V']) {
        format!("v{}", release.tag_name.trim_start_matches(['v', 'V']))
    } else {
        format!("v{}", release.tag_name)
    };
    let asset = select_portable_exe_asset(&release.assets);

    let status_message = if has_update {
        format!("Update available: {} -> {}", current_version, latest_version)
    } else {
        format!("{} {} is up to date", APP_NAME, current_version)
    };

    Ok(UpdateCheckResult {
        current_version,
        latest_version,
        has_update,
        release_url: release.html_url,
        release_notes: release.body,
        asset_name: asset.as_ref().map(|a| a.name.clone()),
        asset_download_url: asset.as_ref().map(|a| a.browser_download_url.clone()),
        asset_size: asset.as_ref().map(|a| a.size),
        checked_at,
        status_message,
    })
}

fn validate_pe_bytes(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < MIN_EXE_SIZE_BYTES {
        return Err(format!(
            "Downloaded file is too small ({} bytes) to be a valid portable executable.",
            bytes.len()
        ));
    }
    if &bytes[..2] != b"MZ" {
        return Err("Downloaded file does not have a valid Windows PE (MZ) header.".to_string());
    }
    Ok(())
}

fn swap_portable_binary(current_exe: &Path, new_exe: &Path) -> Result<(), String> {
    let old_exe = append_exe_suffix(current_exe, ".old");
    if old_exe.exists() {
        let _ = fs::remove_file(&old_exe);
    }

    fs::rename(current_exe, &old_exe)
        .map_err(|e| format!("Cannot stage running executable for replacement: {}", e))?;

    if let Err(err) = fs::rename(new_exe, current_exe) {
        // Attempt rollback if moving the new executable into place fails
        let _ = fs::rename(&old_exe, current_exe);
        return Err(format!("Failed to install downloaded executable: {}", err));
    }

    Ok(())
}

/// Download the new portable `.exe` from GitHub and atomically replace the running binary.
pub async fn download_and_replace_exe(download_url: &str) -> Result<PathBuf, String> {
    if !is_allowed_download_url(download_url) {
        return Err("Blocked update download URL: must be HTTPS on github.com.".to_string());
    }

    let current_exe =
        std::env::current_exe().map_err(|e| format!("Cannot resolve current exe path: {}", e))?;
    let new_exe = append_exe_suffix(&current_exe, ".new");

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(180))
        .build()
        .map_err(|e| format!("Failed to initialize HTTP client: {}", e))?;

    let resp = client
        .get(download_url)
        .header(USER_AGENT, format!("{}/{}", APP_NAME, APP_VERSION))
        .send()
        .await
        .map_err(|e| format!("Failed to download update: {}", e))?;

    if !resp.status().is_success() {
        return Err(format!("Download failed with HTTP {}", resp.status()));
    }

    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed while reading update bytes: {}", e))?;

    validate_pe_bytes(&bytes)?;

    fs::write(&new_exe, &bytes)
        .map_err(|e| format!("Failed to write staged update file: {}", e))?;

    if let Err(err) = swap_portable_binary(&current_exe, &new_exe) {
        let _ = fs::remove_file(&new_exe);
        return Err(err);
    }

    Ok(current_exe)
}

pub fn open_external_url(url: &str) -> Result<(), String> {
    let trimmed = url.trim();
    if !(trimmed.starts_with("https://") || trimmed.starts_with("mailto:")) {
        return Err("Only https:// or mailto: URLs are permitted.".to_string());
    }
    Command::new("explorer.exe")
        .arg(trimmed)
        .spawn()
        .map_err(|e| format!("Failed to open URL: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn semver_parsing_and_comparison_work() {
        assert_eq!(parse_semver("v0.1.0"), Some((0, 1, 0)));
        assert_eq!(parse_semver("1.2.3-beta.1"), Some((1, 2, 3)));
        assert!(is_newer_version("0.1.0", "v0.1.1"));
        assert!(is_newer_version("v0.1.0", "0.2.0"));
        assert!(!is_newer_version("0.1.0", "v0.1.0"));
        assert!(!is_newer_version("0.2.0", "v0.1.9"));
    }

    #[test]
    fn asset_selection_prefers_exact_portable_exe() {
        let assets = vec![
            GitHubAsset {
                name: "other.exe".into(),
                browser_download_url: "https://github.com/a/b/other.exe".into(),
                size: 1000,
            },
            GitHubAsset {
                name: "WindowsPathManager.exe".into(),
                browser_download_url: "https://github.com/a/b/WindowsPathManager.exe".into(),
                size: 2000,
            },
        ];
        let chosen = select_portable_exe_asset(&assets).unwrap();
        assert_eq!(chosen.name, "WindowsPathManager.exe");
    }

    #[test]
    fn allowed_download_url_enforces_https_github() {
        assert!(is_allowed_download_url(
            "https://github.com/aozora-kenzu/Windows-Path-Manager/releases/download/v0.2.0/WindowsPathManager.exe"
        ));
        assert!(is_allowed_download_url(
            "https://objects.githubusercontent.com/github-production-release-asset/123"
        ));
        assert!(!is_allowed_download_url("http://github.com/evil.exe"));
        assert!(!is_allowed_download_url("https://evil.example.com/WindowsPathManager.exe"));
    }

    #[test]
    fn swap_portable_binary_replaces_and_validates_pe() {
        let bad = vec![0u8; 200 * 1024];
        assert!(validate_pe_bytes(&bad).is_err());

        let mut good = vec![0u8; 150 * 1024];
        good[0] = b'M';
        good[1] = b'Z';
        assert!(validate_pe_bytes(&good).is_ok());

        let dir = std::env::temp_dir().join(format!("wpm_upd_swap_{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        let cur = dir.join("App.exe");
        let new_f = dir.join("App.exe.new");
        fs::write(&cur, b"old_bin").unwrap();
        fs::write(&new_f, b"new_bin").unwrap();

        swap_portable_binary(&cur, &new_f).unwrap();
        assert_eq!(fs::read(&cur).unwrap(), b"new_bin");
        assert_eq!(fs::read(dir.join("App.exe.old")).unwrap(), b"old_bin");

        let _ = fs::remove_dir_all(dir);
    }
}
