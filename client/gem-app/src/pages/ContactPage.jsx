import React from "react";
import styles from "./ContactPage.module.css";
import { useLanguage } from "../context/LanguageContext";

const WHATSAPP_URL = "https://wa.me/237000000000";
const SUPPORT_EMAIL = "appgerman989@gmail.com";

export default function ContactPage() {
  const { language, t } = useLanguage();
  const subtitle =
    language === "de"
      ? "Kontaktieren Sie uns direkt über WhatsApp oder per E-Mail."
      : language === "en"
      ? "Reach us directly on WhatsApp or by email."
      : "Parlez-nous directement sur WhatsApp ou envoyez-nous un email.";

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1>{t.common.contact}</h1>
        <p>{subtitle}</p>

        <div className={styles.cards}>
          <a className={styles.card} href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            <h3>WhatsApp</h3>
            <p>Ouvrir la conversation</p>
          </a>
          <a className={styles.card} href={`mailto:${SUPPORT_EMAIL}?subject=Demande%20German%20Exam%20App`}>
            <h3>Email</h3>
            <p>{SUPPORT_EMAIL}</p>
          </a>
        </div>
      </div>
    </div>
  );
}
