import styles from "./ContactPage.module.css";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";

const WHATSAPP_URL = "https://wa.me/237000000000";
const SUPPORT_EMAIL = "appgerman989@gmail.com";

export default function ContactPage() {
  const { t } = useLanguage();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <BackButton fallback="/dashboard" />
        <h1>{t.common.contact}</h1>
        <p>{t.contactPage.subtitle}</p>

        <div className={styles.cards}>
          <a className={styles.card} href={WHATSAPP_URL} target="_blank" rel="noreferrer">
            <h3>WhatsApp</h3>
            <p>{t.contactPage.whatsapp}</p>
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
