import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpenCheck } from "lucide-react";
import styles from "./SimulationSelectionPage.module.css";

import logo from "../assets/images/logo.png";
import userIcon from "../assets/images/icon-profile.png";

import BackButton from "../components/BackButton";
import { languageOptions } from "../utils/language";
import { useLanguage } from "../context/LanguageContext";
import { clearAuthSession, isLoggedIn } from "../utils/access";
import { useSimulationLanguage } from "../utils/simulationLanguage";
import { examSimulations } from "../data/siteContent";
import API from "../services/api";
import { clearDashboardCache } from "../services/dashboard";

const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9"></polyline>
  </svg>
);

const ClockIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="10"></circle>
    <polyline points="12 6 12 12 16 14"></polyline>
  </svg>
);

const ClipboardIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
    <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
    <line x1="8" y1="10" x2="16" y2="10"></line>
    <line x1="8" y1="14" x2="16" y2="14"></line>
    <line x1="8" y1="18" x2="12" y2="18"></line>
  </svg>
);

export const OpenBookIcon = () => (
  <BookOpenCheck size={52} strokeWidth={1.8} />
);

export const SimulationTopNav = ({ onGoHome, onGoAbout, onGoProfile, onGoDashboard, onGoActualites, onGoContact, onGoModule, onLogout }) => {
  const [openLang, setOpenLang] = useState(false);
  const [openFormation, setOpenFormation] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const selectedLanguage = languageOptions.find((opt) => opt.id === language) ?? languageOptions[0];
  const loggedIn = isLoggedIn();

  return (
    <nav className={styles.topNav}>
    <div className={styles.navContainer}>
      <div className={styles.navLeft}>
        <img
          src={logo}
          alt="Deutsch Prüfungen Logo"
          className={styles.logo}
          onClick={loggedIn ? onGoDashboard : onGoHome}
          style={{ cursor: "pointer" }}
        />
      </div>

      <div className={styles.navCenter}>
        {!loggedIn ? (
          <button type="button" className={styles.navLink} onClick={onGoHome}>
            {t.common.home}
          </button>
        ) : null}
        {loggedIn ? (
          <button type="button" className={styles.navLink} onClick={onGoDashboard}>
            {t.common.dashboard}
          </button>
        ) : null}
        <button type="button" className={styles.navLink} onClick={onGoActualites}>
          {t.common.news} <ChevronIcon />
        </button>
        <button type="button" className={styles.navLink} onClick={onGoAbout}>
          {t.common.about} <ChevronIcon />
        </button>
        <div className={styles.dropdown}>
          <button type="button" className={styles.navLink} onClick={() => setOpenFormation((v) => !v)}>
            {t.common.training} <ChevronIcon />
          </button>
          {openFormation ? (
            <div className={styles.dropdownMenu}>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("read")}>
                {t.modules.read}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("listen")}>
                {t.modules.listen}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("write")}>
                {t.modules.write}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("speak")}>
                {t.modules.speak}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("sprach")}>
                {t.modules.sprach}
              </button>
            </div>
          ) : null}
        </div>
        <button type="button" className={styles.navLink} onClick={() => onGoModule("lessons")}>
          {t.common.pages} <ChevronIcon />
        </button>
        <button type="button" className={styles.navLink} onClick={onGoContact}>
          {t.common.contact}
        </button>
      </div>

      <div className={styles.navRight}>
        <div className={styles.dropdown}>
          <button className={styles.langButton} aria-label="Sprache wechseln" type="button" onClick={() => setOpenLang((v) => !v)}>
            {selectedLanguage.flag ? <img src={selectedLanguage.flag} alt={selectedLanguage.label} className={styles.flagIcon} /> : <span className={styles.flagFallback}>🌐</span>}
              <span>{language.toUpperCase()}</span>
            <ChevronIcon />
          </button>
          {openLang ? (
            <div className={styles.dropdownMenu}>
              {languageOptions.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  className={styles.dropdownItem}
                  onClick={() => {
                    setLanguage(opt.id);
                    setOpenLang(false);
                  }}
                >
                  <img src={opt.flag} alt="" className={styles.flagIcon} />
                  {opt.label}
                </button>
              ))}
            </div>
          ) : null}
        </div>
        {loggedIn ? (
          <button className={styles.profileButton} aria-label="Benutzerprofil" type="button" onClick={onGoProfile}>
            <div className={styles.userAvatar}>
              <img src={userIcon} alt="" />
            </div>
          </button>
        ) : null}
        {loggedIn && onLogout ? (
          <button className={styles.navLogoutButton} type="button" onClick={onLogout}>
            {t.common.logout}
          </button>
        ) : null}
      </div>
    </div>
  </nav>
  );
};

export const SimulationDisciplineCard = ({
  iconPath,
  iconNode,
  title,
  time,
  questions,
  minuteLabel,
  questionLabel,
  accent = "#d32f2f",
  badge,
  unavailable = false,
  onClick,
}) => (
  <button
    type="button"
    className={`${styles.card} ${unavailable ? styles.cardUnavailable : ""}`}
    style={{ "--card-accent": accent }}
    onClick={onClick}
    aria-disabled={unavailable ? "true" : undefined}
  >
    {badge ? <span className={styles.cardBadge}>{badge}</span> : null}
    <div className={styles.cardIconWrapper}>
      {iconNode ? iconNode : <img src={iconPath} alt={`Symbol ${title}`} className={styles.cardIcon} />}
    </div>
    <h3 className={styles.cardTitle}>{title}</h3>
    <div className={styles.cardStats}>
      <div className={styles.statItem}>
        <ClockIcon />
        <span>{time} {minuteLabel}</span>
      </div>
      <div className={styles.statItem}>
        <ClipboardIcon />
        <span>{questions} {questionLabel}</span>
      </div>
    </div>
  </button>
);

