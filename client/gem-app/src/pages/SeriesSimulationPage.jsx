import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import styles from "./SimulationSelectionPage.module.css";
import "./SimplePages.css";
import ComingSoonPage from "./ComingSoonPage";
import { simulationModules } from "../data/testSeries";
import { fetchImportedSeries } from "../services/importedExams";
import API from "../services/api";
import { clearDashboardCache } from "../services/dashboard";
import { canOpenSeries, clearAuthSession, isVisitorSeriesAttempt } from "../utils/access";
import BackButton from "../components/BackButton";
import { useSimulationLanguage } from "../utils/simulationLanguage";
import iconListen from "../assets/images/icon-audio.png";
import iconWrite from "../assets/images/icon-write.png";
import iconSpeak from "../assets/images/icon-speak.png";
import logo from "../assets/images/logo.png";
import {
  OpenBookIcon,
  SimulationDisciplineCard,
  StartConfirmationModal,
  SimulationTopNav,
} from "./SimulationSelectionPage";
import { getModuleCountLabel } from "../utils/moduleLabels";

const moduleAssets = {
  read: { iconNode: <OpenBookIcon /> },
  listen: { iconPath: iconListen },
  write: { iconPath: iconWrite },
  speak: { iconPath: iconSpeak },
  sprach: { iconNode: <OpenBookIcon /> },
};

