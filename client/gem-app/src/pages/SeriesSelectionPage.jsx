import { useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";
import ComingSoonPage from "./ComingSoonPage";
import { getExamSimulation } from "../data/testSeries";
import { fetchImportedSeries, hasPlayableImportedSeries } from "../services/importedExams";
import { canOpenSeries, isVisitorSeriesAttempt } from "../utils/access";
import { useSimulationLanguage } from "../utils/simulationLanguage";

export default function SeriesSelectionPage() {
  useSimulationLanguage();
  const { examId } = useParams();
  const location = useLocation();
  const exam = getExamSimulation(examId);
  const [importedState, setImportedState] = useState({ examId: "", series: [] });

  useEffect(() => {
    let cancelled = false;

    fetchImportedSeries(examId)
      .then((items) => {
        if (!cancelled) setImportedState({ examId, series: items });
      })
      .catch(() => {
        if (!cancelled) setImportedState({ examId, series: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [examId]);

  const importedMatchesRoute = importedState.examId === examId;
  const importedSeries = importedMatchesRoute ? importedState.series : [];
  const loadingImported = Boolean(examId && !importedMatchesRoute);
  const series = importedSeries;

  if (!exam) {
    return <NotFoundPage message="Die geoeffnete Testserie ist nicht verfuegbar." />;
  }

  if (!loadingImported && !hasPlayableImportedSeries(series)) {
    return <ComingSoonPage examId={examId} />;
  }

  return (
    <div className={`simple-page ${location.state?.fromResults ? "from-results-transition" : ""}`}>
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutsch Learning
          </Link>
          <Link className="simple-home-link" to="/">
            Startseite
          </Link>
        </div>

        <header className="simple-hero compact">
          <p className="simple-eyebrow">Serienauswahl</p>
          <h1>{exam.name}-Serien</h1>
          <p>{loadingImported ? "Importierte Serien werden geladen..." : "Waehlen Sie eine Serie, um fortzufahren."}</p>
        </header>

        <section className="series-minimal-grid" aria-label={`${exam.name}-Serien`}>
          {loadingImported ? Array.from({ length: 6 }).map((_, index) => (
            <span className="series-box series-box-skeleton" key={index}>
              <span className="series-box-name">Laedt</span>
            </span>
          )) : series.map((item) => {
            const canOpen = canOpenSeries(item);

            return (
              <Link
                className={`series-box ${canOpen ? "" : "locked"}`}
                key={item.id}
                to={canOpen ? `/simulations/${examId}/${item.id}` : "/offers"}
                state={isVisitorSeriesAttempt(item) ? { visitorFreeAccess: true } : undefined}
                aria-label={
                  canOpen
                    ? `${item.code} oeffnen`
                    : `${item.code} ist gesperrt. Angebote ansehen, um Premium-Serien freizuschalten.`
                }
              >
                <span className="series-box-name">{item.code}</span>
                {!canOpen ? <Lock className="series-lock-icon" size={17} /> : null}
              </Link>
            );
          })}
        </section>
      </main>
    </div>
  );
}
