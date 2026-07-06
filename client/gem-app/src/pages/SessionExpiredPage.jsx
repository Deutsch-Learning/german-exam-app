import { Link, useLocation } from "react-router-dom";
import "./SimplePages.css";
import logo from "../assets/images/logo.png";

export default function SessionExpiredPage() {
  const { state } = useLocation();
  const selectedPlan = state?.selectedPlan;
  const offerText = selectedPlan
    ? `Pack sélectionné : ${selectedPlan.level} ${selectedPlan.planName} - ${selectedPlan.displayPrice}.`
    : state?.offerId
      ? `Pack sélectionné : ${state.offerId}.`
      : "";

  return (
    <div className="simple-page">
      <main className="simple-shell">
        <div className="simple-topbar">
          <Link className="simple-logo" to="/">
            <img src={logo} alt="" />
            Deutschprüfungen
          </Link>
        </div>

        <section className="simple-card status-panel">
          <p className="simple-eyebrow">Connexion requise</p>
          <h1>Connectez-vous pour continuer</h1>
          <p>
            {offerText} Créez un compte ou connectez-vous pour continuer avec ce pack.
            Le paiement sera préparé uniquement après connexion.
          </p>
          <div className="simple-actions">
            <Link className="simple-button" to="/register" state={state}>
              Créer un compte
            </Link>
            <Link className="simple-secondary-button" to="/login" state={state}>
              Se connecter
            </Link>
            <Link className="simple-secondary-button" to="/">
              Continuer comme visiteur
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
