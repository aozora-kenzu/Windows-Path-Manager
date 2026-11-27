use chrono::{DateTime, Local};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::process::Command;

use crate::models::{
    CommandConflict, ConflictOccurrence, ConflictScope, DirectoryItem, DirectoryPeek, WhereMatch,
};
use crate::registry::expand_env_vars;
use crate::validator::normalize_path;

const DEFAULT_PATHEXT: &str = ".COM;.EXE;.BAT;.CMD;.VBS;.VBE;.JS;.JSE;.WSF;.WSH;.MSC";
const PEEK_LIMIT: usize = 200;

fn parse_pathext(pathext_env: Option<&str>) -> Vec<String> {
    let raw = pathext_env.unwrap_or(DEFAULT_PATHEXT);
    let exts: Vec<String> = raw
        .split(';')
        .map(|s| s.trim().to_ascii_lowercase())
        .filter(|s| !s.is_empty())
        .collect();
    if exts.is_empty() {
        DEFAULT_PATHEXT
            .split(';')
            .map(|s| s.to_ascii_lowercase())
            .collect()
    } else {
        exts
    }
}

fn format_modified(meta: &fs::Metadata) -> String {
    meta.modified()
        .ok()
        .map(|t| {
            let dt: DateTime<Local> = t.into();
            dt.format("%Y-%m-%d %H:%M").to_string()
        })
        .unwrap_or_default()
}

/// Evaluate Windows command resolution precedence:
/// System PATH is evaluated first, then Draft Active User PATH.
pub fn inspect_where_with_pathext(
    command: &str,
    draft_active_user: &[String],
    system_paths: &[String],
    pathext_env: Option<&str>,
) -> Vec<WhereMatch> {
    let cmd = command.trim();
    if cmd.is_empty() {
        return Vec::new();
    }

    let pathext = parse_pathext(pathext_env);
    let has_dot_ext = Path::new(cmd).extension().is_some();

    let mut candidates = Vec::new();
    if has_dot_ext {
        candidates.push(cmd.to_string());
    }
    for ext in &pathext {
        if !cmd.to_ascii_lowercase().ends_with(ext) {
            candidates.push(format!("{}{}", cmd, ext));
        }
    }
    if !has_dot_ext {
        // Also check exact filename without extension as fallback
        candidates.push(cmd.to_string());
    }

    let mut ordered_dirs: Vec<(&str, usize, &String)> = Vec::new();
    for (idx, p) in system_paths.iter().enumerate() {
        ordered_dirs.push(("system", idx, p));
    }
    for (idx, p) in draft_active_user.iter().enumerate() {
        ordered_dirs.push(("user", idx, p));
    }

    let mut matches = Vec::new();
    let mut seen_full_paths = HashSet::new();
    let mut system_won = false;

    for (source, path_index, dir_raw) in ordered_dirs {
        let dir_expanded = expand_env_vars(dir_raw.trim());
        if dir_expanded.is_empty() {
            continue;
        }
        let dir_path = Path::new(&dir_expanded);
        if !dir_path.is_dir() {
            continue;
        }

        for cand in &candidates {
            let full = dir_path.join(cand);
            if let Ok(meta) = fs::metadata(&full) {
                if meta.is_file() {
                    let full_str = full.to_string_lossy().to_string();
                    let dedup_key = full_str.to_ascii_lowercase();
                    if seen_full_paths.insert(dedup_key) {
                        let rank = matches.len() + 1;
                        let is_winner = rank == 1;
                        if is_winner && source == "system" {
                            system_won = true;
                        }
                        matches.push(WhereMatch {
                            rank,
                            is_winner,
                            shadowed_by_system: !is_winner && source == "user" && system_won,
                            source: source.to_string(),
                            path_index,
                            dir_raw: dir_raw.clone(),
                            dir_expanded: dir_expanded.clone(),
                            full_path: full_str,
                            file_size: meta.len(),
                            modified_at: format_modified(&meta),
                        });
                    }
                }
            }
        }
    }

    matches
}

