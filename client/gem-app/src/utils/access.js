export const hasPaidSeriesAccess = () => {
  if (typeof localStorage === "undefined") return false;

  try {
    const auth = JSON.parse(localStorage.getItem("auth") ?? "null");
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
  } catch {
    return false;
  }
};

export const canOpenSeries = (series) => Boolean(series?.isFree) || hasPaidSeriesAccess();
