import API from "./api";

const CACHE_TTL_MS = 5 * 60_000;
const CACHE_VERSION = "2026-07-05-sprach-hoeren";
const SERIES_STORAGE_PREFIX = "imported-series:";
const seriesCache = new Map();
const moduleCache = new Map();

const getCached = (cache, key) => {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.promise;
};

const setCached = (cache, key, promise) => {
  cache.set(key, { promise, createdAt: Date.now() });
  promise.catch(() => cache.delete(key));
  return promise;
};

const readStoredSeries = (key) => {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(`${SERIES_STORAGE_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== CACHE_VERSION || Date.now() - Number(parsed.createdAt) > CACHE_TTL_MS) {
      window.localStorage.removeItem(`${SERIES_STORAGE_PREFIX}${key}`);
      return null;
    }
    return Array.isArray(parsed.series) ? parsed.series : null;
  } catch {
    return null;
  }
};

const writeStoredSeries = (key, series) => {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(
      `${SERIES_STORAGE_PREFIX}${key}`,
      JSON.stringify({ version: CACHE_VERSION, createdAt: Date.now(), series })
    );
  } catch {
    // Cache writes are optional; network results still drive the UI.
  }
};

export const fetchImportedSeries = async (examId) => {
  if (!examId) return [];
  const key = String(examId).toLowerCase();
  const withAccessExamId = (series = []) => series.map((item) => ({ ...item, accessExamId: key }));
  const cached = getCached(seriesCache, key);
  if (cached) return cached;
  const stored = readStoredSeries(key);
  if (stored) return withAccessExamId(stored);

  return setCached(
    seriesCache,
    key,
    API.get(`/api/exams/${encodeURIComponent(examId)}/series`).then((response) => {
      const series = withAccessExamId(Array.isArray(response.data?.series) ? response.data.series : []);
      writeStoredSeries(key, series);
      return series;
    })
  );
};

export const hasPlayableImportedSeries = (series = []) =>
  series.some((item) =>
    Object.values(item.modules ?? {}).some((module) => Number(module?.questionCount) > 0)
  );

export const fetchImportedSeriesModule = async (examId, seriesId, moduleId) => {
  if (!examId || !seriesId || !moduleId) return null;
  const key = [examId, seriesId, moduleId].map((value) => String(value).toLowerCase()).join(":");
  const cached = getCached(moduleCache, key);
  if (cached) return cached;

  return setCached(
    moduleCache,
    key,
    API.get(
      `/api/exams/${encodeURIComponent(examId)}/series/${encodeURIComponent(seriesId)}/${encodeURIComponent(moduleId)}`
    ).then((response) => {
      if (!response.data?.series || !response.data?.content) return null;
      return {
        series: response.data.series,
        content: response.data.content,
      };
    })
  );
};

export const clearImportedExamCache = () => {
  seriesCache.clear();
  moduleCache.clear();
  if (typeof window !== "undefined") {
    Object.keys(window.localStorage)
      .filter((key) => key.startsWith(SERIES_STORAGE_PREFIX))
      .forEach((key) => window.localStorage.removeItem(key));
  }
};
