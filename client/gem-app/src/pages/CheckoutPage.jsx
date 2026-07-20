import { Link, Navigate, useParams } from "react-router-dom";
import "./PricingPage.css";
import logo from "../assets/images/logo.png";
import NotFoundPage from "./NotFoundPage";
import { getAuthUser } from "../utils/access";
import { findPricingPlan } from "../data/pricingPlans";

export default function CheckoutPage() {
  const { offerId } = useParams();
  const plan = findPricingPlan(offerId);
  const user = getAuthUser();

  if (!user?.id) {
    return <Navigate to="/session-expired" replace state={{ offerId }} />;
  }

  if (!plan) {
    return <NotFoundPage message="Le pack sélectionné n’est pas disponible." />;
  }

  return (
    <div className="official-pricing-page">
      <main className="official-pricing-shell checkout-shell">
        <div className="pricing-topbar inline">
          <Link className="pricing-logo" to="/">
            <img src={logo} alt="" />
            Deutschprüfungen
          </Link>
          <Link className="pricing-home-link" to="/offers">
            Retour aux tarifs
          </Link>
        </div>
        <section className="pricing-modal checkout-panel">
          <p className="pricing-kicker">Pack sélectionné</p>
          <h1>{plan.level} {plan.planName}</h1>
          <div className="pricing-modal-summary">
            <span>Durée</span><strong>{plan.durationDays} jours</strong>
            <span>Prix de base</span><strong>{plan.displayPrice}</strong>
            <span>Simulateur oral</span><strong>{plan.speakingSimulatorQuota ?? 20} essais</strong>
            <span>Certifications</span><strong>À choisir sur la page tarifs</strong>
          </div>
          <p className="pricing-modal-message">
            Paiement bientôt disponible. Choisissez d’abord vos certifications pour préparer le bon total.
          </p>
          <div className="pricing-modal-actions">
            <Link className="pricing-modal-button" to="/offers">
              Choisir les certifications
            </Link>
            <Link className="pricing-modal-secondary" to="/dashboard">
              Dashboard
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
