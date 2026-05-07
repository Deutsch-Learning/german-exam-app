import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { examSimulations } from "../data/siteContent";
import { getSeriesForExam } from "../data/testSeries";
import { canOpenSeries, isVisitorSeriesAttempt } from "../utils/access";

export default function StartPreparationPage() {
  const groupedSeries = examSimulations.map((exam) => ({
    exam,
    series: getSeriesForExam(exam.id),
  }));

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
          <p className="simple-eyebrow">Try for free</p>
          <h1>Choose a series</h1>
          <p>Free series are open to visitors. Paid series are locked until an offer is selected.</p>
        </header>

        <div className="free-series-groups">
          {groupedSeries.map(({ exam, series }) => (
            <section className="free-series-group" key={exam.id}>
              <h2>{exam.name}</h2>
              <div className="series-minimal-grid">
                {series.map((item) => {
                  const canOpen = canOpenSeries(item);

                  return (
                    <Link
                      key={item.id}
                      className={`series-box ${canOpen ? "" : "locked"}`}
                      to={canOpen ? `/simulations/${exam.id}/${item.id}` : "/offers"}
                      state={isVisitorSeriesAttempt(item) ? { visitorFreeAccess: true } : undefined}
                    >
                      <span className="series-box-name">{item.code}</span>
                      {!canOpen ? <Lock className="series-lock-icon" size={17} /> : null}
                    </Link>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
