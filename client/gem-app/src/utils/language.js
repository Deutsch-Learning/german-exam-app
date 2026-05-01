import frenchFlag from "../assets/images/french_flag.png";
import germanFlag from "../assets/images/german-flag-wave.png";

export const LANG_KEY = "app_language";

export const languageOptions = [
  { id: "fr", label: "Français", flag: frenchFlag },
  { id: "en", label: "English", flag: null },
  { id: "de", label: "Deutsch", flag: germanFlag },
];

export const normalizeLanguage = (value) =>
  languageOptions.some((o) => o.id === value) ? value : "fr";

export const getStoredLanguage = () => {
  try {
    const value = localStorage.getItem(LANG_KEY);
    return normalizeLanguage(value);
  } catch {
    return "fr";
  }
};

export const setStoredLanguage = (value) => {
  const safe = normalizeLanguage(value);
  try {
    localStorage.setItem(LANG_KEY, safe);
  } catch {
    // Ignore storage errors.
  }
  return safe;
};
