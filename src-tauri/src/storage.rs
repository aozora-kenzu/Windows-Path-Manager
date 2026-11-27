use chrono::Local;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{
    AppSettings, BackupRecord, ImportPayload, NamedSnapshot, ParkedEntry, RegValueKind, StorageMode,
};
use crate::registry::expand_env_vars;
use crate::validator::normalize_path;

const MAX_BACKUPS: usize = 50;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExportDocument {
    version: u32,
    exported_at: String,
    active_paths: Vec<String>,
    parked_entries: Vec<ParkedEntry>,
}

pub struct StorageManager {
    pub base_dir: PathBuf,
    pub mode: StorageMode,
}

impl StorageManager {
    /// Resolve portable-first storage (`<exe_dir>/data`), falling back to `%LOCALAPPDATA%\WindowsPathManager\data`.
    pub fn resolve() -> Result<Self, String> {
        if let Ok(exe_path) = std::env::current_exe() {
            if let Some(exe_dir) = exe_path.parent() {
                let candidate = exe_dir.join("data");
                if Self::probe_writable_dir(&candidate) {
                    let mgr = Self {
                        base_dir: candidate,
                        mode: StorageMode::Portable,
                    };
                    mgr.ensure_subdirs()?;
                    return Ok(mgr);
                }
            }
        }

        let local_app_data = std::env::var_os("LOCALAPPDATA")
            .map(PathBuf::from)
            .unwrap_or_else(std::env::temp_dir);
        let fallback = local_app_data.join("WindowsPathManager").join("data");
        let mgr = Self {
            base_dir: fallback,
            mode: StorageMode::AppDataFallback,
        };
        mgr.ensure_subdirs()?;
        Ok(mgr)
    }

    #[cfg(test)]
    pub fn new_for_test(base_dir: PathBuf) -> Result<Self, String> {
        let mgr = Self {
            base_dir,
            mode: StorageMode::Portable,
        };
        mgr.ensure_subdirs()?;
        Ok(mgr)
    }

    fn probe_writable_dir(dir: &Path) -> bool {
        if fs::create_dir_all(dir).is_err() {
            return false;
        }
        let probe = dir.join(".write_probe.tmp");
        if fs::write(&probe, b"ok").is_ok() {
            let _ = fs::remove_file(&probe);
            true
        } else {
            false
        }
    }

    fn ensure_subdirs(&self) -> Result<(), String> {
        fs::create_dir_all(&self.base_dir)
            .map_err(|e| format!("Failed to create storage dir: {}", e))?;
        fs::create_dir_all(self.backups_dir())
            .map_err(|e| format!("Failed to create backups dir: {}", e))?;
        fs::create_dir_all(self.snapshots_dir())
            .map_err(|e| format!("Failed to create snapshots dir: {}", e))?;
        Ok(())
    }

    pub fn backups_dir(&self) -> PathBuf {
        self.base_dir.join("backups")
    }

    pub fn snapshots_dir(&self) -> PathBuf {
        self.base_dir.join("snapshots")
    }

    fn settings_path(&self) -> PathBuf {
        self.base_dir.join("settings.json")
    }

    fn parked_path(&self) -> PathBuf {
        self.base_dir.join("parked.json")
    }

