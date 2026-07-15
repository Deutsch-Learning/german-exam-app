import { useEffect, useMemo, useState } from "react";

const parseValue = (value) => {
  const text = String(value ?? "");
  const match = text.match(/^(.*?)(-?\d+(?:[.,]\d+)?)(.*)$/);
  if (!match) return { prefix: "", number: 0, suffix: text, decimals: 0 };
  const rawNumber = match[2].replace(",", ".");
  return {
    prefix: match[1],
    number: Number(rawNumber),
    suffix: match[3],
    decimals: (rawNumber.split(".")[1] || "").length,
  };
};

export default function StatCard({ icon, value, label, animationKey = 0 }) {
  const parsed = useMemo(() => parseValue(value), [value]);
  const [displayedValue, setDisplayedValue] = useState(() => `0${parsed.suffix}`);

  useEffect(() => {
    const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !Number.isFinite(parsed.number)) {
      const reducedFrameId = window.requestAnimationFrame(() => setDisplayedValue(String(value)));
      return () => window.cancelAnimationFrame(reducedFrameId);
    }

    let frameId = 0;
    const startedAt = performance.now();
    const duration = 1150;
    const renderFrame = (now) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const numeric = parsed.number * eased;
      const formatted = parsed.decimals
        ? numeric.toFixed(parsed.decimals)
        : Math.round(numeric).toLocaleString("fr-FR", { useGrouping: false });
      setDisplayedValue(`${parsed.prefix}${formatted}${parsed.suffix}`);
      if (progress < 1) frameId = window.requestAnimationFrame(renderFrame);
    };
    frameId = window.requestAnimationFrame(renderFrame);
    return () => window.cancelAnimationFrame(frameId);
  }, [animationKey, parsed, value]);

  return (
    <div className="stat-card">
      <div className="stat-icon">{icon}</div>
      <h3 className="stat-value" aria-label={String(value)}>{displayedValue}</h3>
      <p className="stat-label">{label}</p>
    </div>
  );
}
