import React from "react";
import { AlertTriangle, CheckCircle2, FolderCog, GitCompareArrows } from "lucide-react";
import { api } from "../api";
import type { RegValueKind, StorageMode } from "../types";

interface StatusBarProps {
  regType: RegValueKind;
  rawCharLength: number;
  brokenCount: number;
  duplicateCount: number;
  userConflictCount: number;
  activeCount: number;
  systemCount: number;
  storageMode: StorageMode;
  storageDir: string;
  isDirty: boolean;
  toast: { message: string; isError: boolean } | null;
  onOpenConflicts: () => void;
}

export const StatusBar: React.FC<StatusBarProps> = ({
  regType,
  rawCharLength,
  brokenCount,
  duplicateCount,
  userConflictCount,
  activeCount,
  systemCount,
  storageMode,
  storageDir,
  isDirty,
  toast,
  onOpenConflicts,
}) => {
  const regLabel =
    regType === "expand_sz"
      ? "REG_EXPAND_SZ"
      : regType === "sz"
      ? "REG_SZ"
      : "MISSING";

  const lenColor =
    rawCharLength > 4096
      ? "var(--red)"
      : rawCharLength > 2048
      ? "var(--yellow)"
      : "var(--text-secondary)";

  return (
    <footer className="statusbar">
      <div className="status-group">
        <span className="status-item" title="Current Windows Registry Value Type">
          {regLabel}
        </span>
        <span className="status-item" style={{ color: lenColor }}>
          {rawCharLength.toLocaleString()} / 2,048 chars
        </span>
        <span className="status-item">
          {brokenCount > 0 || duplicateCount > 0 ? (
            <>
              <AlertTriangle size={12} color="var(--yellow)" />
              <span>
                {brokenCount} broken · {duplicateCount} dup
              </span>
            </>
          ) : userConflictCount > 0 ? (
            <>
              <AlertTriangle size={12} color="var(--yellow)" />
              <span>0 broken</span>
            </>
          ) : (
            <>
              <CheckCircle2 size={12} color="var(--green)" />
              <span>Healthy</span>
            </>
          )}
        </span>
        {userConflictCount > 0 && (
          <button
            type="button"
            className="status-link"
            style={{ color: "var(--yellow)" }}
            title="Inspect cross-directory command conflicts"
            onClick={onOpenConflicts}
          >
            <GitCompareArrows size={12} />
            <span>{userConflictCount} conflicts</span>
          </button>
        )}
        <span className="status-item status-effective-hide" style={{ color: "var(--text-muted)" }}>
          Effective: {systemCount} sys + {activeCount} user
        </span>
      </div>

      <div className="status-group">
        {toast && (
          <span className={`toast-pill ${toast.isError ? "err" : ""}`}>
            {toast.message}
          </span>
        )}
        {isDirty && (
          <span className="status-item" style={{ color: "var(--yellow)" }}>
            ● Unsaved Draft
          </span>
        )}
        <button
          type="button"
          className="status-link"
          title={`Open data folder: ${storageDir}`}
          onClick={() => api.openStorageFolder().catch(() => {})}
        >
          <FolderCog size={12} />
          <span>
            {storageMode === "portable"
              ? "Portable: .\\data"
              : "AppData Fallback"}
          </span>
        </button>
      </div>
    </footer>
  );
};
