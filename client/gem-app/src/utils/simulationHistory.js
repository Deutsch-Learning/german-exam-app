export const SIMULATION_HISTORY_KEY = "gem-simulation-history";
export const MODULE_PROGRESS_PREFIX = "gem-module-progress-";

export const moduleHistoryMeta = {
  read: {
    title: "Goethe B2 - Comprehension Ecrite",
    moduleType: "Reading",
    route: "/simulation/read",
  },
  listen: {
    title: "Goethe B2 - Comprehension Orale",
    moduleType: "Listening",
    route: "/simulation/listen",
  },
  write: {
    title: "Goethe B2 - Expression Ecrite",
    moduleType: "Writing",
    route: "/simulation/write",
  },
  speak: {
    title: "Goethe B2 - Expression Orale",
    moduleType: "Speaking",
    route: "/simulation/speak",
  },
};

const safeJsonParse = (value, fallback) => {
  try {
    return JSON.parse(value ?? "");
  } catch {
    return fallback;
  }
};

export const getProgressKey = (moduleId) => `${MODULE_PROGRESS_PREFIX}${moduleId}`;

export const getSimulationRoute = (moduleId) => moduleHistoryMeta[moduleId]?.route ?? `/simulation/${moduleId}`;

export const normalizeSimulationEntry = (entry) => {
  const moduleId = entry?.moduleId ?? entry?.id;
  if (!moduleId) return null;

  const meta = moduleHistoryMeta[moduleId] ?? {
    title: `Goethe B2 - ${moduleId}`,
    moduleType: moduleId,
    route: `/simulation/${moduleId}`,
  };
  const totalTasks = Number(entry?.totalTasks) || 0;
  const currentIndex = Math.max(0, Number(entry?.currentIndex) || 0);
  const answeredCount = Math.max(0, Number(entry?.answeredCount) || 0);
  const progressPercent = totalTasks
    ? Math.min(100, Math.round((Math.max(answeredCount, currentIndex + 1) / totalTasks) * 100))
    : Math.max(0, Math.min(100, Number(entry?.progressPercent) || 0));
  const savedAt = entry?.lastAccessedAt ?? entry?.savedAt ?? new Date().toISOString();

  return {
    id: moduleId,
    moduleId,
    title: entry?.moduleTitle ?? meta.title,
    moduleType: entry?.moduleType ?? meta.moduleType,
    route: entry?.route ?? meta.route,
    currentIndex,
    totalTasks,
    answeredCount,
    progressPercent,
    completed: Boolean(entry?.completed),
    lastAccessedAt: savedAt,
    savedAt,
  };
};

export const readSimulationHistory = () => {
  if (typeof localStorage === "undefined") return [];

  const indexedEntries = safeJsonParse(localStorage.getItem(SIMULATION_HISTORY_KEY), []);
  const entriesById = new Map();

  if (Array.isArray(indexedEntries)) {
    indexedEntries.forEach((entry) => {
      const normalized = normalizeSimulationEntry(entry);
      if (normalized) entriesById.set(normalized.id, normalized);
    });
  }

  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    if (!key?.startsWith(MODULE_PROGRESS_PREFIX)) continue;

    const stored = safeJsonParse(localStorage.getItem(key), null);
    const moduleId = stored?.moduleId ?? key.replace(MODULE_PROGRESS_PREFIX, "");
    const normalized = normalizeSimulationEntry({ ...stored, moduleId });
    if (normalized) entriesById.set(normalized.id, normalized);
  }

  return [...entriesById.values()].sort(
    (a, b) => new Date(b.lastAccessedAt).getTime() - new Date(a.lastAccessedAt).getTime()
  );
};

export const upsertSimulationHistoryEntry = (entry) => {
  if (typeof localStorage === "undefined") return;

  const normalized = normalizeSimulationEntry(entry);
  if (!normalized) return;

  const nextEntries = [
    normalized,
    ...readSimulationHistory().filter((item) => item.id !== normalized.id),
  ];

  localStorage.setItem(SIMULATION_HISTORY_KEY, JSON.stringify(nextEntries));
};
