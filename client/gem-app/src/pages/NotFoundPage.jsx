import { Link } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { useSimulationLanguage } from "../utils/simulationLanguage";

export default function NotFoundPage({
  title = "404-Fehler",
  message = "Diese Seite wurde nicht gefunden.",
}) {
  useSimulationLanguage();
  return (
    <div className="simple-page">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutsch Learning
          </Link>
        </div>

        <section className="simple-card status-panel">
          <p className="simple-eyebrow">Seite nicht verfuegbar</p>
          <h1>{title}</h1>
          <p>{message}</p>
          <div className="simple-actions">
            <Link className="simple-button" to="/">
              Zur Startseite
            </Link>
            <Link className="simple-secondary-button" to="/start-preparation">
              Vorbereitung starten
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
