import React, { useEffect, useMemo, useState } from "react";
import { Archive, Edit3, History, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../api";
import type { BackupRecord, NamedSnapshot, ParkedEntry } from "../types";

interface SnapshotsBackupsViewProps {
  draftActivePaths: string[];
  draftParkedEntries: ParkedEntry[];
  onRestoreToDraft: (
    activePaths: string[],
    parkedEntries: ParkedEntry[],
    label: string
  ) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

type SelectedItem =
  | { kind: "snapshot"; data: NamedSnapshot }
  | { kind: "backup"; data: BackupRecord };

export const SnapshotsBackupsView: React.FC<SnapshotsBackupsViewProps> = ({
  draftActivePaths,
  draftParkedEntries,
  onRestoreToDraft,
  onNotify,
}) => {
  const [snapshots, setSnapshots] = useState<NamedSnapshot[]>([]);
  const [backups, setBackups] = useState<BackupRecord[]>([]);
  const [selected, setSelected] = useState<SelectedItem | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const reloadAll = async () => {
    try {
      const [snaps, bks] = await Promise.all([api.listSnapshots(), api.listBackups()]);
      setSnapshots(snaps);
      setBackups(bks);
      if (!selected) {
        if (snaps.length > 0) setSelected({ kind: "snapshot", data: snaps[0] });
        else if (bks.length > 0) setSelected({ kind: "backup", data: bks[0] });
      }
    } catch (err) {
      onNotify(String(err), true);
    }
  };

  useEffect(() => {
    reloadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSaveSnapshot = async () => {
    if (!newName.trim()) return;
    try {
      if (renamingId) {
        const updated = await api.renameSnapshot(renamingId, newName, newDesc);
        onNotify(`Renamed snapshot "${updated.name}"`);
        setSelected({ kind: "snapshot", data: updated });
      } else {
        const created = await api.saveSnapshot(
          newName,
          newDesc,
          draftActivePaths,
          draftParkedEntries
        );
        onNotify(`Saved snapshot "${created.name}"`);
        setSelected({ kind: "snapshot", data: created });
      }
      setShowCreate(false);
      setRenamingId(null);
      setNewName("");
      setNewDesc("");
      await reloadAll();
    } catch (err) {
      onNotify(String(err), true);
    }
  };

  const handleDeleteSnapshot = async (id: string) => {
    try {
      await api.deleteSnapshot(id);
      if (selected?.kind === "snapshot" && selected.data.id === id) {
        setSelected(null);
      }
      onNotify("Deleted snapshot");
      await reloadAll();
    } catch (err) {
      onNotify(String(err), true);
    }
  };

  const handleDeleteBackup = async (id: string) => {
    try {
      await api.deleteBackup(id);
      if (selected?.kind === "backup" && selected.data.id === id) {
        setSelected(null);
      }
      onNotify("Deleted backup");
      await reloadAll();
    } catch (err) {
      onNotify(String(err), true);
    }
  };

  const diffPreview = useMemo(() => {
    if (!selected) return null;
    const targetPaths = selected.data.activePaths;
    const currentSet = new Set(draftActivePaths);
    const targetSet = new Set(targetPaths);

    const willAdd = targetPaths.filter((p) => !currentSet.has(p));
    const willRemove = draftActivePaths.filter((p) => !targetSet.has(p));
    const unchanged = targetPaths.filter((p) => currentSet.has(p));
    return { targetPaths, willAdd, willRemove, unchanged };
  }, [selected, draftActivePaths]);

  return (
    <div className="split-pane">
      <div className="split-left">
        <div
          className="toolbar"
          style={{ padding: "8px 10px", background: "var(--bg-panel)" }}
        >
          <span style={{ fontWeight: 600 }}>Profiles &amp; Auto-Backups</span>
          <button
            type="button"
            className="btn btn-primary"
            style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
            onClick={() => {
              setRenamingId(null);
              setNewName("");
              setNewDesc("");
              setShowCreate(true);
            }}
          >
            <Plus size={12} />
            <span>Save Draft Snapshot</span>
          </button>
        </div>

        <div className="sidebar-list">
          <div className="section-header">
            <span>Named Snapshots ({snapshots.length})</span>
            <Archive size={11} />
          </div>
          {snapshots.length === 0 && (
            <div style={{ padding: "6px 10px", color: "var(--text-muted)", fontSize: 11.5 }}>
              No named snapshots yet.
            </div>
          )}
          {snapshots.map((snap) => (
            <div
              key={snap.id}
              className={`sidebar-item ${
                selected?.kind === "snapshot" && selected.data.id === snap.id
                  ? "selected"
                  : ""
              }`}
              onClick={() => setSelected({ kind: "snapshot", data: snap })}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <strong style={{ fontSize: 12.5 }}>{snap.name}</strong>
                <span className="badge badge-info">{snap.activePaths.length}</span>
              </div>
              {snap.description && (
                <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 2 }}>
                  {snap.description}
                </div>
              )}
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                {new Date(snap.updatedAt).toLocaleString()}
              </div>
            </div>
          ))}

          <div className="section-header" style={{ marginTop: 12 }}>
            <span>Auto-Backups ({backups.length})</span>
            <History size={11} />
          </div>
          {backups.length === 0 && (
            <div style={{ padding: "6px 10px", color: "var(--text-muted)", fontSize: 11.5 }}>
              Auto-backups are created automatically every time you Apply changes.
            </div>
          )}
          {backups.map((bk) => (
            <div
              key={bk.id}
              className={`sidebar-item ${
                selected?.kind === "backup" && selected.data.id === bk.id
                  ? "selected"
                  : ""
              }`}
              onClick={() => setSelected({ kind: "backup", data: bk })}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontWeight: 600, fontSize: 12 }}>{bk.reason}</span>
                <span className="badge badge-muted">{bk.activePaths.length}</span>
              </div>
              <div style={{ fontSize: 10.5, color: "var(--text-muted)", marginTop: 3 }}>
                {new Date(bk.createdAt).toLocaleString()}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="split-right">
        {!selected || !diffPreview ? (
          <div className="empty-state">
            Select a Snapshot or Auto-Backup on the left to inspect its contents and diff against your current Draft.
          </div>
        ) : (
          <>
            <div className="toolbar">
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>
                  {selected.kind === "snapshot"
                    ? `Snapshot: ${selected.data.name}`
                    : `Auto-Backup: ${selected.data.reason}`}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                  {selected.data.activePaths.length} active ·{" "}
                  {selected.data.parkedEntries.length} parked ·{" "}
                  {new Date(
                    selected.kind === "snapshot"
                      ? selected.data.updatedAt
                      : selected.data.createdAt
                  ).toLocaleString()}
                </div>
              </div>

              <div className="toolbar-group">
                {selected.kind === "snapshot" && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => {
                      setRenamingId(selected.data.id);
                      setNewName(selected.data.name);
                      setNewDesc(selected.data.description);
                      setShowCreate(true);
                    }}
                  >
                    <Edit3 size={13} />
                    <span>Rename</span>
                  </button>
                )}

                <button
                  type="button"
                  className="btn btn-danger"
                  onClick={() =>
                    selected.kind === "snapshot"
                      ? handleDeleteSnapshot(selected.data.id)
                      : handleDeleteBackup(selected.data.id)
                  }
                >
                  <Trash2 size={13} />
                  <span>Delete</span>
                </button>

                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() =>
                    onRestoreToDraft(
                      selected.data.activePaths,
                      selected.data.parkedEntries,
                      selected.kind === "snapshot"
                        ? `snapshot "${selected.data.name}"`
                        : `backup ${selected.data.id}`
                    )
                  }
                >
                  <RotateCcw size={13} />
                  <span>Restore to Draft</span>
                </button>
              </div>
            </div>

            <div className="list-scroll" style={{ padding: 12 }}>
              <div className="section-header" style={{ paddingLeft: 0 }}>
                <span>Diff vs Current Draft</span>
                <span>
                  +{diffPreview.willAdd.length} / -{diffPreview.willRemove.length}
                </span>
              </div>

              <div className="diff-box" style={{ marginBottom: 14 }}>
                {diffPreview.willAdd.map((p, i) => (
                  <div key={`add-${i}`} className="diff-line add selectable">
                    <span>+</span>
                    <span>{p}</span>
                  </div>
                ))}
                {diffPreview.willRemove.map((p, i) => (
                  <div key={`rem-${i}`} className="diff-line rem selectable">
                    <span>-</span>
                    <span>{p}</span>
                  </div>
                ))}
                {diffPreview.willAdd.length === 0 && diffPreview.willRemove.length === 0 && (
                  <div className="diff-line same">
                    Active PATH set matches current Draft (order or parked items may still differ).
                  </div>
                )}
              </div>

              <div className="section-header" style={{ paddingLeft: 0 }}>
                <span>Entries in Selected {selected.kind === "snapshot" ? "Snapshot" : "Backup"}</span>
              </div>
              <div className="diff-box">
                {selected.data.activePaths.map((p, idx) => (
                  <div key={`${idx}-${p}`} className="diff-line same selectable">
                    <span style={{ color: "var(--text-muted)", minWidth: 28 }}>
                      #{String(idx + 1).padStart(2, "0")}
                    </span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      {showCreate && (
        <div className="modal-backdrop">
          <div className="modal-card" style={{ maxWidth: 440 }}>
            <div className="modal-header">
              <span>{renamingId ? "Rename Snapshot" : "Save Current Draft as Snapshot"}</span>
            </div>
            <div className="modal-body">
              <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                Snapshot Name
                <input
                  type="text"
                  className="text-input"
                  style={{ marginTop: 4 }}
                  placeholder="e.g. Work Stack / Node 26"
                  value={newName}
                  autoFocus
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <label style={{ fontSize: 11.5, color: "var(--text-secondary)" }}>
                Description (optional)
                <input
                  type="text"
                  className="text-input"
                  style={{ marginTop: 4 }}
                  placeholder="Notes about this PATH profile"
                  value={newDesc}
                  onChange={(e) => setNewDesc(e.target.value)}
                />
              </label>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setShowCreate(false);
                  setRenamingId(null);
                }}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={!newName.trim()}
                onClick={handleSaveSnapshot}
              >
                Save Snapshot
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
