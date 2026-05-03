import { Link } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";

export default function NotFoundPage({
  title = "404 error",
  message = "This page could not be found.",
}) {
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
          <p className="simple-eyebrow">Page unavailable</p>
          <h1>{title}</h1>
          <p>{message}</p>
          <div className="simple-actions">
            <Link className="simple-button" to="/">
              Return to Home
            </Link>
            <Link className="simple-secondary-button" to="/start-preparation">
              Start preparation
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
