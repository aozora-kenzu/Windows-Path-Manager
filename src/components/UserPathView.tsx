import React, { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderOpen,
  FolderPlus,
  GripVertical,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Trash2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { api } from "../api";
import { hasEntryConflict, hasEntryIssue, isAutoCleanable } from "../hooks/usePathDraft";
import type { DraftDiff, ParkedEntry, PathEntryInfo, UserFilter } from "../types";
import { PathHighlight } from "./PathHighlight";

function formatCmdSummary(cmds: string[], total: number): string {
  const shown = cmds.slice(0, 2).join(", ");
  const rem = total - Math.min(cmds.length, 2);
  return rem > 0 ? `${shown} (+${rem})` : shown;
}

interface UserPathViewProps {
  activePaths: string[];
  parkedEntries: ParkedEntry[];
  userInfos: PathEntryInfo[];
  parkedInfos: PathEntryInfo[];
  diff: DraftDiff;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onDiscard: () => void;
  onOpenAdd: () => void;
  onOpenBulk: () => void;
  onOpenApply: () => void;
  onUpdateActive: (index: number, nextRaw: string) => void;
  onRemoveActive: (index: number) => void;
  onMoveActive: (fromIndex: number, toIndex: number) => void;
  onParkActive: (index: number) => void;
  onUnpark: (parkedId: string) => void;
  onRemoveParked: (parkedId: string) => void;
  onCleanIssues: () => void;
  onImport: () => void;
  onExport: () => void;
  onPeek: (rawOrExpanded: string) => void;
  onOpenConflictsForDir: (dirRaw: string) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

export const UserPathView: React.FC<UserPathViewProps> = ({
  activePaths,
  parkedEntries,
  userInfos,
  parkedInfos,
  diff,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onDiscard,
  onOpenAdd,
  onOpenBulk,
  onOpenApply,
  onUpdateActive,
  onRemoveActive,
  onMoveActive,
  onParkActive,
  onUnpark,
  onRemoveParked,
  onCleanIssues,
  onImport,
  onExport,
  onPeek,
  onOpenConflictsForDir,
  onNotify,
}) => {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<UserFilter>("all");
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<{ index: number; pos: "top" | "bottom" } | null>(
    null
  );

  const issueCount = useMemo(
    () => userInfos.filter((info) => hasEntryIssue(info)).length,
    [userInfos]
  );

  const conflictEntryCount = useMemo(
    () => userInfos.filter((info) => hasEntryConflict(info)).length,
    [userInfos]
  );

  const cleanableCount = useMemo(
    () => userInfos.filter((info) => isAutoCleanable(info)).length,
    [userInfos]
  );

  const query = search.trim().toLowerCase();

  const visibleActive = useMemo(() => {
    if (filter === "parked") return [];
    return activePaths
      .map((raw, idx) => ({ raw, idx, info: userInfos[idx] }))
      .filter(({ raw, info }) => {
        if (filter === "issues" && !hasEntryIssue(info)) return false;
        if (filter === "conflicts" && !hasEntryConflict(info)) return false;
        if (!query) return true;
        return (
          raw.toLowerCase().includes(query) ||
          (info?.expanded.toLowerCase().includes(query) ?? false)
        );
      });
  }, [activePaths, userInfos, filter, query]);

  const visibleParked = useMemo(() => {
    if (filter === "active" || filter === "conflicts") return [];
    return parkedEntries
      .map((entry, idx) => ({ entry, info: parkedInfos[idx] }))
      .filter(({ entry, info }) => {
        if (filter === "issues" && !hasEntryIssue(info)) return false;
        if (!query) return true;
        return (
          entry.raw.toLowerCase().includes(query) ||
          (info?.expanded.toLowerCase().includes(query) ?? false)
        );
      });
  }, [parkedEntries, parkedInfos, filter, query]);

  const startEdit = (idx: number, raw: string) => {
    setEditingIndex(idx);
    setEditValue(raw);
  };

  const commitInlineEdit = () => {
    if (editingIndex === null) return;
    if (editValue.trim()) {
      onUpdateActive(editingIndex, editValue.trim());
    }
    setEditingIndex(null);
  };

  const handleBrowseForInline = async () => {
    const picked = await api.pickFolder();
    if (picked) setEditValue(picked);
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      onNotify(`Copied ${label}`);
    } catch {
      onNotify("Clipboard copy failed", true);
    }
  };

  const handleExplorer = async (path: string) => {
    try {
      await api.openInExplorer(path);
    } catch (err) {
      onNotify(String(err), true);
    }
  };

  const canDrag = !query && (filter === "all" || filter === "active");

  return (
    <>
      <div className="toolbar">
        <div className="toolbar-group">
          <div className="search-box">
            <Search size={13} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Filter User PATH..."
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
              className={`chip-btn ${filter === "all" ? "active" : ""}`}
              onClick={() => setFilter("all")}
            >
              All ({activePaths.length + parkedEntries.length})
            </button>
            <button
              type="button"
              className={`chip-btn ${filter === "active" ? "active" : ""}`}
              onClick={() => setFilter("active")}
            >
              Active ({activePaths.length})
            </button>
            <button
              type="button"
              className={`chip-btn ${filter === "parked" ? "active" : ""}`}
              onClick={() => setFilter("parked")}
            >
              Parked ({parkedEntries.length})
            </button>
            <button
              type="button"
              className={`chip-btn ${filter === "issues" ? "active" : ""}`}
              onClick={() => setFilter("issues")}
            >
              Issues ({issueCount})
            </button>
            <button
              type="button"
              className={`chip-btn ${filter === "conflicts" ? "active" : ""}`}
              onClick={() => setFilter("conflicts")}
            >
              Conflicts ({conflictEntryCount})
            </button>
          </div>
        </div>

        <div className="toolbar-group">
          <button type="button" className="btn" onClick={onOpenAdd}>
            <Plus size={13} />
            <span>Add Path</span>
          </button>
          <button type="button" className="btn" onClick={onOpenBulk}>
            <FileText size={13} />
            <span>Bulk Edit</span>
          </button>
          <button
            type="button"
            className="btn btn-warn"
            disabled={cleanableCount === 0}
            onClick={onCleanIssues}
            title="Remove missing directories and exact duplicate entries in User/System PATH"
          >
            <Sparkles size={13} />
            <span>Clean ({cleanableCount})</span>
          </button>

          <div style={{ width: 1, height: 18, background: "var(--border-subtle)" }} />

          <button
            type="button"
            className="icon-btn"
            title="Undo (Ctrl+Z)"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Redo (Ctrl+Y)"
            disabled={!canRedo}
            onClick={onRedo}
          >
            <Redo2 size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Import JSON/TXT"
            onClick={onImport}
          >
            <Upload size={14} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Export JSON/TXT"
            onClick={onExport}
          >
            <Download size={14} />
          </button>

          {diff.hasChanges && (
            <button
              type="button"
              className="btn"
              onClick={onDiscard}
              title="Discard all draft edits"
            >
              <RotateCcw size={13} />
              <span>Discard</span>
            </button>
          )}

          <button
            type="button"
            className="btn btn-primary"
            disabled={!diff.hasChanges}
            onClick={onOpenApply}
          >
            <Save size={13} />
            <span>Review &amp; Apply</span>
          </button>
        </div>
      </div>

      <div className="list-scroll">
        {visibleActive.length > 0 && (
          <>
            <div className="section-header">
              <span>Active User PATH (HKCU\Environment\Path)</span>
              <span>
                {canDrag
                  ? "Drag handle or arrows to reorder precedence"
                  : "Clear filter to drag-reorder"}
              </span>
            </div>

            {visibleActive.map(({ raw, idx, info }) => {
              const isEditing = editingIndex === idx;
              const dragClass =
                dragOver && dragOver.index === idx
                  ? dragOver.pos === "top"
                    ? "drag-over-top"
                    : "drag-over-bottom"
                  : "";

              return (
                <div
                  key={`${idx}-${raw}`}
                  className={`path-row ${dragClass}`}
                  draggable={canDrag && !isEditing}
                  onDragStart={() => setDragIndex(idx)}
                  onDragOver={(e) => {
                    if (!canDrag || dragIndex === null || dragIndex === idx) return;
                    e.preventDefault();
                    const rect = e.currentTarget.getBoundingClientRect();
                    const pos = e.clientY - rect.top < rect.height / 2 ? "top" : "bottom";
                    setDragOver({ index: idx, pos });
                  }}
                  onDragLeave={() => {
                    if (dragOver?.index === idx) setDragOver(null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragIndex !== null && dragOver) {
                      let target = dragOver.index;
                      if (dragOver.pos === "bottom") target += 1;
                      if (dragIndex < target) target -= 1;
                      onMoveActive(dragIndex, target);
                    }
                    setDragIndex(null);
                    setDragOver(null);
                  }}
                  onDragEnd={() => {
                    setDragIndex(null);
                    setDragOver(null);
                  }}
                >
                  <div
                    className="drag-handle"
                    style={{ opacity: canDrag ? 0.8 : 0.25 }}
                    title={canDrag ? "Drag to reorder" : "Clear search/filter to drag"}
                  >
                    <GripVertical size={14} />
                  </div>

                  <div className="row-index">#{String(idx + 1).padStart(2, "0")}</div>

                  <div className="row-toggle">
                    <button
                      type="button"
                      className="switch-btn on"
                      title="Park (temporarily disable without deleting)"
                      onClick={() => onParkActive(idx)}
                    >
                      <span className="switch-thumb" />
                    </button>
                  </div>

                  <div className="row-main">
                    {isEditing ? (
                      <div className="inline-edit-wrap">
                        <input
                          type="text"
                          className="text-input"
                          value={editValue}
                          autoFocus
                          onChange={(e) => setEditValue(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") commitInlineEdit();
                            if (e.key === "Escape") setEditingIndex(null);
                          }}
                        />
                        <button
                          type="button"
                          className="icon-btn"
                          title="Browse folder"
                          onClick={handleBrowseForInline}
                        >
                          <FolderPlus size={14} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Save edit"
                          onClick={commitInlineEdit}
                        >
                          <Check size={14} color="var(--green)" />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Cancel"
                          onClick={() => setEditingIndex(null)}
                        >
                          <X size={14} />
                        </button>
                      </div>
                    ) : (
                      <>
                        <div
                          className="row-path-line"
                          onDoubleClick={() => startEdit(idx, raw)}
                        >
                          <PathHighlight raw={raw} />
                        </div>

                        {info?.hasVars && (
                          <div className="expanded-subline selectable">
                            <span>-&gt;</span>
                            <span>{info.expanded}</span>
                          </div>
                        )}

                        <div className="badges-row">
                          {info?.hasVars && (
                            <span className="badge badge-info">REG_EXPAND_SZ</span>
                          )}
                          {info && !info.exists && !info.isFileNotDir && (
                            <span className="badge badge-err">
                              <AlertTriangle size={10} /> Missing Folder
                            </span>
                          )}
                          {info?.isFileNotDir && (
                            <span className="badge badge-err">File, Not Directory</span>
                          )}
                          {info?.hasUnresolvedVars && (
                            <span className="badge badge-warn">Unresolved %VAR%</span>
                          )}
                          {info?.isDuplicateInUser && (
                            <span className="badge badge-warn">Duplicate in User</span>
                          )}
                          {info?.isDuplicateInSystem && (
                            <span className="badge badge-warn">Already in System PATH</span>
                          )}
                          {info?.isSameTargetDuplicate && (
                            <span className="badge badge-warn">Same Target (Link)</span>
                          )}
                          {info && info.shadowedCount > 0 && (
                            <button
                              type="button"
                              className="badge badge-err badge-btn"
                              title={`Shadowed by: ${info.conflictingDirs.join(", ")}. Click to inspect conflicts.`}
                              onClick={() => onOpenConflictsForDir(raw)}
                            >
                              Shadowed: {formatCmdSummary(info.shadowedCommands, info.shadowedCount)}
                            </button>
                          )}
                          {info && info.winningConflictCount > 0 && (
                            <button
                              type="button"
                              className="badge badge-warn badge-btn"
                              title={`Shadows commands in: ${info.conflictingDirs.join(", ")}. Click to inspect conflicts.`}
                              onClick={() => onOpenConflictsForDir(raw)}
                            >
                              Shadows:{" "}
                              {formatCmdSummary(
                                info.winningConflictCommands,
                                info.winningConflictCount
                              )}
                            </button>
                          )}
                          {info?.hasWhitespaceOrQuotes && (
                            <span className="badge badge-warn">Extra Quotes/Spaces</span>
                          )}
                          {info && !hasEntryIssue(info) && (
                            <span className="badge badge-ok">OK</span>
                          )}
                        </div>
                      </>
                    )}
                  </div>

                  {!isEditing && (
                    <div className="row-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move Up"
                        disabled={idx === 0}
                        onClick={() => onMoveActive(idx, idx - 1)}
                      >
                        <ArrowUp size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Move Down"
                        disabled={idx === activePaths.length - 1}
                        onClick={() => onMoveActive(idx, idx + 1)}
                      >
                        <ArrowDown size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit inline"
                        onClick={() => startEdit(idx, raw)}
                      >
                        <Edit3 size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Peek folder executables"
                        onClick={() => onPeek(info?.expanded || raw)}
                      >
                        <Eye size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title="Open in Windows Explorer"
                        disabled={!info?.exists}
                        onClick={() => handleExplorer(info?.expanded || raw)}
                      >
                        <FolderOpen size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        title={
                          info?.hasVars
                            ? "Copy raw path (Shift+Click to copy expanded)"
                            : "Copy path"
                        }
                        onClick={(e) =>
                          copyText(
                            e.shiftKey && info?.expanded ? info.expanded : raw,
                            e.shiftKey && info?.hasVars ? "expanded path" : "raw path"
                          )
                        }
                      >
                        <Copy size={13} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete from Draft"
                        onClick={() => onRemoveActive(idx)}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {visibleParked.length > 0 && (
          <>
            <div className="section-header" style={{ marginTop: 14 }}>
              <span>Parked Entries (Temporarily Disabled — Stored Locally)</span>
              <span>Toggle ON to restore into Active PATH</span>
            </div>

            {visibleParked.map(({ entry, info }) => (
              <div key={entry.id} className="path-row parked">
                <div className="drag-handle" style={{ opacity: 0.2 }}>
                  <GripVertical size={14} />
                </div>
                <div className="row-index">PARK</div>
                <div className="row-toggle">
                  <button
                    type="button"
                    className="switch-btn"
                    title="Re-enable into Active PATH"
                    onClick={() => onUnpark(entry.id)}
                  >
                    <span className="switch-thumb" />
                  </button>
                </div>

                <div className="row-main">
                  <div className="row-path-line">
                    <PathHighlight raw={entry.raw} className="parked-strike" />
                  </div>
                  {info?.hasVars && (
                    <div className="expanded-subline selectable">
                      <span>-&gt;</span>
                      <span>{info.expanded}</span>
                    </div>
                  )}
                  <div className="badges-row">
                    <span className="badge badge-muted">Parked</span>
                    {info && !info.exists && !info.isFileNotDir && (
                      <span className="badge badge-err">Missing Folder</span>
                    )}
                    {info?.isDuplicateInUser && (
                      <span className="badge badge-warn">Already Active in User</span>
                    )}
                    {info?.isDuplicateInSystem && (
                      <span className="badge badge-warn">Already in System PATH</span>
                    )}
                  </div>
                </div>

                <div className="row-actions">
                  <button
                    type="button"
                    className="icon-btn"
                    title="Peek folder"
                    onClick={() => onPeek(info?.expanded || entry.raw)}
                  >
                    <Eye size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn"
                    title="Copy path"
                    onClick={() => copyText(entry.raw, "parked path")}
                  >
                    <Copy size={13} />
                  </button>
                  <button
                    type="button"
                    className="icon-btn danger"
                    title="Delete parked entry permanently"
                    onClick={() => onRemoveParked(entry.id)}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            ))}
          </>
        )}

        {visibleActive.length === 0 && visibleParked.length === 0 && (
          <div className="empty-state">
            No PATH entries match the current filter.
          </div>
        )}
      </div>
    </>
  );
};
