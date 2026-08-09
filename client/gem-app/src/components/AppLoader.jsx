import { memo } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { useLanguage } from "../context/LanguageContext";
import styles from "./AppLoader.module.css";

const VALID_SIZES = new Set(["small", "medium", "large"]);

const danceAnimations = [
  {
    x: [0, -1, 1, 0, 0],
    y: [0, -7, 1, -4, 0],
    rotate: [0, -5, 4, -2, 0],
    scaleX: [1, 0.98, 1.03, 0.99, 1],
    scaleY: [1, 1.05, 0.96, 1.02, 1],
    transition: { duration: 1.9, repeat: Infinity, times: [0, 0.24, 0.5, 0.74, 1], ease: "easeInOut" },
  },
  {
    x: [0, 2, -2, 1, 0],
    y: [0, -3, 2, -5, 0],
    rotate: [0, 4, -4, 3, 0],
    scaleX: [1, 1.02, 0.98, 1.01, 1],
    scaleY: [1, 0.98, 1.04, 1.01, 1],
    transition: { duration: 2.05, delay: 0.08, repeat: Infinity, times: [0, 0.22, 0.48, 0.76, 1], ease: "easeInOut" },
  },
  {
    x: [0, -1, 1, 0, 0],
    y: [0, 2, -8, 1, 0],
    rotate: [0, -3, 6, -4, 0],
    scaleX: [1, 1.05, 0.96, 1.03, 1],
    scaleY: [1, 0.92, 1.09, 0.97, 1],
    transition: { duration: 1.82, delay: 0.16, repeat: Infinity, times: [0, 0.2, 0.46, 0.72, 1], ease: "easeInOut" },
  },
  {
    x: [0, 2, -1, 1, 0],
    y: [0, -5, 2, -3, 0],
    rotate: [0, 5, -4, 2, 0],
    scaleX: [1, 0.99, 1.02, 0.99, 1],
    scaleY: [1, 1.03, 0.98, 1.02, 1],
    transition: { duration: 2.12, delay: 0.04, repeat: Infinity, times: [0, 0.25, 0.52, 0.78, 1], ease: "easeInOut" },
  },
];

const reducedMotionAnimation = {
  opacity: [0.72, 1, 0.72],
  scale: [0.985, 1, 0.985],
  transition: { duration: 2.4, repeat: Infinity, ease: "easeInOut" },
};

function DancingCapsules({ reduceMotion }) {
  const animationFor = (index) => reduceMotion ? reducedMotionAnimation : danceAnimations[index];

  return (
    <svg className={styles.graphic} viewBox="0 4 160 96" aria-hidden="true" focusable="false">
      <motion.g className={styles.shapePrimary} initial={false} animate={animationFor(0)}>
        <rect x="14" y="28" width="21" height="58" rx="10.5" fill="currentColor" />
      </motion.g>
      <motion.g className={styles.shapeSecondary} initial={false} animate={animationFor(1)}>
        <path d="M62 29V67C62 80 68 88 78 93" fill="none" stroke="currentColor" strokeWidth="21" strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
      <motion.g className={styles.shapeHighlight} initial={false} animate={animationFor(2)}>
        <rect x="98" y="34" width="21" height="50" rx="10.5" fill="currentColor" />
      </motion.g>
      <motion.g className={styles.shapeAccent} initial={false} animate={animationFor(3)}>
        <path d="M145 82V39C145 24 137 15 124 14" fill="none" stroke="currentColor" strokeWidth="21" strokeLinecap="round" strokeLinejoin="round" />
      </motion.g>
    </svg>
  );
}

function AppLoader({
  fullScreen = true,
  size = "medium",
  text,
  overlay = false,
  className = "",
  showText = true,
}) {
  const reduceMotion = useReducedMotion();
  const { t } = useLanguage();
  const resolvedSize = VALID_SIZES.has(size) ? size : "medium";
  const resolvedText = text ?? t?.common?.loading ?? "Loading...";
  const rootClassName = [
    styles.root,
    styles[resolvedSize],
    fullScreen ? styles.fullScreen : styles.inline,
    overlay ? styles.overlay : "",
    showText ? "" : styles.visualOnly,
    className,
  ].filter(Boolean).join(" ");

  return (
    <span className={rootClassName} role="status" aria-live="polite" aria-busy="true">
      <DancingCapsules reduceMotion={reduceMotion} />
      {showText ? <span className={styles.text}>{resolvedText}</span> : <span className={styles.srOnly}>{resolvedText}</span>}
    </span>
  );
}

export default memo(AppLoader);
