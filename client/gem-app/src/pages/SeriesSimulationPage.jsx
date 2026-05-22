import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import styles from "./SimulationSelectionPage.module.css";
import "./SimplePages.css";
import ComingSoonPage from "./ComingSoonPage";
import { simulationModules } from "../data/testSeries";
import { fetchImportedSeries } from "../services/importedExams";
import { canOpenSeries, isVisitorSeriesAttempt } from "../utils/access";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";
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

const moduleAssets = {
  read: { iconNode: <OpenBookIcon /> },
  listen: { iconPath: iconListen },
  write: { iconPath: iconWrite },
  speak: { iconPath: iconSpeak },
};

export default function SeriesSimulationPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { examId, seriesId } = useParams();
  const { t } = useLanguage();
  const [pendingModuleId, setPendingModuleId] = useState(null);
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
            <p className="simple-eyebrow">Series</p>
            <h1>Loading imported series...</h1>
          </section>
        </main>
      </div>
    );
  }

  if (!series) {
    return <ComingSoonPage examId={examId} title="This series is not yet available" />;
  }

  if (!canOpenSeries(series)) {
    return (
      <div className="simple-page">
        <main className="simple-shell">
          <div className="simple-topbar">
            <Link className="simple-logo" to="/">
              <img src={logo} alt="" />
              Deutsch Learning
            </Link>
            <Link className="simple-home-link" to={`/simulations/${examId}`}>
              Back to series
            </Link>
          </div>
          <section className="simple-card status-panel">
            <p className="simple-eyebrow">Premium series</p>
            <h1>{series.code} is locked</h1>
            <p>This series is reserved for paid users.</p>
            <div className="simple-actions">
              <Link className="simple-button" to="/offers">
                <Lock size={16} />
                View offers
              </Link>
            </div>
          </section>
        </main>
      </div>
    );
  }

  const orderedModules = ["read", "listen", "write", "speak"]
    .map((moduleId) => simulationModules.find((module) => module.id === moduleId))
    .filter((module) => module && series.modules?.[module.id]);
  const visitorState = isVisitorSeriesAttempt(series) || Boolean(location.state?.visitorFreeAccess)
    ? { visitorFreeAccess: true }
    : undefined;
  const startModule = (moduleId) => {
    navigate(`/simulation/${examId}/${seriesId}/${moduleId}`, {
      state: { ...visitorState, autoStartSimulation: true },
    });
  };
  const requestStartModule = (moduleId) => {
    setPendingModuleId(moduleId);
  };
  const closeStartConfirmation = () => {
    setPendingModuleId(null);
  };
  const continueToModule = () => {
    if (pendingModuleId) {
      startModule(pendingModuleId);
    }
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
      />

      <main className={styles.mainContent}>
        <BackButton fallback={`/simulations/${examId}`} />
        <header className={styles.headerSection}>
          <h1 className={styles.title}>
            {series.examName} - {series.code}
          </h1>
          <p className={styles.subtitle}>
            Choose a module for this selected series. The layout stays the same; the exercises use {series.code} content.
          </p>
        </header>

        <section className={styles.gridSection}>
          <div className={styles.cardGrid}>
            {orderedModules.map((module) => {
              const content = series.modules[module.id] ?? module;
              return (
                <SimulationDisciplineCard
                  key={module.id}
                  iconPath={moduleAssets[module.id]?.iconPath}
                  iconNode={moduleAssets[module.id]?.iconNode}
                  title={content.label ?? module.label}
                  time={content.durationMinutes ?? 60}
                  questions={content.questionCount ?? 39}
                  accent={content.accent ?? module.accent ?? series.accent}
                  minuteLabel={t.simulations.minutes}
                  questionLabel={t.simulations.questions}
                  onClick={() => requestStartModule(module.id)}
                />
              );
            })}
          </div>
        </section>
      </main>
      {pendingModuleId ? (
        <StartConfirmationModal
          title="You are about to start this test."
          message={null}
          cancelLabel="Return"
          startLabel="Continue"
          onCancel={closeStartConfirmation}
          onStart={continueToModule}
        />
      ) : null}
    </div>
  );
}
