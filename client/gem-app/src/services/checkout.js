import API from "./api";

export const createCheckoutSession = async ({
  userId,
  level,
  planKey,
  planName,
  priceEur,
  durationDays,
  writingSimulatorAttempts,
  certifications,
  unlockedSections,
  provider = "manual",
}) => {
  const payload = {
    userId,
    level,
    planKey,
    planName,
    priceEur,
    durationDays,
    writingSimulatorAttempts,
    certifications,
    unlockedSections,
    provider,
  };

  const response = await API.post("/api/checkout/session", payload);
  return response.data;
};