pub fn inspect_where(
    command: &str,
    draft_active_user: &[String],
    system_paths: &[String],
) -> Vec<WhereMatch> {
    let pathext = std::env::var("PATHEXT").ok();
    inspect_where_with_pathext(command, draft_active_user, system_paths, pathext.as_deref())
}

struct DirExecutableHit {
    source: &'static str,
    path_index: usize,
    dir_raw: String,
    dir_expanded: String,
    filename: String,
    full_path: String,
}

fn is_installer_or_updater_command(cmd: &str) -> bool {
    let lower = cmd.to_ascii_lowercase();
    if let Some(rest) = lower.strip_prefix("unins") {
        if !rest.is_empty() && rest.chars().all(|c| c.is_ascii_digit()) {
            return true;
        }
    }
    matches!(
        lower.as_str(),
        "uninstall" | "uninst" | "uninstaller" | "setup" | "update" | "updater" | "maintenancetool"
    )
}

fn is_builtin_windows_or_alias_dir(dir_expanded: &str) -> bool {
    let norm = normalize_path(dir_expanded);
    norm.ends_with("\\windows")
        || norm.ends_with("\\windows\\system32")
        || norm.ends_with("\\windows\\syswow64")
        || norm.ends_with("\\microsoft\\windowsapps")
}

fn classify_conflict_noise(
    command: &str,
    occurrences: &[ConflictOccurrence],
) -> (bool, Option<String>) {
    if is_installer_or_updater_command(command) {
        return (true, Some("Installer/uninstaller executable".to_string()));
    }
    if !occurrences.is_empty()
        && occurrences
            .iter()
            .all(|occ| is_builtin_windows_or_alias_dir(&occ.dir_expanded))
    {
        return (
            true,
            Some("Built-in Windows / App Execution Alias".to_string()),
        );
    }
    (false, None)
}

