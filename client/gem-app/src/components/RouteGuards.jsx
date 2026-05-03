import { Navigate, useLocation } from "react-router-dom";
import { isLoggedIn } from "../utils/access";

export function ProtectedRoute({ children }) {
  const location = useLocation();

  if (!isLoggedIn()) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }

  return children;
}
