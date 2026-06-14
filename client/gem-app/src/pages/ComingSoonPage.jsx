import { Link, useParams } from "react-router-dom";
import { Clock3, Database, Sparkles } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { examSimulations } from "../data/siteContent";
import { isLoggedIn } from "../utils/access";
import { useSimulationLanguage } from "../utils/simulationLanguage";

export default function ComingSoonPage({ examId: examIdProp, title }) {
  useSimulationLanguage();
  const params = useParams();
  const examId = examIdProp ?? params.examId;
  const exam = examSimulations.find((item) => item.id === examId);
  const loggedIn = isLoggedIn();
  const homePath = loggedIn ? "/dashboard" : "/";

  return (
    <div className="simple-page">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to={homePath}>
            <img src={logo} alt="" />
            Deutsch Prüfungen
          </Link>
          <Link className="simple-home-link" to={loggedIn ? "/simulations" : "/"}>
            {loggedIn ? "Zurueck zu den Tests" : "Startseite"}
          </Link>
        </div>

        <section className="simple-card status-panel coming-soon-panel">
          <span className="coming-soon-icon">
            <Sparkles size={26} />
          </span>
          <p className="simple-eyebrow">Demnaechst</p>
          <h1>{title ?? `${exam?.name ?? "Diese Testart"} ist noch nicht verfuegbar`}</h1>
          <p>
            Wir bereiten gerade echte Fragen fuer diesen Bereich vor. Er wird automatisch geoeffnet,
            sobald gepruefte Inhalte in der Datenbank verfuegbar sind.
          </p>
          <div className="coming-soon-details" aria-label="Verfuegbarkeitsdetails">
            <span><Database size={16} /> Kein aktiver Fragensatz gefunden</span>
            <span><Clock3 size={16} /> Inhalt wird vorbereitet</span>
          </div>
          <div className="simple-actions">
            <Link className="simple-secondary-button" to={loggedIn ? "/simulations" : "/"}>
              {loggedIn ? "Anderen Test waehlen" : "Zur Startseite"}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
