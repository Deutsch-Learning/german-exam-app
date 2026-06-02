import API from "./api";

const CACHE_TTL_MS = 45_000;
let dashboardCache = null;
let dashboardPromise = null;

export const fetchDashboardData = async ({ force = false } = {}) => {
  if (!force && dashboardCache && Date.now() - dashboardCache.createdAt < CACHE_TTL_MS) {
    return dashboardCache.data;
  }

  if (!force && dashboardPromise) return dashboardPromise;

  dashboardPromise = API.get("/api/dashboard")
    .then((response) => {
      dashboardCache = {
        data: response.data,
        createdAt: Date.now(),
      };
      return response.data;
    })
    .finally(() => {
      dashboardPromise = null;
    });

  return dashboardPromise;
};

export const clearDashboardCache = () => {
  dashboardCache = null;
  dashboardPromise = null;
};
