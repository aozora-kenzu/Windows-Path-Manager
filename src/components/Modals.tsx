import React, { useEffect, useState } from "react";
import { AlertTriangle, Folder, FolderPlus, Terminal, X } from "lucide-react";
import { api } from "../api";
import type {
  DirectoryPeek,
  DraftDiff,
  ImportPayload,
  PathEntryInfo,
} from "../types";

export const AddPathModal: React.FC<{
  systemPaths: string[];
  onClose: () => void;
  onAdd: (path: string) => void;
}> = ({ systemPaths, onClose, onAdd }) => {
  const [value, setValue] = useState("");
  const [preview, setPreview] = useState<PathEntryInfo | null>(null);

  useEffect(() => {
    const trimmed = value.trim();
    if (!trimmed) {
      setPreview(null);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const res = await api.validateDraft([trimmed], [], systemPaths);
        setPreview(res.userEntries[0] ?? null);
      } catch {
        setPreview(null);
      }
    }, 120);
    return () => window.clearTimeout(timer);
  }, [value, systemPaths]);

  const browse = async () => {
    const picked = await api.pickFolder();
    if (picked) setValue(picked);
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <span>Add Entry to User PATH</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 6 }}>
            <input
              type="text"
              className="text-input"
              placeholder="e.g. %USERPROFILE%\.local\bin or C:\Tools\bin"
              value={value}
              autoFocus
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && value.trim()) {
                  onAdd(value.trim());
                  onClose();
                }
              }}
            />
            <button type="button" className="btn" onClick={browse}>
              <FolderPlus size={13} />
              <span>Browse...</span>
            </button>
          </div>

          {preview && (
            <div
              style={{
                padding: 10,
                borderRadius: 4,
                border: "1px solid var(--border-subtle)",
                background: "var(--bg-panel)",
                fontSize: 11.5,
              }}
            >
              {preview.hasVars && (
                <div style={{ marginBottom: 4 }}>
                  <span style={{ color: "var(--text-muted)" }}>Expanded: </span>
                  <span className="selectable">{preview.expanded}</span>
                </div>
              )}
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {preview.exists ? (
                  <span className="badge badge-ok">Directory exists</span>
                ) : preview.isFileNotDir ? (
                  <span className="badge badge-err">Points to a file, not a directory</span>
                ) : (
                  <span className="badge badge-warn">Directory not found on disk</span>
                )}
                {preview.hasVars && (
                  <span className="badge badge-info">Preserved as REG_EXPAND_SZ</span>
                )}
                {preview.isDuplicateInSystem && (
                  <span className="badge badge-warn">Already present in System PATH</span>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!value.trim()}
            onClick={() => {
              onAdd(value.trim());
              onClose();
            }}
          >
            Add to Draft
          </button>
        </div>
      </div>
    </div>
  );
};

export const BulkEditModal: React.FC<{
  activePaths: string[];
  onClose: () => void;
  onSave: (lines: string[]) => void;
}> = ({ activePaths, onClose, onSave }) => {
  const [text, setText] = useState(() => activePaths.join("\n"));
  const lineCount = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean).length;

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <span>Bulk Raw Text Editor (1 Path per Line)</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
            Edit, paste, or reorder active User PATH entries directly. Blank lines are ignored.
          </div>
          <textarea
            className="textarea-input"
            rows={15}
            value={text}
            autoFocus
            onChange={(e) => setText(e.target.value)}
          />
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
            Parsed entries: {lineCount} · Joined length:{" "}
            {text
              .split(/\r?\n/)
              .map((l) => l.trim())
              .filter(Boolean)
              .join(";").length}{" "}
            chars
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              onSave(text.split(/\r?\n/));
              onClose();
            }}
          >
            Update Draft
          </button>
        </div>
      </div>
    </div>
  );
};

export const DiffApplyModal: React.FC<{
  diff: DraftDiff;
  activePaths: string[];
  rawCharLength: number;
  applying: boolean;
  onClose: () => void;
  onConfirmApply: () => void;
}> = ({ diff, activePaths, rawCharLength, applying, onClose, onConfirmApply }) => {
  const hasVars = activePaths.some((p) => p.includes("%"));

  return (
    <div className="modal-backdrop">
      <div className="modal-card" style={{ maxWidth: 660 }}>
        <div className="modal-header">
          <span>Review &amp; Apply Changes to HKCU\Environment\Path</span>
          <button type="button" className="icon-btn" onClick={onClose} disabled={applying}>
            <X size={14} />
          </button>
        </div>
        <div className="modal-body">
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <span className="badge badge-info">
              Write Type: {hasVars ? "REG_EXPAND_SZ" : "REG_EXPAND_SZ (preferred)"}
            </span>
            <span
              className={`badge ${
                rawCharLength > 4096
                  ? "badge-err"
                  : rawCharLength > 2048
                  ? "badge-warn"
                  : "badge-ok"
              }`}
            >
              Total Length: {rawCharLength.toLocaleString()} chars
            </span>
            <span className="badge badge-muted">Auto-Backup before write</span>
            <span className="badge badge-muted">WM_SETTINGCHANGE broadcast</span>
          </div>

          {rawCharLength > 2048 && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                borderRadius: 4,
                background: rawCharLength > 4096 ? "var(--red-bg)" : "var(--yellow-bg)",
                color: rawCharLength > 4096 ? "var(--red)" : "var(--yellow)",
                fontSize: 11.5,
              }}
            >
              <AlertTriangle size={14} />
              <span>
                {rawCharLength > 4096
                  ? "PATH exceeds 4,096 characters. Some legacy shells/tools truncate long PATH strings."
                  : "PATH exceeds 2,048 characters (legacy Windows CMD/setx warning threshold)."}
              </span>
            </div>
          )}

          <div className="diff-box">
            {diff.added.map((p, i) => (
              <div key={`a-${i}`} className="diff-line add selectable">
                <span>+</span>
                <span>{p}</span>
              </div>
            ))}
            {diff.removed.map((p, i) => (
              <div key={`r-${i}`} className="diff-line rem selectable">
                <span>-</span>
                <span>{p}</span>
              </div>
            ))}
            {diff.reordered && (
              <div className="diff-line mod">
                <span>~</span>
                <span>Entry precedence order changed ({activePaths.length} active entries)</span>
              </div>
            )}
            {diff.parkedChanged && (
              <div className="diff-line mod">
                <span>~</span>
                <span>Parked entries metadata updated</span>
              </div>
            )}
          </div>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn" onClick={onClose} disabled={applying}>
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={applying}
            onClick={onConfirmApply}
          >
            {applying ? "Applying & Broadcasting..." : "Confirm & Write Registry"}
          </button>
        </div>
      </div>
    </div>
  );
};