/// Scan all System PATH and Active User PATH directories to find executable commands
/// that appear in 2 or more distinct directories.
pub fn scan_path_conflicts_with_pathext(
    active_user: &[String],
    system_paths: &[String],
    pathext_env: Option<&str>,
) -> Vec<CommandConflict> {
    let pathext = parse_pathext(pathext_env);
    let ext_priority: HashMap<&str, usize> = pathext
        .iter()
        .enumerate()
        .map(|(i, ext)| (ext.as_str(), i))
        .collect();

    let mut ordered_dirs: Vec<(&'static str, usize, &String)> = Vec::new();
    for (idx, p) in system_paths.iter().enumerate() {
        ordered_dirs.push(("system", idx, p));
    }
    for (idx, p) in active_user.iter().enumerate() {
        ordered_dirs.push(("user", idx, p));
    }

    let mut scanned_norm_dirs: HashSet<String> = HashSet::new();
    let mut by_command: HashMap<String, Vec<DirExecutableHit>> = HashMap::new();

    for (source, path_index, dir_raw) in ordered_dirs {
        let dir_expanded = expand_env_vars(dir_raw.trim());
        let norm_exp = normalize_path(&dir_expanded);
        if norm_exp.is_empty() || !scanned_norm_dirs.insert(norm_exp) {
            // Skip empty or exact-duplicate directories (already flagged as exact duplicates).
            continue;
        }

        let dir_path = Path::new(&dir_expanded);
        let Ok(read_dir) = fs::read_dir(dir_path) else {
            continue;
        };

        // Pick at most one best-priority PATHEXT executable per command stem in this directory
        // so e.g. npm.cmd + npm.bat in the same directory do not conflict with each other.
        let mut best_in_dir: HashMap<String, (usize, String, String)> = HashMap::new();

        for entry in read_dir.flatten() {
            let Ok(ft) = entry.file_type() else {
                continue;
            };
            let entry_path = entry.path();
            if !(ft.is_file() || (ft.is_symlink() && entry_path.is_file())) {
                continue;
            }

            let Some(ext_os) = entry_path.extension().and_then(|s| s.to_str()) else {
                continue;
            };
            let dot_ext = format!(".{}", ext_os.to_ascii_lowercase());
            let Some(&prio) = ext_priority.get(dot_ext.as_str()) else {
                continue;
            };

            let Some(stem) = entry_path
                .file_stem()
                .and_then(|s| s.to_str())
                .map(|s| s.to_ascii_lowercase())
            else {
                continue;
            };
            if stem.is_empty() {
                continue;
            }

            let filename = entry.file_name().to_string_lossy().to_string();
            let full_path = entry_path.to_string_lossy().to_string();

            match best_in_dir.get(&stem) {
                Some((prev_prio, prev_name, _))
                    if *prev_prio < prio
                        || (*prev_prio == prio
                            && prev_name.to_ascii_lowercase()
                                <= filename.to_ascii_lowercase()) => {}
                _ => {
                    best_in_dir.insert(stem, (prio, filename, full_path));
                }
            }
        }

        for (stem, (_, filename, full_path)) in best_in_dir {
            by_command.entry(stem).or_default().push(DirExecutableHit {
                source,
                path_index,
                dir_raw: dir_raw.clone(),
                dir_expanded: dir_expanded.clone(),
                filename,
                full_path,
            });
        }
    }

    let mut conflicts = Vec::new();
    for (command, hits) in by_command {
        if hits.len() < 2 {
            continue;
        }

        let has_system = hits.iter().any(|h| h.source == "system");
        let has_user = hits.iter().any(|h| h.source == "user");
        let scope = match (has_user, has_system) {
            (true, false) => ConflictScope::UserUser,
            (true, true) => ConflictScope::UserSystem,
            (false, true) => ConflictScope::SystemSystem,
            (false, false) => continue,
        };
        let involves_user = scope != ConflictScope::SystemSystem;
        let first_is_system = hits.first().map(|h| h.source == "system").unwrap_or(false);

        let occurrences: Vec<ConflictOccurrence> = hits
            .into_iter()
            .enumerate()
            .map(|(i, h)| {
                let rank = i + 1;
                let is_winner = rank == 1;
                let shadowed_by_system = !is_winner && h.source == "user" && first_is_system;
                ConflictOccurrence {
                    rank,
                    is_winner,
                    shadowed_by_system,
                    source: h.source.to_string(),
                    path_index: h.path_index,
                    dir_raw: h.dir_raw,
                    dir_expanded: h.dir_expanded,
                    filename: h.filename,
                    full_path: h.full_path,
                }
            })
            .collect();

        let (is_noise, noise_reason) = classify_conflict_noise(&command, &occurrences);

        conflicts.push(CommandConflict {
            command,
            scope,
            involves_user,
            is_noise,
            noise_reason,
            occurrences,
        });
    }

    conflicts.sort_by(|a, b| {
        let rank_scope = |s: ConflictScope| match s {
            ConflictScope::UserUser => 0u8,
            ConflictScope::UserSystem => 1u8,
            ConflictScope::SystemSystem => 2u8,
        };
        rank_scope(a.scope)
            .cmp(&rank_scope(b.scope))
            .then_with(|| a.command.cmp(&b.command))
    });

    conflicts
}

pub fn scan_path_conflicts(
    active_user: &[String],
    system_paths: &[String],
) -> Vec<CommandConflict> {
    let pathext = std::env::var("PATHEXT").ok();
    scan_path_conflicts_with_pathext(active_user, system_paths, pathext.as_deref())
}

fn is_executable_filename(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".exe")
        || lower.ends_with(".cmd")
        || lower.ends_with(".bat")
        || lower.ends_with(".ps1")
        || lower.ends_with(".com")
}

