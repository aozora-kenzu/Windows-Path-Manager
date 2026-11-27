import React, { useMemo, useState } from "react";
import { AlertTriangle, Copy, Eye, FolderOpen, Lock, Search, X } from "lucide-react";
import { api } from "../api";
import type { PathEntryInfo } from "../types";
import { PathHighlight } from "./PathHighlight";

interface SystemPathViewProps {
  systemEntries: PathEntryInfo[];
  onPeek: (path: string) => void;
  onOpenConflictsForDir: (dirRaw: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

function formatCmdSummary(cmds: string[], total: number): string {
  const shown = cmds.slice(0, 2).join(", ");
  const rem = total - Math.min(cmds.length, 2);
  return rem > 0 ? `${shown} (+${rem})` : shown;
}

export const SystemPathView: React.FC<SystemPathViewProps> = ({
  systemEntries,
  onPeek,
  onOpenConflictsForDir,
  onNotify,
}) => {
  const [search, setSearch] = useState("");
  const [onlyIssues, setOnlyIssues] = useState(false);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return systemEntries
      .map((info, idx) => ({ info, idx }))
      .filter(({ info }) => {
        if (
          onlyIssues &&
          info.exists &&
          !info.isFileNotDir &&
          !info.hasUnresolvedVars &&
          info.shadowedCount === 0 &&
          info.winningConflictCount === 0 &&
          !info.isSameTargetDuplicate
        ) {
          return false;
        }
        if (!q) return true;
        return (
          info.raw.toLowerCase().includes(q) ||
          info.expanded.toLowerCase().includes(q)
        );
      });
  }, [systemEntries, search, onlyIssues]);

  const issueCount = useMemo(
    () =>
      systemEntries.filter(
        (info) =>
          !info.exists ||
          info.isFileNotDir ||
          info.hasUnresolvedVars ||
          info.shadowedCount > 0 ||
          info.winningConflictCount > 0 ||
          info.isSameTargetDuplicate
      ).length,
    [systemEntries]
  );

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify("Copied System PATH entry");
    } catch {
      onNotify("Clipboard copy failed", true);
    }
  };

  return (
    <>
      <div className="info-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={13} color="var(--accent)" />
          <span>
            <strong>Read-Only View:</strong>{" "}
            <code>HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment\Path</code>{" "}
            (Windows evaluates System PATH before User PATH).
          </span>
        </div>
        <span className="badge badge-muted">Standard User Safe</span>
      </div>

      <div className="toolbar">
        <div className="toolbar-group">
          <div className="search-box">
            <Search size={13} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Filter System PATH..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            {search && (
              <button
                type="button"
                className="icon-btn"
                style={{ width: 18, height: 18 }}
                onClick={() => setSearch("")}
              >
                <X size={11} />
              </button>
            )}
          </div>

          <div className="chip-group">
            <button
              type="button"
              className={`chip-btn ${!onlyIssues ? "active" : ""}`}
              onClick={() => setOnlyIssues(false)}
            >
              All ({systemEntries.length})
            </button>
            <button
              type="button"
              className={`chip-btn ${onlyIssues ? "active" : ""}`}
              onClick={() => setOnlyIssues(true)}
            >
              Issues ({issueCount})
            </button>
          </div>
        </div>
      </div>

      <div className="list-scroll">
        {filtered.map(({ info, idx }) => (
          <div key={`${idx}-${info.raw}`} className="path-row">
            <div className="row-index">S#{String(idx + 1).padStart(2, "0")}</div>
            <div className="row-main">
              <div className="row-path-line">
                <PathHighlight raw={info.raw} />
              </div>
              {info.hasVars && (
                <div className="expanded-subline selectable">
                  <span>-&gt;</span>
                  <span>{info.expanded}</span>
                </div>
              )}
              <div className="badges-row">
                {!info.exists && !info.isFileNotDir && (
                  <span className="badge badge-err">
                    <AlertTriangle size={10} /> Missing Folder
                  </span>
                )}
                {info.isFileNotDir && (
                  <span className="badge badge-err">File, Not Directory</span>
                )}
                {info.hasUnresolvedVars && (
                  <span className="badge badge-warn">Unresolved %VAR%</span>
                )}
                {info.isSameTargetDuplicate && (
                  <span className="badge badge-warn">Same Target (Link)</span>
                )}
                {info.shadowedCount > 0 && (
                  <button
                    type="button"
                    className="badge badge-err badge-btn"
                    title={`Shadowed by: ${info.conflictingDirs.join(", ")}. Click to inspect conflicts.`}
                    onClick={() => onOpenConflictsForDir(info.raw)}
                  >
                    Shadowed: {formatCmdSummary(info.shadowedCommands, info.shadowedCount)}
                  </button>
                )}
                {info.winningConflictCount > 0 && (
                  <button
                    type="button"
                    className="badge badge-warn badge-btn"
                    title={`Shadows commands in: ${info.conflictingDirs.join(", ")}. Click to inspect conflicts.`}
                    onClick={() => onOpenConflictsForDir(info.raw)}
                  >
                    Shadows:{" "}
                    {formatCmdSummary(info.winningConflictCommands, info.winningConflictCount)}
                  </button>
                )}
                {info.exists &&
                  !info.isFileNotDir &&
                  !info.hasUnresolvedVars &&
                  info.shadowedCount === 0 &&
                  info.winningConflictCount === 0 &&
                  !info.isSameTargetDuplicate && <span className="badge badge-ok">OK</span>}
              </div>
            </div>

            <div className="row-actions">
              <button
                type="button"
                className="icon-btn"
                title="Peek folder executables"
                onClick={() => onPeek(info.expanded || info.raw)}
              >
                <Eye size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Open in Explorer"
                disabled={!info.exists}
                onClick={() =>
                  api.openInExplorer(info.expanded || info.raw).catch((e) => onNotify(String(e), true))
                }
              >
                <FolderOpen size={13} />
              </button>
              <button
                type="button"
                className="icon-btn"
                title="Copy path (Shift+Click for expanded)"
                onClick={(e) =>
                  copyText(e.shiftKey && info.hasVars ? info.expanded : info.raw)
                }
              >
                <Copy size={13} />
              </button>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="empty-state">No System PATH entries match this filter.</div>
        )}
      </div>
    </>
  );
};
