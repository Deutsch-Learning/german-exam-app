import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Landmark, Smartphone, X } from "lucide-react";
import "./PricingPage.css";
import logo from "../assets/images/logo.png";
import { createCheckoutSession, getCheckoutQuote, getCheckoutSessionStatus } from "../services/checkout";
import { getAuthUser, updateStoredUser } from "../utils/access";
import { SUPPORT_WHATSAPP_NUMBER } from "../config/support";
import {
  certificationOptions,
  enrichPricingPlan,
  enterpriseOffers,
  formatEuro,
  pricingSections,
  unlockedSections,
} from "../data/pricingPlans";

const buildEnterprisePlan = (offer) => ({
  id: `enterprise-${offer.offerKey}`,
  offerKey: offer.offerKey,
  isEnterprise: true,
  level: "B1 + B2",
  planKey: "enterprise",
  planName: offer.label,
  priceEur: Number(offer.priceEur),
  displayPrice: offer.displayPrice,
  durationDays: offer.durationDays || offer.accessDays || 30,
  writingSimulatorAttempts: 10,
  availableCertifications: certificationOptions,
  unlockedSections: unlockedSections.map((section) => section.title),
  sectionDetails: unlockedSections,
  currency: "EUR",
  accessLabel: offer.accessLabel,
  billedLabel: offer.billedLabel,
  speakingSimulatorQuota: offer.speakingSimulatorQuota,
});

const getSupportName = (user) =>
  user?.name || user?.full_name || user?.fullName || user?.username || user?.email || "Client";

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

const mobileMoneyCountries = [
  {
    key: "CM",
    label: "Cameroun",
    dialCode: "+237",
    providers: {
      mtn: { label: "MTN Mobile Money", prefixes: [/^(?:\+?237)?(?:650|651|652|653|654|67\d|680|681|682|683)\d{6}$/] },
      orange: { label: "Orange Money", prefixes: [/^(?:\+?237)?(?:640|655|656|657|658|659|686|687|688|689|69\d)\d{6}$/] },
    },
  },
  {
    key: "CI",
    label: "Cote d'Ivoire",
    dialCode: "+225",
    providers: {
      mtn: { label: "MTN Mobile Money", prefixes: [/^(?:\+?225)?05\d{8}$/] },
      orange: { label: "Orange Money", prefixes: [/^(?:\+?225)?07\d{8}$/] },
    },
  },
  {
    key: "SN",
    label: "Senegal",
    dialCode: "+221",
    providers: {
      orange: { label: "Orange Money", prefixes: [/^(?:\+?221)?77\d{7}$/] },
    },
  },
];

const getMobileCountry = (key) =>
  mobileMoneyCountries.find((country) => country.key === key) || mobileMoneyCountries[0];

const normalizeMobilePhoneForUi = (value, countryKey) => {
  const digits = String(value || "").replace(/[^\d]/g, "");
  const country = getMobileCountry(countryKey);
  if (!digits) return "";
  if (digits.startsWith(country.dialCode.replace("+", ""))) return `+${digits}`;
  return `${country.dialCode}${digits}`;
};

const formatMobileAmount = (amount, currency) =>
  `${Number(amount || 0).toLocaleString("fr-FR")} ${currency || ""}`.trim();

const CLIENT_EUR_TO_XAF = 656;

const buildEstimatedQuote = (priceEur, countryKey) => {
  const amount = Math.round(Number(priceEur || 0) * CLIENT_EUR_TO_XAF);
  if (!amount) return null;
  return {
    paymentAmount: amount,
    paymentCurrency: countryKey === "CM" ? "XAF" : countryKey,
    estimated: true,
  };
};

const wait = (ms) => new Promise((resolve) => window.setTimeout(resolve, Math.max(0, ms)));

const scrollModalFirst = (event, modalElement) => {
  if (!modalElement) return;
  const deltaY = event.deltaY;
  if (!deltaY) return;

  const maxScrollTop = modalElement.scrollHeight - modalElement.clientHeight;
  if (maxScrollTop <= 0) return;

  const goingDown = deltaY > 0;
  const canScrollDown = modalElement.scrollTop < maxScrollTop - 1;
  const canScrollUp = modalElement.scrollTop > 1;

  if ((goingDown && canScrollDown) || (!goingDown && canScrollUp)) {
    event.preventDefault();
    modalElement.scrollTop += deltaY;
  }
};