    pub fn load_settings(&self) -> AppSettings {
        let path = self.settings_path();
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_settings(&self, settings: &AppSettings) -> Result<(), String> {
        let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
        fs::write(self.settings_path(), json).map_err(|e| e.to_string())
    }

    pub fn load_parked(&self) -> Vec<ParkedEntry> {
        let path = self.parked_path();
        fs::read_to_string(path)
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    pub fn save_parked(&self, parked: &[ParkedEntry]) -> Result<(), String> {
        let json = serde_json::to_string_pretty(parked).map_err(|e| e.to_string())?;
        fs::write(self.parked_path(), json).map_err(|e| e.to_string())
    }

    /// Reconcile parked entries if they were re-added externally to HKCU\Environment\Path.
    pub fn reconcile_parked(&self, parked: &mut Vec<ParkedEntry>, active_user: &[String]) -> bool {
        let mut active_norms = HashSet::new();
        for p in active_user {
            let n_raw = normalize_path(p);
            let n_exp = normalize_path(&expand_env_vars(p));
            if !n_raw.is_empty() {
                active_norms.insert(n_raw);
            }
            if !n_exp.is_empty() {
                active_norms.insert(n_exp);
            }
        }
        let before = parked.len();
        parked.retain(|entry| {
            let n_raw = normalize_path(&entry.raw);
            let n_exp = normalize_path(&expand_env_vars(&entry.raw));
            !active_norms.contains(&n_raw) && !active_norms.contains(&n_exp)
        });
        let changed = parked.len() != before;
        if changed {
            let _ = self.save_parked(parked);
        }
        changed
    }

    pub fn create_auto_backup(
        &self,
        reason: &str,
        user_reg_type: RegValueKind,
        active_paths: &[String],
        parked_entries: &[ParkedEntry],
    ) -> Result<BackupRecord, String> {
        let now = Local::now();
        let id = format!("backup_{}", now.format("%Y%m%d_%H%M%S_%3f"));
        let record = BackupRecord {
            id: id.clone(),
            created_at: now.to_rfc3339(),
            reason: reason.to_string(),
            user_reg_type,
            active_paths: active_paths.to_vec(),
            parked_entries: parked_entries.to_vec(),
        };
        let path = self.backups_dir().join(format!("{}.json", id));
        let json = serde_json::to_string_pretty(&record).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;

        self.prune_old_backups();
        Ok(record)
    }

    fn prune_old_backups(&self) {
        if let Ok(mut list) = self.list_backups() {
            if list.len() > MAX_BACKUPS {
                // list_backups returns newest first
                for old in list.drain(MAX_BACKUPS..) {
                    let _ = self.delete_backup(&old.id);
                }
            }
        }
    }

    pub fn list_backups(&self) -> Result<Vec<BackupRecord>, String> {
        let mut items = Vec::new();
        let entries = fs::read_dir(self.backups_dir()).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(rec) = serde_json::from_str::<BackupRecord>(&content) {
                        items.push(rec);
                    }
                }
            }
        }
        items.sort_by(|a, b| b.created_at.cmp(&a.created_at));
        Ok(items)
    }

    pub fn delete_backup(&self, id: &str) -> Result<(), String> {
        let safe_id = sanitize_id(id);
        let path = self.backups_dir().join(format!("{}.json", safe_id));
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn list_snapshots(&self) -> Result<Vec<NamedSnapshot>, String> {
        let mut items = Vec::new();
        let entries = fs::read_dir(self.snapshots_dir()).map_err(|e| e.to_string())?;
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|s| s.to_str()) == Some("json") {
                if let Ok(content) = fs::read_to_string(&path) {
                    if let Ok(snap) = serde_json::from_str::<NamedSnapshot>(&content) {
                        items.push(snap);
                    }
                }
            }
        }
        items.sort_by(|a, b| b.updated_at.cmp(&a.updated_at));
        Ok(items)
    }

    pub fn save_snapshot(
        &self,
        name: &str,
        description: &str,
        active_paths: &[String],
        parked_entries: &[ParkedEntry],
    ) -> Result<NamedSnapshot, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Snapshot name cannot be empty.".to_string());
        }
        let now = Local::now();
        let id = format!("snap_{}", now.format("%Y%m%d_%H%M%S_%3f"));
        let snapshot = NamedSnapshot {
            id: id.clone(),
            name: trimmed_name.to_string(),
            description: description.trim().to_string(),
            created_at: now.to_rfc3339(),
            updated_at: now.to_rfc3339(),
            active_paths: active_paths.to_vec(),
            parked_entries: parked_entries.to_vec(),
        };
        let path = self.snapshots_dir().join(format!("{}.json", id));
        let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(snapshot)
    }

    pub fn rename_snapshot(
        &self,
        id: &str,
        name: &str,
        description: &str,
    ) -> Result<NamedSnapshot, String> {
        let trimmed_name = name.trim();
        if trimmed_name.is_empty() {
            return Err("Snapshot name cannot be empty.".to_string());
        }
        let safe_id = sanitize_id(id);
        let path = self.snapshots_dir().join(format!("{}.json", safe_id));
        let content = fs::read_to_string(&path)
            .map_err(|e| format!("Snapshot '{}' not found: {}", safe_id, e))?;
        let mut snap: NamedSnapshot = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        snap.name = trimmed_name.to_string();
        snap.description = description.trim().to_string();
        snap.updated_at = Local::now().to_rfc3339();
        let json = serde_json::to_string_pretty(&snap).map_err(|e| e.to_string())?;
        fs::write(path, json).map_err(|e| e.to_string())?;
        Ok(snap)
    }

    pub fn delete_snapshot(&self, id: &str) -> Result<(), String> {
        let safe_id = sanitize_id(id);
        let path = self.snapshots_dir().join(format!("{}.json", safe_id));
        if path.exists() {
            fs::remove_file(path).map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn export_to_file(
        path: &Path,
        format: &str,
        active_paths: &[String],
        parked_entries: &[ParkedEntry],
    ) -> Result<(), String> {
        let fmt = format.to_lowercase();
        if fmt == "txt" {
            let mut out = String::new();
            out.push_str("# WindowsPathManager Export\n");
            for p in active_paths {
                out.push_str(p);
                out.push('\n');
            }
            fs::write(path, out).map_err(|e| e.to_string())
        } else {
            let doc = ExportDocument {
                version: 1,
                exported_at: Local::now().to_rfc3339(),
                active_paths: active_paths.to_vec(),
                parked_entries: parked_entries.to_vec(),
            };
            let json = serde_json::to_string_pretty(&doc).map_err(|e| e.to_string())?;
            fs::write(path, json).map_err(|e| e.to_string())
        }
    }

    pub fn import_from_file(path: &Path) -> Result<ImportPayload, String> {
        let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
        let trimmed = content.trim_start();
        let is_json = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("json"))
            .unwrap_or(false)
            || trimmed.starts_with('{')
            || trimmed.starts_with('[');

        if is_json {
            if let Ok(doc) = serde_json::from_str::<ExportDocument>(&content) {
                return Ok(ImportPayload {
                    format: "json".to_string(),
                    active_paths: doc.active_paths,
                    parked_entries: doc.parked_entries,
                });
            }
            if let Ok(arr) = serde_json::from_str::<Vec<String>>(&content) {
                return Ok(ImportPayload {
                    format: "json".to_string(),
                    active_paths: arr,
                    parked_entries: Vec::new(),
                });
            }
            return Err("Invalid JSON PATH export file.".to_string());
        }

        let active_paths: Vec<String> = content
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.is_empty() && !l.starts_with('#'))
            .map(|l| l.to_string())
            .collect();

        Ok(ImportPayload {
            format: "txt".to_string(),
            active_paths,
            parked_entries: Vec::new(),
        })
    }
}

