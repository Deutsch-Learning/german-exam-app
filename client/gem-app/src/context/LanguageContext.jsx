import React, { createContext, useContext, useMemo, useState } from "react";
import { getStoredLanguage, setStoredLanguage } from "../utils/language";

const LanguageContext = createContext({
  language: "fr",
  setLanguage: () => {},
  t: {},
});

const translations = {
  fr: {
    common: {
      home: "Accueil",
      about: "A propos",
      contact: "Contact",
      news: "Actualités",
      training: "Formations",
      pages: "Pages",
      profile: "Profil",
      logout: "Déconnexion",
      loading: "Chargement...",
    },
    auth: {
      loginTitle: "Bon retour",
      loginCta: "Se connecter",
      registerTitle: "Créer un compte",
      registerCta: "S'inscrire",
    },
  },
  en: {
    common: {
      home: "Home",
      about: "About",
      contact: "Contact",
      news: "News",
      training: "Training",
      pages: "Pages",
      profile: "Profile",
      logout: "Logout",
      loading: "Loading...",
    },
    auth: {
      loginTitle: "Welcome back",
      loginCta: "Log in",
      registerTitle: "Create an account",
      registerCta: "Sign up",
    },
  },
  de: {
    common: {
      home: "Start",
      about: "Über uns",
      contact: "Kontakt",
      news: "Nachrichten",
      training: "Kurse",
      pages: "Seiten",
      profile: "Profil",
      logout: "Abmelden",
      loading: "Lädt...",
    },
    auth: {
      loginTitle: "Willkommen zurück",
      loginCta: "Anmelden",
      registerTitle: "Konto erstellen",
      registerCta: "Registrieren",
    },
  },
};

export function LanguageProvider({ children }) {
  const [language, setLangState] = useState(getStoredLanguage);
  const setLanguage = (next) => setLangState(setStoredLanguage(next));

  const value = useMemo(
    () => ({ language, setLanguage, t: translations[language] ?? translations.fr }),
    [language]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useLanguage() {
  return useContext(LanguageContext);
}
