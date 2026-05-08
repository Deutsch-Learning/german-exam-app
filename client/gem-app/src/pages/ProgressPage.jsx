import { useEffect, useMemo, useState } from "react";
import styles from "./ProgressPage.module.css";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";
import API from "../services/api";

export default function ProgressPage() {
  const { t } = useLanguage();
  const [progress, setProgress] = useState({ completed: 0, total: 0, percentage: 0 });
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;

    API.get("/api/progress")
      .then((res) => {
        if (!active) return;
        setProgress({
          completed: Number(res.data?.completed ?? 0),
          total: Number(res.data?.total ?? 0),
          percentage: Number(res.data?.percentage ?? 0),
        });
      })
      .catch(() => {
        if (active) setError("Impossible de charger votre progression.");
      });

    return () => {
      active = false;
    };
  }, []);

  const progressState = useMemo(() => {
    if (progress.percentage >= 70) return "high";
    if (progress.percentage >= 35) return "medium";
    return "low";
  }, [progress.percentage]);

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <BackButton fallback="/dashboard" />
        <h1>{t.progressPage.title}</h1>
        <p>{t.progressPage.subtitle}</p>

        {error ? <p className={styles.error}>{error}</p> : null}

        <article className={styles.card} data-state={progressState}>
          <div className={styles.header}>
            <h3>{t.dashboard.certificationProgress}</h3>
            <span>{progress.percentage}%</span>
          </div>
          <div className={styles.barWrap}>
            <div className={styles.barFill} style={{ width: `${progress.percentage}%` }} />
          </div>
          <p className={styles.meta}>
            {progress.completed}/{progress.total} exams completed
          </p>
        </article>
      </div>
    </div>
  );
}
