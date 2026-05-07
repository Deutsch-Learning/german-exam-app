const AUTH_KEY = "auth";

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value ?? "");
  } catch {
    return fallback;
  }
};

const getStorage = (remember) => (remember ? localStorage : sessionStorage);

export const clearAuthSession = () => {
  if (typeof localStorage !== "undefined") localStorage.removeItem(AUTH_KEY);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(AUTH_KEY);
};

export const storeAuthSession = ({ user, token, expiresIn }, remember = false) => {
  if (!user || !token) return;
  clearAuthSession();
  getStorage(remember).setItem(
    AUTH_KEY,
    JSON.stringify({
      user,
      token,
      expiresIn,
      remember: Boolean(remember),
      savedAt: new Date().toISOString(),
    })
  );
};

export const updateStoredUser = (user) => {
  const session = getAuthSession();
  if (!session?.token || !user) return;
  storeAuthSession(
    {
      user,
      token: session.token,
      expiresIn: session.expiresIn,
    },
    Boolean(session.remember)
  );
};

export const getAuthSession = () => {
  if (typeof localStorage === "undefined" || typeof sessionStorage === "undefined") return null;

  const persistent = safeJsonParse(localStorage.getItem(AUTH_KEY));
  if (persistent?.token && persistent?.user) return persistent;

  const session = safeJsonParse(sessionStorage.getItem(AUTH_KEY));
  if (session?.token && session?.user) return session;

  return null;
};

export const getAuthToken = () => getAuthSession()?.token ?? "";

export const getAuthUser = () => getAuthSession()?.user ?? null;

export const isLoggedIn = () => Boolean(getAuthToken() && getAuthUser()?.id);

export const isAdmin = () => getAuthUser()?.role === "admin";

export const hasPaidSeriesAccess = () => {
  const auth = getAuthUser();
  if (!auth?.id) return false;

  const plan = String(auth?.plan ?? auth?.subscriptionPlan ?? "").toLowerCase();
  const status = String(auth?.subscription?.status ?? auth?.subscriptionStatus ?? "").toLowerCase();

  return Boolean(
    auth?.has_full_access ||
      auth?.hasFullAccess ||
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
