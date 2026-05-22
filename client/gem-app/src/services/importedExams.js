import API from "./api";

export const fetchImportedSeries = async (examId) => {
  if (!examId) return [];
  const response = await API.get(`/api/exams/${encodeURIComponent(examId)}/series`);
  return Array.isArray(response.data?.series) ? response.data.series : [];
};

export const fetchImportedSeriesModule = async (examId, seriesId, moduleId) => {
  if (!examId || !seriesId || !moduleId) return null;
  const response = await API.get(
    `/api/exams/${encodeURIComponent(examId)}/series/${encodeURIComponent(seriesId)}/${encodeURIComponent(moduleId)}`
  );
  if (!response.data?.series || !response.data?.content) return null;
  return {
    series: response.data.series,
    content: response.data.content,
  };
};
