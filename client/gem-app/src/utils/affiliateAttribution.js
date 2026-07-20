import API from "../services/api";

const AFFILIATE_ATTRIBUTION_KEY = "affiliate_referral_attribution";
const DEFAULT_DAYS = 30;

export const normalizeAffiliateCode = (value) =>
  String(value ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);

export const storeAffiliateAttribution = (code, days = DEFAULT_DAYS) => {
  const normalized = normalizeAffiliateCode(code);
  if (!normalized || typeof localStorage === "undefined") return null;
  const now = Date.now();
  const payload = {
    code: normalized,
    savedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + Math.max(1, Number(days) || DEFAULT_DAYS) * 24 * 60 * 60 * 1000).toISOString(),
  };
  localStorage.setItem(AFFILIATE_ATTRIBUTION_KEY, JSON.stringify(payload));
  return payload;
};

export const getStoredAffiliateAttribution = () => {
  if (typeof localStorage === "undefined") return null;
  try {
    const payload = JSON.parse(localStorage.getItem(AFFILIATE_ATTRIBUTION_KEY) || "null");
    if (!payload?.code || !payload?.expiresAt || new Date(payload.expiresAt).getTime() <= Date.now()) {
      localStorage.removeItem(AFFILIATE_ATTRIBUTION_KEY);
      return null;
    }
    return payload;
  } catch {
    localStorage.removeItem(AFFILIATE_ATTRIBUTION_KEY);
    return null;
  }
};

export const clearAffiliateAttribution = () => {
  if (typeof localStorage !== "undefined") localStorage.removeItem(AFFILIATE_ATTRIBUTION_KEY);
};

export const captureAffiliateRefFromLocation = async (search, landing = "") => {
  const params = new URLSearchParams(search || "");
  const code = normalizeAffiliateCode(params.get("ref"));
  if (!code) return null;
  try {
    const response = await API.get(`/api/affiliate/validate/${encodeURIComponent(code)}`);
    if (response.data?.valid) {
      const stored = storeAffiliateAttribution(response.data.code || code, response.data.attributionCookieDays);
      API.post("/api/affiliate/click", { code, landing }).catch(() => {});
      return stored;
    }
  } catch {
    // Invalid referral links should never block ordinary browsing.
  }
  return null;
};

export const claimStoredAffiliateAttribution = async () => {
  const stored = getStoredAffiliateAttribution();
  if (!stored?.code) return null;
  try {
    const response = await API.post("/api/affiliate/claim", { code: stored.code });
    if (response.data?.ok) clearAffiliateAttribution();
    return response.data;
  } catch (error) {
    if ([400, 404, 409].includes(error?.response?.status)) clearAffiliateAttribution();
    return null;
  }
};
