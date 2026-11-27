export type RegValueKind = "expand_sz" | "sz" | "missing";
export type StorageMode = "portable" | "app_data_fallback";
export type ActiveTab = "user" | "system" | "conflicts" | "where" | "snapshots";
export type UserFilter = "all" | "active" | "parked" | "issues" | "conflicts";
export type ConflictScope = "user_user" | "user_system" | "system_system";

export interface PathEntryInfo {
  raw: string;
  expanded: string;
  hasVars: boolean;
  hasUnresolvedVars: boolean;
  exists: boolean;
  isFileNotDir: boolean;
  isDuplicateInUser: boolean;
  isDuplicateInSystem: boolean;
  isSameTargetDuplicate: boolean;
  hasWhitespaceOrQuotes: boolean;
  normalized: string;
  normalizedExpanded: string;
  shadowedCommands: string[];
  shadowedCount: number;
  winningConflictCommands: string[];
  winningConflictCount: number;
  conflictingDirs: string[];
}

export interface ConflictOccurrence {
  rank: number;
  isWinner: boolean;
  shadowedBySystem: boolean;
  source: "system" | "user";
  pathIndex: number;
  dirRaw: string;
  dirExpanded: string;
  filename: string;
  fullPath: string;
}

export interface CommandConflict {
  command: string;
  scope: ConflictScope;
  involvesUser: boolean;
  isNoise: boolean;
  noiseReason: string | null;
  occurrences: ConflictOccurrence[];
}

export interface ParkedEntry {
  id: string;
  raw: string;
  parkedAt: string;
  preferredIndex: number;
  note?: string | null;
}

export interface AppSettings {
  theme: "dark" | "light";
  preferExpandSz: boolean;
}

export interface PathStateSnapshot {
  userEntries: PathEntryInfo[];
  parkedEntries: ParkedEntry[];
  parkedInfos: PathEntryInfo[];
  systemEntries: PathEntryInfo[];
  conflicts: CommandConflict[];
  userRegType: RegValueKind;
  rawCharLength: number;
  storageDir: string;
  storageMode: StorageMode;
  settings: AppSettings;
}

export interface ValidationResult {
  userEntries: PathEntryInfo[];
  parkedInfos: PathEntryInfo[];
  systemEntries: PathEntryInfo[];
  conflicts: CommandConflict[];
  rawCharLength: number;
}

export interface ApplyResult {
  backupId: string;
  broadcastOk: boolean;
  regTypeWritten: RegValueKind;
  snapshot: PathStateSnapshot;
}

export interface BackupRecord {
  id: string;
  createdAt: string;
  reason: string;
  userRegType: RegValueKind;
  activePaths: string[];
  parkedEntries: ParkedEntry[];
}

export interface NamedSnapshot {
  id: string;
  name: string;
  description: string;
  createdAt: string;
  updatedAt: string;
  activePaths: string[];
  parkedEntries: ParkedEntry[];
}

export interface WhereMatch {
  rank: number;
  isWinner: boolean;
  shadowedBySystem: boolean;
  source: "system" | "user";
  pathIndex: number;
  dirRaw: string;
  dirExpanded: string;
  fullPath: string;
  fileSize: number;
  modifiedAt: string;
}

export interface DirectoryItem {
  name: string;
  isDir: boolean;
  size: number;
}

export interface DirectoryPeek {
  dirExpanded: string;
  exists: boolean;
  isDir: boolean;
  totalItems: number;
  truncated: boolean;
  executables: DirectoryItem[];
  otherItems: DirectoryItem[];
}

export interface ImportPayload {
  format: string;
  activePaths: string[];
  parkedEntries: ParkedEntry[];
}

export interface DraftState {
  activePaths: string[];
  parkedEntries: ParkedEntry[];
}

export interface DraftDiff {
  added: string[];
  removed: string[];
  reordered: boolean;
  parkedChanged: boolean;
  hasChanges: boolean;
}

export interface AppInfo {
  name: string;
  version: string;
  developer: string;
  email: string;
  website: string;
  telegram: string;
  githubRepo: string;
  license: string;
  builtWith: string;
  appFolder: string;
  dataFolder: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
  releaseUrl: string;
  releaseNotes: string;
  assetName: string | null;
  assetDownloadUrl: string | null;
  assetSize: number | null;
  checkedAt: string;
  statusMessage: string;
}
