import React from "react";
import { useLanguage } from "../context/LanguageContext";

const news = [
  {
    title: "Nouveaux sujets B2 ajoutés",
    date: "Mai 2026",
    text: "10 nouvelles simulations orientées grammaire et compréhension orale sont disponibles.",
  },
  {
    title: "Atelier live : réussir l'expression écrite",
    date: "Avril 2026",
    text: "Webinaire hebdomadaire avec correction de copies et méthodologie d'examen.",
  },
  {
    title: "Mise à jour des recommandations IA",
    date: "Mars 2026",
    text: "Les feedbacks sont désormais plus détaillés avec priorisation des lacunes.",
  },
];

export default function ActualitesPage() {
  const { language, t } = useLanguage();
  const heading = language === "de" ? "Nachrichten" : language === "en" ? "News" : "Actualités";
  const subtitle =
    language === "de"
      ? "Hier finden Sie aktuelle Neuigkeiten, Lernressourcen und Plattform-Updates."
      : language === "en"
      ? "Find the latest updates, resources, and exam preparation announcements."
      : "Retrouvez ici les dernières nouvelles, ressources et mises à jour de préparation à l'examen.";

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24, fontFamily: "Inter, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto" }}>
        <h1 style={{ marginTop: 0 }}>{heading}</h1>
        <p style={{ color: "#6b7280", marginBottom: 20 }}>
          {subtitle}
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          {news.map((item) => (
            <article
              key={item.title}
              style={{
                background: "#fff",
                border: "1px solid #e5e7eb",
                borderRadius: 14,
                padding: 18,
                boxShadow: "0 5px 16px rgba(0,0,0,0.05)",
              }}
            >
              <p style={{ margin: 0, color: "#d32f2f", fontWeight: 700, fontSize: 13 }}>{item.date}</p>
              <h3 style={{ margin: "6px 0 8px" }}>{item.title}</h3>
              <p style={{ margin: 0, color: "#4b5563" }}>{item.text}</p>
            </article>
          ))}
        </div>
      </div>
    </div>
  );
}

