import { useCallback, useEffect } from "react";
import { getTranslations, useLanguage } from "../context/LanguageContext";

export const SIMULATION_LANGUAGE = "de";

export const useStartSimulationLanguage = () => {
  const { setLanguage } = useLanguage();
  return useCallback(() => setLanguage(SIMULATION_LANGUAGE), [setLanguage]);
};

export const useSimulationLanguage = () => {
  const { language, setLanguage } = useLanguage();

  useEffect(() => {
    if (language !== SIMULATION_LANGUAGE) {
      setLanguage(SIMULATION_LANGUAGE);
    }
  }, [language, setLanguage]);

  return getTranslations(SIMULATION_LANGUAGE);
};
