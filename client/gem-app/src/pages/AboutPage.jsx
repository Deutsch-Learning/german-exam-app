import { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./AboutPage.module.css";
import logo from "../assets/images/logo.png";
import userIcon from "../assets/images/icon-profile.png";
import calendarIcon from "../assets/images/calendar.png";
import brainIcon from "../assets/images/brain.png";
import graphIcon from "../assets/images/graph.png";
import handshakeIcon from "../assets/images/handshake.jpg";
import certificateIcon from "../assets/images/certificate.png";
import BackButton from "../components/BackButton";
import { languageOptions } from "../utils/language";
import { useLanguage } from "../context/LanguageContext";

const ChevronDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="6 9 12 15 18 9" />
  </svg>
);

const Navbar = () => {
  const navigate = useNavigate();
  const { language, setLanguage, t } = useLanguage();
  const [openLang, setOpenLang] = useState(false);
  const [openFormation, setOpenFormation] = useState(false);
  const selected = languageOptions.find((option) => option.id === language) ?? languageOptions[0];

  const modules = [
    { id: "listen", label: t.modules.listen },
    { id: "read", label: t.modules.read },
    { id: "speak", label: t.modules.speak },
    { id: "write", label: t.modules.write },
  ];

  return (
    <nav className={styles.topNav}>
      <div className={styles.navContainer}>
        <div className={styles.navLeft}>
          <button type="button" className={styles.logoButton} onClick={() => navigate("/")}>
            <img src={logo} alt="Deutsch Lernen Logo" className={styles.logo} />
          </button>
        </div>

        <div className={styles.navCenter}>
          <button type="button" className={styles.navLink} onClick={() => navigate("/dashboard")}>{t.common.home}</button>
          <button type="button" className={styles.navLink} onClick={() => navigate("/actualites")}>{t.common.news} <ChevronDownIcon /></button>
          <button type="button" className={`${styles.navLink} ${styles.active}`} onClick={() => navigate("/about")}>{t.common.about} <ChevronDownIcon /></button>
          <div className={styles.dropdown}>
            <button type="button" className={styles.navLink} onClick={() => setOpenFormation((value) => !value)}>
              {t.common.training} <ChevronDownIcon />
            </button>
            {openFormation ? (
              <div className={styles.dropdownMenu}>
                {modules.map((module) => (
                  <button key={module.id} type="button" onClick={() => navigate(`/simulation/${module.id}`)}>
                    {module.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" className={styles.navLink} onClick={() => navigate("/lessons")}>{t.common.pages} <ChevronDownIcon /></button>
          <button type="button" className={styles.navLink} onClick={() => navigate("/contact")}>{t.common.contact}</button>
        </div>

        <div className={styles.navRight}>
          <div className={styles.langWrap}>
            <button className={styles.langButton} aria-label="Changer de langue" type="button" onClick={() => setOpenLang((value) => !value)}>
              <img src={selected.flag} alt={selected.label} className={styles.flagIcon} />
              <span>{selected.id.toUpperCase()}</span>
              <ChevronDownIcon />
            </button>
            {openLang ? (
              <div className={styles.langMenu}>
                {languageOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => { setLanguage(option.id); setOpenLang(false); }}>
                    <img src={option.flag} alt="" />
                    {option.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button className={styles.profileButton} aria-label={t.common.profile} type="button" onClick={() => navigate("/profile")}>
            <div className={styles.userAvatar}>
              <img src={userIcon} alt="" />
            </div>
          </button>
        </div>
      </div>
    </nav>
  );
};

const PillarCard = ({ iconPath, title }) => (
  <div className={styles.pillarCard}>
    <img src={iconPath} alt="" className={styles.pillarIcon} />
    <span className={styles.pillarTitle}>{title}</span>
  </div>
);

const ValueCard = ({ title }) => (
  <div className={styles.valueCard}>
    <span className={styles.valueTitle}>{title}</span>
  </div>
);

export default function AboutPage() {
  const { t } = useLanguage();
  const pillars = [
    { iconPath: calendarIcon, title: t.about.pillars[0] },
    { iconPath: brainIcon, title: t.about.pillars[1] },
    { iconPath: graphIcon, title: t.about.pillars[2] },
  ];

  return (
    <div className={styles.pageContainer}>
      <Navbar />

      <main className={styles.mainContent}>
        <BackButton fallback="/dashboard" />
        <header className={styles.headerSection}>
          <h1 className={styles.pageTitle}>{t.about.title}</h1>
          <h2 className={styles.pageSubtitle}>{t.about.subtitle}</h2>
        </header>

        <section className={styles.twoColumnSection}>
          <div className={styles.missionWrapper}>
            <div className={styles.missionCard}>
              <div className={styles.missionIcons}>
                <img src={handshakeIcon} alt="Partenariat" className={`${styles.missionIcon} ${styles.handshakeIcon}`} />
                <img src={certificateIcon} alt="Certification" className={styles.missionIcon} />
              </div>
              <div className={styles.missionText}>
                <p>{t.about.mission1}</p>
                <p>{t.about.mission2}</p>
              </div>
            </div>
          </div>

          <div className={styles.pillarsWrapper}>
            <h3 className={styles.sectionTitle}>{t.about.pillarsTitle}</h3>
            <div className={styles.pillarsList}>
              {pillars.map((pillar) => (
                <PillarCard key={pillar.title} iconPath={pillar.iconPath} title={pillar.title} />
              ))}
            </div>
          </div>
        </section>

        <section className={styles.valuesSection}>
          <h3 className={styles.sectionTitle}>{t.about.valuesTitle}</h3>
          <div className={styles.valuesGrid}>
            {t.about.values.map((value) => (
              <ValueCard key={value} title={value} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
