import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./SimulationSelectionPage.module.css";

import logo from "../assets/images/logo.png";
import userIcon from "../assets/images/icon-profile.png";

import iconListen from "../assets/images/icon-audio.png";
import iconWrite from "../assets/images/icon-write.png";
import iconSpeak from "../assets/images/icon-speak.png";
import BackButton from "../components/BackButton";
import { languageOptions } from "../utils/language";
import { useLanguage } from "../context/LanguageContext";
import { isLoggedIn } from "../utils/access";

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
  <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#d32f2f" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6.5A2.5 2.5 0 0 1 5.5 4H11v15H5.5A2.5 2.5 0 0 0 3 21.5z" />
    <path d="M21 6.5A2.5 2.5 0 0 0 18.5 4H13v15h5.5a2.5 2.5 0 0 1 2.5 2.5z" />
    <path d="M11 7c-1.2-0.5-2.5-0.8-4-0.8" />
    <path d="M13 7c1.2-0.5 2.5-0.8 4-0.8" />
  </svg>
);

export const SimulationTopNav = ({ onGoAbout, onGoProfile, onGoDashboard, onGoActualites, onGoContact, onGoModule }) => {
  const [openLang, setOpenLang] = useState(false);
  const [openFormation, setOpenFormation] = useState(false);
  const { language, setLanguage, t } = useLanguage();
  const selectedLanguage = languageOptions.find((opt) => opt.id === language) ?? languageOptions[0];
  const loggedIn = isLoggedIn();

  return (
    <nav className={styles.topNav}>
    <div className={styles.navContainer}>
      <div className={styles.navLeft}>
        <img src={logo} alt="Deutsch Lernen Logo" className={styles.logo} onClick={loggedIn ? onGoDashboard : () => window.location.assign("/")} style={{ cursor: "pointer" }} />
      </div>

      <div className={styles.navCenter}>
        {loggedIn ? (
          <button type="button" className={styles.navLink} onClick={onGoDashboard}>
            {t.common.home}
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
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("listen")}>
                {t.modules.listen}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("read")}>
                {t.modules.read}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("speak")}>
                {t.modules.speak}
              </button>
              <button type="button" className={styles.dropdownItem} onClick={() => onGoModule("write")}>
                {t.modules.write}
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
          <button className={styles.langButton} aria-label="Changer de langue" type="button" onClick={() => setOpenLang((v) => !v)}>
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
          <button className={styles.profileButton} aria-label="Profil utilisateur" type="button" onClick={onGoProfile}>
            <div className={styles.userAvatar}>
              <img src={userIcon} alt="" />
            </div>
          </button>
        ) : null}
      </div>
    </div>
  </nav>
  );
};

export const SimulationDisciplineCard = ({ iconPath, iconNode, title, time, questions, minuteLabel, questionLabel, onClick }) => (
  <button type="button" className={styles.card} onClick={onClick}>
    <div className={styles.cardIconWrapper}>
      {iconNode ? iconNode : <img src={iconPath} alt={`Icone ${title}`} className={styles.cardIcon} />}
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

export const StartConfirmationModal = ({ examName, moduleTitle, onCancel, onStart }) => (
  <div className={styles.modalOverlay} role="presentation" onMouseDown={onCancel}>
    <section
      className={styles.confirmModal}
      role="dialog"
      aria-modal="true"
      aria-labelledby="start-confirm-title"
      onMouseDown={(event) => event.stopPropagation()}
    >
      <p className={styles.modalEyebrow}>Simulation</p>
      <h2 id="start-confirm-title">You are about to start the {examName} test</h2>
      <p>
        {moduleTitle ? `${moduleTitle} will begin now. ` : ""}
        Are you ready to start?
      </p>
      <div className={styles.modalActions}>
        <button type="button" className={styles.modalCancelButton} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className={styles.modalStartButton} onClick={onStart}>
          Start
        </button>
      </div>
    </section>
  </div>
);

export default function SimulationSelectionPage() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const [pendingDiscipline, setPendingDiscipline] = useState(null);

  const disciplines = [
    { id: "read", iconNode: <OpenBookIcon />, title: t.modules.read, time: 60, questions: 39 },
    { id: "listen", iconPath: iconListen, title: t.modules.listen, time: 60, questions: 39 },
    { id: "write", iconPath: iconWrite, title: t.modules.write, time: 60, questions: 39 },
    { id: "speak", iconPath: iconSpeak, title: t.modules.speak, time: 60, questions: 39 },
  ];

  return (
    <div className={styles.pageContainer}>
      <SimulationTopNav
        onGoAbout={() => navigate("/about")}
        onGoProfile={() => navigate("/profile")}
        onGoDashboard={() => navigate("/dashboard")}
        onGoActualites={() => navigate("/actualites")}
        onGoContact={() => navigate("/contact")}
        onGoModule={(moduleId) => moduleId === "lessons" ? navigate("/lessons") : navigate(`/simulation/${moduleId}`)}
      />

      <main className={styles.mainContent}>
        <BackButton fallback="/dashboard" />
        <header className={styles.headerSection}>
          <h1 className={styles.title}>{t.simulations.title}</h1>
          <p className={styles.subtitle}>{t.simulations.subtitle}</p>
        </header>

        <section className={styles.gridSection}>
          <div className={styles.cardGrid}>
            {disciplines.map((discipline) => (
              <SimulationDisciplineCard
                key={discipline.id}
                iconPath={discipline.iconPath}
                iconNode={discipline.iconNode}
                title={discipline.title}
                time={discipline.time}
                questions={discipline.questions}
                minuteLabel={t.simulations.minutes}
                questionLabel={t.simulations.questions}
                onClick={() => setPendingDiscipline(discipline)}
              />
            ))}
          </div>
        </section>
      </main>
      {pendingDiscipline ? (
        <StartConfirmationModal
          examName="Goethe-Zertifikat B2"
          moduleTitle={pendingDiscipline.title}
          onCancel={() => setPendingDiscipline(null)}
          onStart={() => navigate(`/simulation/${pendingDiscipline.id}`)}
        />
      ) : null}
    </div>
  );
}
