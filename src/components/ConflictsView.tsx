import React, { useEffect, useMemo, useState } from "react";
import {
  ArrowUpToLine,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  GitCompareArrows,
  Layers,
  List,
  PauseCircle,
  Search,
  X,
} from "lucide-react";
import { api } from "../api";
import type { CommandConflict, ConflictOccurrence } from "../types";

interface ConflictsViewProps {
  conflicts: CommandConflict[];
  initialFilter: string;
  onClearInitialFilter: () => void;
  onParkUserIndex: (index: number) => void;
  onMoveUserToTop: (index: number) => void;
  onNotify: (msg: string, isError?: boolean) => void;
}

type ConflictScopeFilter =
  | "involves_user"
  | "user_user"
  | "user_system"
  | "system_system"
  | "all";

type ConflictViewMode = "grouped" | "by_command";

interface ConflictDirGroup {
  key: string;
  scope: CommandConflict["scope"];
  isNoise: boolean;
  noiseReason: string | null;
  commands: string[];
  occurrences: ConflictOccurrence[];
}

function scopeLabel(scope: CommandConflict["scope"]): string {
  if (scope === "user_user") return "User <-> User";
  if (scope === "user_system") return "User <-> System";
  return "System <-> System";
}

export const ConflictsView: React.FC<ConflictsViewProps> = ({
  conflicts,
  initialFilter,
  onClearInitialFilter,
  onParkUserIndex,
  onMoveUserToTop,
  onNotify,
}) => {
  const [scopeFilter, setScopeFilter] = useState<ConflictScopeFilter>("involves_user");
  const [viewMode, setViewMode] = useState<ConflictViewMode>("grouped");
  const [showNoise, setShowNoise] = useState(false);
  const [conflictQuery, setConflictQuery] = useState(initialFilter);

  useEffect(() => {
    if (initialFilter) {
      setConflictQuery(initialFilter);
      setScopeFilter("all");
    }
  }, [initialFilter]);

  const noiseCount = useMemo(
    () => conflicts.filter((c) => c.isNoise).length,
    [conflicts]
  );

  const counts = useMemo(() => {
    let userUser = 0;
    let userSystem = 0;
    let sysOnly = 0;
    let visibleTotal = 0;
    for (const c of conflicts) {
      if (!showNoise && c.isNoise) continue;
      visibleTotal += 1;
      if (c.scope === "user_user") userUser += 1;
      else if (c.scope === "user_system") userSystem += 1;
      else sysOnly += 1;
    }
    return {
      userUser,
      userSystem,
      involvesUser: userUser + userSystem,
      sysOnly,
      all: visibleTotal,
    };
  }, [conflicts, showNoise]);

  const filteredConflicts = useMemo(() => {
    const q = conflictQuery.trim().toLowerCase();
    return conflicts.filter((c) => {
      if (!showNoise && c.isNoise) return false;
      if (scopeFilter === "involves_user" && !c.involvesUser) return false;
      if (scopeFilter === "user_user" && c.scope !== "user_user") return false;
      if (scopeFilter === "user_system" && c.scope !== "user_system") return false;
      if (scopeFilter === "system_system" && c.scope !== "system_system") return false;
      if (!q) return true;
      if (c.command.toLowerCase().includes(q)) return true;
      return c.occurrences.some(
        (occ) =>
          occ.dirRaw.toLowerCase().includes(q) ||
          occ.dirExpanded.toLowerCase().includes(q) ||
          occ.fullPath.toLowerCase().includes(q)
      );
    });
  }, [conflicts, scopeFilter, conflictQuery, showNoise]);

  const groupedConflicts = useMemo<ConflictDirGroup[]>(() => {
    const map = new Map<string, ConflictDirGroup>();
    for (const c of filteredConflicts) {
      const dirKey =
        c.occurrences
          .map((o) => `${o.source}:${o.pathIndex}:${o.dirExpanded.toLowerCase()}`)
          .join("|") + `::${c.isNoise ? "noise" : "real"}`;
      const existing = map.get(dirKey);
      if (existing) {
        if (!existing.commands.includes(c.command)) {
          existing.commands.push(c.command);
        }
      } else {
        map.set(dirKey, {
          key: dirKey,
          scope: c.scope,
          isNoise: c.isNoise,
          noiseReason: c.noiseReason,
          commands: [c.command],
          occurrences: c.occurrences,
        });
      }
    }
    return Array.from(map.values());
  }, [filteredConflicts]);

  const renderOccurrenceActions = (
    occ: ConflictOccurrence,
    scope: CommandConflict["scope"],
    copyTarget: string
  ) => (
    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
      {occ.source === "user" && scope === "user_user" && !occ.isWinner && (
        <button
          type="button"
          className="btn"
          style={{ height: 24, padding: "0 8px", fontSize: 11 }}
          title="Move this User PATH directory to top (#1) of User PATH"
          onClick={() => {
            onMoveUserToTop(occ.pathIndex);
            onNotify(`Moved "${occ.dirRaw}" to #1 in User PATH Draft`);
          }}
        >
          <ArrowUpToLine size={12} />
          <span>Move to Top</span>
        </button>
      )}
      {occ.source === "user" && (
        <button
          type="button"
          className="btn"
          style={{ height: 24, padding: "0 8px", fontSize: 11 }}
          title="Park (temporarily disable) this User PATH entry"
          onClick={() => {
            onParkUserIndex(occ.pathIndex);
            onNotify(`Parked "${occ.dirRaw}" in Draft`);
          }}
        >
          <PauseCircle size={12} />
          <span>Park</span>
        </button>
      )}
      <button
        type="button"
        className="icon-btn"
        title="Open containing folder"
        onClick={() =>
          api
            .openInExplorer(occ.dirExpanded)
            .catch((e) => onNotify(String(e), true))
        }
      >
        <FolderOpen size={13} />
      </button>
      <button
        type="button"
        className="icon-btn"
        title="Copy path"
        onClick={async () => {
          await navigator.clipboard.writeText(copyTarget);
          onNotify("Copied path");
        }}
      >
        <Copy size={13} />
      </button>
    </div>
  );

  return (
    <>
      <div className="info-banner">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <GitCompareArrows size={13} color="var(--yellow)" />
          <span>
            Auto-detected executables appearing in <strong>2+ different PATH directories</strong>{" "}
            (System PATH evaluated before Draft Active User PATH). Built-in Windows aliases and
            installer binaries are filtered as noise by default.
          </span>
        </div>
      </div>

      <div className="toolbar" style={{ background: "var(--bg-panel)" }}>
        <div className="toolbar-group">
          <div className="chip-group">
            <button
              type="button"
              className={`chip-btn ${scopeFilter === "involves_user" ? "active" : ""}`}
              onClick={() => setScopeFilter("involves_user")}
            >
              User Conflicts ({counts.involvesUser})
            </button>
            <button
              type="button"
              className={`chip-btn ${scopeFilter === "user_user" ? "active" : ""}`}
              onClick={() => setScopeFilter("user_user")}
            >
              User &lt;-&gt; User ({counts.userUser})
            </button>
            <button
              type="button"
              className={`chip-btn ${scopeFilter === "user_system" ? "active" : ""}`}
              onClick={() => setScopeFilter("user_system")}
            >
              User &lt;-&gt; System ({counts.userSystem})
            </button>
            <button
              type="button"
              className={`chip-btn ${scopeFilter === "system_system" ? "active" : ""}`}
              onClick={() => setScopeFilter("system_system")}
            >
              System Only ({counts.sysOnly})
            </button>
            <button
              type="button"
              className={`chip-btn ${scopeFilter === "all" ? "active" : ""}`}
              onClick={() => setScopeFilter("all")}
            >
              All ({counts.all})
            </button>
          </div>
        </div>

        <div className="toolbar-group">
          <div className="chip-group">
            <button
              type="button"
              className={`chip-btn ${viewMode === "grouped" ? "active" : ""}`}
              title="Group commands that conflict between the same directory pair"
              onClick={() => setViewMode("grouped")}
            >
              <Layers size={12} />
              <span>Group by Dir</span>
            </button>
            <button
              type="button"
              className={`chip-btn ${viewMode === "by_command" ? "active" : ""}`}
              title="Show one card per conflicting command"
              onClick={() => setViewMode("by_command")}
            >
              <List size={12} />
              <span>By Command</span>
            </button>
          </div>

          <button
            type="button"
            className={`btn ${showNoise ? "btn-warn" : ""}`}
            style={{ height: 26, padding: "0 8px", fontSize: 11.5 }}
            title="Show/hide built-in Windows aliases (e.g. notepad) and uninstaller binaries (e.g. unins000)"
            onClick={() => setShowNoise((v) => !v)}
          >
            {showNoise ? <Eye size={12} /> : <EyeOff size={12} />}
            <span>Noise ({noiseCount})</span>
          </button>

          <div className="search-box" style={{ minWidth: 210 }}>
            <Search size={13} color="var(--text-muted)" />
            <input
              type="text"
              placeholder="Filter command or dir..."
              value={conflictQuery}
              onChange={(e) => {
                setConflictQuery(e.target.value);
                if (!e.target.value && initialFilter) onClearInitialFilter();
              }}
            />
            {conflictQuery && (
              <button
                type="button"
                className="icon-btn"
                style={{ width: 18, height: 18 }}
                onClick={() => {
                  setConflictQuery("");
                  onClearInitialFilter();
                }}
              >
                <X size={11} />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="list-scroll" style={{ padding: 12 }}>
        {(viewMode === "grouped" ? groupedConflicts.length : filteredConflicts.length) === 0 ? (
          <div className="empty-state">
            {counts.all === 0
              ? "No actionable cross-directory executable conflicts detected."
              : "No conflicts match the selected scope or filter."}
          </div>
        ) : viewMode === "grouped" ? (
          groupedConflicts.map((g) => (
            <div key={g.key} className="conflict-card">
              <div className="conflict-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span
                    className={`badge ${
                      g.scope === "user_user"
                        ? "badge-err"
                        : g.scope === "user_system"
                        ? "badge-warn"
                        : "badge-muted"
                    }`}
                  >
                    {scopeLabel(g.scope)}
                  </span>
                  {g.isNoise && (
                    <span className="badge badge-muted" title={g.noiseReason ?? "Noise"}>
                      NOISE: {g.noiseReason ?? "Ignored"}
                    </span>
                  )}
                  <span style={{ fontWeight: 600, fontSize: 12.5 }}>
                    {g.commands.slice(0, 8).join(", ")}
                    {g.commands.length > 8 ? ` (+${g.commands.length - 8} more)` : ""}
                  </span>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    ({g.commands.length} {g.commands.length === 1 ? "command" : "commands"})
                  </span>
                </div>
              </div>

              {g.occurrences.map((occ) => (
                <div key={`${g.key}-${occ.source}-${occ.pathIndex}`} className="conflict-occ-row">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        width: 28,
                        fontVariantNumeric: "tabular-nums",
                        color: occ.isWinner ? "var(--green)" : "var(--text-muted)",
                      }}
                    >
                      #{occ.rank}
                    </span>

                    {occ.isWinner ? (
                      <span className="badge badge-ok">WINNER</span>
                    ) : occ.shadowedBySystem ? (
                      <span className="badge badge-warn">SHADOWED BY SYSTEM</span>
                    ) : (
                      <span className="badge badge-err">SHADOWED</span>
                    )}

                    <span
                      className={`badge ${
                        occ.source === "system" ? "badge-info" : "badge-muted"
                      }`}
                    >
                      {occ.source === "system"
                        ? `System #${occ.pathIndex + 1}`
                        : `User #${occ.pathIndex + 1}`}
                    </span>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="selectable" style={{ wordBreak: "break-all" }}>
                        {occ.dirExpanded}
                      </div>
                      {occ.dirRaw !== occ.dirExpanded && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          raw: {occ.dirRaw}
                        </div>
                      )}
                    </div>
                  </div>

                  {renderOccurrenceActions(occ, g.scope, occ.dirExpanded)}
                </div>
              ))}
            </div>
          ))
        ) : (
          filteredConflicts.map((c) => (
            <div key={c.command} className="conflict-card">
              <div className="conflict-card-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <strong style={{ fontSize: 13 }}>{c.command}</strong>
                  <span
                    className={`badge ${
                      c.scope === "user_user"
                        ? "badge-err"
                        : c.scope === "user_system"
                        ? "badge-warn"
                        : "badge-muted"
                    }`}
                  >
                    {scopeLabel(c.scope)}
                  </span>
                  {c.isNoise && (
                    <span className="badge badge-muted" title={c.noiseReason ?? "Noise"}>
                      NOISE: {c.noiseReason ?? "Ignored"}
                    </span>
                  )}
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                    {c.occurrences.length} directories
                  </span>
                </div>
              </div>

              {c.occurrences.map((occ) => (
                <div key={`${c.command}-${occ.fullPath}`} className="conflict-occ-row">
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      minWidth: 0,
                      flex: 1,
                    }}
                  >
                    <span
                      style={{
                        fontWeight: 700,
                        width: 28,
                        fontVariantNumeric: "tabular-nums",
                        color: occ.isWinner ? "var(--green)" : "var(--text-muted)",
                      }}
                    >
                      #{occ.rank}
                    </span>

                    {occ.isWinner ? (
                      <span className="badge badge-ok">WINNER</span>
                    ) : occ.shadowedBySystem ? (
                      <span className="badge badge-warn">SHADOWED BY SYSTEM</span>
                    ) : (
                      <span className="badge badge-err">SHADOWED</span>
                    )}

                    <span
                      className={`badge ${
                        occ.source === "system" ? "badge-info" : "badge-muted"
                      }`}
                    >
                      {occ.source === "system"
                        ? `System #${occ.pathIndex + 1}`
                        : `User #${occ.pathIndex + 1}`}
                    </span>

                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div className="selectable" style={{ wordBreak: "break-all" }}>
                        {occ.fullPath}
                      </div>
                      {occ.dirRaw !== occ.dirExpanded && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          from {occ.dirRaw}
                        </div>
                      )}
                    </div>
                  </div>

                  {renderOccurrenceActions(occ, c.scope, occ.fullPath)}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </>
  );
};
