const AUTH_KEY = "auth";
const AUTH_HINT_KEY = "auth_session_hint";

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
  if (typeof localStorage !== "undefined") localStorage.removeItem(AUTH_HINT_KEY);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(AUTH_KEY);
};

export const storeAuthSession = ({ user, token, expiresIn }, remember = false) => {
  if (!user || !token) return;
  clearAuthSession();
  if (typeof localStorage !== "undefined") localStorage.setItem(AUTH_HINT_KEY, "1");
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

export const hasAuthSessionHint = () =>
  typeof localStorage !== "undefined" && localStorage.getItem(AUTH_HINT_KEY) === "1";

export const isAdmin = () => getAuthUser()?.role === "admin";

export const normalizeSeriesLevel = (series) => {
  const fields = [
    series?.level,
    series?.targetLevel,
    series?.target_level,
    series?.examLevel,
    series?.exam_level,
    series?.examId,
    series?.exam_id,
    series?.accessExamId,
    series?.access_exam_id,
    series?.name,
    series?.examName,
    series?.exam_name,
    series?.title,
  ];
  const match = fields
    .map((field) => String(field ?? "").match(/\b(B1|B2)\b/i)?.[1]?.toUpperCase())
    .find(Boolean);
  return match || "";
};

export const hasActiveSubscriptionForLevel = (level) => {
  const auth = getAuthUser();
  if (!auth?.id) return false;
  const normalizedLevel = String(level ?? "").trim().toUpperCase();
  if (!["B1", "B2"].includes(normalizedLevel)) return false;

  const subscriptions = Array.isArray(auth.active_subscriptions)
    ? auth.active_subscriptions
    : Array.isArray(auth.activeSubscriptions)
      ? auth.activeSubscriptions
      : [];
  const now = Date.now();
  return subscriptions.some((subscription) => {
    const subscriptionLevel = String(subscription?.level ?? "").toUpperCase();
    const status = String(subscription?.status ?? "").toLowerCase();
    const expiresAt = subscription?.expiresAt || subscription?.expires_at;
    const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : 0;
    return subscriptionLevel === normalizedLevel && status === "active" && expiresAtMs > now;
  });
};

export const hasPaidSeriesAccess = (series = null) => {
  const auth = getAuthUser();
  if (!auth?.id) return false;

  const plan = String(auth?.plan ?? auth?.subscriptionPlan ?? "").toLowerCase();
  const status = String(auth?.subscription?.status ?? auth?.subscriptionStatus ?? "").toLowerCase();
  const broadAccess = Boolean(
    auth?.has_full_access ||
      auth?.hasFullAccess ||
      auth?.isPremium ||
      auth?.paid ||
      auth?.hasActiveSubscription ||
      auth?.role === "admin" ||
      ["active", "trialing", "paid"].includes(status) ||
      (plan && !["free", "visitor"].includes(plan))
  );
  if (broadAccess) return true;

  const level = normalizeSeriesLevel(series);
  return level ? hasActiveSubscriptionForLevel(level) : false;
};

export const hasPartialSeriesAccess = (series) => {
  const auth = getAuthUser();
  if (!auth?.id || !series) return false;

  const grants = Array.isArray(auth.partial_access)
    ? auth.partial_access
    : Array.isArray(auth.partialAccess)
      ? auth.partialAccess
      : [];
  const examId = String(series.examId ?? series.exam_id ?? "").toLowerCase();
  const accessExamId = String(series.accessExamId ?? series.access_exam_id ?? "").toLowerCase();
  const seriesId = String(series.id ?? series.seriesId ?? series.series_id ?? "").toLowerCase();

  return grants.some((grant) => (
    [examId, accessExamId].filter(Boolean).includes(String(grant?.examId ?? grant?.exam_id ?? "").toLowerCase()) &&
    String(grant?.seriesId ?? grant?.series_id ?? "").toLowerCase() === seriesId
  ));
};

export const canOpenSeries = (series) =>
  Boolean(series?.isFree) || hasPaidSeriesAccess(series) || hasPartialSeriesAccess(series);

export const isVisitorSeriesAttempt = (series) => Boolean(series?.isFree) && !isLoggedIn();
