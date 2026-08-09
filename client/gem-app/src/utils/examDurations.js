import examSectionDurations from "../../../../shared/examSectionDurations.json";

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

export const normalizeExamDurationKey = (examId, level) => {
  const raw = String(examId ?? "").trim();
  const detectedLevel = String(level || raw.match(/\b(B1|B2)\b/i)?.[1] || "").toLowerCase();
  const provider = normalizeProvider(raw);
  return provider && detectedLevel ? `${provider}-${detectedLevel}` : provider;
};

export const getExamSectionDurationMinutes = ({ examId, level, moduleId, fallback = null }) => {
  const examKey = normalizeExamDurationKey(examId, level);
  const configured = Number(examSectionDurations[examKey]?.[String(moduleId ?? "").toLowerCase()]);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const safeFallback = Number(fallback);
  return Number.isFinite(safeFallback) && safeFallback > 0 ? safeFallback : null;
};

export const harmonizeDurationText = (value, durationMinutes) => {
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

export const harmonizeModuleDuration = (module, durationMinutes) => {
  if (!module || !durationMinutes) return module;
  return {
    ...module,
    durationMinutes,
    globalDurationMinutes: durationMinutes,
    passage: module.passage
      ? { ...module.passage, intro: harmonizeDurationText(module.passage.intro, durationMinutes) }
      : module.passage,
    parts: Array.isArray(module.parts)
      ? module.parts.map((part) => ({
          ...part,
          heading: harmonizeDurationText(part.heading, durationMinutes),
          text: harmonizeDurationText(part.text, durationMinutes),
          instructions: harmonizeDurationText(part.instructions, durationMinutes),
        }))
      : module.parts,
  };
};

export { examSectionDurations };
