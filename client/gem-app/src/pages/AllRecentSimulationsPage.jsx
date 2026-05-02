import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import BackButton from "../components/BackButton";
import logo from "../assets/images/logo.png";
import { readSimulationHistory } from "../utils/simulationHistory";
import styles from "./DashboardPage.module.css";

const formatDateTimeFr = (iso) => {
  try {
    return new Date(iso).toLocaleString("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "-";
  }
};

export default function AllRecentSimulationsPage() {
  const navigate = useNavigate();
  const [simulations, setSimulations] = useState(() => readSimulationHistory());

  const refreshSimulations = useCallback(() => {
    setSimulations(readSimulationHistory());
  }, []);

  useEffect(() => {
    window.addEventListener("focus", refreshSimulations);
    return () => window.removeEventListener("focus", refreshSimulations);
  }, [refreshSimulations]);

  return (
    <div className={styles.historyPage}>
      <nav className={styles.historyNav}>
        <button type="button" className={styles.historyLogoButton} onClick={() => navigate("/dashboard")}>
          <img src={logo} alt="Deutsch Lernen" />
        </button>
        <button type="button" className={styles.moreButton} onClick={() => navigate("/dashboard")}>
          Dashboard
        </button>
      </nav>

      <main className={styles.historyContent}>
        <BackButton fallback="/dashboard" />
        <header className={styles.historyHeader}>
          <p>Historique</p>
          <h1>All Recent Simulations</h1>
          <span>Resume any saved module exactly where you left it.</span>
        </header>

        {simulations.length ? (
          <div className={styles.historyGrid}>
            {simulations.map((simulation) => (
              <article key={simulation.id} className={styles.historyCard}>
                <div className={styles.historyCardTop}>
                  <div>
                    <h2>{simulation.title}</h2>
                    <p>{simulation.moduleType}</p>
                  </div>
                  <strong>{simulation.progressPercent}%</strong>
                </div>
                <div className={styles.resumeProgressTrack}>
                  <span style={{ width: `${simulation.progressPercent}%` }} />
                </div>
                <div className={styles.historyMeta}>
                  <span>Last accessed: {formatDateTimeFr(simulation.lastAccessedAt)}</span>
                  <span>
                    {simulation.answeredCount}/{simulation.totalTasks || "?"} questions
                  </span>
                </div>
                <button type="button" className={styles.btnDetails} onClick={() => navigate(simulation.route)}>
                  Resume
                </button>
              </article>
            ))}
          </div>
        ) : (
          <section className={styles.card}>
            <h2 className={styles.cardTitle}>No saved simulations yet</h2>
            <p className={styles.simDate}>Start a module and your progress will appear here automatically.</p>
          </section>
        )}
      </main>
    </div>
  );
}
