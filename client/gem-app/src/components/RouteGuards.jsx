import { Navigate, useLocation } from "react-router-dom";
import { isAdmin, isLoggedIn } from "../utils/access";

export function ProtectedRoute({ children }) {
  const location = useLocation();

  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  const adminUserView = new URLSearchParams(location.search).get("view") === "user";
  if (isAdmin() && location.pathname === "/dashboard" && !adminUserView) {
    return <Navigate to="/admin/dashboard" replace />;
  }

  return children;
}

export function AdminRoute({ children }) {
  const location = useLocation();

  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  if (!isAdmin()) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
