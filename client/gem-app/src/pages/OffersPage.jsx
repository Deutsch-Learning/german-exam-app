import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { CheckCircle2, CreditCard, X } from "lucide-react";
import "./PricingPage.css";
import logo from "../assets/images/logo.png";
import { createCheckoutSession } from "../services/checkout";
import { getAuthUser } from "../utils/access";
import { pricingSections, enrichPricingPlan } from "../data/pricingPlans";

const PriceText = ({ value }) => {
  const [euros, cents = ""] = String(value).replace("€", "").split(",");
  return (
    <div className="official-price">
      <span>€</span>
      <strong>{euros}</strong>
      <small>,{cents}</small>
    </div>
  );
};

const CheckoutModal = ({ plan, checkout, loading, error, onClose }) => {
  if (!plan) return null;

  return (
    <div className="pricing-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pricing-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="pricing-modal-close" type="button" aria-label="Fermer" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="pricing-kicker">Pack sélectionné</p>
        <h2 id="checkout-title">{plan.level} {plan.planName}</h2>
        <div className="pricing-modal-summary">
          <span>Durée</span><strong>{plan.durationDays} jours</strong>
          <span>Prix</span><strong>{plan.displayPrice}</strong>
          <span>Simulateur écrit</span><strong>{plan.writingSimulatorAttempts} essais</strong>
          <span>Certifications</span><strong>{plan.certificationLabels.join(", ")}</strong>
        </div>
        <p className="pricing-modal-message">
          Paiement bientôt disponible. Ce pack est prêt pour l’intégration du paiement.
        </p>
        {checkout?.checkoutSession?.status ? (
          <p className="pricing-modal-status">
            Session préparée : {checkout.checkoutSession.status}
          </p>
        ) : null}
        {error ? <p className="pricing-modal-error">{error}</p> : null}
        <button className="pricing-modal-button" type="button" disabled={loading}>
          <CreditCard size={18} />
          {loading ? "Préparation..." : "Paiement bientôt disponible"}
        </button>
      </section>
    </div>
  );
};

export default function OffersPage() {
  const navigate = useNavigate();
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [checkout, setCheckout] = useState(null);
  const [checkoutError, setCheckoutError] = useState("");
  const [loadingPlanId, setLoadingPlanId] = useState("");
  const user = useMemo(() => getAuthUser(), []);

  const handleSubscribe = async (plan) => {
    const userNow = getAuthUser();
    if (!userNow?.id) {
      navigate("/session-expired", {
        state: {
          offerId: plan.id,
          selectedPlan: plan,
        },
      });
      return;
    }

    setSelectedPlan(plan);
    setCheckout(null);
    setCheckoutError("");
    setLoadingPlanId(plan.id);
    try {
      const session = await createCheckoutSession({ userId: userNow.id, ...plan, provider: "manual" });
      setCheckout(session);
    } catch (err) {
      setCheckoutError(
        err.response?.data?.error ||
          "La session de paiement n’a pas pu être préparée. Réessayez dans quelques instants."
      );
    } finally {
      setLoadingPlanId("");
    }
  };

  return (
    <div className="official-pricing-page">
      <header className="pricing-topbar">
        <Link className="pricing-logo" to="/">
          <img src={logo} alt="" />
          Deutschprüfungen
        </Link>
        <Link className="pricing-home-link" to={user?.id ? "/dashboard" : "/"}>
          {user?.id ? "Dashboard" : "Accueil"}
        </Link>
      </header>

      <main className="official-pricing-shell">
        <section className="pricing-heading">
          <p className="pricing-kicker">POSITIONNEMENT PREMIUM</p>
          <h1>Grille Tarifaire Officielle</h1>
          <p>Packs de révision pour la préparation aux examens d’allemand - Niveaux B1 & B2</p>
        </section>

        {pricingSections.map((section) => (
          <section className="pricing-level-section" key={section.level} aria-labelledby={`pricing-${section.level}`}>
            <div className="pricing-level-header">
              <h2 id={`pricing-${section.level}`}>NIVEAU {section.level}</h2>
              <div className="pricing-cert-tabs" aria-label={`Certifications ${section.level}`}>
                <span>Goethe / ÖSD</span>
                <span>TELC</span>
                <span>ECL</span>
              </div>
            </div>

            <div className="pricing-card-grid">
              {section.plans.map((rawPlan) => {
                const plan = enrichPricingPlan(section.level, rawPlan);
                return (
                  <article className="official-pricing-card" key={plan.id}>
                    <div className="pricing-card-header">
                      <h3>{plan.planName}</h3>
                      <p>{plan.formulaLabel}</p>
                    </div>
                    <div className="pricing-card-body">
                      <PriceText value={plan.displayPrice} />
                      <div className="pricing-feature-list">
                        {plan.sectionDetails.map((feature) => (
                          <div className="pricing-feature" key={feature.title}>
                            <strong>{feature.title}</strong>
                            <span>{feature.detail}</span>
                          </div>
                        ))}
                      </div>
                      <p className="pricing-version">Version <strong>2026</strong></p>
                      <p className="pricing-attempts">
                        Simulateur expression écrite : <strong>{plan.writingSimulatorAttempts} essais</strong>
                      </p>
                      <p className="pricing-access">Accès : {plan.durationDays} Jours</p>
                      <button
                        className="pricing-subscribe-button"
                        type="button"
                        onClick={() => handleSubscribe(plan)}
                        disabled={loadingPlanId === plan.id}
                      >
                        <CheckCircle2 size={15} />
                        {loadingPlanId === plan.id ? "PRÉPARATION..." : "S’ABONNER"}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        <p className="pricing-footer-note">
          Tarifs valables pour les quatre certifications ciblées : Goethe, ÖSD, TELC, ECL, à niveau et durée équivalents.
        </p>
      </main>

      <CheckoutModal
        plan={selectedPlan}
        checkout={checkout}
        loading={Boolean(loadingPlanId)}
        error={checkoutError}
        onClose={() => {
          setSelectedPlan(null);
          setCheckout(null);
          setCheckoutError("");
        }}
      />
    </div>
  );
}
