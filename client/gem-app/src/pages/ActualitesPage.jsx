import BackButton from "../components/BackButton";
import { useLanguage } from "../context/LanguageContext";

export default function ActualitesPage() {
  const { t } = useLanguage();

  return (
    <div style={{ minHeight: "100vh", background: "#f8fafc", padding: 24, fontFamily: "Inter, sans-serif" }}>
      <div style={{ maxWidth: 980, margin: "0 auto", display: "grid", gap: 18 }}>
        <BackButton fallback="/dashboard" />
        <div>
          <h1 style={{ marginTop: 0 }}>{t.newsPage.title}</h1>
          <p style={{ color: "#6b7280", marginBottom: 20 }}>{t.newsPage.subtitle}</p>
        </div>
        <div style={{ display: "grid", gap: 14 }}>
          {t.newsPage.items.map((item) => (
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
