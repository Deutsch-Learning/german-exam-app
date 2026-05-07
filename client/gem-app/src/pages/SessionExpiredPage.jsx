import { Link, useLocation } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";

export default function SessionExpiredPage() {
  const { state } = useLocation();
  const offerText = state?.offerId ? `Offer selected: ${state.offerId}.` : "";

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
          <p className="simple-eyebrow">Session</p>
          <h1>Your session has expired</h1>
          <p>
            {offerText} Create an account or log in to continue with this offer. You can
            also continue as a visitor and return to the landing page.
          </p>
          <div className="simple-actions">
            <Link className="simple-button" to="/register">
              Create an account
            </Link>
            <Link className="simple-secondary-button" to="/login">
              Login
            </Link>
            <Link className="simple-secondary-button" to="/">
              Continue as a visitor
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
