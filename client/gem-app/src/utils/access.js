export const getAuthUser = () => {
  if (typeof localStorage === "undefined") return null;

  try {
    return JSON.parse(localStorage.getItem("auth") ?? "null");
  } catch {
    return null;
  }
};

export const isLoggedIn = () => Boolean(getAuthUser()?.id);

export const hasPaidSeriesAccess = () => {
  const auth = getAuthUser();
  if (!auth?.id) return false;

  const plan = String(auth?.plan ?? auth?.subscriptionPlan ?? "").toLowerCase();
  const status = String(auth?.subscription?.status ?? auth?.subscriptionStatus ?? "").toLowerCase();

  return Boolean(
    auth?.isPremium ||
      auth?.paid ||
      auth?.hasActiveSubscription ||
      auth?.role === "admin" ||
      ["active", "trialing", "paid"].includes(status) ||
      (plan && !["free", "visitor"].includes(plan))
  );
};

export const canOpenSeries = (series) => Boolean(series?.isFree) || hasPaidSeriesAccess();

export const isVisitorSeriesAttempt = (series) => Boolean(series?.isFree) && !isLoggedIn();
