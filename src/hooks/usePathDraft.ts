import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api";
import type {
  DraftDiff,
  DraftState,
  ParkedEntry,
  PathEntryInfo,
  ValidationResult,
} from "../types";

const MAX_HISTORY = 80;

function cloneDraft(d: DraftState): DraftState {
  return {
    activePaths: [...d.activePaths],
    parkedEntries: d.parkedEntries.map((p) => ({ ...p })),
  };
}

function draftsEqual(a: DraftState, b: DraftState): boolean {
  if (a.activePaths.length !== b.activePaths.length) return false;
  for (let i = 0; i < a.activePaths.length; i++) {
    if (a.activePaths[i] !== b.activePaths[i]) return false;
  }
  if (a.parkedEntries.length !== b.parkedEntries.length) return false;
  for (let i = 0; i < a.parkedEntries.length; i++) {
    if (a.parkedEntries[i].raw !== b.parkedEntries[i].raw) return false;
  }
  return true;
}

function normalizeClient(s: string): string {
  return s.trim().replace(/^"+|"+$/g, "").replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

export function computeDiff(baseline: DraftState, current: DraftState): DraftDiff {
  const baseSet = new Set(baseline.activePaths);
  const currSet = new Set(current.activePaths);

  const added = current.activePaths.filter((p) => !baseSet.has(p));
  const removed = baseline.activePaths.filter((p) => !currSet.has(p));

  let reordered = false;
  if (added.length === 0 && removed.length === 0 && baseline.activePaths.length === current.activePaths.length) {
    reordered = baseline.activePaths.some((p, i) => current.activePaths[i] !== p);
  } else {
    const commonBase = baseline.activePaths.filter((p) => currSet.has(p));
    const commonCurr = current.activePaths.filter((p) => baseSet.has(p));
    reordered = commonBase.some((p, i) => commonCurr[i] !== p);
  }

  const parkedChanged =
    baseline.parkedEntries.length !== current.parkedEntries.length ||
    baseline.parkedEntries.some((p, i) => current.parkedEntries[i]?.raw !== p.raw);

  const hasChanges = !draftsEqual(baseline, current);
  return { added, removed, reordered, parkedChanged, hasChanges };
}

export function hasEntryConflict(info: PathEntryInfo | undefined): boolean {
  if (!info) return false;
  return (
    info.shadowedCount > 0 ||
    info.winningConflictCount > 0 ||
    info.isSameTargetDuplicate
  );
}

export function isAutoCleanable(info: PathEntryInfo | undefined): boolean {
  if (!info) return false;
  return (
    !info.exists ||
    info.isFileNotDir ||
    info.isDuplicateInUser ||
    info.isDuplicateInSystem
  );
}

export function hasEntryIssue(info: PathEntryInfo | undefined): boolean {
  if (!info) return false;
  return (
    isAutoCleanable(info) ||
    info.hasUnresolvedVars ||
    info.hasWhitespaceOrQuotes ||
    hasEntryConflict(info)
  );
}

export function usePathDraft(
  systemPaths: string[],
  initialValidation: ValidationResult | null
) {
  const [baseline, setBaseline] = useState<DraftState>({
    activePaths: [],
    parkedEntries: [],
  });
  const [draft, setDraft] = useState<DraftState>({
    activePaths: [],
    parkedEntries: [],
  });
  const [undoStack, setUndoStack] = useState<DraftState[]>([]);
  const [redoStack, setRedoStack] = useState<DraftState[]>([]);
  const [validation, setValidation] = useState<ValidationResult | null>(initialValidation);

  const resetFromCommitted = useCallback(
    (
      activePaths: string[],
      parkedEntries: ParkedEntry[],
      val: ValidationResult
    ) => {
      const next: DraftState = {
        activePaths: [...activePaths],
        parkedEntries: parkedEntries.map((p) => ({ ...p })),
      };
      setBaseline(cloneDraft(next));
      setDraft(cloneDraft(next));
      setUndoStack([]);
      setRedoStack([]);
      setValidation(val);
    },
    []
  );

  const commitEdit = useCallback(
    (updater: (prev: DraftState) => DraftState) => {
      setDraft((prev) => {
        const next = updater(cloneDraft(prev));
        if (draftsEqual(prev, next)) return prev;
        setUndoStack((u) => [...u.slice(-(MAX_HISTORY - 1)), cloneDraft(prev)]);
        setRedoStack([]);
        return next;
      });
    },
    []
  );

  const undo = useCallback(() => {
    setUndoStack((u) => {
      if (u.length === 0) return u;
      const previous = u[u.length - 1];
      setDraft((curr) => {
        setRedoStack((r) => [...r, cloneDraft(curr)]);
        return cloneDraft(previous);
      });
      return u.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setRedoStack((r) => {
      if (r.length === 0) return r;
      const next = r[r.length - 1];
      setDraft((curr) => {
        setUndoStack((u) => [...u, cloneDraft(curr)]);
        return cloneDraft(next);
      });
      return r.slice(0, -1);
    });
  }, []);

  const discardChanges = useCallback(() => {
    commitEdit(() => cloneDraft(baseline));
  }, [baseline, commitEdit]);

  // Debounced validation whenever draft or systemPaths changes
  useEffect(() => {
    let cancelled = false;
    const handle = window.setTimeout(async () => {
      try {
        const res = await api.validateDraft(
          draft.activePaths,
          draft.parkedEntries,
          systemPaths
        );
        if (!cancelled) {
          setValidation(res);
        }
      } catch {
        // Ignore transient validation errors in preview
      }
    }, 90);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [draft, systemPaths]);

  const diff = useMemo(() => computeDiff(baseline, draft), [baseline, draft]);

  const addPath = useCallback(
    (rawPath: string) => {
      const cleaned = rawPath.trim();
      if (!cleaned) return;
      commitEdit((d) => ({
        ...d,
        activePaths: [cleaned, ...d.activePaths],
      }));
    },
    [commitEdit]
  );

  const updateActivePath = useCallback(
    (index: number, nextRaw: string) => {
      const cleaned = nextRaw.trim();
      if (!cleaned) return;
      commitEdit((d) => {
        if (index < 0 || index >= d.activePaths.length) return d;
        const copy = [...d.activePaths];
        copy[index] = cleaned;
        return { ...d, activePaths: copy };
      });
    },
    [commitEdit]
  );

  const removeActivePath = useCallback(
    (index: number) => {
      commitEdit((d) => ({
        ...d,
        activePaths: d.activePaths.filter((_, i) => i !== index),
      }));
    },
    [commitEdit]
  );

  const moveActivePath = useCallback(
    (fromIndex: number, toIndex: number) => {
      commitEdit((d) => {
        if (
          fromIndex < 0 ||
          toIndex < 0 ||
          fromIndex >= d.activePaths.length ||
          toIndex >= d.activePaths.length ||
          fromIndex === toIndex
        ) {
          return d;
        }
        const copy = [...d.activePaths];
        const [item] = copy.splice(fromIndex, 1);
        copy.splice(toIndex, 0, item);
        return { ...d, activePaths: copy };
      });
    },
    [commitEdit]
  );

  const parkActivePath = useCallback(
    (index: number) => {
      commitEdit((d) => {
        if (index < 0 || index >= d.activePaths.length) return d;
        const raw = d.activePaths[index];
        const nextActive = d.activePaths.filter((_, i) => i !== index);
        const alreadyParked = d.parkedEntries.some(
          (p) => normalizeClient(p.raw) === normalizeClient(raw)
        );
        const nextParked = alreadyParked
          ? d.parkedEntries
          : [
              {
                id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                raw,
                parkedAt: new Date().toISOString(),
                preferredIndex: index,
                note: null,
              },
              ...d.parkedEntries,
            ];
        return { activePaths: nextActive, parkedEntries: nextParked };
      });
    },
    [commitEdit]
  );

  const unparkEntry = useCallback(
    (parkedId: string) => {
      commitEdit((d) => {
        const target = d.parkedEntries.find((p) => p.id === parkedId);
        if (!target) return d;
        const nextParked = d.parkedEntries.filter((p) => p.id !== parkedId);
        const insertAt = Math.min(Math.max(0, target.preferredIndex), d.activePaths.length);
        const nextActive = [...d.activePaths];
        nextActive.splice(insertAt, 0, target.raw);
        return { activePaths: nextActive, parkedEntries: nextParked };
      });
    },
    [commitEdit]
  );

  const removeParkedEntry = useCallback(
    (parkedId: string) => {
      commitEdit((d) => ({
        ...d,
        parkedEntries: d.parkedEntries.filter((p) => p.id !== parkedId),
      }));
    },
    [commitEdit]
  );

  const setBulkActivePaths = useCallback(
    (lines: string[]) => {
      const cleaned = lines.map((l) => l.trim()).filter((l) => l.length > 0);
      commitEdit((d) => ({
        ...d,
        activePaths: cleaned,
      }));
    },
    [commitEdit]
  );

  const cleanIssues = useCallback(() => {
    if (!validation) return 0;
    let removedCount = 0;
    commitEdit((d) => {
      const nextActive: string[] = [];
      d.activePaths.forEach((raw, idx) => {
        const info = validation.userEntries[idx];
        const trimmed = raw.trim().replace(/^"+|"+$/g, "").trim();
        if (!info) {
          if (trimmed) nextActive.push(trimmed);
          return;
        }
        if (isAutoCleanable(info)) {
          removedCount += 1;
          return;
        }
        nextActive.push(trimmed);
      });
      return { ...d, activePaths: nextActive };
    });
    return removedCount;
  }, [commitEdit, validation]);

  const applyImported = useCallback(
    (
      activePaths: string[],
      parkedEntries: ParkedEntry[],
      mode: "replace" | "merge"
    ) => {
      commitEdit((d) => {
        if (mode === "replace") {
          return {
            activePaths: [...activePaths],
            parkedEntries: parkedEntries.map((p) => ({ ...p })),
          };
        }
        const existingNorms = new Set(d.activePaths.map(normalizeClient));
        const mergedActive = [...d.activePaths];
        for (const p of activePaths) {
          const n = normalizeClient(p);
          if (n && !existingNorms.has(n)) {
            existingNorms.add(n);
            mergedActive.push(p);
          }
        }
        const existingParked = new Set(d.parkedEntries.map((p) => normalizeClient(p.raw)));
        const mergedParked = [...d.parkedEntries];
        for (const p of parkedEntries) {
          const n = normalizeClient(p.raw);
          if (n && !existingParked.has(n) && !existingNorms.has(n)) {
            existingParked.add(n);
            mergedParked.push({ ...p });
          }
        }
        return { activePaths: mergedActive, parkedEntries: mergedParked };
      });
    },
    [commitEdit]
  );

  return {
    baseline,
    draft,
    validation,
    diff,
    canUndo: undoStack.length > 0,
    canRedo: redoStack.length > 0,
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
  };
}
