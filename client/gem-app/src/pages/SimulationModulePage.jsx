import React, { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import API from "../services/api";
import { useLanguage } from "../context/LanguageContext";

const MODULE_META = {
  listen: { title: "Compréhension Orale" },
  read: { title: "Compréhension Ecrite" },
  write: { title: "Expression Ecrite" },
  speak: { title: "Expression Orale" },
};

export default function SimulationModulePage() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const { moduleId } = useParams();
  const [status, setStatus] = useState("");
  const [saving, setSaving] = useState(false);

  const auth = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("auth") ?? "null");
    } catch {
      return null;
    }
  }, []);

  const meta = MODULE_META[moduleId] ?? { title: "Simulation" };

  const finishAndSave = useCallback(async () => {
    setStatus("");
    if (!auth?.id) {
      setStatus("Vous n’êtes pas connecté. Veuillez vous reconnecter.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        examName: `${meta.title} - Test`,
        scorePct: Math.floor(55 + Math.random() * 40),
        levelCurrent: "B2",
        levelTarget: "C1",
        aiCorrections: {
          module: moduleId,
          recommendations: [
            "Travailler l’accord des adjectifs dans les phrases complexes.",
            "Renforcer le vocabulaire thématique (travail, environnement, société).",
            "S’entraîner avec des sujets chronométrés.",
          ],
        },
      };

      await API.post("/simulations", payload, {
        headers: { "x-user-id": String(auth.id) },
      });

      setStatus("Résultat enregistré. Retour au dashboard…");
      navigate("/dashboard");
    } catch {
      setStatus("Impossible d’enregistrer le résultat (backend indisponible ?).");
    } finally {
      setSaving(false);
    }
  }, [auth?.id, meta.title, moduleId, navigate]);

  return (
    <div style={{ padding: 24, maxWidth: 900, margin: "0 auto" }}>
      <button type="button" onClick={() => navigate("/simulations")} style={{ marginBottom: 16 }}>
        ← Retour
      </button>
      <h1 style={{ marginTop: 0 }}>{meta.title}</h1>
      <p>Page module (placeholder). Ici on mettra la vraie simulation.</p>

      <div style={{ display: "flex", gap: 12, marginTop: 16, flexWrap: "wrap" }}>
        <button type="button" onClick={finishAndSave} disabled={saving}>
          {saving ? "Enregistrement..." : "Terminer le test (démo) & enregistrer"}
        </button>
        <button type="button" onClick={() => navigate("/dashboard")}>
          {t.common.home}
        </button>
      </div>

      {status ? <p style={{ marginTop: 12 }}>{status}</p> : null}
    </div>
  );
}

