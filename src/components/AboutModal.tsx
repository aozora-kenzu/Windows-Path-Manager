import React, { useState } from "react";
import { Download, ExternalLink, RefreshCw, Send, X } from "lucide-react";
import { api } from "../api";
import type { AppInfo, UpdateCheckResult } from "../types";

interface AboutModalProps {
  appInfo: AppInfo | null;
  updateResult: UpdateCheckResult | null;
  checking: boolean;
  onCheckUpdate: () => Promise<void>;
  onClose: () => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

function formatSize(bytes: number | null): string {
  if (!bytes) return "";
  return ` (${(bytes / (1024 * 1024)).toFixed(2)} MB)`;
}

export const AboutModal: React.FC<AboutModalProps> = ({
  appInfo,
  updateResult,
  checking,
  onCheckUpdate,
  onClose,
  onNotify,
}) => {
  const [updating, setUpdating] = useState(false);

  const openUrl = (url: string) => {
    api.openExternalUrl(url).catch((err) => onNotify(String(err), true));
  };

  const openFolder = (path: string) => {
    api.openInExplorer(path).catch((err) => onNotify(String(err), true));
  };

  const handleUpdateAndRestart = async () => {
    if (!updateResult?.assetDownloadUrl) return;
    setUpdating(true);
    try {
      await api.downloadAndApplyUpdate(updateResult.assetDownloadUrl);
    } catch (err) {
      onNotify(String(err), true);
      setUpdating(false);
    }
  };

  const version = appInfo?.version ?? "v0.1.0";
  const githubRepo =
    appInfo?.githubRepo ?? "https://github.com/aozora-kenzu/Windows-Path-Manager";
  const telegramUrl = appInfo?.telegram ?? "https://t.me/AozoraKZ";

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card about-modal-card"
        style={{ maxWidth: 680 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span>About WindowsPathManager</span>
          <button type="button" className="icon-btn" onClick={onClose} disabled={updating}>
            <X size={14} />
          </button>
        </div>

        <div className="modal-body" style={{ gap: 12 }}>
          <div className="about-hero">
            <div className="about-hero-icon">&gt;_</div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span style={{ fontSize: 16, fontWeight: 700, color: "var(--text-primary)" }}>
                  {appInfo?.name ?? "WindowsPathManager"}
                </span>
                <span className="badge badge-ok" style={{ fontSize: 11.5, padding: "2px 8px" }}>
                  {version}
                </span>
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                Portable Windows User PATH Manager (Standard User · Zero UAC)
              </div>
            </div>
          </div>

          <div className="about-card about-update-card">
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ fontWeight: 700, fontSize: 12.5, color: "var(--text-primary)" }}>
                Application Update
              </div>
              <div style={{ fontSize: 11.5, color: "var(--text-secondary)", marginTop: 3 }}>
                {updating ? (
                  "Downloading update and replacing portable binary..."
                ) : updateResult ? (
                  <>
                    <span
                      style={{
                        color: updateResult.hasUpdate ? "var(--yellow)" : "var(--text-secondary)",
                        fontWeight: updateResult.hasUpdate ? 600 : 400,
                      }}
                    >
                      {updateResult.statusMessage}
                    </span>
                    <span style={{ color: "var(--text-muted)" }}>
                      {" "}
                      · Last checked: {updateResult.checkedAt}
                    </span>
                  </>
                ) : (
                  `Current version ${version} · Check GitHub Releases for updates`
                )}
              </div>

              {updateResult?.hasUpdate && updateResult.releaseNotes && (
                <div className="about-release-notes selectable">
                  {updateResult.releaseNotes}
                </div>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                disabled={checking || updating}
                onClick={onCheckUpdate}
              >
                <RefreshCw size={12} className={checking ? "spin" : ""} />
                <span>{checking ? "Checking..." : "Check App Update"}</span>
              </button>

              {updateResult?.hasUpdate && updateResult.assetDownloadUrl && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={updating}
                  onClick={handleUpdateAndRestart}
                >
                  <Download size={12} />
                  <span>
                    {updating
                      ? "Updating..."
                      : `Update & Restart${formatSize(updateResult.assetSize)}`}
                  </span>
                </button>
              )}

              {updateResult?.hasUpdate && !updateResult.assetDownloadUrl && (
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => openUrl(updateResult.releaseUrl)}
                >
                  <ExternalLink size={12} />
                  <span>Open Release</span>
                </button>
              )}
            </div>
          </div>

          <div className="about-card">
            <div style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.55 }}>
              Portable Windows desktop utility for managing <code>HKCU\Environment\Path</code>{" "}
              cleanly without Administrator privileges — featuring Draft &amp; Apply diffs,{" "}
              <code>%VAR%</code> (<code>REG_EXPAND_SZ</code>) preservation, cross-directory
              conflict detection, <code>where</code> precedence inspection, temporary parking, and
              named snapshots.
            </div>
          </div>

          <div className="about-card">
            <div className="about-meta-grid">
              <span className="about-meta-label">Version</span>
              <span className="about-meta-value" style={{ color: "var(--cyan)" }}>
                {version}
              </span>

              <span className="about-meta-label">Developer</span>
              <span className="about-meta-value">{appInfo?.developer ?? "AKZ Team"}</span>

              <span className="about-meta-label">Email</span>
              <button
                type="button"
                className="about-meta-link"
                onClick={() => openUrl(`mailto:${appInfo?.email ?? "aozora@botsec.dev"}`)}
              >
                {appInfo?.email ?? "aozora@botsec.dev"}
              </button>

              <span className="about-meta-label">Website</span>
              <button
                type="button"
                className="about-meta-link"
                onClick={() => openUrl(appInfo?.website ?? "https://botsec.dev")}
              >
                {appInfo?.website ?? "https://botsec.dev"}
              </button>

              <span className="about-meta-label">Telegram</span>
              <button
                type="button"
                className="about-meta-link"
                onClick={() => openUrl(telegramUrl)}
              >
                {telegramUrl}
              </button>

              <span className="about-meta-label">GitHub Repo</span>
              <button
                type="button"
                className="about-meta-link"
                onClick={() => openUrl(githubRepo)}
              >
                {githubRepo}
              </button>

              <span className="about-meta-label">License</span>
              <span className="about-meta-value">
                {appInfo?.license ?? "MIT License (Copyright © 2026 AKZ Team)"}
              </span>

              <span className="about-meta-label">Built With</span>
              <span className="about-meta-value">
                {appInfo?.builtWith ?? "Rust + Tauri v2 + React + TypeScript"}
              </span>

              <span className="about-meta-label">App Folder</span>
              <button
                type="button"
                className="about-meta-link selectable"
                style={{ color: "var(--cyan)" }}
                onClick={() => appInfo?.appFolder && openFolder(appInfo.appFolder)}
              >
                {appInfo?.appFolder || "-"}
              </button>

              <span className="about-meta-label">Data Folder</span>
              <button
                type="button"
                className="about-meta-link selectable"
                style={{ color: "var(--cyan)" }}
                onClick={() => appInfo?.dataFolder && openFolder(appInfo.dataFolder)}
              >
                {appInfo?.dataFolder || "-"}
              </button>
            </div>
          </div>
        </div>

        <div className="modal-footer" style={{ justifyContent: "space-between" }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn" onClick={() => openUrl(githubRepo)}>
              <ExternalLink size={12} />
              <span>Open GitHub</span>
            </button>
            <button type="button" className="btn" onClick={() => openUrl(telegramUrl)}>
              <Send size={12} />
              <span>Contact Telegram</span>
            </button>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onClose}
            disabled={updating}
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