export default function SeriesSimulationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { examId, seriesId } = useParams();
  const t = useSimulationLanguage();
  const [pendingModuleId, setPendingModuleId] = useState(null);
  const [startingModuleId, setStartingModuleId] = useState(null);
  const [remoteSeriesState, setRemoteSeriesState] = useState({
    examId: "",
    seriesId: "",
    series: null,
  });

  useEffect(() => {
    let cancelled = false;

    fetchImportedSeries(examId)
      .then((items) => {
        if (cancelled) return;
        setRemoteSeriesState({
          examId,
          seriesId,
          series: items.find((item) => item.id === seriesId) ?? null,
        });
      })
      .catch(() => {
        if (!cancelled) setRemoteSeriesState({ examId, seriesId, series: null });
      });

    return () => {
      cancelled = true;
    };
  }, [examId, seriesId]);

  const remoteMatchesRoute = remoteSeriesState.examId === examId && remoteSeriesState.seriesId === seriesId;
  const loadingRemoteSeries = Boolean(examId && seriesId && !remoteMatchesRoute);
  const series = remoteMatchesRoute ? remoteSeriesState.series : null;

  if (!series && loadingRemoteSeries) {
    return (
      <div className="simple-page">
        <main className="simple-shell">
          <section className="simple-card status-panel">
            <p className="simple-eyebrow">Serie</p>
            <h1>
              <span className="simple-loading-dots" aria-label="Importierte Serie wird geladen">
                <span />
                <span />
                <span />
              </span>
            </h1>
          </section>
        </main>
      </div>
    );
  }

  if (!series) {
    return <ComingSoonPage examId={examId} title="Diese Serie ist noch nicht verfuegbar" />;
  }

  if (!canOpenSeries(series)) {
    return (
      <div className="simple-page">
        <main className="simple-shell">
          <div className="simple-topbar">
            <Link className="simple-logo" to="/">
              <img src={logo} alt="" />
              Deutsch Prüfungen
            </Link>
            <Link className="simple-home-link" to={`/simulations/${examId}`}>
              Zurueck zu den Serien
            </Link>
          </div>
          <section className="simple-card status-panel">
            <p className="simple-eyebrow">Premium-Serie</p>
            <h1>{series.code} ist gesperrt</h1>
            <p>Diese Serie ist fuer zahlende Nutzer reserviert.</p>
            <div className="simple-actions">
              <Link className="simple-button" to="/offers">
                <Lock size={16} />
                Angebote ansehen
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const orderedModules = ["read", "listen", "write", "speak", "sprach"]
    .map((moduleId) => simulationModules.find((module) => module.id === moduleId))
    .filter((module) => module && series.modules?.[module.id]);
  const visitorState = isVisitorSeriesAttempt(series) || Boolean(location.state?.visitorFreeAccess)
    ? { visitorFreeAccess: true }
    : undefined;
  const startModule = (moduleId) => {
    setStartingModuleId(moduleId);
    navigate(`/simulation/${examId}/${seriesId}/${moduleId}`, {
      state: { ...visitorState, autoStartSimulation: true, confirmedStart: true },
    });
  };
  const requestStartModule = (moduleId) => {
    if (series.modules?.[moduleId]?.available === false) {
      navigate(`/simulation/${examId}/${seriesId}/${moduleId}`, {
        state: visitorState,
      });
      return;
    }
    setStartingModuleId(null);
    setPendingModuleId(moduleId);
  };
  const closeStartConfirmation = () => {
    if (startingModuleId) return;
    setPendingModuleId(null);
  };
  const logout = async () => {
    try {
      await API.post("/api/auth/logout");
    } catch {
      // Local logout remains reliable when the server token is stale.
    }
    clearAuthSession();
    clearDashboardCache();
    navigate("/", { replace: true });
  };
  const continueToModule = () => {
    if (pendingModuleId && !startingModuleId) {
      startModule(pendingModuleId);
    }
  };

  const getStartDetails = (moduleId) => {
    const baseModule = simulationModules.find((module) => module.id === moduleId);
    const content = series.modules?.[moduleId] ?? baseModule ?? {};
    const questionCount =
      Number(content.questionCount) ||
      (Array.isArray(content.taskOverrides) ? content.taskOverrides.length : 0) ||
      (Array.isArray(content.tasks) ? content.tasks.length : 0);
    const durationMinutes =
      Number(content.durationMinutes) ||
      Number(content.defaultMinutes) ||
      (Number(content.simulationSeconds) ? Math.round(Number(content.simulationSeconds) / 60) : 60);

    return {
      moduleType: t.modules?.[moduleId] ?? content.label ?? baseModule?.label ?? "Modul",
      examType: series.examName ?? examId,
      questionCount,
      itemLabel: getModuleCountLabel(moduleId, t.simulations.questions),
      durationMinutes,
    };
  };

  return (
    <div className={styles.pageContainer}>
      <SimulationTopNav
        onGoHome={() => navigate("/")}
        onGoAbout={() => navigate("/about")}
        onGoProfile={() => navigate("/profile")}
        onGoDashboard={() => navigate("/dashboard")}
        onGoActualites={() => navigate("/actualites")}
        onGoContact={() => navigate("/contact")}
        onGoModule={(moduleId) =>
          moduleId === "lessons"
            ? navigate("/lessons")
            : requestStartModule(moduleId)
        }
        onLogout={logout}
      />

      <main className={styles.mainContent}>
        <BackButton
          fallback={`/simulations/${examId}`}
          forceFallback={Boolean(location.state?.fromSimulationExit)}
        />
        <header className={styles.headerSection}>
          <h1 className={styles.title}>
            {series.examName} - {series.code}
          </h1>
          <p className={styles.subtitle}>
            Waehlen Sie ein Modul fuer diese Serie. Der Aufbau bleibt gleich; die Aufgaben nutzen Inhalte aus {series.code}.
          </p>
        </header>

        <section className={styles.gridSection}>
          <div className={styles.cardGrid}>
            {orderedModules.map((module) => {
              const content = series.modules[module.id] ?? module;
              const unavailable = content.available === false;
              return (
                <SimulationDisciplineCard
                  key={module.id}
                  iconPath={moduleAssets[module.id]?.iconPath}
                  iconNode={moduleAssets[module.id]?.iconNode}
                  title={t.modules?.[module.id] ?? content.label ?? module.label}
                  time={content.durationMinutes ?? 60}
                  questions={content.questionCount ?? 39}
                  accent={content.accent ?? module.accent ?? series.accent}
                  badge={unavailable ? "Non disponible" : undefined}
                  minuteLabel={t.simulations.minutes}
                  questionLabel={getModuleCountLabel(module.id, t.simulations.questions)}
                  onClick={() => requestStartModule(module.id)}
                />
              );
            })}
          </div>
        </section>
      </main>
      {pendingModuleId ? (
        <StartConfirmationModal
          {...getStartDetails(pendingModuleId)}
          busy={Boolean(startingModuleId)}
          onCancel={closeStartConfirmation}
          onStart={continueToModule}
        />
      ) : null}
    </div>
  );
}