fn sanitize_id(id: &str) -> String {
    id.chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '-')
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir(name: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("wpm_test_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&p);
        fs::create_dir_all(&p).unwrap();
        p
    }

    #[test]
    fn parked_reconcile_removes_externally_readded_entries() {
        let dir = temp_test_dir("reconcile");
        let mgr = StorageManager::new_for_test(dir.clone()).unwrap();
        let mut parked = vec![
            ParkedEntry {
                id: "1".into(),
                raw: r"C:\Tools\Node20\".into(),
                parked_at: "2026-01-01".into(),
                preferred_index: 0,
                note: None,
            },
            ParkedEntry {
                id: "2".into(),
                raw: r"C:\Tools\Python312".into(),
                parked_at: "2026-01-01".into(),
                preferred_index: 1,
                note: None,
            },
        ];
        let active = vec![r"c:/tools/node20".to_string()];
        let changed = mgr.reconcile_parked(&mut parked, &active);
        assert!(changed);
        assert_eq!(parked.len(), 1);
        assert_eq!(parked[0].id, "2");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn export_and_import_json_and_txt_work() {
        let dir = temp_test_dir("exp_imp");
        let json_path = dir.join("paths.json");
        let txt_path = dir.join("paths.txt");

        let active = vec![r"%USERPROFILE%\bin".to_string(), r"C:\Tools".to_string()];
        let parked = vec![ParkedEntry {
            id: "p1".into(),
            raw: r"C:\OldTool".into(),
            parked_at: "2026-01-01".into(),
            preferred_index: 1,
            note: None,
        }];

        StorageManager::export_to_file(&json_path, "json", &active, &parked).unwrap();
        let imported_json = StorageManager::import_from_file(&json_path).unwrap();
        assert_eq!(imported_json.active_paths, active);
        assert_eq!(imported_json.parked_entries.len(), 1);

        StorageManager::export_to_file(&txt_path, "txt", &active, &parked).unwrap();
        let imported_txt = StorageManager::import_from_file(&txt_path).unwrap();
        assert_eq!(imported_txt.active_paths, active);
        assert!(imported_txt.parked_entries.is_empty());

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn snapshots_crud_works() {
        let dir = temp_test_dir("snaps");
        let mgr = StorageManager::new_for_test(dir.clone()).unwrap();
        let snap = mgr
            .save_snapshot("Work", "Work stack", &[r"C:\Work\bin".into()], &[])
            .unwrap();
        assert_eq!(mgr.list_snapshots().unwrap().len(), 1);

        let renamed = mgr.rename_snapshot(&snap.id, "Work v2", "Updated").unwrap();
        assert_eq!(renamed.name, "Work v2");

        mgr.delete_snapshot(&snap.id).unwrap();
        assert!(mgr.list_snapshots().unwrap().is_empty());
        let _ = fs::remove_dir_all(dir);
    }
}
