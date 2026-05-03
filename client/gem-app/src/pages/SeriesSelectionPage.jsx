import { Link, useParams } from "react-router-dom";
import { Lock } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";
import { getExamSimulation, getSeriesForExam } from "../data/testSeries";
import { canOpenSeries, isVisitorSeriesAttempt } from "../utils/access";

export default function SeriesSelectionPage() {
  const { examId } = useParams();
  const exam = getExamSimulation(examId);
  const series = getSeriesForExam(examId);

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
          <p>Choose a series to continue.</p>
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
