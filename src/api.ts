import { invoke } from "@tauri-apps/api/core";
import { open, save } from "@tauri-apps/plugin-dialog";
import type {
  AppInfo,
  AppSettings,
  ApplyResult,
  BackupRecord,
  DirectoryPeek,
  ImportPayload,
  NamedSnapshot,
  ParkedEntry,
  PathStateSnapshot,
  UpdateCheckResult,
  ValidationResult,
  WhereMatch,
} from "./types";

export const api = {
  loadState: () => invoke<PathStateSnapshot>("load_state"),

  validateDraft: (
    activePaths: string[],
    parkedEntries: ParkedEntry[],
    systemPaths: string[]
  ) =>
    invoke<ValidationResult>("validate_draft", {
      activePaths,
      parkedEntries,
      systemPaths,
    }),

  applyChanges: (
    activePaths: string[],
    parkedEntries: ParkedEntry[],
    reason?: string
  ) =>
    invoke<ApplyResult>("apply_changes", {
      request: { activePaths, parkedEntries, reason: reason ?? null },
    }),

  inspectWhere: (
    command: string,
    draftActiveUser: string[],
    systemPaths: string[]
  ) =>
    invoke<WhereMatch[]>("inspect_where", {
      command,
      draftActiveUser,
      systemPaths,
    }),

  peekDirectory: (path: string) =>
    invoke<DirectoryPeek>("peek_directory", { path }),

  openInExplorer: (path: string) =>
    invoke<void>("open_in_explorer", { path }),

  openStorageFolder: () => invoke<void>("open_storage_folder"),

  listBackups: () => invoke<BackupRecord[]>("list_backups"),

  deleteBackup: (id: string) => invoke<void>("delete_backup", { id }),

  listSnapshots: () => invoke<NamedSnapshot[]>("list_snapshots"),

  saveSnapshot: (
    name: string,
    description: string,
    activePaths: string[],
    parkedEntries: ParkedEntry[]
  ) =>
    invoke<NamedSnapshot>("save_snapshot", {
      name,
      description,
      activePaths,
      parkedEntries,
    }),

  renameSnapshot: (id: string, name: string, description: string) =>
    invoke<NamedSnapshot>("rename_snapshot", { id, name, description }),

  deleteSnapshot: (id: string) => invoke<void>("delete_snapshot", { id }),

  exportPaths: (
    filePath: string,
    format: "json" | "txt",
    activePaths: string[],
    parkedEntries: ParkedEntry[]
  ) =>
    invoke<void>("export_paths", {
      filePath,
      format,
      activePaths,
      parkedEntries,
    }),

  importPaths: (filePath: string) =>
    invoke<ImportPayload>("import_paths", { filePath }),

  saveSettings: (settings: AppSettings) =>
    invoke<void>("save_settings", { settings }),

  getAppInfo: () => invoke<AppInfo>("get_app_info"),

  checkAppUpdate: () => invoke<UpdateCheckResult>("check_app_update"),

  downloadAndApplyUpdate: (downloadUrl: string) =>
    invoke<void>("download_and_apply_update", { downloadUrl }),

  openExternalUrl: (url: string) =>
    invoke<void>("open_external_url", { url }),

  pickFolder: async (defaultPath?: string): Promise<string | null> => {
    const selected = await open({
      directory: true,
      multiple: false,
      defaultPath,
      title: "Select Folder for User PATH",
    });
    return typeof selected === "string" ? selected : null;
  },

  pickImportFile: async (): Promise<string | null> => {
    const selected = await open({
      multiple: false,
      title: "Import PATH Configuration",
      filters: [
        { name: "PATH Exports", extensions: ["json", "txt"] },
        { name: "All Files", extensions: ["*"] },
      ],
    });
    return typeof selected === "string" ? selected : null;
  },

  pickExportFile: async (): Promise<{
    filePath: string;
    format: "json" | "txt";
  } | null> => {
    const selected = await save({
      title: "Export User PATH",
      defaultPath: "user-path-export.json",
      filters: [
        { name: "JSON Export (Active + Parked)", extensions: ["json"] },
        { name: "Plain Text (1 path per line)", extensions: ["txt"] },
      ],
    });
    if (!selected) return null;
    const format = selected.toLowerCase().endsWith(".txt") ? "txt" : "json";
    return { filePath: selected, format };
  },
};