export const ImportModeModal: React.FC<{
  payload: ImportPayload;
  onClose: () => void;
  onChoose: (mode: "replace" | "merge") => void;
}> = ({ payload, onClose, onChoose }) => (
  <div className="modal-backdrop">
    <div className="modal-card" style={{ maxWidth: 460 }}>
      <div className="modal-header">
        <span>Import PATH Entries ({payload.format.toUpperCase()})</span>
        <button type="button" className="icon-btn" onClick={onClose}>
          <X size={14} />
        </button>
      </div>
      <div className="modal-body">
        <div style={{ fontSize: 12 }}>
          Loaded <strong>{payload.activePaths.length}</strong> active entries
          {payload.parkedEntries.length > 0
            ? ` and ${payload.parkedEntries.length} parked entries`
            : ""}
          . How would you like to apply them to your Draft?
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <button type="button" className="btn" onClick={() => onChoose("merge")}>
          Merge Unique into Draft
        </button>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => onChoose("replace")}
        >
          Replace Draft
        </button>
      </div>
    </div>
  </div>
);

export const CloseConfirmModal: React.FC<{
  onCancel: () => void;
  onDiscardAndClose: () => void;
}> = ({ onCancel, onDiscardAndClose }) => (
  <div className="modal-backdrop">
    <div className="modal-card" style={{ maxWidth: 430 }}>
      <div className="modal-header">
        <span>Unsaved Draft Changes</span>
      </div>
      <div className="modal-body">
        <div style={{ fontSize: 12 }}>
          You have unapplied edits in your User PATH Draft. Changes are not written to the Windows Registry until you click <strong>Review &amp; Apply</strong>.
        </div>
      </div>
      <div className="modal-footer">
        <button type="button" className="btn" onClick={onCancel}>
          Return to App
        </button>
        <button type="button" className="btn btn-danger" onClick={onDiscardAndClose}>
          Discard Draft &amp; Close
        </button>
      </div>
    </div>
  </div>
);

export const PeekDrawer: React.FC<{
  peek: DirectoryPeek | null;
  onClose: () => void;
}> = ({ peek, onClose }) => {
  if (!peek) return null;
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <div className="drawer-panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Folder Peek</span>
          <button type="button" className="icon-btn" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div
          style={{
            padding: "8px 12px",
            borderBottom: "1px solid var(--border-subtle)",
            background: "var(--bg-panel)",
            fontSize: 11.5,
            wordBreak: "break-all",
          }}
          className="selectable"
        >
          {peek.dirExpanded}
        </div>
        <div className="list-scroll" style={{ padding: 12 }}>
          {!peek.exists ? (
            <div className="empty-state">Directory does not exist on disk.</div>
          ) : !peek.isDir ? (
            <div className="empty-state">Target exists but is a file, not a directory.</div>
          ) : (
            <>
              <div className="section-header" style={{ paddingLeft: 0 }}>
                <span>Executables ({peek.executables.length})</span>
                <span>Total items: {peek.totalItems}{peek.truncated ? "+" : ""}</span>
              </div>
              {peek.executables.length === 0 ? (
                <div style={{ fontSize: 11.5, color: "var(--text-muted)", marginBottom: 12 }}>
                  No .exe / .cmd / .bat / .ps1 / .com files found in top 200 items.
                </div>
              ) : (
                <div className="diff-box" style={{ marginBottom: 14 }}>
                  {peek.executables.map((item) => (
                    <div key={item.name} className="diff-line same selectable">
                      <Terminal size={12} color="var(--green)" />
                      <span style={{ flex: 1 }}>{item.name}</span>
                      <span style={{ color: "var(--text-muted)", fontSize: 11 }}>
                        {(item.size / 1024).toFixed(1)} KB
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="section-header" style={{ paddingLeft: 0 }}>
                <span>Other Items ({peek.otherItems.length})</span>
              </div>
              <div className="diff-box">
                {peek.otherItems.map((item) => (
                  <div key={item.name} className="diff-line same selectable">
                    {item.isDir ? (
                      <Folder size={12} color="var(--accent)" />
                    ) : (
                      <span style={{ width: 12 }} />
                    )}
                    <span style={{ flex: 1 }}>{item.name}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
