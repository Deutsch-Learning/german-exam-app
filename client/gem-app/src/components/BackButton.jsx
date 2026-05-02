import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useLanguage } from "../context/LanguageContext";
import styles from "./BackButton.module.css";

export default function BackButton({ fallback = "/dashboard", label }) {
  const navigate = useNavigate();
  const { t } = useLanguage();

  const goBack = () => {
    if (window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(fallback);
  };

  return (
    <button type="button" className={styles.backButton} onClick={goBack}>
      <ArrowLeft size={17} />
      {label ?? t.common.back}
    </button>
  );
}
