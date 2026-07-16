const AUTH_KEY = "auth";
const AUTH_HINT_KEY = "auth_session_hint";
const AUTH_LAST_ACTIVITY_KEY = "auth_last_activity_at";
const AUTH_INACTIVITY_LIMIT_MS = 24 * 60 * 60 * 1000;

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value ?? "");
  } catch {
    return fallback;
  }
};

export const clearAuthSession = ({ keepActivity = false } = {}) => {
  if (typeof localStorage !== "undefined") localStorage.removeItem(AUTH_KEY);
  if (typeof localStorage !== "undefined") localStorage.removeItem(AUTH_HINT_KEY);
  if (!keepActivity && typeof localStorage !== "undefined") localStorage.removeItem(AUTH_LAST_ACTIVITY_KEY);
  if (typeof sessionStorage !== "undefined") sessionStorage.removeItem(AUTH_KEY);
};

export const touchAuthActivity = (timestamp = Date.now()) => {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(AUTH_LAST_ACTIVITY_KEY, String(timestamp));
};

export const getLastAuthActivityAt = () => {
  if (typeof localStorage === "undefined") return 0;
  const value = Number(localStorage.getItem(AUTH_LAST_ACTIVITY_KEY));
  return Number.isFinite(value) && value > 0 ? value : 0;
};

export const hasExceededAuthInactivityLimit = (now = Date.now()) => {
  const lastActivityAt = getLastAuthActivityAt();
  return Boolean(lastActivityAt && now - lastActivityAt >= AUTH_INACTIVITY_LIMIT_MS);
};

export const storeAuthSession = ({ user, token, expiresIn }, remember = true) => {
  if (!user || !token) return;
  clearAuthSession({ keepActivity: true });
  if (typeof localStorage !== "undefined") localStorage.setItem(AUTH_HINT_KEY, "1");
  localStorage.setItem(
    AUTH_KEY,
    JSON.stringify({
      user,
      token,
      expiresIn,
      remember: Boolean(remember),
      savedAt: new Date().toISOString(),
    })
  );
  touchAuthActivity();
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

export const normalizeCertificationKey = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase();
  if (raw.includes("goethe")) return "goethe";
  const normalized = raw.replace(/ö/g, "o").replace(/oe/g, "o");
  if (normalized.includes("telc")) return "telc";
  if (normalized.includes("ecl")) return "ecl";
  if (normalized.includes("osd")) return "osd";
  return "";
};

export const normalizeSeriesCertification = (series) => {
  const fields = [
    series?.provider,
    series?.certification,
    series?.certificationKey,
    series?.examId,
    series?.exam_id,
    series?.accessExamId,
    series?.access_exam_id,
    series?.name,
    series?.examName,
    series?.exam_name,
    series?.title,
  ];
  return fields.map(normalizeCertificationKey).find(Boolean) || "";
};

const getSubscriptionCertifications = (subscription) => {
  const raw = Array.isArray(subscription?.selectedCertifications)
    ? subscription.selectedCertifications
    : Array.isArray(subscription?.selected_certifications)
      ? subscription.selected_certifications
      : Array.isArray(subscription?.certifications)
        ? subscription.certifications
        : [];
  return raw.map(normalizeCertificationKey).filter(Boolean);
};

export const hasActiveSubscriptionForLevel = (level, certification = "") => {
  const auth = getAuthUser();
  if (!auth?.id) return false;
  const normalizedLevel = String(level ?? "").trim().toUpperCase();
  if (!["B1", "B2"].includes(normalizedLevel)) return false;
  const normalizedCertification = normalizeCertificationKey(certification);

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
    const certifications = getSubscriptionCertifications(subscription);
    return (
      subscriptionLevel === normalizedLevel &&
      status === "active" &&
      expiresAtMs > now &&
      (!normalizedCertification || certifications.includes(normalizedCertification))
    );
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
  const certification = normalizeSeriesCertification(series);
  return level && certification ? hasActiveSubscriptionForLevel(level, certification) : false;
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
