import { Link, useParams } from "react-router-dom";
import { Clock3, Database, Sparkles } from "lucide-react";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";
import { examSimulations } from "../data/siteContent";
import { isLoggedIn } from "../utils/access";

export default function ComingSoonPage({ examId: examIdProp, title }) {
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
            Deutsch Learning
          </Link>
          <Link className="simple-home-link" to={loggedIn ? "/simulations" : "/"}>
            {loggedIn ? "Back to tests" : "Home"}
          </Link>
        </div>

        <section className="simple-card status-panel coming-soon-panel">
          <span className="coming-soon-icon">
            <Sparkles size={26} />
          </span>
          <p className="simple-eyebrow">Coming Soon</p>
          <h1>{title ?? `${exam?.name ?? "This test type"} is not yet available`}</h1>
          <p>
            We are currently preparing real questions for this section. It will open automatically
            once validated content is available in the database.
          </p>
          <div className="coming-soon-details" aria-label="Availability details">
            <span><Database size={16} /> No active question set found</span>
            <span><Clock3 size={16} /> Content preparation in progress</span>
          </div>
          <div className="simple-actions">
            <Link className="simple-secondary-button" to={loggedIn ? "/simulations" : "/"}>
              {loggedIn ? "Choose another test" : "Return home"}
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
