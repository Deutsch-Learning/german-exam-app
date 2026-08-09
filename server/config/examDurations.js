const examSectionDurations = require("../../shared/examSectionDurations.json");

const normalizeProvider = (value) => {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.includes("goethe")) return "goethe";
  if (normalized.includes("osd") || normalized.includes("oesd") || /(?:^|-)sd(?:-|$)/.test(normalized)) return "osd";
  if (normalized.includes("telc")) return "telc";
  if (normalized.includes("ecl")) return "ecl";
  return normalized;
};

const getExamSectionDurationMinutes = ({ examId, provider, level, moduleId, fallback = null }) => {
  const rawExamId = String(examId ?? "").trim();
  const detectedLevel = String(level || rawExamId.match(/\b(B1|B2)\b/i)?.[1] || "").toLowerCase();
  const normalizedProvider = normalizeProvider(provider || rawExamId);
  const examKey = normalizedProvider && detectedLevel ? `${normalizedProvider}-${detectedLevel}` : normalizedProvider;
  const configured = Number(examSectionDurations[examKey]?.[String(moduleId ?? "").toLowerCase()]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) && safeFallback > 0 ? safeFallback : null;
};

const harmonizeDurationText = (value, durationMinutes) => {
  const text = String(value ?? "");
  const duration = Number(durationMinutes);
  if (!text || !Number.isFinite(duration) || duration <= 0) return text;
  return text
    .replace(/\b\d{1,3}(?=\s*-\s*min(?:u|ue|\u00fc)tig)/gi, String(duration))
    .replace(
      /\b(?:ca\.?\s*|etwa\s+|ungef(?:ae|\u00e4)hr\s+)?\d{1,3}\s*(?:Minuten?|Min\.?|minutes?)\b/gi,
      `${duration} Minuten`
    );
};

module.exports = {
  examSectionDurations,
  getExamSectionDurationMinutes,
  harmonizeDurationText,
};
