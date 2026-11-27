#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod inspector;
mod models;
mod registry;
mod storage;
mod updater;
mod validator;

fn main() {
    updater::cleanup_old_exe_on_startup();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::load_state,
            commands::validate_draft,
            commands::apply_changes,
            commands::inspect_where,
            commands::peek_directory,
            commands::open_in_explorer,
            commands::open_storage_folder,
            commands::list_backups,
            commands::delete_backup,
            commands::list_snapshots,
            commands::save_snapshot,
            commands::rename_snapshot,
            commands::delete_snapshot,
            commands::export_paths,
            commands::import_paths,
            commands::save_settings,
            commands::get_app_info,
            commands::check_app_update,
            commands::download_and_apply_update,
            commands::open_external_url,
        ])
        .run(tauri::generate_context!())
        .expect("error while running WindowsPathManager");
}