pub fn peek_directory(raw_or_expanded: &str) -> DirectoryPeek {
    let expanded = expand_env_vars(raw_or_expanded.trim());
    let path = Path::new(&expanded);
    if !path.exists() {
        return DirectoryPeek {
            dir_expanded: expanded,
            exists: false,
            is_dir: false,
            total_items: 0,
            truncated: false,
            executables: Vec::new(),
            other_items: Vec::new(),
        };
    }
    if !path.is_dir() {
        return DirectoryPeek {
            dir_expanded: expanded,
            exists: true,
            is_dir: false,
            total_items: 0,
            truncated: false,
            executables: Vec::new(),
            other_items: Vec::new(),
        };
    }

    let mut executables = Vec::new();
    let mut other_items = Vec::new();
    let mut total_items = 0usize;
    let mut truncated = false;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            total_items += 1;
            if total_items > PEEK_LIMIT {
                truncated = true;
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = entry.metadata().ok();
            let is_dir = meta.as_ref().map(|m| m.is_dir()).unwrap_or(false);
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let item = DirectoryItem { name: name.clone(), is_dir, size };
            if !is_dir && is_executable_filename(&name) {
                executables.push(item);
            } else {
                other_items.push(item);
            }
        }
    }

    executables.sort_by(|a, b| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()));
    other_items.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });

    DirectoryPeek {
        dir_expanded: expanded,
        exists: true,
        is_dir: true,
        total_items,
        truncated,
        executables,
        other_items,
    }
}

