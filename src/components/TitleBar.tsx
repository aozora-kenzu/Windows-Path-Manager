import React, { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Archive,
  FolderGit2,
  GitCompareArrows,
  Info,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  RefreshCw,
  SearchCode,
  Shield,
  Sun,
  X,
} from "lucide-react";
import type { ActiveTab } from "../types";

interface TitleBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  isDirty: boolean;
  userCount: number;
  parkedCount: number;
  systemCount: number;
  userConflictCount: number;
  hasAppUpdate: boolean;
  appVersion: string;
  theme: "dark" | "light";
  onToggleTheme: () => void;
  onRefresh: () => void;
  onOpenAbout: () => void;
  refreshing: boolean;
  onRequestClose: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  activeTab,
  onSelectTab,
  isDirty,
  userCount,
  parkedCount,
  systemCount,
  userConflictCount,
  hasAppUpdate,
  appVersion,
  theme,
  onToggleTheme,
  onRefresh,
  onOpenAbout,
  refreshing,
  onRequestClose,
}) => {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    win.isMaximized().then(setMaximized).catch(() => {});
    const unlistenPromise = win.onResized(async () => {
      try {
        setMaximized(await win.isMaximized());
      } catch {
        // Ignore
      }
    });
    return () => {
      unlistenPromise.then((u) => u()).catch(() => {});
    };
  }, []);

  const handleMinimize = () => getCurrentWindow().minimize().catch(() => {});
  const handleToggleMax = () => getCurrentWindow().toggleMaximize().catch(() => {});

  return (
    <div className="chrome-top">
      <header className="titlebar">
        <div className="titlebar-brand" data-tauri-drag-region>
          <span className="brand-mark" data-tauri-drag-region>
            &gt;_
          </span>
          <span data-tauri-drag-region>WindowsPathManager</span>
          <span className="brand-version-pill" data-tauri-drag-region>
            {appVersion}
          </span>
          <span className="brand-scope-pill" data-tauri-drag-region>
            HKCU User
          </span>
        </div>

        <div
          className="titlebar-drag-spacer"
          data-tauri-drag-region
          onDoubleClick={handleToggleMax}
        />

        <div className="titlebar-right">
          <div className="titlebar-actions">
            <button
              type="button"
              className="btn title-about-btn"
              title="About WindowsPathManager & Check for Updates"
              onClick={onOpenAbout}
            >
              <Info size={13} />
              <span>About</span>
              {hasAppUpdate && <span className="update-dot" title="Update available" />}
            </button>
            <button
              type="button"
              className="icon-btn"
              title="Reload PATH from Windows Registry"
              onClick={onRefresh}
              disabled={refreshing}
            >
              <RefreshCw size={13} className={refreshing ? "spin" : ""} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={theme === "dark" ? "Switch to Zed One Light" : "Switch to Zed One Dark"}
              onClick={onToggleTheme}
            >
              {theme === "dark" ? <Sun size={13} /> : <Moon size={13} />}
            </button>
          </div>

          <div className="win-controls">
            <button
              type="button"
              className="win-btn"
              aria-label="Minimize"
              onClick={handleMinimize}
            >
              <Minus size={14} />
            </button>
            <button
              type="button"
              className="win-btn"
              aria-label={maximized ? "Restore" : "Maximize"}
              onClick={handleToggleMax}
            >
              {maximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
            </button>
            <button
              type="button"
              className="win-btn close"
              aria-label="Close"
              onClick={onRequestClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>
      </header>

      <nav className="tabbar" aria-label="Workspace tabs">
        <button
          type="button"
          className={`tab-btn ${activeTab === "user" ? "active" : ""}`}
          onClick={() => onSelectTab("user")}
        >
          <FolderGit2 size={13} />
          <span>User PATH</span>
          <span className="tab-count">
            {userCount}
            {parkedCount > 0 ? `+${parkedCount}p` : ""}
          </span>
          {isDirty && <span className="dirty-dot" title="Unapplied draft changes" />}
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "system" ? "active" : ""}`}
          onClick={() => onSelectTab("system")}
        >
          <Shield size={13} />
          <span>System PATH</span>
          <span className="tab-count">{systemCount}</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "conflicts" ? "active" : ""}`}
          onClick={() => onSelectTab("conflicts")}
        >
          <GitCompareArrows size={13} />
          <span>Conflicts</span>
          {userConflictCount > 0 && (
            <span className="badge badge-warn" style={{ padding: "0 5px", fontSize: 10 }}>
              {userConflictCount}
            </span>
          )}
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "where" ? "active" : ""}`}
          onClick={() => onSelectTab("where")}
        >
          <SearchCode size={13} />
          <span>where Inspector</span>
        </button>

        <button
          type="button"
          className={`tab-btn ${activeTab === "snapshots" ? "active" : ""}`}
          onClick={() => onSelectTab("snapshots")}
        >
          <Archive size={13} />
          <span>Snapshots &amp; Backups</span>
        </button>
      </nav>
    </div>
  );
};
