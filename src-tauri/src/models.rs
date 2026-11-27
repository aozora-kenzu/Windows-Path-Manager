use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RegValueKind {
    ExpandSz,
    Sz,
    Missing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum StorageMode {
    Portable,
    AppDataFallback,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathEntryInfo {
    pub raw: String,
    pub expanded: String,
    pub has_vars: bool,
    pub has_unresolved_vars: bool,
    pub exists: bool,
    pub is_file_not_dir: bool,
    pub is_duplicate_in_user: bool,
    pub is_duplicate_in_system: bool,
    pub is_same_target_duplicate: bool,
    pub has_whitespace_or_quotes: bool,
    pub normalized: String,
    pub normalized_expanded: String,
    pub shadowed_commands: Vec<String>,
    pub shadowed_count: usize,
    pub winning_conflict_commands: Vec<String>,
    pub winning_conflict_count: usize,
    pub conflicting_dirs: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ConflictScope {
    UserUser,
    UserSystem,
    SystemSystem,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConflictOccurrence {
    pub rank: usize,
    pub is_winner: bool,
    pub shadowed_by_system: bool,
    pub source: String,
    pub path_index: usize,
    pub dir_raw: String,
    pub dir_expanded: String,
    pub filename: String,
    pub full_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandConflict {
    pub command: String,
    pub scope: ConflictScope,
    pub involves_user: bool,
    pub is_noise: bool,
    pub noise_reason: Option<String>,
    pub occurrences: Vec<ConflictOccurrence>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParkedEntry {
    pub id: String,
    pub raw: String,
    pub parked_at: String,
    pub preferred_index: usize,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub theme: String,
    #[serde(default = "default_true")]
    pub prefer_expand_sz: bool,
}

fn default_true() -> bool {
    true
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: "dark".to_string(),
            prefer_expand_sz: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PathStateSnapshot {
    pub user_entries: Vec<PathEntryInfo>,
    pub parked_entries: Vec<ParkedEntry>,
    pub parked_infos: Vec<PathEntryInfo>,
    pub system_entries: Vec<PathEntryInfo>,
    pub conflicts: Vec<CommandConflict>,
    pub user_reg_type: RegValueKind,
    pub raw_char_length: usize,
    pub storage_dir: String,
    pub storage_mode: StorageMode,
    pub settings: AppSettings,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidationResult {
    pub user_entries: Vec<PathEntryInfo>,
    pub parked_infos: Vec<PathEntryInfo>,
    pub system_entries: Vec<PathEntryInfo>,
    pub conflicts: Vec<CommandConflict>,
    pub raw_char_length: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyRequest {
    pub active_paths: Vec<String>,
    pub parked_entries: Vec<ParkedEntry>,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub backup_id: String,
    pub broadcast_ok: bool,
    pub reg_type_written: RegValueKind,
    pub snapshot: PathStateSnapshot,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRecord {
    pub id: String,
    pub created_at: String,
    pub reason: String,
    pub user_reg_type: RegValueKind,
    pub active_paths: Vec<String>,
    pub parked_entries: Vec<ParkedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NamedSnapshot {
    pub id: String,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub updated_at: String,
    pub active_paths: Vec<String>,
    pub parked_entries: Vec<ParkedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WhereMatch {
    pub rank: usize,
    pub is_winner: bool,
    pub shadowed_by_system: bool,
    pub source: String,
    pub path_index: usize,
    pub dir_raw: String,
    pub dir_expanded: String,
    pub full_path: String,
    pub file_size: u64,
    pub modified_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryItem {
    pub name: String,
    pub is_dir: bool,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryPeek {
    pub dir_expanded: String,
    pub exists: bool,
    pub is_dir: bool,
    pub total_items: usize,
    pub truncated: bool,
    pub executables: Vec<DirectoryItem>,
    pub other_items: Vec<DirectoryItem>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportPayload {
    pub format: String,
    pub active_paths: Vec<String>,
    pub parked_entries: Vec<ParkedEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    pub version: String,
    pub developer: String,
    pub email: String,
    pub website: String,
    pub telegram: String,
    pub github_repo: String,
    pub license: String,
    pub built_with: String,
    pub app_folder: String,
    pub data_folder: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub has_update: bool,
    pub release_url: String,
    pub release_notes: String,
    pub asset_name: Option<String>,
    pub asset_download_url: Option<String>,
    pub asset_size: Option<u64>,
    pub checked_at: String,
    pub status_message: String,
}