// Kept temporarily as a compatibility reference while the payment modal is migrated.
const CheckoutModal = ({
  plan,
  selectedCertifications,
  checkout,
  loading,
  error,
  onClose,
  onToggleCertification,
  onConfirm,
}) => {
  if (!plan) return null;

  const selectedCount = selectedCertifications.length;
  const totalPrice = Number((plan.priceEur * selectedCount).toFixed(2));
  const selectedLabels = certificationOptions
    .filter((option) => selectedCertifications.includes(option.key))
    .map((option) => `${option.label} ${plan.level}`);

  return (
    <div className="pricing-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="pricing-modal pricing-certification-modal"
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
        <p className="pricing-modal-message compact">
          Choisissez les certifications que vous voulez débloquer pour ce pack.
        </p>

        <div className="pricing-certification-grid" aria-label={`Certifications ${plan.level}`}>
          {certificationOptions.map((option) => {
            const selected = selectedCertifications.includes(option.key);
            return (
              <button
                className={`pricing-certification-option ${selected ? "selected" : ""}`}
                key={option.key}
                type="button"
                aria-pressed={selected}
                onClick={() => onToggleCertification(option.key)}
              >
                <span>{option.label}</span>
                <strong>{plan.level}</strong>
                <CheckCircle2 size={18} />
              </button>
            );
          })}
        </div>

        <div className="pricing-modal-summary">
          <span>Prix de base</span><strong>{formatEuro(plan.priceEur)} par certification</strong>
          <span>Durée</span><strong>{plan.durationDays} jours</strong>
          <span>Simulateur écrit</span><strong>{plan.writingSimulatorAttempts} essais</strong>
          <span>Sélection</span><strong>{selectedCount || 0} certification{selectedCount > 1 ? "s" : ""}</strong>
          <span>Total</span><strong>{formatEuro(totalPrice)}</strong>
        </div>

        {selectedLabels.length ? (
          <p className="pricing-selection-note">
            Accès choisi : {selectedLabels.join(", ")}
          </p>
        ) : (
          <p className="pricing-selection-note muted">
            Sélectionnez au moins une certification pour continuer.
          </p>
        )}

        <p className="pricing-modal-message">
          Apres confirmation, vous serez redirige vers le paiement securise Notch Pay.
        </p>
        {checkout?.checkoutSession?.status ? (
          <p className="pricing-modal-status">
            Session préparée : {checkout.checkoutSession.status} · Total {formatEuro(checkout.checkoutSession.finalPriceEur)}
          </p>
        ) : null}
        {error ? <p className="pricing-modal-error">{error}</p> : null}
        <button
          className="pricing-modal-button"
          type="button"
          disabled={loading || selectedCount < 1}
          onClick={onConfirm}
        >
          <CreditCard size={18} />
          {loading ? "Préparation..." : "Continuer"}
        </button>
      </section>
    </div>
  );
};

void CheckoutModal;

