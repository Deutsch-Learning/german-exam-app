import API from "./api";
import { clearExamMetadata, readExamMetadata, writeExamMetadata } from "./examCache";

const CACHE_TTL_MS = 5 * 60_000;
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

const requestSeries = (examId, key, withAccessExamId) =>
  API.get(`/api/exams/${encodeURIComponent(examId)}/series`).then((response) => {
    const series = withAccessExamId(Array.isArray(response.data?.series) ? response.data.series : []);
    void writeExamMetadata(`series:${key}`, series);
    return series;
  });

export const fetchImportedSeries = async (examId) => {
  if (!examId) return [];
  const key = String(examId).toLowerCase();
  const withAccessExamId = (series = []) => series.map((item) => ({ ...item, accessExamId: key }));
  const cached = getCached(seriesCache, key);
  if (cached) return cached;
  const stored = await readExamMetadata(`series:${key}`);
  if (Array.isArray(stored)) {
    const series = withAccessExamId(stored);
    setCached(seriesCache, key, Promise.resolve(series));
    requestSeries(examId, key, withAccessExamId)
      .then((fresh) => seriesCache.set(key, { promise: Promise.resolve(fresh), createdAt: Date.now() }))
      .catch(() => {});
    return series;
  }

  return setCached(
    seriesCache,
    key,
    requestSeries(examId, key, withAccessExamId)
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
  void clearExamMetadata();
};
