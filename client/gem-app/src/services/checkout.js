import API from "./api";

export const getCheckoutQuote = async ({
  level,
  planKey,
  selectedCertifications,
  country = "CM",
}) => {
  const response = await API.post("/api/checkout/quote", {
    level,
    planKey,
    selectedCertifications,
    country,
  });
  return response.data;
};

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
  paymentMethod,
  mobileMoney,
  idempotencyKey,
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
    paymentMethod,
    mobileMoney,
    idempotencyKey,
    provider,
  };

  const response = await API.post("/api/checkout/session", payload);
  return response.data;
};

export const getCheckoutSessionStatus = async (reference) => {
  const response = await API.get(`/api/checkout/session/${encodeURIComponent(reference)}/status`);
  return response.data;
};
