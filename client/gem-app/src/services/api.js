import axios from "axios";
import { clearAuthSession, getAuthSession, getAuthToken, storeAuthSession } from "../utils/access";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  withCredentials: true,
});

API.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

API.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config ?? {};
    const isRefreshRequest = original.url?.includes("/api/auth/refresh");
    const isAuthRequest = ["/login", "/register", "/api/auth/login", "/api/auth/register"].some((path) =>
      original.url?.includes(path)
    );

    if (error.response?.status === 401 && !original._retry && !isRefreshRequest && !isAuthRequest) {
      original._retry = true;
      try {
        const refresh = await API.post("/api/auth/refresh", null, { _retry: true });
        const token = refresh.data?.accessToken ?? refresh.data?.token;
        const user = refresh.data?.user;
        if (token && user) {
          const session = getAuthSession();
          storeAuthSession(
            { user, token, expiresIn: refresh.data?.expiresIn ?? "15m" },
            Boolean(session?.remember)
          );
          original.headers = {
            ...(original.headers ?? {}),
            Authorization: `Bearer ${token}`,
          };
          return API(original);
        }
      } catch {
        clearAuthSession();
      }
    } else if (error.response?.status === 401) {
      clearAuthSession();
    }
    return Promise.reject(error);
  }
);

export default API;