pub fn open_in_explorer(raw_or_expanded: &str) -> Result<(), String> {
    let expanded = expand_env_vars(raw_or_expanded.trim());
    let path = Path::new(&expanded);
    if !path.exists() {
        return Err(format!("Path does not exist: {}", expanded));
    }
    Command::new("explorer.exe")
        .arg(&expanded)
        .spawn()
        .map_err(|e| format!("Failed to launch Explorer: {}", e))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn mk_temp(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("wpm_insp_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn system_path_shadows_user_path_in_where_inspector() {
        let base = mk_temp("where");
        let sys_dir = base.join("sys");
        let usr_dir = base.join("usr");
        fs::create_dir_all(&sys_dir).unwrap();
        fs::create_dir_all(&usr_dir).unwrap();

        fs::write(sys_dir.join("mytool.exe"), b"sys").unwrap();
        fs::write(usr_dir.join("mytool.exe"), b"usr").unwrap();

        let hits = inspect_where_with_pathext(
            "mytool",
            &[usr_dir.to_string_lossy().to_string()],
            &[sys_dir.to_string_lossy().to_string()],
            Some(".EXE;.CMD"),
        );

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].source, "system");
        assert!(hits[0].is_winner);
        assert!(!hits[0].shadowed_by_system);

        assert_eq!(hits[1].source, "user");
        assert!(!hits[1].is_winner);
        assert!(hits[1].shadowed_by_system);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn peek_directory_separates_executables() {
        let base = mk_temp("peek");
        fs::write(base.join("app.exe"), b"123").unwrap();
        fs::write(base.join("readme.txt"), b"hi").unwrap();
        fs::create_dir_all(base.join("sub")).unwrap();

        let peek = peek_directory(&base.to_string_lossy());
        assert!(peek.exists);
        assert!(peek.is_dir);
        assert_eq!(peek.executables.len(), 1);
        assert_eq!(peek.executables[0].name, "app.exe");
        assert_eq!(peek.other_items.len(), 2);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn scan_conflicts_detects_user_user_and_user_system_across_different_dirs() {
        let base = mk_temp("scan_conflicts");
        let sys_dir = base.join("sys");
        let usr1 = base.join("usr1");
        let usr2 = base.join("usr2");
        fs::create_dir_all(&sys_dir).unwrap();
        fs::create_dir_all(&usr1).unwrap();
        fs::create_dir_all(&usr2).unwrap();

        fs::write(sys_dir.join("python.exe"), b"sys").unwrap();
        fs::write(usr1.join("python.exe"), b"u1").unwrap();
        fs::write(usr1.join("node.exe"), b"u1").unwrap();
        fs::write(usr2.join("node.exe"), b"u2").unwrap();
        // Same-dir multi-extension should NOT conflict with itself
        fs::write(usr1.join("npm.cmd"), b"cmd").unwrap();
        fs::write(usr1.join("npm.bat"), b"bat").unwrap();

        let user = vec![
            usr1.to_string_lossy().to_string(),
            usr2.to_string_lossy().to_string(),
            // Exact duplicate dir should not create cross-dir conflicts
            usr1.to_string_lossy().to_string(),
        ];
        let system = vec![sys_dir.to_string_lossy().to_string()];

        let conflicts = scan_path_conflicts_with_pathext(&user, &system, Some(".EXE;.CMD;.BAT"));
        assert_eq!(conflicts.len(), 2);

        // Sorted: UserUser first ("node"), then UserSystem ("python")
        assert_eq!(conflicts[0].command, "node");
        assert_eq!(conflicts[0].scope, ConflictScope::UserUser);
        assert!(conflicts[0].occurrences[0].is_winner);
        assert_eq!(conflicts[0].occurrences[0].path_index, 0);
        assert!(!conflicts[0].occurrences[1].is_winner);
        assert_eq!(conflicts[0].occurrences[1].path_index, 1);

        assert_eq!(conflicts[1].command, "python");
        assert_eq!(conflicts[1].scope, ConflictScope::UserSystem);
        assert_eq!(conflicts[1].occurrences[0].source, "system");
        assert!(conflicts[1].occurrences[0].is_winner);
        assert_eq!(conflicts[1].occurrences[1].source, "user");
        assert!(conflicts[1].occurrences[1].shadowed_by_system);
        assert!(!conflicts[0].is_noise);
        assert!(!conflicts[1].is_noise);

        let _ = fs::remove_dir_all(base);
    }

    #[test]
    fn classify_noise_flags_uninstaller_and_windows_alias_but_keeps_real_conflicts() {
        let base = mk_temp("noise_cls");
        let win_sys32 = base.join("Windows").join("System32");
        let win_apps = base.join("Microsoft").join("WindowsApps");
        let custom_py = base.join("CustomPython");
        let inno = base.join("InnoSetup6");
        let rev = base.join("RevisionTool");
        fs::create_dir_all(&win_sys32).unwrap();
        fs::create_dir_all(&win_apps).unwrap();
        fs::create_dir_all(&custom_py).unwrap();
        fs::create_dir_all(&inno).unwrap();
        fs::create_dir_all(&rev).unwrap();

        fs::write(win_sys32.join("notepad.exe"), b"1").unwrap();
        fs::write(win_apps.join("notepad.exe"), b"2").unwrap();
        fs::write(win_apps.join("python.exe"), b"3").unwrap();
        fs::write(custom_py.join("python.exe"), b"4").unwrap();
        fs::write(rev.join("unins000.exe"), b"5").unwrap();
        fs::write(inno.join("unins000.exe"), b"6").unwrap();

        let user = vec![
            win_apps.to_string_lossy().to_string(),
            custom_py.to_string_lossy().to_string(),
            inno.to_string_lossy().to_string(),
        ];
        let system = vec![
            win_sys32.to_string_lossy().to_string(),
            rev.to_string_lossy().to_string(),
        ];

        let conflicts = scan_path_conflicts_with_pathext(&user, &system, Some(".EXE"));
        let by_cmd: HashMap<String, CommandConflict> =
            conflicts.into_iter().map(|c| (c.command.clone(), c)).collect();

        assert!(by_cmd["notepad"].is_noise);
        assert!(by_cmd["unins000"].is_noise);
        assert!(!by_cmd["python"].is_noise);

        let _ = fs::remove_dir_all(base);
    }
}
