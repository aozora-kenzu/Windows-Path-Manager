import React, { useState } from "react";
import { Copy, FolderOpen, Search, Terminal } from "lucide-react";
import { api } from "../api";
import type { WhereMatch } from "../types";

interface WhereInspectorViewProps {
  draftActivePaths: string[];
  systemPaths: string[];
  onNotify: (msg: string, isError?: boolean) => void;
}

const PRESETS = ["node", "python", "git", "cargo", "go", "dotnet", "pwsh", "code"];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const WhereInspectorView: React.FC<WhereInspectorViewProps> = ({
  draftActivePaths,
  systemPaths,
  onNotify,
}) => {
  const [command, setCommand] = useState("node");
  const [matches, setMatches] = useState<WhereMatch[]>([]);
  const [searchedCmd, setSearchedCmd] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const runInspect = async (target?: string) => {
    const cmd = (target ?? command).trim();
    if (!cmd) return;
    setCommand(cmd);
    setLoading(true);
    try {
      const res = await api.inspectWhere(cmd, draftActivePaths, systemPaths);
      setMatches(res);
      setSearchedCmd(cmd);
    } catch (err) {
      onNotify(String(err), true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <div className="info-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Terminal size={13} color="var(--accent)" />
          <span>
            Simulates Windows executable lookup using <strong>System PATH first</strong>, then your{" "}
            <strong>Draft Active User PATH</strong> + <code>PATHEXT</code>.
          </span>
        </div>
      </div>

      <div className="toolbar">
        <div className="toolbar-group" style={{ flex: 1 }}>
          <div className="search-box" style={{ minWidth: 280 }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Enter command name (e.g. node, python, git)..."
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") runInspect();
              }}
            />
          </div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={loading || !command.trim()}
            onClick={() => runInspect()}
          >
            {loading ? "Scanning..." : "Inspect Precedence"}
          </button>
        </div>

        <div className="toolbar-group">
          <span style={{ color: "var(--text-muted)", fontSize: 11 }}>Quick:</span>
          {PRESETS.map((preset) => (
            <button
              key={preset}
              type="button"
              className="btn"
              style={{ height: 24, padding: "0 8px", fontSize: 11.5 }}
              onClick={() => runInspect(preset)}
            >
              {preset}
            </button>
          ))}
        </div>
      </div>

      <div className="list-scroll" style={{ padding: 0 }}>
        {searchedCmd === null ? (
          <div className="empty-state">
            Enter a command or click a quick preset above to inspect which binary Windows will
            launch first.
          </div>
        ) : matches.length === 0 ? (
          <div className="empty-state">
            No matching executable found for <code>{searchedCmd}</code> in System PATH or Draft
            Active User PATH.
          </div>
        ) : (
          <div className="table-scroll-wrap">
            <table className="where-table">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>Rank</th>
                  <th style={{ width: 170 }}>Status</th>
                  <th style={{ width: 120 }}>Scope</th>
                  <th>Resolved Executable Path</th>
                  <th style={{ width: 90 }}>Size</th>
                  <th style={{ width: 135 }}>Modified</th>
                  <th style={{ width: 78 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {matches.map((m) => (
                  <tr key={m.fullPath}>
                    <td style={{ fontWeight: 700, fontVariantNumeric: "tabular-nums" }}>
                      #{m.rank}
                    </td>
                    <td>
                      {m.isWinner ? (
                        <span className="badge badge-ok">WINNER</span>
                      ) : m.shadowedBySystem ? (
                        <span className="badge badge-warn">SHADOWED BY SYSTEM</span>
                      ) : (
                        <span className="badge badge-muted">SHADOWED</span>
                      )}
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          m.source === "system" ? "badge-info" : "badge-muted"
                        }`}
                      >
                        {m.source === "system"
                          ? `System #${m.pathIndex + 1}`
                          : `User #${m.pathIndex + 1}`}
                      </span>
                    </td>
                    <td className="selectable" style={{ wordBreak: "break-all" }}>
                      <div>{m.fullPath}</div>
                      {m.dirRaw !== m.dirExpanded && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          from {m.dirRaw}
                        </div>
                      )}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-secondary)" }}>
                      {formatBytes(m.fileSize)}
                    </td>
                    <td style={{ fontVariantNumeric: "tabular-nums", color: "var(--text-muted)" }}>
                      {m.modifiedAt}
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Open containing folder"
                          onClick={() =>
                            api
                              .openInExplorer(m.dirExpanded)
                              .catch((e) => onNotify(String(e), true))
                          }
                        >
                          <FolderOpen size={13} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          title="Copy full executable path"
                          onClick={async () => {
                            await navigator.clipboard.writeText(m.fullPath);
                            onNotify("Copied executable path");
                          }}
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
};
