import { useEffect, useLayoutEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import Lenis from "lenis";
import { useLocation, useNavigationType } from "react-router-dom";
import "./motion.css";

const pageVariants = {
  initial: {
    opacity: 0,
    y: 18,
    scale: 0.992,
    filter: "blur(10px)",
  },
  animate: {
    opacity: 1,
    y: 0,
    scale: 1,
    filter: "blur(0px)",
  },
  exit: {
    opacity: 0,
    y: -10,
    scale: 0.996,
    filter: "blur(8px)",
  },
};

const pageTransition = {
  duration: 0.34,
  ease: [0.22, 1, 0.36, 1],
};

const revealSelector = [
  "main section",
  "main article",
  "main header",
  "main aside",
  "main form",
  "main h1",
  "main h2",
  "main h3",
  "main p",
  "main img",
  "[class*='card']",
  "[class*='Card']",
  "[class*='panel']",
  "[class*='Panel']",
  "[class*='grid'] > *",
  "[class*='list'] > *",
].join(",");

function useRouteScroll(location, reduceMotion) {
  const navigationType = useNavigationType();

  useLayoutEffect(() => {
    if (location.hash) {
      const target = document.querySelector(location.hash);
      if (target) {
        target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      }
      return;
    }

    if (navigationType === "POP") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [location.hash, location.pathname, navigationType, reduceMotion]);
}

function useScrollReveal(location, reduceMotion) {
  useEffect(() => {
    if (reduceMotion || typeof IntersectionObserver === "undefined") return undefined;

    const root = document.querySelector(".motion-page");
    if (!root) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
    );

    const observed = new WeakSet();
    const observePageElements = () => {
      const elements = Array.from(root.querySelectorAll(revealSelector))
        .filter((element) => {
          if (observed.has(element) || element.closest(".motion-no-reveal")) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        })
        .slice(0, 160);

      elements.forEach((element, index) => {
        observed.add(element);
        element.classList.add("motion-reveal");
        element.style.setProperty("--motion-reveal-delay", `${Math.min(index * 18, 180)}ms`);
        observer.observe(element);
      });
    };

    observePageElements();
    const timers = [120, 520, 1200].map((delay) => window.setTimeout(observePageElements, delay));

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      observer.disconnect();
    };
  }, [location.key, location.pathname, reduceMotion]);
}

function useSmoothScroll(reduceMotion) {
  useEffect(() => {
    if (reduceMotion || typeof window === "undefined") return undefined;

    const lenis = new Lenis({
      duration: 0.92,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
      smoothWheel: true,
      syncTouch: false,
      wheelMultiplier: 0.86,
    });

    let frameId;
    const raf = (time) => {
      lenis.raf(time);
      frameId = window.requestAnimationFrame(raf);
    };
    frameId = window.requestAnimationFrame(raf);

    return () => {
      window.cancelAnimationFrame(frameId);
      lenis.destroy();
    };
  }, [reduceMotion]);
}

function LiquidTransitionOverlay({ routeKey }) {
  return (
    <AnimatePresence initial={false}>
      <motion.div
        key={routeKey}
        className="motion-route-overlay motion-no-reveal"
        initial={{
          y: "100%",
          opacity: 0.96,
          borderRadius: "42% 58% 0 0 / 22% 28% 0 0",
        }}
        animate={{
          y: "-115%",
          opacity: [0.96, 0.96, 0],
          borderRadius: [
            "42% 58% 0 0 / 22% 28% 0 0",
            "24% 76% 0 0 / 16% 34% 0 0",
            "0 0 0 0",
          ],
        }}
        transition={{ duration: 0.72, ease: [0.76, 0, 0.24, 1], times: [0, 0.72, 1] }}
        aria-hidden="true"
      />
    </AnimatePresence>
  );
}

export default function MotionShell({ children }) {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  useSmoothScroll(reduceMotion);
  useRouteScroll(location, reduceMotion);
  useScrollReveal(location, reduceMotion);

  if (reduceMotion) {
    return <>{children}</>;
  }

  return (
    <>
      <LiquidTransitionOverlay routeKey={location.key} />
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={location.key}
          className="motion-page"
          variants={pageVariants}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={pageTransition}
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </>
  );
}
