import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { CheckCircle2, CreditCard, Landmark, Smartphone, X } from "lucide-react";
import "./PricingPage.css";
import logo from "../assets/images/logo.png";
import { createCheckoutSession, getCheckoutQuote, getCheckoutSessionStatus } from "../services/checkout";
import { getAuthSession, getAuthUser, storeAuthSession, updateStoredUser } from "../utils/access";
import { SUPPORT_WHATSAPP_NUMBER } from "../config/support";
import {
  certificationOptions,
  enrichPricingPlan,
  enterpriseOffers,
  formatEuro,
  pricingSections,
  unlockedSections,
} from "../data/pricingPlans";
import { useLanguage } from "../context/LanguageContext";
import { languageOptions } from "../utils/language";

const offersCopy = {
  fr: {
    home: "Accueil",
    kicker: "POSITIONNEMENT PREMIUM",
    title: "Grille Tarifaire Officielle",
    subtitle: "Packs de revision pour la preparation aux examens d'allemand - Niveaux B1 & B2",
    level: "NIVEAU",
    version: "Version",
    oralSimulator: "Simulateur expression orale",
    attempts: "essais",
    access: "Acces",
    days: "Jours",
    preparing: "PREPARATION...",
    subscribe: "S'ABONNER",
    enterpriseKicker: "OFFRES ECOLES & INSTITUTIONS",
    enterpriseTitle: "Paiement entreprise",
    enterpriseSubtitle: "Packs concus pour les ecoles, centres de langue et partenaires qui veulent preparer plusieurs apprenants B1 et B2.",
    billing: "Facturation",
    oralSimulations: "Simulations orales",
    modules: "Modules",
    footer: "Tarifs valables pour les certifications ciblees : Goethe, OSD, TELC, ECL, a niveau et duree equivalents.",
    features: {
      reading: ["Comprehension ecrite", "Tests en conditions reelles"],
      listening: ["Comprehension orale", "Simulations audio officielles"],
      speaking: ["Expression orale", "Exercices guides et corrections"],
      writing: ["Expression ecrite", "Exercices guides et corrections"],
    },
    notices: {
      failed: "Le paiement n'a pas abouti. Vous pouvez reessayer ou choisir un autre moyen de paiement.",
      pending: "Le paiement est en cours de verification. L'acces sera active automatiquement apres confirmation.",
      verification_error: "Nous n'avons pas pu verifier ce paiement pour le moment. Si le montant a ete debite, contactez le support.",
      missing_reference: "La reference du paiement est manquante. Veuillez relancer le paiement depuis cette page.",
    },
    modal: {
      close: "Fermer",
      selectedPack: "Pack selectionne",
      level: "Niveau",
      pack: "Pack",
      exams: "Examens",
      duration: "Duree",
      quantity: "Quantite",
      price: "Prix",
      total: "Total EUR",
      paymentCurrency: "Devise paiement",
      reference: "Reference",
      none: "Aucune selection",
      calculating: "Calcul...",
      toConfirm: "A confirmer",
      estimated: " estime",
      chooseCerts: "Choisissez les certifications que vous voulez debloquer pour ce pack.",
      finalizeNext: "Vous allez finaliser le paiement a l'etape suivante.",
      enterpriseUnlock: "Ce pack entreprise debloque automatiquement les examens B1 et B2 pour Goethe, OSD, TELC et ECL apres confirmation securisee du paiement.",
      continue: "Continuer",
      paymentMethod: "Choisissez votre moyen de paiement.",
      card: "Carte bancaire",
      cardSoon: "Bientot disponible",
      cardPaySoon: "Paiement par carte bientot disponible",
      mobileContinue: "Continuer avec Mobile Money",
      back: "Retour",
      mobileInstructions: "Selectionnez votre operateur, saisissez le numero Mobile Money, puis confirmez le paiement sur votre telephone.",
      country: "Pays",
      phone: "Numero Mobile Money",
      invalidPhone: "Ce numero ne correspond pas clairement a l'operateur selectionne.",
      paying: "Paiement en cours...",
      pay: "Payer",
      verifying: "Verification du paiement...",
      verify: "Verifier le paiement",
      retryIn: "Reessayer dans",
      confirmed: "Paiement confirme",
      confirmPhone: "Confirmez sur votre telephone",
      checking: "Nous verifions la transaction existante aupres du prestataire. Aucun nouveau paiement n'est cree.",
      accessActivated: "Paiement confirme. Votre acces aux examens a ete active.",
      paymentSent: "Une demande Mobile Money vient d'etre envoyee. Validez-la sur votre telephone.",
      notReceived: "Nous n'avons pas encore recu votre paiement.",
      pendingPayment: "Nous n'avons pas encore recu votre paiement. La confirmation Mobile Money peut prendre un court instant.",
      dashboard: "Aller au dashboard",
      verifyHintWait: "La confirmation peut prendre un court instant. Vous pourrez verifier a nouveau apres ce delai.",
      verifyHint: "Cliquez ici si le paiement a ete effectue.",
      notConfirmed: "Paiement non confirme",
      contactSupportText: "Si vous avez effectue le paiement mais que votre acces n'a pas ete active, contactez le service client.",
      contactSupport: "Contacter le service client",
      selectCertError: "Selectionnez au moins une certification.",
      quoteError: "Le montant n'a pas pu etre confirme. Reessayez dans quelques instants.",
      sessionError: "La session de paiement n'a pas pu etre preparee. Reessayez dans quelques instants.",
      missingReference: "La reference de paiement est introuvable. Relancez le paiement ou contactez le service client si votre compte a ete debite.",
    },
  },
  en: {
    home: "Home",
    kicker: "PREMIUM PLACEMENT",
    title: "Official Pricing",
    subtitle: "Revision packs for German exam preparation - B1 & B2 levels",
    level: "LEVEL",
    version: "Version",
    oralSimulator: "Speaking simulator",
    attempts: "attempts",
    access: "Access",
    days: "Days",
    preparing: "PREPARING...",
    subscribe: "SUBSCRIBE",
    enterpriseKicker: "SCHOOL & INSTITUTION OFFERS",
    enterpriseTitle: "Enterprise payment",
    enterpriseSubtitle: "Packs designed for schools, language centres, and partners preparing several B1 and B2 learners.",
    billing: "Billing",
    oralSimulations: "Speaking simulations",
    modules: "Modules",
    footer: "Prices apply to targeted certifications: Goethe, OSD, TELC, ECL, with equivalent level and duration.",
    features: {
      reading: ["Reading comprehension", "Tests under real exam conditions"],
      listening: ["Listening comprehension", "Official audio simulations"],
      speaking: ["Speaking expression", "Guided exercises and corrections"],
      writing: ["Written expression", "Guided exercises and corrections"],
    },
    notices: {
      failed: "The payment did not go through. You can try again or choose another payment method.",
      pending: "The payment is being verified. Access will activate automatically after confirmation.",
      verification_error: "We could not verify this payment right now. If you were debited, contact support.",
      missing_reference: "The payment reference is missing. Please restart payment from this page.",
    },
    modal: {
      close: "Close",
      selectedPack: "Selected pack",
      level: "Level",
      pack: "Pack",
      exams: "Exams",
      duration: "Duration",
      quantity: "Quantity",
      price: "Price",
      total: "Total EUR",
      paymentCurrency: "Payment currency",
      reference: "Reference",
      none: "No selection",
      calculating: "Calculating...",
      toConfirm: "To confirm",
      estimated: " estimated",
      chooseCerts: "Choose the certifications you want to unlock for this pack.",
      finalizeNext: "You will finalize payment in the next step.",
      enterpriseUnlock: "This enterprise pack automatically unlocks B1 and B2 exams for Goethe, OSD, TELC, and ECL after secure payment confirmation.",
      continue: "Continue",
      paymentMethod: "Choose your payment method.",
      card: "Bank card",
      cardSoon: "Coming soon",
      cardPaySoon: "Card payment coming soon",
      mobileContinue: "Continue with Mobile Money",
      back: "Back",
      mobileInstructions: "Select your operator, enter your Mobile Money number, then confirm the payment on your phone.",
      country: "Country",
      phone: "Mobile Money number",
      invalidPhone: "This number does not clearly match the selected operator.",
      paying: "Payment in progress...",
      pay: "Pay",
      verifying: "Verifying payment...",
      verify: "Verify payment",
      retryIn: "Retry in",
      confirmed: "Payment confirmed",
      confirmPhone: "Confirm on your phone",
      checking: "We are checking the existing transaction with the provider. No new payment is being created.",
      accessActivated: "Payment confirmed. Your exam access has been activated.",
      paymentSent: "A Mobile Money request has been sent. Validate it on your phone.",
      notReceived: "We have not received your payment yet.",
      pendingPayment: "We have not received your payment yet. Mobile Money confirmation can take a short moment.",
      dashboard: "Go to dashboard",
      verifyHintWait: "Confirmation can take a short moment. You can check again after this delay.",
      verifyHint: "Click here if the payment has been completed.",
      notConfirmed: "Payment not confirmed",
      contactSupportText: "If you completed the payment but your access was not activated, contact customer service.",
      contactSupport: "Contact customer service",
      selectCertError: "Select at least one certification.",
      quoteError: "The amount could not be confirmed. Try again in a few moments.",
      sessionError: "The payment session could not be prepared. Try again in a few moments.",
      missingReference: "The payment reference cannot be found. Restart payment or contact customer service if your account was debited.",
    },
  },
  de: {
    home: "Start",
    kicker: "PREMIUM-EINSTUFUNG",
    title: "Offizielle Preisliste",
    subtitle: "Wiederholungspakete fuer die Deutschpruefungsvorbereitung - Niveaus B1 & B2",
    level: "NIVEAU",
    version: "Version",
    oralSimulator: "Simulator muendlicher Ausdruck",
    attempts: "Versuche",
    access: "Zugang",
    days: "Tage",
    preparing: "VORBEREITUNG...",
    subscribe: "ABONNIEREN",
    enterpriseKicker: "ANGEBOTE FUER SCHULEN & INSTITUTIONEN",
    enterpriseTitle: "Unternehmenszahlung",
    enterpriseSubtitle: "Pakete fuer Schulen, Sprachzentren und Partner, die mehrere Lernende auf B1 und B2 vorbereiten.",
    billing: "Abrechnung",
    oralSimulations: "Muendliche Simulationen",
    modules: "Module",
    footer: "Preise gelten fuer die Zielzertifikate Goethe, OSD, TELC und ECL bei gleichem Niveau und gleicher Dauer.",
    features: {
      reading: ["Leseverstehen", "Tests unter realen Pruefungsbedingungen"],
      listening: ["Hoerverstehen", "Offizielle Audiosimulationen"],
      speaking: ["Muendlicher Ausdruck", "Gefuehrte Uebungen und Korrekturen"],
      writing: ["Schriftlicher Ausdruck", "Gefuehrte Uebungen und Korrekturen"],
    },
    notices: {
      failed: "Die Zahlung war nicht erfolgreich. Sie koennen es erneut versuchen oder eine andere Zahlungsmethode waehlen.",
      pending: "Die Zahlung wird geprueft. Der Zugang wird nach Bestaetigung automatisch aktiviert.",
      verification_error: "Wir konnten diese Zahlung im Moment nicht pruefen. Wenn der Betrag abgebucht wurde, kontaktieren Sie den Support.",
      missing_reference: "Die Zahlungsreferenz fehlt. Bitte starten Sie die Zahlung erneut von dieser Seite.",
    },
    modal: {
      close: "Schliessen",
      selectedPack: "Ausgewaehltes Paket",
      level: "Niveau",
      pack: "Paket",
      exams: "Pruefungen",
      duration: "Dauer",
      quantity: "Anzahl",
      price: "Preis",
      total: "Total EUR",
      paymentCurrency: "Zahlungswaehrung",
      reference: "Referenz",
      none: "Keine Auswahl",
      calculating: "Berechnung...",
      toConfirm: "Zu bestaetigen",
      estimated: " geschaetzt",
      chooseCerts: "Waehlen Sie die Zertifikate, die Sie mit diesem Paket freischalten moechten.",
      finalizeNext: "Sie schliessen die Zahlung im naechsten Schritt ab.",
      enterpriseUnlock: "Dieses Unternehmenspaket schaltet nach sicherer Zahlungsbestaetigung automatisch B1- und B2-Pruefungen fuer Goethe, OSD, TELC und ECL frei.",
      continue: "Weiter",
      paymentMethod: "Waehlen Sie Ihre Zahlungsmethode.",
      card: "Bankkarte",
      cardSoon: "Bald verfuegbar",
      cardPaySoon: "Kartenzahlung bald verfuegbar",
      mobileContinue: "Mit Mobile Money fortfahren",
      back: "Zurueck",
      mobileInstructions: "Waehlen Sie Ihren Anbieter, geben Sie die Mobile-Money-Nummer ein und bestaetigen Sie die Zahlung auf Ihrem Telefon.",
      country: "Land",
      phone: "Mobile-Money-Nummer",
      invalidPhone: "Diese Nummer passt nicht eindeutig zum ausgewaehlten Anbieter.",
      paying: "Zahlung laeuft...",
      pay: "Zahlen",
      verifying: "Zahlung wird geprueft...",
      verify: "Zahlung pruefen",
      retryIn: "Erneut versuchen in",
      confirmed: "Zahlung bestaetigt",
      confirmPhone: "Auf dem Telefon bestaetigen",
      checking: "Wir pruefen die bestehende Transaktion beim Anbieter. Es wird keine neue Zahlung erstellt.",
      accessActivated: "Zahlung bestaetigt. Ihr Pruefungszugang wurde aktiviert.",
      paymentSent: "Eine Mobile-Money-Anfrage wurde gesendet. Bestaetigen Sie sie auf Ihrem Telefon.",
      notReceived: "Wir haben Ihre Zahlung noch nicht erhalten.",
      pendingPayment: "Wir haben Ihre Zahlung noch nicht erhalten. Die Mobile-Money-Bestaetigung kann kurz dauern.",
      dashboard: "Zum Dashboard",
      verifyHintWait: "Die Bestaetigung kann kurz dauern. Sie koennen nach dieser Frist erneut pruefen.",
      verifyHint: "Klicken Sie hier, wenn die Zahlung durchgefuehrt wurde.",
      notConfirmed: "Zahlung nicht bestaetigt",
      contactSupportText: "Wenn Sie bezahlt haben, der Zugang aber nicht aktiviert wurde, kontaktieren Sie den Kundenservice.",
      contactSupport: "Kundenservice kontaktieren",
      selectCertError: "Waehlen Sie mindestens ein Zertifikat.",
      quoteError: "Der Betrag konnte nicht bestaetigt werden. Versuchen Sie es gleich erneut.",
      sessionError: "Die Zahlungssitzung konnte nicht vorbereitet werden. Versuchen Sie es gleich erneut.",
      missingReference: "Die Zahlungsreferenz wurde nicht gefunden. Starten Sie die Zahlung erneut oder kontaktieren Sie den Kundenservice, wenn Ihr Konto belastet wurde.",
    },
  },
};

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
  const [euros, cents = ""] = String(value).replace(/\u20ac/g, "").split(",");
  return (
    <div className="official-price">
      <span>{"\u20ac"}</span>
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
  copy,
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
  const modalCopy = copy?.modal || offersCopy.fr.modal;

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
    ? modalCopy.verifying
    : verifyCooldown > 0
      ? `${modalCopy.retryIn} ${verifyCooldown}s`
      : modalCopy.verify;
  const processingTitle = verifying
    ? modalCopy.verifying
    : paymentSucceeded
      ? modalCopy.confirmed
      : modalCopy.confirmPhone;
  const verifiedProviderMessage = verificationChecked ? String(paymentStatus?.message || "").trim() : "";
  const processingMessage = verifying
    ? modalCopy.checking
    : paymentSucceeded
      ? modalCopy.accessActivated
      : verifiedProviderMessage
        ? verifiedProviderMessage
        : verificationChecked && paymentPending
          ? modalCopy.pendingPayment
          : verificationChecked && paymentFailed
            ? modalCopy.notReceived
            : paymentStatus?.message || checkout?.checkoutSession?.message || modalCopy.paymentSent;

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
        <button className="pricing-modal-close" type="button" aria-label={modalCopy.close} onClick={onClose}>
          <X size={18} />
        </button>
        <p className="pricing-kicker">{modalCopy.selectedPack}</p>
        <h2 id="checkout-title">{plan.level} {plan.planName}</h2>

        <div className="pricing-summary-card">
          <div><span>{modalCopy.level}</span><strong>{plan.level}</strong></div>
          <div><span>{modalCopy.pack}</span><strong>{plan.planName}</strong></div>
          <div><span>{modalCopy.exams}</span><strong>{selectedLabels.length ? selectedLabels.join(", ") : modalCopy.none}</strong></div>
          <div><span>{modalCopy.duration}</span><strong>{plan.accessLabel || `${plan.durationDays} jours`}</strong></div>
          <div><span>{modalCopy.quantity}</span><strong>{selectedCount || 0}</strong></div>
          <div><span>{modalCopy.price}</span><strong>{formatEuro(plan.priceEur)}</strong></div>
          <div><span>{modalCopy.total}</span><strong>{formatEuro(totalPrice)}</strong></div>
          <div>
            <span>{modalCopy.paymentCurrency}</span>
            <strong>
              {visibleQuote
                ? `${formatMobileAmount(visibleQuote.paymentAmount, visibleQuote.paymentCurrency)}${visibleQuote.estimated && quoteLoading ? modalCopy.estimated : ""}`
                : quoteLoading
                  ? modalCopy.calculating
                  : modalCopy.toConfirm}
            </strong>
          </div>
        </div>

        {step === "certifications" && !isEnterprise ? (
          <>
            <p className="pricing-modal-message compact">
              {modalCopy.chooseCerts}
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
            <p className="pricing-modal-message">{modalCopy.finalizeNext}</p>
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            <button className="pricing-modal-button" type="button" disabled={selectedCount < 1} onClick={onContinue}>
              {modalCopy.continue}
            </button>
          </>
        ) : null}

        {step === "certifications" && isEnterprise ? (
          <>
            <p className="pricing-modal-message compact">
              {modalCopy.enterpriseUnlock}
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
              {modalCopy.continue}
            </button>
          </>
        ) : null}

        {step === "method" ? (
          <>
            <p className="pricing-modal-message compact">{modalCopy.paymentMethod}</p>
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
                <span>{modalCopy.card}</span>
                <small>{modalCopy.cardSoon}</small>
              </button>
            </div>
            {paymentMethod === "mobile_money" ? (
              <button className="pricing-modal-button" type="button" onClick={onContinue}>{modalCopy.mobileContinue}</button>
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
                  {modalCopy.cardPaySoon}
                </button>
              </div>
            ) : null}
            <button className="pricing-modal-secondary" type="button" onClick={onBack}>{modalCopy.back}</button>
          </>
        ) : null}

        {step === "mobile" ? (
          <>
            <p className="pricing-modal-message compact">
              {modalCopy.mobileInstructions}
            </p>
            <label className="pricing-field">
              <span>{modalCopy.country}</span>
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
              <span>{modalCopy.phone}</span>
              <input
                value={mobilePhone}
                onChange={(event) => onSetMobilePhone(event.target.value)}
                placeholder={`${country.dialCode}6XXXXXXXX`}
                inputMode="tel"
              />
            </label>
            {mobilePhone && !clientPhoneLooksValid ? (
              <p className="pricing-modal-error">{modalCopy.invalidPhone}</p>
            ) : null}
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            <button
              className="pricing-modal-button"
              type="button"
              disabled={loading || quoteLoading || !mobilePhone || !mobileProvider}
              onClick={onPayMobileMoney}
            >
              <Smartphone size={18} />
              {loading ? modalCopy.paying : `${modalCopy.pay} ${visibleQuote ? formatMobileAmount(visibleQuote.paymentAmount, visibleQuote.paymentCurrency) : ""}`}
            </button>
            <button className="pricing-modal-secondary" type="button" disabled={loading} onClick={onBack}>{modalCopy.back}</button>
          </>
        ) : null}

        {step === "processing" ? (
          <>
            <div className="pricing-processing">
              <Smartphone className={`pricing-processingIcon ${verifying ? "verifying" : ""}`} size={34} />
              <h3>{processingTitle}</h3>
              <p>{processingMessage}</p>
              {displayedReference ? (
                <small>{modalCopy.reference} : {displayedReference}</small>
              ) : null}
            </div>
            {error ? <p className="pricing-modal-error">{error}</p> : null}
            {paymentSucceeded ? (
              <Link className="pricing-modal-button" to="/dashboard">{modalCopy.dashboard}</Link>
            ) : (
              <>
                <button className={`pricing-modal-button ${verifying ? "verifying" : ""}`} type="button" disabled={verifying || verifyCooldown > 0} onClick={onVerifyPayment}>
                  {verifying ? <span className="pricing-button-spinner" aria-hidden="true" /> : null}
                  {verificationButtonLabel}
                </button>
                <p className="pricing-verify-hint">
                  {verifyCooldown > 0
                    ? modalCopy.verifyHintWait
                    : modalCopy.verifyHint}
                </p>
                {paymentNotConfirmed ? (
                  <div className="pricing-verification-alert" role="status" aria-live="polite">
                    <strong>{modalCopy.notConfirmed}</strong>
                    <p>{modalCopy.notReceived}</p>
                    <p>
                      {modalCopy.contactSupportText}
                    </p>
                    <a className="pricing-modal-secondary" href={supportUrl} target="_blank" rel="noreferrer">
                      {modalCopy.contactSupport}
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
  const { language, setLanguage } = useLanguage();
  const copy = offersCopy[language] || offersCopy.fr;
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
  const paymentNotice = copy.notices[paymentStatus] || "";

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
        if (!cancelled) setCheckoutError(copy.modal.quoteError);
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
        setCheckoutError(copy.modal.selectCertError);
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
          copy.modal.sessionError
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
      message: modalCopy.verifying,
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
            copy.modal.missingReference,
        }));
        setVerifyCooldown(8);
        return;
      }
      const result = await getCheckoutSessionStatus(reference);
      await wait(1400 - (Date.now() - startedAt));
      setCheckoutPaymentStatus({ ...result, checked: true });
      if (result.status === "succeeded") {
        if (result.user && result.accessToken) {
          const session = getAuthSession();
          storeAuthSession(
            { user: result.user, token: result.accessToken, expiresIn: result.expiresIn || session?.expiresIn || "15m" },
            Boolean(session?.remember)
          );
        } else if (result.user) {
          updateStoredUser(result.user);
        }
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
          copy.modal.pendingPayment,
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
          Deutschpruefungen
        </Link>
        <Link className="pricing-home-link" to={user?.id ? "/dashboard" : "/"}>
          {user?.id ? "Dashboard" : copy.home}
        </Link>
        <select
          className="pricing-home-link"
          value={language}
          onChange={(event) => setLanguage(event.target.value)}
          aria-label="Language"
        >
          {languageOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.label}</option>
          ))}
        </select>
      </header>

      <main className="official-pricing-shell">
        <section className="pricing-heading">
          <p className="pricing-kicker">{copy.kicker}</p>
          <h1>{copy.title}</h1>
          <p>{copy.subtitle}</p>
        </section>

        {paymentNotice ? (
          <div className={`pricing-payment-notice ${paymentStatus === "failed" || paymentStatus === "verification_error" ? "warning" : ""}`}>
            {paymentNotice}
          </div>
        ) : null}

        {pricingSections.map((section) => (
          <section className="pricing-level-section" key={section.level} aria-labelledby={`pricing-${section.level}`}>
            <div className="pricing-level-header">
              <h2 id={`pricing-${section.level}`}>{copy.level} {section.level}</h2>
              <div className="pricing-cert-tabs" aria-label={`Certifications ${section.level}`}>
                {certificationOptions.map((option) => (
                  <span className={`pricing-cert-tab pricing-cert-tab-${option.key}`} key={option.key}>
                    {option.label}
                  </span>
                ))}
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
                            <strong>{copy.features?.[feature.key]?.[0] || feature.title}</strong>
                            <span>{copy.features?.[feature.key]?.[1] || feature.detail}</span>
                          </div>
                        ))}
                      </div>
                      <p className="pricing-version">{copy.version} <strong>2026</strong></p>
                      <p className="pricing-attempts">
                        {copy.oralSimulator} : <strong>{plan.speakingSimulatorQuota ?? 20} {copy.attempts}</strong>
                      </p>
                      <p className="pricing-access">{copy.access} : {plan.durationDays} {copy.days}</p>
                      <button
                        className="pricing-subscribe-button"
                        type="button"
                        onClick={() => openPlanSelector(plan)}
                        disabled={loadingPlanId === plan.id}
                      >
                        <CheckCircle2 size={15} />
                        {loadingPlanId === plan.id ? copy.preparing : copy.subscribe}
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
            <p className="pricing-kicker">{copy.enterpriseKicker}</p>
            <h2 id="enterprise-pricing-title">{copy.enterpriseTitle}</h2>
            <p>{copy.enterpriseSubtitle}</p>
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
                    <div><dt>{copy.access}</dt><dd>{offer.accessLabel}</dd></div>
                    <div><dt>{copy.billing}</dt><dd>{offer.billedLabel}</dd></div>
                    <div><dt>{copy.oralSimulations}</dt><dd>{offer.speakingSimulatorQuota}</dd></div>
                    <div><dt>{copy.modules}</dt><dd>B1 + B2 - Goethe, OSD, TELC, ECL</dd></div>
                  </dl>
                  <button className="enterprise-button" type="button" onClick={() => openEnterpriseCheckout(offer)}>
                    <CreditCard size={17} />
                    {copy.subscribe}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <p className="pricing-footer-note">
          {copy.footer}
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
        copy={copy}
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



