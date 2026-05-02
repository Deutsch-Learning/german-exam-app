import styles from "./ProgressPage.module.css";
import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";

const progressValues = [
  { key: "read", value: 72 },
  { key: "listen", value: 64 },
  { key: "write", value: 58 },
  { key: "speak", value: 70 },
];

export default function ProgressPage() {
  const { t } = useLanguage();

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <BackButton fallback="/dashboard" />
        <h1>{t.progressPage.title}</h1>
        <p>{t.progressPage.subtitle}</p>

        <div className={styles.list}>
          {progressValues.map((item) => (
            <article key={item.key} className={styles.card}>
              <div className={styles.header}>
                <h3>{t.modules[item.key]}</h3>
                <span>{item.value}%</span>
              </div>
              <div className={styles.barWrap}>
                <div className={styles.barFill} style={{ width: `${item.value}%` }} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}
