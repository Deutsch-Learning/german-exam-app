import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Lock } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { examSimulations } from "../data/siteContent";
import { fetchImportedSeries, hasPlayableImportedSeries } from "../services/importedExams";
import { canOpenSeries, isVisitorSeriesAttempt } from "../utils/access";
import { useSimulationLanguage } from "../utils/simulationLanguage";

export default function StartPreparationPage() {
  useSimulationLanguage();
  const [importedByExam, setImportedByExam] = useState({});

  useEffect(() => {
    let cancelled = false;

    Promise.all(
      examSimulations.map((exam) =>
        fetchImportedSeries(exam.id)
          .then((series) => [exam.id, series])
          .catch(() => [exam.id, []])
      )
    ).then((entries) => {
      if (!cancelled) setImportedByExam(Object.fromEntries(entries));
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const groupedSeries = examSimulations.map((exam) => ({
    exam,
    checked: Object.prototype.hasOwnProperty.call(importedByExam, exam.id),
    series: importedByExam[exam.id] ?? [],
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
            Startseite
          </Link>
        </div>

        <header className="simple-hero compact">
          <p className="simple-eyebrow">Kostenlos testen</p>
          <h1>Serie waehlen</h1>
          <p>Kostenlose Serien sind fuer Besucher offen. Bezahlte Serien bleiben gesperrt, bis ein Angebot ausgewaehlt wurde.</p>
        </header>

        <div className="free-series-groups">
          {groupedSeries.map(({ exam, checked, series }) => (
            <section className="free-series-group" key={exam.id}>
              <h2>{exam.name}</h2>
              <div className="series-minimal-grid">
                {!checked ? (
                  <span className="series-box locked">
                    <span className="series-box-name">Pruefung laeuft...</span>
                  </span>
                ) : !hasPlayableImportedSeries(series) ? (
                  <Link className="series-box locked" to={`/coming-soon/${exam.id}`}>
                    <span className="series-box-name">Demnaechst</span>
                    <Lock className="series-lock-icon" size={17} />
                  </Link>
                ) : series.map((item) => {
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
