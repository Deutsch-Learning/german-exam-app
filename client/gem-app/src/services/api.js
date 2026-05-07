import axios from "axios";
import { clearAuthSession, getAuthToken } from "../utils/access";

const API = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "http://localhost:3000",
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
  (error) => {
    if (error.response?.status === 401) {
      clearAuthSession();
    }
    return Promise.reject(error);
  }
);

export default API;
