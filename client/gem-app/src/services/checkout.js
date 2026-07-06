import API from "./api";

export const createCheckoutSession = async ({
  level,
  planKey,
  planName,
  basePriceEur,
  priceEur,
  durationDays,
  writingSimulatorAttempts,
  selectedCertifications,
  selectedCertificationCount,
  finalPriceEur,
  unlockedSections,
  provider = "manual",
}) => {
  const payload = {
    level,
    planKey,
    planName,
    basePriceEur: Number(basePriceEur ?? priceEur),
    durationDays,
    writingSimulatorAttempts,
    selectedCertifications,
    selectedCertificationCount,
    finalPriceEur,
    unlockedSections,
    provider,
  };

  const response = await API.post("/api/checkout/session", payload);
  return response.data;
};