const CheckoutModalV2 = ({
  plan,
  selectedCertifications,
  checkout,
  quote,
  quoteLoading,
  step,
  paymentMethod,
  mobileCountry,
  mobileProvider,
  mobilePhone,
  paymentStatus,
  verifying,
  verifyCooldown,
  loading,
  error,
  supportUrl,
  onClose,
  onToggleCertification,
  onContinue,
  onBack,
  onSelectPaymentMethod,
  onSetMobileCountry,
  onSetMobileProvider,
  onSetMobilePhone,
  onPayMobileMoney,
  onVerifyPayment,
}) => {
  const modalRef = useRef(null);
  if (!plan) return null;

  const isEnterprise = Boolean(plan.isEnterprise);
  const selectedCount = isEnterprise ? 1 : selectedCertifications.length;
  const totalPrice = isEnterprise
    ? Number(plan.priceEur)
    : Number((plan.priceEur * selectedCount).toFixed(2));
  const selectedLabels = certificationOptions
    .filter((option) => selectedCertifications.includes(option.key))
    .map((option) => (isEnterprise ? `${option.label} B1 + B2` : `${option.label} ${plan.level}`));
  const country = getMobileCountry(mobileCountry);
  const providerOptions = Object.entries(country.providers);
  const selectedProviderConfig = country.providers[mobileProvider];
  const normalizedPhone = normalizeMobilePhoneForUi(mobilePhone, mobileCountry);
  const estimatedQuote = buildEstimatedQuote(totalPrice, mobileCountry);
  const visibleQuote = quote || estimatedQuote;
  const clientPhoneLooksValid =
    Boolean(selectedProviderConfig) &&
    selectedProviderConfig.prefixes.some((pattern) => pattern.test(normalizedPhone.replace(/\s+/g, "")));
  const verificationChecked = Boolean(paymentStatus?.checked);
  const paymentSucceeded = paymentStatus?.status === "succeeded";
  const paymentPending = ["pending", "processing"].includes(paymentStatus?.status);
  const paymentFailed = paymentStatus?.status === "failed";
  const paymentNotConfirmed = verificationChecked && !paymentSucceeded && (paymentPending || paymentFailed);
  const displayedReference =
    checkout?.checkoutSession?.providerReference ||
    checkout?.checkoutSession?.merchantReference ||
    checkout?.checkoutSession?.transactionId ||
    "";
  const verificationButtonLabel = verifying
    ? "Vérification du paiement..."
    : verifyCooldown > 0
      ? `Réessayer dans ${verifyCooldown}s`
      : "Vérifier le paiement";
  const processingTitle = verifying
    ? "Vérification du paiement..."
    : paymentSucceeded
      ? "Paiement confirmé"
      : "Confirmez sur votre téléphone";
  const verifiedProviderMessage = verificationChecked ? String(paymentStatus?.message || "").trim() : "";
  const processingMessage = verifying
    ? "Nous vérifions la transaction existante auprès du prestataire. Aucun nouveau paiement n'est créé."
    : paymentSucceeded
      ? "Paiement confirmé. Votre accès aux examens a été activé."
      : verifiedProviderMessage
        ? verifiedProviderMessage
        : verificationChecked && paymentPending
          ? "Nous n'avons pas encore reçu votre paiement. La confirmation Mobile Money peut prendre un court instant."
          : verificationChecked && paymentFailed
            ? "Nous n'avons pas encore reçu votre paiement."
            : paymentStatus?.message || checkout?.checkoutSession?.message || "Une demande Mobile Money vient d'être envoyée. Validez-la sur votre téléphone.";

  return createPortal((
    <div
      className="pricing-modal-backdrop"
      role="presentation"
      onMouseDown={onClose}
      onWheel={(event) => {
        if (event.target === event.currentTarget) {
          scrollModalFirst(event, modalRef.current);
        }
      }}
    >
      <section
        ref={modalRef}
        className={`pricing-modal pricing-certification-modal pricing-step-${step}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        onMouseDown={(event) => event.stopPropagation()}
        onWheel={(event) => scrollModalFirst(event, modalRef.current)}
      >
        <button className="pricing-modal-close" type="button" aria-label="Fermer" onClick={onClose}>
          <X size={18} />
        </button>
        <p className="pricing-kicker">Pack selectionne</p>
        <h2 id="checkout-title">{plan.level} {plan.planName}</h2>

        <div className="pricing-summary-card">
          <div><span>Niveau</span><strong>{plan.level}</strong></div>
          <div><span>Pack</span><strong>{plan.planName}</strong></div>
          <div><span>Examens</span><strong>{selectedLabels.length ? selectedLabels.join(", ") : "Aucune selection"}</strong></div>
          <div><span>Duree</span><strong>{plan.accessLabel || `${plan.durationDays} jours`}</strong></div>
          <div><span>Quantite</span><strong>{selectedCount || 0}</strong></div>
          <div><span>Prix</span><strong>{formatEuro(plan.priceEur)}</strong></div>
          <div><span>Total EUR</span><strong>{formatEuro(totalPrice)}</strong></div>
          <div>
            <span>Devise paiement</span>
            <strong>
              {visibleQuote
                ? `${formatMobileAmount(visibleQuote.paymentAmount, visibleQuote.paymentCurrency)}${visibleQuote.estimated && quoteLoading ? " estime" : ""}`
                : quoteLoading
                  ? "Calcul..."
                  : "A confirmer"}
            </strong>
          </div>
        </div>

        {step === "certifications" && !isEnterprise ? (
          <>
            <p className="pricing-modal-message compact">
              Choisissez les certifications que vous voulez debloquer pour ce pack.
            </p>
            <div className="pricing-certification-grid" aria-label={`Certifications ${plan.level}`}>
              {certificationOptions.map((option) => {
                const selected = selectedCertifications.includes(option.key);
                return (
                  <button
                    className={`pricing-certification-option ${selected ? "selected" : ""}`}
                    key={option.key}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => onToggleCertification(option.key)}
                  >
                    <span>{option.label}</span>
                    <strong>{plan.level}</strong>
                    <CheckCircle2 size={18} />
                  </button>
                );
              })}
            </div>
            <p className="pricing-modal-message">Vous allez finaliser le paiement a l'etape suivante.</p>
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            <button className="pricing-modal-button" type="button" disabled={selectedCount < 1} onClick={onContinue}>
              Continuer
            </button>
          </>
        ) : null}

        {step === "certifications" && isEnterprise ? (
          <>
            <p className="pricing-modal-message compact">
              Ce pack entreprise debloque automatiquement les examens B1 et B2 pour Goethe, OSD, TELC et ECL apres confirmation securisee du paiement.
            </p>
            <div className="pricing-enterprise-access-grid" aria-label="Acces entreprise inclus">
              {certificationOptions.map((option) => (
                <div className="pricing-enterprise-access" key={option.key}>
                  <CheckCircle2 size={18} />
                  <span>{option.label}</span>
                  <strong>B1 + B2</strong>
                </div>
              ))}
            </div>
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            <button className="pricing-modal-button" type="button" onClick={onContinue}>
              Continuer
            </button>
          </>
        ) : null}

        {step === "method" ? (
          <>
            <p className="pricing-modal-message compact">Choisissez votre moyen de paiement.</p>
            <div className="pricing-payment-methods">
              <button
                className={`pricing-payment-method ${paymentMethod === "mobile_money" ? "selected" : ""}`}
                type="button"
                onClick={() => onSelectPaymentMethod("mobile_money")}
              >
                <Smartphone size={22} />
                <span>Mobile Money</span>
                <small>MTN Mobile Money ou Orange Money</small>
              </button>
              <button
                className={`pricing-payment-method ${paymentMethod === "card" ? "selected" : ""}`}
                type="button"
                onClick={() => onSelectPaymentMethod("card")}
              >
                <CreditCard size={22} />
                <span>Carte bancaire</span>
                <small>Bientot disponible</small>
              </button>
            </div>
            {paymentMethod === "mobile_money" ? (
              <button className="pricing-modal-button" type="button" onClick={onContinue}>Continuer avec Mobile Money</button>
            ) : null}
            {paymentMethod === "card" ? (
              <div className="pricing-card-placeholder">
                <div className="pricing-card-field">Nom du titulaire</div>
                <div className="pricing-card-field">Numero de carte</div>
                <div className="pricing-card-split">
                  <div className="pricing-card-field">MM/AA</div>
                  <div className="pricing-card-field">CVV</div>
                </div>
                <button className="pricing-modal-button" type="button" disabled>
                  Paiement par carte bientot disponible
                </button>
              </div>
            ) : null}
            <button className="pricing-modal-secondary" type="button" onClick={onBack}>Retour</button>
          </>
        ) : null}

        {step === "mobile" ? (
          <>
            <p className="pricing-modal-message compact">
              Selectionnez votre operateur, saisissez le numero Mobile Money, puis confirmez le paiement sur votre telephone.
            </p>
            <label className="pricing-field">
              <span>Pays</span>
              <select value={mobileCountry} onChange={(event) => onSetMobileCountry(event.target.value)}>
                {mobileMoneyCountries.map((item) => (
                  <option key={item.key} value={item.key}>{item.label} ({item.dialCode})</option>
                ))}
              </select>
            </label>
            <div className="pricing-payment-methods compact">
              {providerOptions.map(([key, provider]) => (
                <button
                  className={`pricing-payment-method ${mobileProvider === key ? "selected" : ""}`}
                  key={key}
                  type="button"
                  onClick={() => onSetMobileProvider(key)}
                >
                  <Landmark size={20} />
                  <span>{provider.label}</span>
                  <small>{country.label}</small>
                </button>
              ))}
            </div>
            <label className="pricing-field">
              <span>Numero Mobile Money</span>
              <input
                value={mobilePhone}
                onChange={(event) => onSetMobilePhone(event.target.value)}
                placeholder={`${country.dialCode}6XXXXXXXX`}
                inputMode="tel"
              />
            </label>
            {mobilePhone && !clientPhoneLooksValid ? (
              <p className="pricing-modal-error">Ce numero ne correspond pas clairement a l'operateur selectionne.</p>
            ) : null}
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            <button
              className="pricing-modal-button"
              type="button"
              disabled={loading || quoteLoading || !mobilePhone || !mobileProvider}
              onClick={onPayMobileMoney}
            >
              <Smartphone size={18} />
              {loading ? "Paiement en cours..." : `Payer ${visibleQuote ? formatMobileAmount(visibleQuote.paymentAmount, visibleQuote.paymentCurrency) : ""}`}
            </button>
            <button className="pricing-modal-secondary" type="button" disabled={loading} onClick={onBack}>Retour</button>
          </>
        ) : null}

        {step === "processing" ? (
          <>
            <div className="pricing-processing">
              <Smartphone className={`pricing-processingIcon ${verifying ? "verifying" : ""}`} size={34} />
              <h3>{processingTitle}</h3>
              <p>{processingMessage}</p>
              {displayedReference ? (
                <small>Référence : {displayedReference}</small>
              ) : null}
            </div>
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            {paymentSucceeded ? (
              <Link className="pricing-modal-button" to="/dashboard">Aller au dashboard</Link>
            ) : (
              <>
                <button className={`pricing-modal-button ${verifying ? "verifying" : ""}`} type="button" disabled={verifying || verifyCooldown > 0} onClick={onVerifyPayment}>
                  {verifying ? <span className="pricing-button-spinner" aria-hidden="true" /> : null}
                  {verificationButtonLabel}
                </button>
                <p className="pricing-verify-hint">
                  {verifyCooldown > 0
                    ? "La confirmation peut prendre un court instant. Vous pourrez vérifier à nouveau après ce délai."
                    : "Cliquez ici si le paiement a été effectué."}
                </p>
                {paymentNotConfirmed ? (
                  <div className="pricing-verification-alert" role="status" aria-live="polite">
                    <strong>Paiement non confirme</strong>
                    <p>Nous n'avons pas encore recu votre paiement.</p>
                    <p>
                      Si vous avez effectué le paiement mais que votre accès n'a pas été activé, contactez le service client.
                    </p>
                    <a className="pricing-modal-secondary" href={supportUrl} target="_blank" rel="noreferrer">
                      Contacter le service client
                    </a>
                  </div>
                ) : null}
              </>
            )}
          </>
        ) : null}
      </section>
    </div>
  ), document.body);
};

export default function OffersPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [selectedPlan, setSelectedPlan] = useState(null);
  const [, setSelectedEnterpriseOffer] = useState(null);
  const [selectedCertifications, setSelectedCertifications] = useState([]);
  const [checkout, setCheckout] = useState(null);
  const [checkoutQuote, setCheckoutQuote] = useState(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [checkoutError, setCheckoutError] = useState("");
  const [checkoutStep, setCheckoutStep] = useState("certifications");
  const [paymentMethod, setPaymentMethod] = useState("mobile_money");
  const [mobileCountry, setMobileCountry] = useState("CM");
  const [mobileProvider, setMobileProvider] = useState("mtn");
  const [mobilePhone, setMobilePhone] = useState("");
  const [checkoutPaymentStatus, setCheckoutPaymentStatus] = useState(null);
  const [verifyingPayment, setVerifyingPayment] = useState(false);
  const [verifyCooldown, setVerifyCooldown] = useState(0);
  const [idempotencyKey, setIdempotencyKey] = useState("");
  const [loadingPlanId, setLoadingPlanId] = useState("");
  const checkoutSubmittingRef = useRef(false);
  const user = useMemo(() => getAuthUser(), []);
  const paymentStatus = searchParams.get("payment");
  const paymentNotice = {
    failed: "Le paiement n'a pas abouti. Vous pouvez réessayer ou choisir un autre moyen de paiement.",
    pending: "Le paiement est en cours de vérification. L'accès sera activé automatiquement après confirmation.",
    verification_error: "Nous n'avons pas pu vérifier ce paiement pour le moment. Si le montant a été débité, contactez le support.",
    missing_reference: "La référence du paiement est manquante. Veuillez relancer le paiement depuis cette page.",
  }[paymentStatus] || "";

  useEffect(() => {
    if (!selectedPlan) return undefined;
    const handleEscape = (event) => {
      if (event.key === "Escape" && checkoutStep !== "processing") {
        setSelectedPlan(null);
      }
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("keydown", handleEscape);
    };
  }, [checkoutStep, selectedPlan]);

  useEffect(() => {
    const canQuote = selectedPlan?.isEnterprise || selectedCertifications.length > 0;
    if (!selectedPlan || !canQuote || !["method", "mobile"].includes(checkoutStep)) {
      return undefined;
    }
    let cancelled = false;
    getCheckoutQuote({
      offerKey: selectedPlan.offerKey,
      level: selectedPlan.isEnterprise ? undefined : selectedPlan.level,
      planKey: selectedPlan.isEnterprise ? undefined : selectedPlan.planKey,
      selectedCertifications,
      country: mobileCountry,
    })
      .then((result) => {
        if (!cancelled) setCheckoutQuote(result.quote);
      })
      .catch(() => {
        if (!cancelled) setCheckoutError("Le montant n'a pas pu etre confirme. Reessayez dans quelques instants.");
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutStep, mobileCountry, selectedCertifications, selectedPlan]);

  useEffect(() => {
    if (checkoutStep !== "processing" || checkoutPaymentStatus?.status !== "succeeded") return undefined;
    const timeout = window.setTimeout(() => navigate("/dashboard?payment=success"), 1600);
    return () => window.clearTimeout(timeout);
  }, [checkoutPaymentStatus?.status, checkoutStep, navigate]);

  useEffect(() => {
    if (verifyCooldown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setVerifyCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [verifyCooldown]);

  useEffect(() => {
    const reference = checkout?.checkoutSession?.providerReference;
    if (checkoutStep !== "processing" || !reference || checkoutPaymentStatus?.status === "succeeded") return undefined;
    let cancelled = false;
    const interval = window.setInterval(async () => {
      try {
        const result = await getCheckoutSessionStatus(reference);
        if (cancelled) return;
        setCheckoutPaymentStatus((current) => ({ ...result, checked: Boolean(current?.checked) }));
        if (["succeeded", "failed"].includes(result.status)) {
          window.clearInterval(interval);
        }
      } catch {
        if (!cancelled) setCheckoutError("");
      }
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [checkout, checkoutPaymentStatus?.status, checkoutStep]);

  const openPlanSelector = (plan) => {
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
    setSelectedCertifications([]);
    setCheckout(null);
    setCheckoutQuote(null);
    setCheckoutError("");
    setCheckoutStep("certifications");
    setPaymentMethod("mobile_money");
    setMobileCountry("CM");
    setMobileProvider("mtn");
    setMobilePhone("");
    setCheckoutPaymentStatus(null);
    setVerifyingPayment(false);
    setVerifyCooldown(0);
    setIdempotencyKey(plan.id);
  };

  const openEnterpriseCheckout = (offer) => {
    const userNow = getAuthUser();
    if (!userNow?.id) {
      navigate("/session-expired", {
        state: {
          offerId: offer.offerKey,
          selectedEnterpriseOffer: offer,
        },
      });
      return;
    }
    const plan = buildEnterprisePlan(offer);
    const allCertifications = certificationOptions.map((option) => option.key);
    setSelectedEnterpriseOffer(null);
    setSelectedPlan(plan);
    setSelectedCertifications(allCertifications);
    setCheckout(null);
    setCheckoutQuote(null);
    setCheckoutError("");
    setCheckoutStep("certifications");
    setPaymentMethod("mobile_money");
    setMobileCountry("CM");
    setMobileProvider("mtn");
    setMobilePhone("");
    setCheckoutPaymentStatus(null);
    setVerifyingPayment(false);
    setVerifyCooldown(0);
    setIdempotencyKey(plan.id);
  };

  const toggleCertification = (key) => {
    if (selectedPlan?.isEnterprise) return;
    setSelectedCertifications((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
    setCheckout(null);
    setCheckoutQuote(null);
    setCheckoutError("");
  };

  const continueCheckout = () => {
    setCheckoutError("");
    if (checkoutStep === "certifications") {
      if (!selectedPlan?.isEnterprise && selectedCertifications.length < 1) {
        setCheckoutError("Selectionnez au moins une certification.");
        return;
      }
      setQuoteLoading(true);
      setCheckoutStep("method");
      setIdempotencyKey(selectedPlan?.isEnterprise
        ? selectedPlan.id
        : `${selectedPlan.id}-${selectedCertifications.slice().sort().join("-")}`);
      return;
    }
    if (checkoutStep === "method" && paymentMethod === "mobile_money") {
      setQuoteLoading(true);
      setCheckoutStep("mobile");
    }
  };

  const backCheckout = () => {
    setCheckoutError("");
    if (checkoutStep === "mobile") setCheckoutStep("method");
    else if (checkoutStep === "method") setCheckoutStep("certifications");
    else if (checkoutStep === "processing") setCheckoutStep("method");
  };

  const updateMobileCountry = (countryKey) => {
    const country = getMobileCountry(countryKey);
    setMobileCountry(country.key);
    if (!country.providers[mobileProvider]) {
      setMobileProvider(Object.keys(country.providers)[0]);
    }
    setMobilePhone("");
    setCheckoutError("");
    setQuoteLoading(true);
  };

  const confirmCheckout = async () => {
    if (!selectedPlan || selectedCertifications.length < 1 || checkoutSubmittingRef.current) return;
    checkoutSubmittingRef.current = true;
    const activePlanKey = selectedPlan.id || selectedPlan.offerKey || `${selectedPlan.level}-${selectedPlan.planKey}`;
    setCheckout(null);
    setCheckoutPaymentStatus(null);
    setCheckoutError("");
    setLoadingPlanId(activePlanKey);
    try {
      const finalPriceEur = Number((selectedPlan.priceEur * selectedCertifications.length).toFixed(2));
      const session = await createCheckoutSession({
        offerKey: selectedPlan.offerKey,
        ...selectedPlan,
        basePriceEur: selectedPlan.priceEur,
        selectedCertifications,
        selectedCertificationCount: selectedCertifications.length,
        finalPriceEur: selectedPlan.isEnterprise ? selectedPlan.priceEur : finalPriceEur,
        paymentMethod: "mobile_money",
        mobileMoney: {
          country: mobileCountry,
          provider: mobileProvider,
          phone: mobilePhone,
        },
        idempotencyKey,
        provider: "notchpay",
      });
      setCheckout(session);
      setCheckoutPaymentStatus({
        status: session?.checkoutSession?.status || "processing",
        message: session?.checkoutSession?.message,
      });
      setCheckoutStep("processing");
    } catch (err) {
      setCheckoutError(
        err.response?.data?.error ||
          "La session de paiement n’a pas pu être préparée. Réessayez dans quelques instants."
      );
    } finally {
      setLoadingPlanId("");
      checkoutSubmittingRef.current = false;
    }
  };

  const verifyPayment = async () => {
    if (verifyingPayment || verifyCooldown > 0) return;
    const session = checkout?.checkoutSession || {};
    const reference = session.providerReference || session.merchantReference || session.transactionId;
    setVerifyingPayment(true);
    setCheckoutError("");
    setCheckoutPaymentStatus((current) => ({
      ...(current || {}),
      status: current?.status || "processing",
      checked: false,
      message: "Vérification du paiement...",
    }));
    const startedAt = Date.now();
    try {
      if (!reference) {
        await wait(1400 - (Date.now() - startedAt));
        setCheckoutPaymentStatus((current) => ({
          ...(current || {}),
          status: "processing",
          checked: true,
          message:
            "La référence de paiement est introuvable. Relancez le paiement ou contactez le service client si votre compte a été débité.",
        }));
        setVerifyCooldown(8);
        return;
      }
      const result = await getCheckoutSessionStatus(reference);
      await wait(1400 - (Date.now() - startedAt));
      setCheckoutPaymentStatus({ ...result, checked: true });
      if (result.status === "succeeded") {
        if (result.user) updateStoredUser(result.user);
        setCheckoutError("");
        window.setTimeout(() => navigate("/dashboard"), 1200);
      } else if (result.status === "failed") {
        setCheckoutError("");
        setVerifyCooldown(10);
      } else {
        setCheckoutError("");
        setVerifyCooldown(8);
      }
    } catch (err) {
      await wait(1400 - (Date.now() - startedAt));
      setCheckoutError("");
      setCheckoutPaymentStatus((current) => ({
        ...(current || {}),
        status: current?.status || "processing",
        checked: true,
        message:
          err.response?.data?.error ||
          "Nous n'avons pas encore reçu votre paiement. La confirmation peut prendre un court instant.",
      }));
      setVerifyCooldown(8);
    } finally {
      setVerifyingPayment(false);
    }
  };

  const supportUrl = useMemo(() => {
    const session = checkout?.checkoutSession || {};
    const selectedLabel = selectedPlan
      ? `${selectedPlan.level} ${selectedPlan.planName}`
      : "Pack non precise";
    const message = [
      "Bonjour N-Deutschprufungen,",
      "j'ai effectue un paiement mais mon acces n'est pas encore active.",
      `Nom: ${getSupportName(user)}`,
      `Email: ${user?.email || "Non renseigne"}`,
      `Pack: ${selectedLabel}`,
      `Prestataire: ${session.provider || "notchpay"}`,
      `Reference: ${session.providerReference || "Non disponible"}`,
      `Montant: ${session.paymentAmount || session.amount || ""} ${session.paymentCurrency || session.currency || ""}`.trim(),
      `Date: ${new Date().toLocaleString("fr-FR")}`,
    ].join("\n");
    return `https://wa.me/${SUPPORT_WHATSAPP_NUMBER}?text=${encodeURIComponent(message)}`;
  }, [checkout, selectedPlan, user]);

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

        {paymentNotice ? (
          <div className={`pricing-payment-notice ${paymentStatus === "failed" || paymentStatus === "verification_error" ? "warning" : ""}`}>
            {paymentNotice}
          </div>
        ) : null}

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
                        onClick={() => openPlanSelector(plan)}
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

        <section className="enterprise-pricing-section" aria-labelledby="enterprise-pricing-title">
          <div className="enterprise-pricing-heading">
            <p className="pricing-kicker">OFFRES ÉCOLES & INSTITUTIONS</p>
            <h2 id="enterprise-pricing-title">Paiement entreprise</h2>
            <p>
              Packs conçus pour les écoles, centres de langue et partenaires qui veulent préparer plusieurs apprenants B1 et B2.
            </p>
          </div>
          <div className="enterprise-card-grid">
            {enterpriseOffers.map((offer) => (
              <article className="enterprise-card" key={offer.offerKey}>
                <div className="enterprise-card-top">
                  <span>{offer.subtitle}</span>
                  <h3>{offer.label}</h3>
                  <PriceText value={offer.displayPrice} />
                </div>
                <div className="enterprise-card-body">
                  <p>{offer.description}</p>
                  <dl>
                    <div><dt>Accès</dt><dd>{offer.accessLabel}</dd></div>
                    <div><dt>Facturation</dt><dd>{offer.billedLabel}</dd></div>
                    <div><dt>Simulations orales</dt><dd>{offer.speakingSimulatorQuota}</dd></div>
                    <div><dt>Modules</dt><dd>B1 + B2 · Goethe, ÖSD, TELC, ECL</dd></div>
                  </dl>
                  <button className="enterprise-button" type="button" onClick={() => openEnterpriseCheckout(offer)}>
                    <CreditCard size={17} />
                    S'abonner
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <p className="pricing-footer-note">
          Tarifs valables pour les certifications ciblées : Goethe, ÖSD, TELC, ECL, à niveau et durée équivalents.
        </p>
      </main>

      <CheckoutModalV2
        plan={selectedPlan}
        selectedCertifications={selectedCertifications}
        checkout={checkout}
        quote={checkoutQuote}
        quoteLoading={quoteLoading}
        step={checkoutStep}
        paymentMethod={paymentMethod}
        mobileCountry={mobileCountry}
        mobileProvider={mobileProvider}
        mobilePhone={mobilePhone}
        paymentStatus={checkoutPaymentStatus}
        verifying={verifyingPayment}
        verifyCooldown={verifyCooldown}
        loading={Boolean(loadingPlanId)}
        error={checkoutError}
        supportUrl={supportUrl}
        onToggleCertification={toggleCertification}
        onContinue={continueCheckout}
        onBack={backCheckout}
        onSelectPaymentMethod={(method) => {
          setPaymentMethod(method);
          setCheckoutError("");
        }}
        onSetMobileCountry={updateMobileCountry}
        onSetMobileProvider={(provider) => {
          setMobileProvider(provider);
          setCheckoutError("");
        }}
        onSetMobilePhone={setMobilePhone}
        onPayMobileMoney={confirmCheckout}
        onVerifyPayment={verifyPayment}
        onClose={() => {
          setSelectedPlan(null);
          setSelectedEnterpriseOffer(null);
          setSelectedCertifications([]);
          setCheckout(null);
          setCheckoutQuote(null);
          setCheckoutError("");
          setCheckoutStep("certifications");
          setCheckoutPaymentStatus(null);
          setVerifyingPayment(false);
          setVerifyCooldown(0);
        }}
      />
    </div>
  );
}
