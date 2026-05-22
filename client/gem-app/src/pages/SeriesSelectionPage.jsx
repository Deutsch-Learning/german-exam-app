import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";
import { getExamSimulation, getSeriesForExam } from "../data/testSeries";
import { fetchImportedSeries } from "../services/importedExams";
import { canOpenSeries, isVisitorSeriesAttempt } from "../utils/access";

export default function SeriesSelectionPage() {
  const { examId } = useParams();
  const exam = getExamSimulation(examId);
  const staticSeries = useMemo(() => getSeriesForExam(examId), [examId]);
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
  const series = importedSeries.length ? importedSeries : staticSeries;

  if (!exam || !series.length) {
    return <NotFoundPage message="The test series you opened is not available." />;
  }

  return (
    <div className="simple-page">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutsch Learning
          </Link>
          <Link className="simple-home-link" to="/">
            Home
          </Link>
        </div>

        <header className="simple-hero compact">
          <p className="simple-eyebrow">Series selection</p>
          <h1>{exam.name} series</h1>
          <p>{loadingImported ? "Loading imported series..." : "Choose a series to continue."}</p>
        </header>

        <section className="series-minimal-grid" aria-label={`${exam.name} series`}>
          {series.map((item) => {
            const canOpen = canOpenSeries(item);

            return (
              <Link
                className={`series-box ${canOpen ? "" : "locked"}`}
                key={item.id}
                to={canOpen ? `/simulations/${examId}/${item.id}` : "/offers"}
                state={isVisitorSeriesAttempt(item) ? { visitorFreeAccess: true } : undefined}
                aria-label={
                  canOpen
                    ? `Open ${item.code}`
                    : `${item.code} is locked. View offers to unlock premium series.`
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