export const StartConfirmationModal = ({
  examName,
  moduleTitle,
  examType,
  moduleType,
  questionCount,
  durationMinutes,
  itemLabel = "Fragen",
  cancelLabel = "Abbrechen",
  startLabel = "Beginnen",
  busy = false,
  onCancel,
  onStart,
}) => {
  const safeModuleType = moduleType || moduleTitle || "dieses Modul";
  const safeExamType = examType || examName || "diese Pruefung";
  const safeQuestionCount = Math.max(0, Math.round(Number(questionCount) || 0));
  const safeDuration = Math.max(0, Math.round(Number(durationMinutes) || 0));
  const safeItemLabel = itemLabel || "Fragen";

  const handleCancel = () => {
    if (!busy) onCancel?.();
  };

  const handleStart = () => {
    if (!busy) onStart?.();
  };

  if (safeQuestionCount >= 0) {
    return (
      <div className={styles.modalOverlay} role="presentation">
        <section
          className={styles.confirmModal}
          role="dialog"
          aria-modal="true"
          aria-labelledby="start-confirm-title"
          aria-describedby="start-confirm-description"
          aria-busy={busy ? "true" : "false"}
        >
          <h2 id="start-confirm-title">Testbeginn</h2>
          <p id="start-confirm-description" className={styles.modalBody}>
            Sie beginnen gleich einen Test im Modul {safeModuleType} fuer die Pruefung {safeExamType}. Er enthaelt {safeQuestionCount} {safeItemLabel} und dauert genau {safeDuration} Minuten.
          </p>
          <p className={styles.modalBody}>
            Lesen Sie die {safeItemLabel} und Anweisungen sorgfaeltig, bevor Sie antworten.
          </p>
          <p className={styles.modalConfirmation}>SIND SIE BEREIT ZU BEGINNEN?</p>
          <div className={styles.modalActions}>
            <button type="button" className={styles.modalCancelButton} onClick={handleCancel} disabled={busy}>
              {cancelLabel}
            </button>
            <button type="button" className={styles.modalStartButton} onClick={handleStart} disabled={busy}>
              {startLabel}
            </button>
          </div>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.modalOverlay} role="presentation">
      <section
        className={styles.confirmModal}
        role="dialog"
        aria-modal="true"
        aria-labelledby="start-confirm-title"
        aria-describedby="start-confirm-description"
        aria-busy={busy ? "true" : "false"}
      >
        <h2 id="start-confirm-title">Début du test</h2>
        <p id="start-confirm-description" className={styles.modalBody}>
          Vous êtes sur le point de débuter un test de {safeModuleType} type examen {safeExamType}. Il comporte {safeQuestionCount} questions et dure {safeDuration} minutes exactement.
        </p>
        <p className={styles.modalBody}>
          Prenez la peine de bien lire les questions et les consignes avant de répondre.
        </p>
        <p className={styles.modalConfirmation}>ETES-VOUS PRÊT À COMMENCER ?</p>
        <div className={styles.modalActions}>
          <button type="button" className={styles.modalCancelButton} onClick={handleCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button type="button" className={styles.modalStartButton} onClick={handleStart} disabled={busy}>
            {startLabel}
          </button>
        </div>
      </section>
    </div>
  );
};

export default function SimulationSelectionPage() {
  const navigate = useNavigate();
  useSimulationLanguage();
  const logout = async () => {
    try {
      await API.post("/api/auth/logout");
    } catch {
      // Local logout remains reliable when the server token is stale.
    }
    clearAuthSession();
    clearDashboardCache();
    navigate("/", { replace: true });
  };

  return (
    <div className={styles.pageContainer}>
      <SimulationTopNav
        onGoHome={() => navigate("/")}
        onGoAbout={() => navigate("/about")}
        onGoProfile={() => navigate("/profile")}
        onGoDashboard={() => navigate("/dashboard")}
        onGoActualites={() => navigate("/actualites")}
        onGoContact={() => navigate("/contact")}
        onGoModule={(moduleId) => moduleId === "lessons" ? navigate("/lessons") : navigate(`/simulation/${moduleId}`)}
        onLogout={logout}
      />

      <main className={styles.mainContent}>
        <BackButton fallback="/dashboard" />
        <header className={styles.headerSection}>
          <h1 className={styles.title}>Waehlen Sie Ihren Test</h1>
          <p className={styles.subtitle}>
            Waehlen Sie Goethe B1/B2, ÖSD B1/B2, TELC B1/B2 oder ECL B1/B2. Kostenlose Serien bleiben offen,
            Premium-Serien sind ohne Vollzugriff gesperrt.
          </p>
          <p className={styles.subtitle} hidden>
            Sélectionnez Goethe, TestDaF, DSH ou telc. Les séries gratuites restent ouvertes,
            les séries premium sont verrouillées sans accès complet.
          </p>
        </header>

        <section className={styles.gridSection}>
          <div className={styles.cardGrid}>
            {examSimulations.map((exam) => (
              <SimulationDisciplineCard
                key={exam.id}
                iconNode={<OpenBookIcon />}
                title={exam.name}
                time={20}
                questions={exam.id.includes("telc") ? 5 : 4}
                accent={exam.accent}
                badge="Verfuegbar"
                minuteLabel="Serien"
                questionLabel="Module"
                onClick={() => navigate(exam.path)}
              />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
