use std::path::PathBuf;

use crate::inspector;
use crate::models::{
    AppInfo, AppSettings, ApplyRequest, ApplyResult, BackupRecord, DirectoryPeek, ImportPayload,
    NamedSnapshot, ParkedEntry, PathStateSnapshot, UpdateCheckResult, ValidationResult, WhereMatch,
};
use crate::registry;
use crate::storage::StorageManager;
use crate::updater;
use crate::validator;

fn build_snapshot(storage: &StorageManager) -> Result<PathStateSnapshot, String> {
    let (user_raw, user_reg_type) = registry::read_user_path()?;
    let system_raw = registry::read_system_path().unwrap_or_default();

    let mut parked = storage.load_parked();
    storage.reconcile_parked(&mut parked, &user_raw);

    let settings = storage.load_settings();
    let (user_entries, parked_infos, system_entries, raw_char_length, conflicts) =
        validator::validate_entries(&user_raw, &parked, &system_raw);

    Ok(PathStateSnapshot {
        user_entries,
        parked_entries: parked,
        parked_infos,
        system_entries,
        conflicts,
        user_reg_type,
        raw_char_length,
        storage_dir: storage.base_dir.to_string_lossy().to_string(),
        storage_mode: storage.mode,
        settings,
    })
}

#[tauri::command]
pub async fn load_state() -> Result<PathStateSnapshot, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let storage = StorageManager::resolve()?;
        build_snapshot(&storage)
    })
    .await
    .map_err(|e| format!("Background task error: {}", e))?
}

#[tauri::command]
pub async fn validate_draft(
    active_paths: Vec<String>,
    parked_entries: Vec<ParkedEntry>,
    system_paths: Vec<String>,
) -> Result<ValidationResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (user_entries, parked_infos, system_entries, raw_char_length, conflicts) =
            validator::validate_entries(&active_paths, &parked_entries, &system_paths);
        ValidationResult {
            user_entries,
            parked_infos,
            system_entries,
            conflicts,
            raw_char_length,
        }
    })
    .await
    .map_err(|e| format!("Background task error: {}", e))
}

#[tauri::command]
pub async fn apply_changes(request: ApplyRequest) -> Result<ApplyResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let storage = StorageManager::resolve()?;
        let (current_user_raw, current_reg_type) = registry::read_user_path()?;
        let current_parked = storage.load_parked();
        let settings = storage.load_settings();

        let reason = request
            .reason
            .unwrap_or_else(|| "Before Apply changes".to_string());
        let backup = storage.create_auto_backup(
            &reason,
            current_reg_type,
            &current_user_raw,
            &current_parked,
        )?;

        let reg_type_written =
            registry::write_user_path(&request.active_paths, settings.prefer_expand_sz)?;
        storage.save_parked(&request.parked_entries)?;

        let broadcast_ok = registry::broadcast_env_change();
        let snapshot = build_snapshot(&storage)?;

        Ok(ApplyResult {
            backup_id: backup.id,
            broadcast_ok,
            reg_type_written,
            snapshot,
        })
    })
    .await
    .map_err(|e| format!("Background task error: {}", e))?
}

#[tauri::command]
pub fn inspect_where(
    command: String,
    draft_active_user: Vec<String>,
    system_paths: Vec<String>,
) -> Vec<WhereMatch> {
    inspector::inspect_where(&command, &draft_active_user, &system_paths)
}

#[tauri::command]
pub fn peek_directory(path: String) -> DirectoryPeek {
    inspector::peek_directory(&path)
}

#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    inspector::open_in_explorer(&path)
}

#[tauri::command]
pub fn open_storage_folder() -> Result<(), String> {
    let storage = StorageManager::resolve()?;
    inspector::open_in_explorer(&storage.base_dir.to_string_lossy())
}

#[tauri::command]
pub fn list_backups() -> Result<Vec<BackupRecord>, String> {
    let storage = StorageManager::resolve()?;
    storage.list_backups()
}

#[tauri::command]
pub fn delete_backup(id: String) -> Result<(), String> {
    let storage = StorageManager::resolve()?;
    storage.delete_backup(&id)
}

#[tauri::command]
pub fn list_snapshots() -> Result<Vec<NamedSnapshot>, String> {
    let storage = StorageManager::resolve()?;
    storage.list_snapshots()
}

#[tauri::command]
pub fn save_snapshot(
    name: String,
    description: String,
    active_paths: Vec<String>,
    parked_entries: Vec<ParkedEntry>,
) -> Result<NamedSnapshot, String> {
    let storage = StorageManager::resolve()?;
    storage.save_snapshot(&name, &description, &active_paths, &parked_entries)
}

#[tauri::command]
pub fn rename_snapshot(
    id: String,
    name: String,
    description: String,
) -> Result<NamedSnapshot, String> {
    let storage = StorageManager::resolve()?;
    storage.rename_snapshot(&id, &name, &description)
}

#[tauri::command]
pub fn delete_snapshot(id: String) -> Result<(), String> {
    let storage = StorageManager::resolve()?;
    storage.delete_snapshot(&id)
}

#[tauri::command]
pub fn export_paths(
    file_path: String,
    format: String,
    active_paths: Vec<String>,
    parked_entries: Vec<ParkedEntry>,
) -> Result<(), String> {
    StorageManager::export_to_file(
        &PathBuf::from(file_path),
        &format,
        &active_paths,
        &parked_entries,
    )
}

#[tauri::command]
pub fn import_paths(file_path: String) -> Result<ImportPayload, String> {
    StorageManager::import_from_file(&PathBuf::from(file_path))
}

#[tauri::command]
pub fn save_settings(settings: AppSettings) -> Result<(), String> {
    let storage = StorageManager::resolve()?;
    storage.save_settings(&settings)
}

#[tauri::command]
pub fn get_app_info() -> Result<AppInfo, String> {
    let storage = StorageManager::resolve()?;
    Ok(updater::build_app_info(&storage))
}

#[tauri::command]
pub async fn check_app_update() -> Result<UpdateCheckResult, String> {
    updater::check_app_update().await
}

#[tauri::command]
pub async fn download_and_apply_update(
    app: tauri::AppHandle,
    download_url: String,
) -> Result<(), String> {
    let exe_path = updater::download_and_replace_exe(&download_url).await?;
    std::process::Command::new(&exe_path)
        .spawn()
        .map_err(|e| format!("Updated binary installed, but failed to relaunch: {}", e))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    updater::open_external_url(&url)
}
