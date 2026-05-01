import React from "react";
import styles from "./ProgressPage.module.css";
import { useLanguage } from "../context/LanguageContext";

const progressData = [
  { label: "Compréhension Écrite", value: 72 },
  { label: "Compréhension Orale", value: 64 },
  { label: "Expression Écrite", value: 58 },
  { label: "Expression Orale", value: 70 },
];

export default function ProgressPage() {
  const { language } = useLanguage();
  const heading = language === "de" ? "Mein Fortschritt" : language === "en" ? "My progress" : "Mon progrès";
  const subtitle =
    language === "de"
      ? "Verfolgen Sie Ihre Entwicklung nach Kompetenz."
      : language === "en"
      ? "Track your evolution by skill."
      : "Suivez votre évolution par compétence.";

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <h1>{heading}</h1>
        <p>{subtitle}</p>

        <div className={styles.list}>
          {progressData.map((item) => (
            <article key={item.label} className={styles.card}>
              <div className={styles.header}>
                <h3>{item.label}</h3>
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
