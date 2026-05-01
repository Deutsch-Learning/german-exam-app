import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import styles from "./AboutPage.module.css";
import logo from "../assets/images/logo.png";
import userIcon from "../assets/images/icon-profile.png";
import iconAudio from "../assets/images/icon-audio.png";
import iconWrite from "../assets/images/icon-write.png";
import iconSpeak from "../assets/images/icon-speak.png";
import iconProfile from "../assets/images/icon-profile.png";
import trophy from "../assets/images/trophy.png";
import { useLanguage } from "../context/LanguageContext";
import { languageOptions } from "../utils/language";

const PillarCard = ({ icon, title }) => (
  <div className={styles.pillarCard}>
    <div className={styles.pillarIcon}>
      <img src={icon} alt="" />
    </div>
    <h3>{title}</h3>
  </div>
);

const ValueCard = ({ text }) => (
  <div className={styles.valueCard}>
    <span>{text}</span>
  </div>
);

const AboutPage = () => {
  const navigate = useNavigate();
  const { language, setLanguage } = useLanguage();
  const [openLang, setOpenLang] = useState(false);
  const selectedLanguage = languageOptions.find((o) => o.id === language) ?? languageOptions[0];

  const pillars = [
    { icon: iconAudio, title: "SIMULATIONS REELLES" },
    { icon: iconWrite, title: "CORRECTION PAR IA" },
    { icon: iconSpeak, title: "SUIVI DE PROGRES" },
  ];

  const values = ["EXCELLENCE ACADEMIQUE", "ACCESSIBILITE", "INNOVATION TECHNOLOGIQUE"];

  return (
    <div className={styles.pageWrapper}>
      <nav className={styles.navbar}>
        <div className={styles.navContainer}>
          <img src={logo} alt="Logo" className={styles.logo} />

          <ul className={styles.navLinks}>
            <li><button type="button" onClick={() => navigate("/")}>Accueil</button></li>
            <li>Actualités <span>▾</span></li>
            <li className={styles.active}>A propos <span>▾</span></li>
            <li>Formations <span>▾</span></li>
            <li>Pages <span>▾</span></li>
            <li><button type="button" onClick={() => navigate("/contact")}>Contact</button></li>
          </ul>

          <div className={styles.navRight}>
            <div className={styles.dropdownWrap}>
              <button className={styles.langSelector} type="button" onClick={() => setOpenLang((v) => !v)}>
                {selectedLanguage.flag ? <img src={selectedLanguage.flag} alt={selectedLanguage.label} /> : <span>🌐</span>}
                <span>{selectedLanguage.id.toUpperCase()}</span>
                <span>▾</span>
              </button>
              {openLang ? (
                <div className={styles.langMenu}>
                  {languageOptions.map((lang) => (
                    <button key={lang.id} type="button" onClick={() => { setLanguage(lang.id); setOpenLang(false); }}>
                      {lang.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <div className={styles.userProfile}>
              <img src={userIcon} alt="User" />
            </div>
          </div>
        </div>
      </nav>

      <main className={styles.container}>
        <header className={styles.header}>
          <h1>A propos de nous</h1>
          <p className={styles.subtitle}>Notre Mission : Votre Réussite</p>
        </header>

        <section className={styles.missionSection}>
          <div className={styles.missionGrid}>
            <article className={styles.missionCard}>
              <div className={styles.missionIcons}>
                <img src={iconProfile} alt="Partnership" />
                <img src={trophy} alt="Certification" />
              </div>
              <div className={styles.missionText}>
                <p>
                  Nous avons créé le <strong>Deutsch Prüfung</strong> pour rendre les
                  certification allemandes, moins stressantes et plus efficaces.
                </p>
                <p>
                  Notre simulation en conditions réelles, couplée à la
                  correction par IA vous guide pas à pas vers votre diplôme.
                </p>
              </div>
            </article>

            <aside className={styles.pillarsWrapper}>
              <h2 className={styles.sectionTitle}>Les trois piliers de notre solution</h2>
              <div className={styles.pillarList}>
                {pillars.map((pillar, idx) => (
                  <PillarCard key={idx} {...pillar} />
                ))}
              </div>
            </aside>
          </div>
        </section>

        <section className={styles.valuesSection}>
          <h2 className={styles.sectionTitle}>Nos Valeurs</h2>
          <div className={styles.valuesGrid}>
            {values.map((val, idx) => (
              <ValueCard key={idx} text={val} />
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default AboutPage;

