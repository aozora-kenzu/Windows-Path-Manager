import React, { useCallback, useEffect, useMemo, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { AboutModal } from "./components/AboutModal";
import {
  AddPathModal,
  BulkEditModal,
  CloseConfirmModal,
  DiffApplyModal,
  ImportModeModal,
  PeekDrawer,
} from "./components/Modals";
import { ConflictsView } from "./components/ConflictsView";
import { SnapshotsBackupsView } from "./components/SnapshotsBackupsView";
import { StatusBar } from "./components/StatusBar";
import { SystemPathView } from "./components/SystemPathView";
import { TitleBar } from "./components/TitleBar";
import { UserPathView } from "./components/UserPathView";
import { WhereInspectorView } from "./components/WhereInspectorView";
import { usePathDraft } from "./hooks/usePathDraft";
import type {
  ActiveTab,
  AppInfo,
  AppSettings,
  DirectoryPeek,
  ImportPayload,
  ParkedEntry,
  PathStateSnapshot,
  UpdateCheckResult,
} from "./types";

export const App: React.FC = () => {
  const [snapshot, setSnapshot] = useState<PathStateSnapshot | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>("user");
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showBulkModal, setShowBulkModal] = useState(false);
  const [showApplyModal, setShowApplyModal] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [importPayload, setImportPayload] = useState<ImportPayload | null>(null);
  const [peekData, setPeekData] = useState<DirectoryPeek | null>(null);
  const [conflictFilter, setConflictFilter] = useState("");
  const [toast, setToast] = useState<{ message: string; isError: boolean } | null>(
    null
  );

  const systemPaths = useMemo(
    () => snapshot?.systemEntries.map((e) => e.raw) ?? [],
    [snapshot]
  );

  const {
    draft,
    validation,
    diff,
    canUndo,
    canRedo,
    resetFromCommitted,
    undo,
    redo,
    discardChanges,
    addPath,
    updateActivePath,
    removeActivePath,
    moveActivePath,
    parkActivePath,
    unparkEntry,
    removeParkedEntry,
    setBulkActivePaths,
    cleanIssues,
    applyImported,
  } = usePathDraft(systemPaths, null);

  const notify = useCallback((message: string, isError = false) => {
    setToast({ message, isError });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(id);
  }, [toast]);

  const loadFromRegistry = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const data = await api.loadState();
      setSnapshot(data);
      const nextTheme = data.settings.theme === "light" ? "light" : "dark";
      setTheme(nextTheme);
      document.documentElement.setAttribute("data-theme", nextTheme);

      resetFromCommitted(
        data.userEntries.map((e) => e.raw),
        data.parkedEntries,
        {
          userEntries: data.userEntries,
          parkedInfos: data.parkedInfos,
          systemEntries: data.systemEntries,
          conflicts: data.conflicts,
          rawCharLength: data.rawCharLength,
        }
      );
    } catch (err) {
      setErrorMsg(String(err));
    } finally {
      setLoading(false);
    }
  }, [resetFromCommitted]);

  useEffect(() => {
    loadFromRegistry();
    api.getAppInfo().then(setAppInfo).catch(() => {});
  }, [loadFromRegistry]);

  const handleCheckUpdate = useCallback(async () => {
    setCheckingUpdate(true);
    try {
      const res = await api.checkAppUpdate();
      setUpdateResult(res);
      notify(res.statusMessage);
    } catch (err) {
      notify(String(err), true);
    } finally {
      setCheckingUpdate(false);
    }
  }, [notify]);

  // Global keyboard shortcuts: Ctrl+Z, Ctrl+Y, Ctrl+Shift+Z, Ctrl+S
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTextField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);

      if ((e.ctrlKey || e.metaKey) && !isTextField) {
        if (e.key.toLowerCase() === "z" && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if (
          e.key.toLowerCase() === "y" ||
          (e.key.toLowerCase() === "z" && e.shiftKey)
        ) {
          e.preventDefault();
          redo();
        } else if (e.key.toLowerCase() === "s" && diff.hasChanges) {
          e.preventDefault();
          setShowApplyModal(true);
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undo, redo, diff.hasChanges]);

  const handleToggleTheme = async () => {
    const next: "dark" | "light" = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.setAttribute("data-theme", next);
    if (snapshot) {
      const nextSettings: AppSettings = { ...snapshot.settings, theme: next };
      setSnapshot({ ...snapshot, settings: nextSettings });
      api.saveSettings(nextSettings).catch(() => {});
    }
  };

  const handleApplyConfirm = async () => {
    setApplying(true);
    try {
      const res = await api.applyChanges(
        draft.activePaths,
        draft.parkedEntries,
        "Apply via WindowsPathManager"
      );
      setSnapshot(res.snapshot);
      resetFromCommitted(
        res.snapshot.userEntries.map((e) => e.raw),
        res.snapshot.parkedEntries,
        {
          userEntries: res.snapshot.userEntries,
          parkedInfos: res.snapshot.parkedInfos,
          systemEntries: res.snapshot.systemEntries,
          conflicts: res.snapshot.conflicts,
          rawCharLength: res.snapshot.rawCharLength,
        }
      );
      setShowApplyModal(false);
      notify(
        res.broadcastOk
          ? `Applied (${res.backupId}) & broadcasted WM_SETTINGCHANGE`
          : `Applied (${res.backupId}); broadcast timed out`
      );
    } catch (err) {
      notify(String(err), true);
    } finally {
      setApplying(false);
    }
  };

  const handleImport = async () => {
    try {
      const filePath = await api.pickImportFile();
      if (!filePath) return;
      const payload = await api.importPaths(filePath);
      setImportPayload(payload);
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleExport = async () => {
    try {
      const target = await api.pickExportFile();
      if (!target) return;
      await api.exportPaths(
        target.filePath,
        target.format,
        draft.activePaths,
        draft.parkedEntries
      );
      notify(`Exported ${target.format.toUpperCase()} successfully`);
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handlePeek = async (path: string) => {
    try {
      const peek = await api.peekDirectory(path);
      setPeekData(peek);
    } catch (err) {
      notify(String(err), true);
    }
  };

  const handleRestoreToDraft = (
    activePaths: string[],
    parkedEntries: ParkedEntry[],
    label: string
  ) => {
    applyImported(activePaths, parkedEntries, "replace");
    setActiveTab("user");
    notify(`Loaded ${label} into Draft — click Review & Apply to commit`);
  };

  const handleRequestClose = () => {
    if (diff.hasChanges) {
      setShowCloseConfirm(true);
    } else {
      getCurrentWindow().close().catch(() => {});
    }
  };

  const userInfos = validation?.userEntries ?? snapshot?.userEntries ?? [];
  const parkedInfos = validation?.parkedInfos ?? snapshot?.parkedInfos ?? [];
  const systemInfos = validation?.systemEntries ?? snapshot?.systemEntries ?? [];
  const conflicts = validation?.conflicts ?? snapshot?.conflicts ?? [];
  const userConflictCount = useMemo(
    () => conflicts.filter((c) => c.involvesUser && !c.isNoise).length,
    [conflicts]
  );
  const rawCharLength = validation?.rawCharLength ?? snapshot?.rawCharLength ?? 0;

  const openConflictsForDir = useCallback((dirRaw?: string) => {
    setConflictFilter(dirRaw ?? "");
    setActiveTab("conflicts");
  }, []);

  const brokenCount = userInfos.filter((i) => !i.exists || i.isFileNotDir).length;
  const duplicateCount = userInfos.filter(
    (i) => i.isDuplicateInUser || i.isDuplicateInSystem || i.isSameTargetDuplicate
  ).length;

  return (
    <div className="app-shell">
      <TitleBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        isDirty={diff.hasChanges}
        userCount={draft.activePaths.length}
        parkedCount={draft.parkedEntries.length}
        systemCount={systemInfos.length}
        userConflictCount={userConflictCount}
        hasAppUpdate={Boolean(updateResult?.hasUpdate)}
        appVersion={appInfo?.version ?? "v0.1.0"}
        theme={theme}
        onToggleTheme={handleToggleTheme}
        onRefresh={() => {
          loadFromRegistry();
          notify("Reloaded from Registry");
        }}
        onOpenAbout={() => setShowAboutModal(true)}
        refreshing={loading}
        onRequestClose={handleRequestClose}
      />

      <main className="main-workspace">
        {errorMsg ? (
          <div className="empty-state">
            <div style={{ color: "var(--red)", marginBottom: 10 }}>{errorMsg}</div>
            <button type="button" className="btn" onClick={loadFromRegistry}>
              Retry
            </button>
          </div>
        ) : loading && !snapshot ? (
          <div className="empty-state">Reading HKCU\Environment\Path...</div>
        ) : activeTab === "user" ? (
          <UserPathView
            activePaths={draft.activePaths}
            parkedEntries={draft.parkedEntries}
            userInfos={userInfos}
            parkedInfos={parkedInfos}
            diff={diff}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onDiscard={() => {
              discardChanges();
              notify("Discarded draft changes");
            }}
            onOpenAdd={() => setShowAddModal(true)}
            onOpenBulk={() => setShowBulkModal(true)}
            onOpenApply={() => setShowApplyModal(true)}
            onUpdateActive={updateActivePath}
            onRemoveActive={removeActivePath}
            onMoveActive={moveActivePath}
            onParkActive={parkActivePath}
            onUnpark={unparkEntry}
            onRemoveParked={removeParkedEntry}
            onCleanIssues={() => {
              const removed = cleanIssues();
              notify(
                removed > 0
                  ? `Cleaned ${removed} broken/duplicate entries in Draft`
                  : "No removable issues found"
              );
            }}
            onImport={handleImport}
            onExport={handleExport}
            onPeek={handlePeek}
            onOpenConflictsForDir={openConflictsForDir}
            onNotify={notify}
          />
        ) : activeTab === "system" ? (
          <SystemPathView
            systemEntries={systemInfos}
            onPeek={handlePeek}
            onOpenConflictsForDir={openConflictsForDir}
            onNotify={notify}
          />
        ) : activeTab === "conflicts" ? (
          <ConflictsView
            conflicts={conflicts}
            initialFilter={conflictFilter}
            onClearInitialFilter={() => setConflictFilter("")}
            onParkUserIndex={parkActivePath}
            onMoveUserToTop={(idx) => moveActivePath(idx, 0)}
            onNotify={notify}
          />
        ) : activeTab === "where" ? (
          <WhereInspectorView
            draftActivePaths={draft.activePaths}
            systemPaths={systemPaths}
            onNotify={notify}
          />
        ) : (
          <SnapshotsBackupsView
            draftActivePaths={draft.activePaths}
            draftParkedEntries={draft.parkedEntries}
            onRestoreToDraft={handleRestoreToDraft}
            onNotify={notify}
          />
        )}
      </main>

      <StatusBar
        regType={snapshot?.userRegType ?? "expand_sz"}
        rawCharLength={rawCharLength}
        brokenCount={brokenCount}
        duplicateCount={duplicateCount}
        userConflictCount={userConflictCount}
        activeCount={draft.activePaths.length}
        systemCount={systemInfos.length}
        storageMode={snapshot?.storageMode ?? "portable"}
        storageDir={snapshot?.storageDir ?? ""}
        isDirty={diff.hasChanges}
        toast={toast}
        onOpenConflicts={() => openConflictsForDir("")}
      />

      {showAddModal && (
        <AddPathModal
          systemPaths={systemPaths}
          onClose={() => setShowAddModal(false)}
          onAdd={(p) => {
            addPath(p);
            notify("Added to Draft");
          }}
        />
      )}

      {showBulkModal && (
        <BulkEditModal
          activePaths={draft.activePaths}
          onClose={() => setShowBulkModal(false)}
          onSave={(lines) => {
            setBulkActivePaths(lines);
            notify("Updated Draft from bulk editor");
          }}
        />
      )}

      {showApplyModal && (
        <DiffApplyModal
          diff={diff}
          activePaths={draft.activePaths}
          rawCharLength={rawCharLength}
          applying={applying}
          onClose={() => setShowApplyModal(false)}
          onConfirmApply={handleApplyConfirm}
        />
      )}

      {importPayload && (
        <ImportModeModal
          payload={importPayload}
          onClose={() => setImportPayload(null)}
          onChoose={(mode) => {
            applyImported(
              importPayload.activePaths,
              importPayload.parkedEntries,
              mode
            );
            setImportPayload(null);
            notify(`Imported (${mode}) into Draft`);
          }}
        />
      )}

      {showCloseConfirm && (
        <CloseConfirmModal
          onCancel={() => setShowCloseConfirm(false)}
          onDiscardAndClose={() => getCurrentWindow().close().catch(() => {})}
        />
      )}

      {showAboutModal && (
        <AboutModal
          appInfo={appInfo}
          updateResult={updateResult}
          checking={checkingUpdate}
          onCheckUpdate={handleCheckUpdate}
          onClose={() => setShowAboutModal(false)}
          onNotify={notify}
        />
      )}

      <PeekDrawer peek={peekData} onClose={() => setPeekData(null)} />
    </div>
  );
};

export default App;
