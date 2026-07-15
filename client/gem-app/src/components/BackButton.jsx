import { ArrowLeft } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import styles from "./BackButton.module.css";

export default function BackButton({ fallback = "/dashboard", label, className = "", forceFallback = false }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();

  const goBack = () => {
    if (forceFallback) {
      if (location.pathname !== fallback) navigate(fallback, { replace: true });
      return;
    }
    const historyIndex = Number(window.history.state?.idx);
    const sameOriginReferrer = (() => {
      try {
        return !document.referrer || new URL(document.referrer).origin === window.location.origin;
      } catch {
        return false;
      }
    })();
    if (historyIndex > 0 && sameOriginReferrer) {
      navigate(-1);
      return;
    }
    if (location.pathname !== fallback) navigate(fallback, { replace: true });
  };

  return (
    <button type="button" className={`${styles.backButton} ${className}`.trim()} onClick={goBack} aria-label={label ?? t.common.back}>
      <ArrowLeft size={17} />
      {label ?? t.common.back}
    </button>
  );
}
