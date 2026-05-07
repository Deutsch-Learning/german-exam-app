import { useEffect } from "react";

const BLOCKED_EVENTS = ["copy", "cut", "paste", "drop", "dragstart"];

export const useTestProtection = () => {
  useEffect(() => {
    const previousTranslate = document.documentElement.getAttribute("translate");
    const previousBodyTranslate = document.body.getAttribute("translate");
    let meta = document.querySelector('meta[name="google"][content="notranslate"]');
    const createdMeta = !meta;

    if (!meta) {
      meta = document.createElement("meta");
      meta.setAttribute("name", "google");
      meta.setAttribute("content", "notranslate");
      document.head.appendChild(meta);
    }

    document.documentElement.setAttribute("translate", "no");
    document.body.setAttribute("translate", "no");
    document.documentElement.classList.add("notranslate");
    document.body.classList.add("notranslate");

    const prevent = (event) => {
      event.preventDefault();
      event.stopPropagation();
    };

    BLOCKED_EVENTS.forEach((eventName) => {
      document.addEventListener(eventName, prevent, true);
    });

    return () => {
      BLOCKED_EVENTS.forEach((eventName) => {
        document.removeEventListener(eventName, prevent, true);
      });

      if (previousTranslate === null) {
        document.documentElement.removeAttribute("translate");
      } else {
        document.documentElement.setAttribute("translate", previousTranslate);
      }

      if (previousBodyTranslate === null) {
        document.body.removeAttribute("translate");
      } else {
        document.body.setAttribute("translate", previousBodyTranslate);
      }

      document.documentElement.classList.remove("notranslate");
      document.body.classList.remove("notranslate");

      if (createdMeta) {
        meta?.remove();
      }
    };
  }, []);
};
