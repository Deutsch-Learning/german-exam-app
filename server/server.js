const crypto = require("crypto");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });
const express = require("express");
const multer = require("multer");
const pool = require("./db");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const nodemailer = require("nodemailer");
const { createAuthMiddleware, getBearerToken } = require("./middleware/auth");
const adminMiddleware = require("./middleware/admin");
const {
  analyzeExamDocument,
  buildHoerenParsedPreview,
  buildListeningImportFoundation,
  ensureDocumentImportSchema,
  getExamImportDraft,
  importParsedExamDocument,
  publishExamImportDraft,
  saveExamImportDraft,
  saveListeningImportFoundationDraft,
  summarizeOutline,
  updateExamImportDraft,
  validateImportDraftContent,
} = require("./services/documentImport");
const {
  correctWritingSimulation,
  ensureWritingCorrectionSchema,
  getWritingCorrectionForSimulation,
  isWritingSimulation,
} = require("./services/writingCorrection");
const {
  correctSpeakingSimulation,
  ensureSpeakingCorrectionSchema,
  getSpeakingCorrectionForSimulation,
  isSpeakingSimulation,
  saveSpeakingRecording,
} = require("./services/speakingCorrection");
const {
  ensureContentStyleSchema,
  registerContentStyleRoutes,
} = require("./services/contentStyleTemplates");
const {
  buildAudioContentHash,
  ensureAudioAssetSchema,
  ensureVoiceProfileSchema,
  generateAndStoreExamAudio,
  getAudioAssetById,
  getAudioAssetForExam,
  getConfiguredProvider,
  getProviderStatus,
  getVoiceProfiles,
  normalizeProvider,
  parseSpeakerSegments,
  stripProductionMarkers,
  TtsConfigurationError,
} = require("./services/ttsService");
const goetheB1HoerenQuestionFixes = require("./data/goetheB1HoerenQuestionFixes.json");
const {
  getAppBaseUrl,
  normalizePublicUrl,
  sendEmail,
  renderVerificationEmail,
  renderResetPasswordEmail,
  renderWelcomeEmail,
  renderPasswordChangedEmail,
  renderPromotionalEmail,
} = require("./services/emailService");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = normalizePublicUrl(process.env.FRONTEND_URL || process.env.APP_BASE_URL || "http://localhost:5173");
const SERVE_CLIENT = process.env.SERVE_CLIENT === "true";
const CLIENT_DIST_DIR = SERVE_CLIENT
  ? process.env.CLIENT_DIST_DIR
    ? path.resolve(process.env.CLIENT_DIST_DIR)
    : path.join(__dirname, "..", "client", "gem-app", "dist")
  : "";
const CLIENT_INDEX_FILE = CLIENT_DIST_DIR ? path.join(CLIENT_DIST_DIR, "index.html") : "";
const isProduction = process.env.NODE_ENV === "production";
const WRITING_GLOBAL_DURATION_MINUTES = 60;

const normalizeOrigin = (value) =>
  String(value ?? "")
    .trim()
    .replace(/\/$/, "");

const collectAllowedOrigins = () => {
  const set = new Set([
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    normalizeOrigin(FRONTEND_URL),
  ]);
  const extras = String(process.env.CORS_ORIGINS ?? "")
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
  extras.forEach((o) => set.add(o));
  return set;
};

const allowedOrigins = collectAllowedOrigins();

const isVercelPreviewOrigin = (origin) => {
  if (process.env.CORS_ALLOW_VERCEL_PREVIEWS !== "true") return false;
  try {
    const u = new URL(origin);
    return u.protocol === "https:" && u.hostname.endsWith(".vercel.app");
  } catch {
    return false;
  }
};

const originAllowed = (origin) => {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (allowedOrigins.has(normalized)) return true;
  return isVercelPreviewOrigin(origin);
};

const getRequestPublicBaseUrl = (req) => {
  const origin = normalizePublicUrl(req.get("origin") || "");
  if (origin && originAllowed(origin)) return origin;
  const host = String(req.get("x-forwarded-host") || req.get("host") || "").trim();
  if (!host) return FRONTEND_URL;
  const protocol = String(req.get("x-forwarded-proto") || req.protocol || "https").split(",")[0].trim() || "https";
  return normalizePublicUrl(`${protocol}://${host}`);
};

const JWT_SECRET =
  process.env.JWT_SECRET ||
  "dev-only-change-me-german-exam-app-secret";
const JWT_ISSUER = "german-exam-app";
const JWT_AUDIENCE = "german-exam-app-client";
const ACCESS_TOKEN_EXPIRES_IN = "15m";
const REFRESH_COOKIE_NAME = "refresh_token";
const REFRESH_DAYS = 7;
const REFRESH_MAX_AGE_MS = REFRESH_DAYS * 24 * 60 * 60 * 1000;
const COOKIE_SECURE = isProduction;
const DEFAULT_TOTAL_AVAILABLE_EXAMS = Number(process.env.TOTAL_AVAILABLE_EXAMS || 20);
const EMAIL_VERIFICATION_ENABLED = process.env.EMAIL_VERIFICATION_ENABLED !== "false";
const EMAIL_VERIFICATION_MODE = String(process.env.EMAIL_VERIFICATION_MODE || "soft").toLowerCase();
const EMAIL_VERIFICATION_REQUIRED =
  EMAIL_VERIFICATION_ENABLED &&
  (EMAIL_VERIFICATION_MODE === "strict" || process.env.EMAIL_VERIFICATION_REQUIRED === "true");
const LEVEL_ORDER = ["A1", "A2", "B1", "B2", "C1", "C2"];
const NOT_SPECIFIED_LEVEL = "Not specified";
const SUBSCRIPTION_CERTIFICATIONS = ["goethe", "osd", "telc", "ecl"];
const SUBSCRIPTION_SECTIONS = ["read", "listen", "speak", "write"];
const SUBSCRIPTION_SPEAKING_QUOTAS = {
  starter: 20,
  standard: 45,
  intensif: 65,
};
const SUBSCRIPTION_PLAN_SEEDS = [
  { level: "B1", planKey: "starter", planName: "Starter", durationDays: 5, priceEur: 14.99, writingSimulatorAttempts: 3 },
  { level: "B1", planKey: "standard", planName: "Standard", durationDays: 15, priceEur: 29.99, writingSimulatorAttempts: 6 },
  { level: "B1", planKey: "intensif", planName: "Intensif", durationDays: 30, priceEur: 54.99, writingSimulatorAttempts: 10 },
  { level: "B2", planKey: "starter", planName: "Starter", durationDays: 5, priceEur: 19.99, writingSimulatorAttempts: 3 },
  { level: "B2", planKey: "standard", planName: "Standard", durationDays: 15, priceEur: 34.99, writingSimulatorAttempts: 6 },
  { level: "B2", planKey: "intensif", planName: "Intensif", durationDays: 30, priceEur: 64.99, writingSimulatorAttempts: 10 },
];
const NOTCHPAY_API_BASE_URL = process.env.NOTCHPAY_API_BASE_URL || "https://api.notchpay.co";
const NOTCHPAY_PUBLIC_KEY = process.env.NOTCHPAY_PUBLIC_KEY || "";
const NOTCHPAY_SECRET_KEY = process.env.NOTCHPAY_SECRET_KEY || process.env.NOTCHPAY_PRIVATE_KEY || "";
const NOTCHPAY_WEBHOOK_HASH = process.env.NOTCHPAY_WEBHOOK_HASH || process.env.NOTCHPAY_HASH_KEY || "";
const NOTCHPAY_CURRENCY = String(process.env.NOTCHPAY_CURRENCY || "XAF").toUpperCase();
const NOTCHPAY_LOCKED_COUNTRY = process.env.NOTCHPAY_LOCKED_COUNTRY || "CM";
const NOTCHPAY_XAF_PER_EUR = Number(process.env.NOTCHPAY_XAF_PER_EUR || 656);
const NOTCHPAY_CALLBACK_URL =
  process.env.NOTCHPAY_CALLBACK_URL ||
  `${normalizePublicUrl(process.env.API_BASE_URL || FRONTEND_URL)}/api/payments/notchpay/callback`;
const INDUSTRIAL_OFFERS = [
  { offerKey: "industrial_1_month", label: "Industrial 1 month", accessMonths: 1, billedMonths: 1, durationDays: 30, priceEur: 450.99, speakingSimulatorQuota: 240 },
  { offerKey: "industrial_6_months", label: "Industrial 6 months", accessMonths: 6, billedMonths: 6, durationDays: 180, priceEur: 2500.99, speakingSimulatorQuota: 600 },
  { offerKey: "industrial_12_plus_2", label: "Industrial 1 year + 2 free months", accessMonths: 14, billedMonths: 12, durationDays: 420, priceEur: 5000.99, speakingSimulatorQuota: 1000 },
];

if (!process.env.JWT_SECRET && isProduction) {
  throw new Error("JWT_SECRET is required in production");
}

app.set("trust proxy", 1);
app.use(helmet());
app.use(cookieParser());
app.use(
  cors({
    origin: (origin, callback) => {
      if (originAllowed(origin)) return callback(null, true);
      if (origin && process.env.NODE_ENV !== "production") {
        console.warn(`[cors] blocked origin: ${origin}`);
      }
      return callback(null, false);
    },
    allowedHeaders: ["Content-Type", "Authorization", "Accept-Language", "X-Requested-With"],
    credentials: true,
  })
);
app.use(express.json({
  limit: "8mb",
  verify: (req, _res, buf) => {
    req.rawBody = Buffer.from(buf || "");
  },
}));

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 1,
  },
});

const speakingAudioUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: Number(process.env.SPEAKING_RECORDING_MAX_BYTES || 8 * 1024 * 1024),
    files: 1,
  },
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const testimonialRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 6,
  standardHeaders: true,
  legacyHeaders: false,
});

const TOKEN_BYTES = 32;
const VERIFICATION_HOURS = 24;
const VERIFICATION_CODE_MINUTES = 15;
const RESET_MINUTES = 60;
const GOOGLE_CLIENT_IDS = String(
  process.env.GOOGLE_CLIENT_IDS ||
    process.env.GOOGLE_CLIENT_ID ||
    process.env.VITE_GOOGLE_CLIENT_ID ||
    ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || "";

const isEmail = (value) =>
  typeof value === "string" && /^\S+@\S+\.\S+$/.test(value.trim());

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const tokenHash = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const makeToken = () => crypto.randomBytes(TOKEN_BYTES).toString("hex");
const makeVerificationCode = () => crypto.randomInt(0, 1_000_000).toString().padStart(6, "0");
const verificationCodeHash = (email, code) => tokenHash(`${normalizeEmail(email)}:${String(code || "").trim()}`);
const expiresFromNow = (amount, unit) => {
  const date = new Date();
  if (unit === "hours") date.setHours(date.getHours() + amount);
  if (unit === "minutes") date.setMinutes(date.getMinutes() + amount);
  return date;
};

const sanitizeUser = (user) => ({
  id: user.id,
  email: user.email,
  username: user.username,
  first_name: user.first_name,
  last_name: user.last_name,
  date_of_birth: user.date_of_birth,
  country: user.country || null,
  phone: user.phone || null,
  avatar_url: user.avatar_url || null,
  auth_provider: user.auth_provider || "email",
  role: user.role,
  status: user.status,
  email_verified: Boolean(user.email_verified),
  has_full_access: Boolean(user.has_full_access),
  partial_access: normalizePartialAccess(user.partial_access),
  current_level: user.current_level || NOT_SPECIFIED_LEVEL,
  target_level: user.target_level || null,
  marketing_emails_enabled: Boolean(user.marketing_emails_enabled),
  created_at: user.created_at,
  last_login_at: user.last_login_at,
});

const normalizePartialAccess = (value) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return [];
          }
        })()
      : [];

  const seen = new Set();
  return raw
    .map((item) => ({
      examId: String(item?.examId ?? item?.exam_id ?? "").trim().toLowerCase(),
      seriesId: String(item?.seriesId ?? item?.series_id ?? "").trim().toLowerCase(),
      seriesCode: String(item?.seriesCode ?? item?.series_code ?? "").trim(),
      examName: String(item?.examName ?? item?.exam_name ?? "").trim(),
      grantedAt: item?.grantedAt || item?.granted_at || new Date().toISOString(),
    }))
    .filter((item) => item.examId && item.seriesId)
    .filter((item) => {
      const key = `${item.examId}:${item.seriesId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
};

const normalizeSubscriptionLevel = (value) => {
  const level = String(value ?? "").trim().toUpperCase();
  return ["B1", "B2"].includes(level) ? level : "";
};

const normalizePlanKey = (value) => {
  const key = String(value ?? "").trim().toLowerCase();
  return ["starter", "standard", "intensif"].includes(key) ? key : "";
};

const normalizePaymentProvider = (value) => {
  const provider = String(value ?? "").trim().toLowerCase();
  if (provider === "notpay") return "notchpay";
  return ["stripe", "cinetpay", "notchpay", "manual"].includes(provider) ? provider : "manual";
};

const MOBILE_MONEY_COUNTRIES = {
  CM: {
    label: "Cameroun",
    dialCode: "237",
    currency: "XAF",
    providers: {
      mtn: {
        label: "MTN Mobile Money",
        channel: "cm.mtn",
        prefixes: [/^237(?:650|651|652|653|654|67\d|680|681|682|683)\d{6}$/],
      },
      orange: {
        label: "Orange Money",
        channel: "cm.orange",
        prefixes: [/^237(?:640|655|656|657|658|659|686|687|688|689|69\d)\d{6}$/],
      },
    },
  },
  CI: {
    label: "Côte d'Ivoire",
    dialCode: "225",
    currency: "XOF",
    providers: {
      mtn: { label: "MTN Mobile Money", channel: "ci.mtn", prefixes: [/^22505\d{8}$/] },
      orange: { label: "Orange Money", channel: "ci.orange", prefixes: [/^22507\d{8}$/] },
    },
  },
  SN: {
    label: "Sénégal",
    dialCode: "221",
    currency: "XOF",
    providers: {
      orange: { label: "Orange Money", channel: "sn.orange", prefixes: [/^22177\d{7}$/] },
    },
  },
};

const normalizeMobileMoneyProvider = (value) => {
  const provider = String(value ?? "").trim().toLowerCase();
  return ["mtn", "orange"].includes(provider) ? provider : "";
};

const normalizeMobileMoneyCountry = (value) => {
  const country = String(value ?? "").trim().toUpperCase();
  return MOBILE_MONEY_COUNTRIES[country] ? country : "";
};

const normalizePaymentStatus = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");

const isSuccessfulPaymentStatus = (value) =>
  [
    "complete",
    "completed",
    "success",
    "successful",
    "succeeded",
    "paid",
    "active",
    "approved",
    "accepted",
    "payment_complete",
    "payment_completed",
    "payment_success",
    "payment_successful",
  ].includes(normalizePaymentStatus(value));

const isFailedPaymentStatus = (value) =>
  [
    "failed",
    "failure",
    "cancelled",
    "canceled",
    "expired",
    "declined",
    "rejected",
    "refused",
    "aborted",
    "error",
    "insufficient_funds",
    "insufficient_balance",
    "payment_failed",
    "payment_cancelled",
    "payment_canceled",
    "payment_expired",
    "payment_declined",
  ].includes(normalizePaymentStatus(value));

const eurToNotchPayAmount = (amountEur, currency = NOTCHPAY_CURRENCY) => {
  const amount = Number(amountEur);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  if (["XAF", "XOF"].includes(String(currency).toUpperCase())) {
    return Math.round(amount * NOTCHPAY_XAF_PER_EUR);
  }
  return Number(amount.toFixed(2));
};

const buildNotchPayReference = (transactionId) =>
  `ndp_${Date.now()}_${transactionId}_${crypto.randomBytes(4).toString("hex")}`;

const normalizeMobileMoneyPhone = (rawPhone, countryCode) => {
  const country = MOBILE_MONEY_COUNTRIES[countryCode];
  if (!country) return "";
  const digits = String(rawPhone ?? "").replace(/[^\d]/g, "");
  if (!digits) return "";
  if (digits.startsWith(country.dialCode)) return `+${digits}`;
  if (countryCode === "CM" && /^6\d{8}$/.test(digits)) return `+237${digits}`;
  if (countryCode === "CI" && /^(05|07)\d{8}$/.test(digits)) return `+225${digits}`;
  if (countryCode === "SN" && /^77\d{7}$/.test(digits)) return `+221${digits}`;
  return `+${digits}`;
};

const validateMobileMoneySelection = ({ country, provider, phone }) => {
  const normalizedCountry = normalizeMobileMoneyCountry(country);
  const normalizedProvider = normalizeMobileMoneyProvider(provider);
  if (!normalizedCountry) {
    return { ok: false, error: "Pays Mobile Money non pris en charge." };
  }
  const countryConfig = MOBILE_MONEY_COUNTRIES[normalizedCountry];
  const providerConfig = countryConfig.providers[normalizedProvider];
  if (!normalizedProvider || !providerConfig) {
    return {
      ok: false,
      error: `Ce pays ne prend pas en charge ${normalizedProvider === "mtn" ? "MTN Mobile Money" : "Orange Money"} dans cette integration.`,
    };
  }
  const normalizedPhone = normalizeMobileMoneyPhone(phone, normalizedCountry);
  const digits = normalizedPhone.replace(/[^\d]/g, "");
  if (!providerConfig.prefixes.some((pattern) => pattern.test(digits))) {
    const otherProviderKey = Object.keys(countryConfig.providers).find((key) => key !== normalizedProvider);
    const otherProvider = otherProviderKey ? countryConfig.providers[otherProviderKey] : null;
    const belongsToOther = otherProvider?.prefixes?.some((pattern) => pattern.test(digits));
    const selectedLabel = providerConfig.label;
    const otherLabel = otherProvider?.label || "un autre operateur";
    return {
      ok: false,
      error: belongsToOther
        ? `Ce numero ne semble pas etre un numero ${selectedLabel}. Verifiez le numero ou selectionnez ${otherLabel}.`
        : `Ce numero ne semble pas etre valide pour ${selectedLabel}. Verifiez le format et le pays selectionne.`,
    };
  }
  return {
    ok: true,
    country: normalizedCountry,
    provider: normalizedProvider,
    phone: normalizedPhone,
    channel: providerConfig.channel,
    currency: countryConfig.currency,
    providerLabel: providerConfig.label,
    countryLabel: countryConfig.label,
  };
};

const safeJson = (value) => {
  try {
    return JSON.stringify(value ?? {});
  } catch {
    return "{}";
  }
};

const parseJsonBody = (value) => {
  if (!value) return {};
  if (typeof value === "object") return value;
  try {
    return JSON.parse(String(value));
  } catch {
    return {};
  }
};

const getNotchPayTransactionObject = (payload = {}) => {
  const body = parseJsonBody(payload);
  return body.transaction || body.data?.transaction || body.data || body.payment || body;
};

const collectPayloadValues = (value, keys, output = [], depth = 0) => {
  if (!value || depth > 5) return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectPayloadValues(item, keys, output, depth + 1));
    return output;
  }
  if (typeof value !== "object") return output;
  Object.entries(value).forEach(([key, item]) => {
    if (keys.includes(String(key).toLowerCase())) output.push(item);
    if (item && typeof item === "object") collectPayloadValues(item, keys, output, depth + 1);
  });
  return output;
};

const getNotchPayReferenceFromPayload = (payload = {}) => {
  const body = parseJsonBody(payload);
  const transaction = getNotchPayTransactionObject(body);
  return String(
    transaction.reference ||
      transaction.provider_reference ||
      body.reference ||
      body.transaction_reference ||
      body.payment_reference ||
      transaction.id ||
      ""
  ).trim();
};

const getNotchPayStatusFromPayload = (payload = {}) => {
  const body = parseJsonBody(payload);
  const transaction = getNotchPayTransactionObject(body);
  const directCandidates = [
    transaction.status,
    transaction.payment_status,
    transaction.transaction_status,
    transaction.gateway_status,
    body.status,
    body.payment_status,
    body.transaction_status,
    body.event,
    body.type,
  ];
  const recursiveCandidates = collectPayloadValues(body, [
    "status",
    "payment_status",
    "transaction_status",
    "gateway_status",
    "state",
  ]);
  const candidates = [...directCandidates, ...recursiveCandidates].map((item) => String(item || "").trim()).filter(Boolean);
  return candidates.find((item) => isSuccessfulPaymentStatus(item) || isFailedPaymentStatus(item)) || candidates[0] || "";
};

const getNotchPayMessageFromPayload = (payload = {}) => {
  const body = parseJsonBody(payload);
  const transaction = getNotchPayTransactionObject(body);
  const candidates = [
    body.message,
    body.error,
    body.description,
    body.reason,
    body.data?.message,
    body.data?.error,
    body.data?.reason,
    transaction.message,
    transaction.error,
    transaction.description,
    transaction.reason,
    transaction.failure_reason,
    transaction.gateway_response,
    ...collectPayloadValues(body, [
      "message",
      "error",
      "description",
      "reason",
      "failure_reason",
      "gateway_response",
      "processor_response",
      "response_message",
    ]),
  ];
  return candidates.map((item) => String(item || "").trim()).find(Boolean) || "";
};

const buildPaymentStatusMessage = (status, providerStatus, providerMessage = "") => {
  const statusText = normalizePaymentStatus(providerStatus || status);
  const detail = String(providerMessage || "").trim();
  const detailSuffix = detail ? ` Detail: ${detail}` : "";
  if (isSuccessfulPaymentStatus(statusText) || status === "succeeded") {
    return "Paiement confirme. Votre acces aux examens a ete active.";
  }
  if (statusText.includes("insufficient") || detail.toLowerCase().includes("insufficient")) {
    return `Paiement non confirme: solde insuffisant.${detailSuffix}`;
  }
  if (["cancelled", "canceled"].includes(statusText) || detail.toLowerCase().includes("cancel")) {
    return `Paiement annule.${detailSuffix}`;
  }
  if (isFailedPaymentStatus(statusText) || status === "failed") {
    return `Paiement non confirme ou echoue.${detailSuffix}`;
  }
  return detail
    ? `Paiement en attente de confirmation. ${detail}`
    : "Nous n'avons pas encore recu votre paiement. La confirmation peut prendre un court instant.";
};

const verifyNotchPaySignature = (rawBody, signature) => {
  if (!NOTCHPAY_WEBHOOK_HASH || !signature) return false;
  const payload = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody || ""));
  const expected = crypto.createHmac("sha256", NOTCHPAY_WEBHOOK_HASH).update(payload).digest("hex");
  const received = String(signature || "").replace(/^sha256=/i, "").trim();
  if (!received || expected.length !== received.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(received, "utf8"));
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const isTransientNotchPayError = (error) => {
  const status = Number(error?.status || error?.statusCode || 0);
  return !status || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
};

const notchPayRequestOnce = async (pathName, { method = "GET", body } = {}) => {
  if (!NOTCHPAY_PUBLIC_KEY) {
    const error = new Error("Notch Pay public key is not configured.");
    error.status = 503;
    throw error;
  }
  const headers = {
    Authorization: NOTCHPAY_PUBLIC_KEY,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (NOTCHPAY_SECRET_KEY) headers["X-Grant"] = NOTCHPAY_SECRET_KEY;
  const response = await fetch(`${NOTCHPAY_API_BASE_URL}${pathName}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const data = parseJsonBody(text);
  if (!response.ok) {
    const error = new Error(data.message || data.error || `Notch Pay request failed with status ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
};

const notchPayRequest = async (pathName, options = {}) => {
  const attempts = Number(options.attempts || 2);
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await notchPayRequestOnce(pathName, options);
    } catch (err) {
      lastError = err;
      if (attempt >= attempts || !isTransientNotchPayError(err)) break;
      await sleep(350 * attempt);
    }
  }
  throw lastError;
};

const createNotchPayPayment = async ({
  user,
  transactionId,
  reference,
  amountEur,
  plan,
  selectedCertifications,
  callbackBaseUrl,
  currency = NOTCHPAY_CURRENCY,
  lockedCountry = NOTCHPAY_LOCKED_COUNTRY,
  phone,
}) => {
  const paymentCurrency = String(currency || NOTCHPAY_CURRENCY).toUpperCase();
  const amount = eurToNotchPayAmount(amountEur, paymentCurrency);
  if (!amount) {
    const error = new Error("Invalid Notch Pay amount.");
    error.status = 400;
    throw error;
  }
  const callbackRoot = callbackBaseUrl
    ? `${normalizePublicUrl(callbackBaseUrl)}/api/payments/notchpay/callback`
    : NOTCHPAY_CALLBACK_URL;
  const callback = `${callbackRoot}?reference=${encodeURIComponent(reference)}`;
  const payload = {
    amount,
    currency: paymentCurrency,
    email: user.email,
    phone: phone || String(user.phone || "").replace(/[^\d]/g, "") || undefined,
    description: `N-Deutschpruefungen ${plan.level || "Enterprise"} ${plan.plan_name || plan.label || ""}`.trim(),
    reference,
    callback,
    locked_currency: paymentCurrency,
    locked_country: lockedCountry,
    customer_meta: {
      userId: user.id,
      transactionId,
      level: plan.level,
      planKey: plan.plan_key,
      selectedCertifications,
      amountEur,
      amount,
      currency: paymentCurrency,
    },
  };
  const session = await notchPayRequest("/payments", { method: "POST", body: payload });
  return { ...session, callback, notchAmount: amount, notchCurrency: paymentCurrency };
};

const retrieveNotchPayPayment = async (reference) =>
  notchPayRequest(`/payments/${encodeURIComponent(reference)}`);

const retrieveNotchPayPaymentWithFallback = async (references = []) => {
  const uniqueReferences = [...new Set(references.map((item) => String(item || "").trim()).filter(Boolean))];
  let lastError = null;
  for (const lookupReference of uniqueReferences) {
    try {
      const payment = await retrieveNotchPayPayment(lookupReference);
      return { payment, reference: lookupReference };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

const getRequestClientIp = (req) =>
  String(req.get("cf-connecting-ip") || req.get("x-real-ip") || req.get("x-forwarded-for") || req.ip || "")
    .split(",")[0]
    .trim();

const getNotchPayAuthorizationUrlFromPayload = (payload = {}) => {
  const body = parseJsonBody(payload);
  const transaction = getNotchPayTransactionObject(body);
  const candidates = [
    body.authorization_url,
    body.authorizationUrl,
    body.payment_url,
    body.paymentUrl,
    body.checkout_url,
    body.checkoutUrl,
    body.redirect_url,
    body.redirectUrl,
    body.link,
    body.url,
    body.data?.authorization_url,
    body.data?.payment_url,
    body.data?.checkout_url,
    body.data?.redirect_url,
    body.data?.link,
    transaction.authorization_url,
    transaction.payment_url,
    transaction.checkout_url,
    transaction.redirect_url,
    transaction.link,
    transaction.url,
  ];
  return candidates.map((item) => String(item || "").trim()).find(Boolean) || "";
};

const buildNotchPayProcessPayload = ({ channel, phone, clientIp }) => ({
  channel,
  data: {
    phone: Number(String(phone || "").replace(/[^\d]/g, "")),
    account_number: String(phone || "").replace(/[^\d]/g, ""),
    country: String(phone || "").replace(/[^\d]/g, "").startsWith("237") ? "CM" : undefined,
  },
  client_ip: clientIp || undefined,
});

const processNotchPayMobileMoneyPayment = async ({ reference, channel, phone, clientIp, method = "POST" }) =>
  notchPayRequest(`/payments/${encodeURIComponent(reference)}`, {
    method,
    body: buildNotchPayProcessPayload({ channel, phone, clientIp }),
  });

const processNotchPayMobileMoneyPaymentWithFallback = async ({ reference, channel, phone, clientIp }) => {
  let lastError = null;
  for (const method of ["POST", "PUT"]) {
    try {
      const result = await processNotchPayMobileMoneyPayment({ reference, channel, phone, clientIp, method });
      return { result, method };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError;
};

const startNotchPayMobileMoneyPrompt = async ({ references, channel, phone, clientIp }) => {
  const processReferences = [...new Set((references || []).filter(Boolean))];
  let lastProcessError = null;
  for (const processReference of processReferences) {
    try {
      const processed = await processNotchPayMobileMoneyPaymentWithFallback({
        reference: processReference,
        channel,
        phone,
        clientIp,
      });
      return {
        providerReference: processReference,
        processing: processed.result,
        processMethod: processed.method,
        providerStatus: getNotchPayStatusFromPayload(processed.result) || "processing",
      };
    } catch (err) {
      lastProcessError = err;
    }
  }
  throw lastProcessError;
};

const getNotchPayPromptErrorDetails = (err) => ({
  status: Number(err?.status || err?.statusCode || 0) || null,
  message:
    err?.data?.message ||
    err?.data?.error ||
    err?.message ||
    "Notch Pay Mobile Money prompt could not be started immediately.",
});

const updateNotchPayTransactionPromptMetadata = async ({
  transactionId,
  providerReference,
  merchantReference,
  authorizationUrl = "",
  notchPaySession = null,
  processing = null,
  processingError = null,
  providerStatus = "processing",
  processMethod = "",
  customerMessage,
}) =>
  pool.query(
    `UPDATE payment_transactions
        SET provider_reference = $2,
            status = 'processing',
            metadata = (metadata || ($3::jsonb - 'notchpay')) ||
              jsonb_build_object(
                'notchpay',
                COALESCE(metadata->'notchpay', '{}'::jsonb) || COALESCE($3::jsonb->'notchpay', '{}'::jsonb)
              ),
            updated_at = NOW()
      WHERE id = $1`,
    [
      transactionId,
      providerReference,
      safeJson({
        notchpay: {
          reference: providerReference,
          merchantReference,
          amount: notchPaySession?.notchAmount,
          currency: notchPaySession?.notchCurrency,
          authorizationUrl,
          callbackUrl: notchPaySession?.callback,
          transaction: notchPaySession ? getNotchPayTransactionObject(notchPaySession) : undefined,
          processing: processing ? getNotchPayTransactionObject(processing) : null,
          processingError,
          processMethod,
          providerStatus,
          promptRequestedAt: new Date().toISOString(),
        },
        customerMessage,
      }),
    ]
  );

const getEnterpriseBillingPlan = async (client = pool) => {
  const result = await client.query(
    `SELECT id, level, plan_key, plan_name, duration_days, price_eur, currency,
            writing_simulator_attempts, speaking_simulator_quota, certifications, unlocked_sections
       FROM subscription_plans
      WHERE level = 'B2' AND plan_key = 'intensif' AND is_active = TRUE
      LIMIT 1`
  );
  return result.rows[0] || null;
};

const mergeTransactionMetadata = (metadata, next) => ({
  ...asPlainObject(metadata),
  ...next,
});

const asPlainObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeStringArray = (value, allowed = []) => {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value);
          } catch {
            return [];
          }
        })()
      : [];
  const allowedSet = new Set(allowed.map((item) => String(item).toLowerCase()));
  return raw
    .map((item) => String(item ?? "").trim().toLowerCase())
    .map((item) => (item === "ösd" ? "osd" : item))
    .filter((item, index, arr) => item && (!allowedSet.size || allowedSet.has(item)) && arr.indexOf(item) === index);
};

const mapSubscriptionRow = (row) => ({
  id: row.id,
  planId: row.plan_id,
  level: row.level,
  planKey: row.plan_key,
  planName: row.plan_name,
  status: row.status,
  startsAt: row.starts_at,
  expiresAt: row.expires_at,
  durationDays: Number(row.duration_days ?? 0),
  priceEur: Number(row.price_eur ?? row.amount_paid ?? 0),
  basePriceEur: Number(row.price_eur ?? 0),
  finalPriceEur: Number(row.amount_paid ?? 0),
  currency: row.currency || "EUR",
  selectedCertifications: normalizeStringArray(row.selected_certifications, SUBSCRIPTION_CERTIFICATIONS),
  certifications: normalizeStringArray(row.selected_certifications, SUBSCRIPTION_CERTIFICATIONS),
  unlockedSections: normalizeStringArray(row.unlocked_sections, SUBSCRIPTION_SECTIONS),
  writingSimulatorAttempts: Number(row.writing_simulator_attempts ?? 0),
  writingAttemptsUsed: Number(row.writing_attempts_used ?? 0),
  writingAttemptsRemaining: Math.max(
    0,
    Number(row.writing_simulator_attempts ?? 0) - Number(row.writing_attempts_used ?? 0)
  ),
  speakingSimulatorQuota: Number(row.speaking_simulator_quota_override ?? row.speaking_simulator_quota ?? 0),
  planCategory: row.plan_category || "standard",
});

const getActiveSubscriptionsForUser = async (userId) => {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) return [];
  const result = await pool.query(
    `SELECT us.id, us.plan_id, us.level, us.plan_key, us.status, us.starts_at, us.expires_at,
            us.amount_paid, us.currency, us.selected_certifications,
            us.speaking_simulator_quota_override,
            sp.plan_name, sp.duration_days, sp.price_eur, sp.writing_simulator_attempts,
            sp.speaking_simulator_quota, sp.plan_category,
            sp.unlocked_sections,
            COALESCE(wsu.attempts_used, 0) AS writing_attempts_used
     FROM user_subscriptions us
     JOIN subscription_plans sp ON sp.id = us.plan_id
     LEFT JOIN writing_simulator_usage wsu ON wsu.subscription_id = us.id AND wsu.user_id = us.user_id
     WHERE us.user_id = $1
       AND us.status = 'active'
       AND us.starts_at <= NOW()
       AND us.expires_at > NOW()
       AND sp.is_active = TRUE
     ORDER BY us.expires_at DESC`,
    [Number(userId)]
  );
  return result.rows.map(mapSubscriptionRow);
};

const getActiveSubscriptionsForUserLevel = async (userId, level) => {
  const normalizedLevel = normalizeSubscriptionLevel(level);
  if (!normalizedLevel) return [];
  const subscriptions = await getActiveSubscriptionsForUser(Number(userId));
  return subscriptions.filter((subscription) => subscription.level === normalizedLevel);
};

const getActiveSubscriptionForUser = async (userId, level, certification = "") => {
  const subscriptions = await getActiveSubscriptionsForUserLevel(userId, level);
  const cert = normalizeStringArray([certification], SUBSCRIPTION_CERTIFICATIONS)[0] || "";
  if (!cert) return subscriptions[0] ?? null;
  return subscriptions.find((subscription) => subscription.certifications.includes(cert)) ?? null;
};

const sanitizeUserWithSubscriptions = async (user) => ({
  ...sanitizeUser(user),
  active_subscriptions: await getActiveSubscriptionsForUser(Number(user?.id)),
});

const userHasSubscriptionAccess = (user, subscription, certification, section) => {
  if (!user?.id) return false;
  if (user.role === "admin" || user.has_full_access || user.hasFullAccess) return true;
  if (!subscription) return false;
  const cert = normalizeStringArray([certification], SUBSCRIPTION_CERTIFICATIONS)[0] || "";
  const unlockedSection = String(section ?? "").trim().toLowerCase();
  return (
    (!cert || subscription.certifications.includes(cert)) &&
    (!unlockedSection || subscription.unlockedSections.includes(unlockedSection))
  );
};

const activateSubscriptionFromTransaction = async ({ providerReference, providerPayload = {}, eventType = "" }) => {
  const reference = String(providerReference || "").trim();
  if (!reference) return { activated: false, reason: "missing_reference" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const transactionResult = await client.query(
      `SELECT pt.id, pt.user_id, pt.plan_id, pt.provider, pt.provider_reference, pt.status,
              pt.amount, pt.currency, pt.selected_certifications, pt.metadata,
              sp.level, sp.plan_key, sp.duration_days, sp.writing_simulator_attempts,
              sp.speaking_simulator_quota
        FROM payment_transactions pt
         JOIN subscription_plans sp ON sp.id = pt.plan_id
        WHERE pt.provider_reference = $1
           OR pt.metadata #>> '{notchpay,merchantReference}' = $1
           OR pt.metadata #>> '{notchpay,reference}' = $1
        FOR UPDATE`,
      [reference]
    );
    const transaction = transactionResult.rows[0];
    if (!transaction) {
      await client.query("ROLLBACK");
      return { activated: false, reason: "transaction_not_found" };
    }
    const transactionMetadata = asPlainObject(transaction.metadata);

    const metadata = mergeTransactionMetadata(transaction.metadata, {
      lastProviderEvent: eventType || null,
      lastProviderPayload: providerPayload,
      paidAt: new Date().toISOString(),
    });
    await client.query(
      `UPDATE payment_transactions
          SET status = 'succeeded',
              metadata = $2::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [transaction.id, safeJson(metadata)]
    );

    const isEnterprisePayment = transactionMetadata.offerType === "enterprise";
    if (isEnterprisePayment) {
      const enterpriseOffer = asPlainObject(transactionMetadata.enterpriseOffer);
      const levels = ["B1", "B2"];
      const existingEnterprise = await client.query(
        `SELECT id
           FROM user_subscriptions
          WHERE payment_provider = $1
            AND payment_reference = ANY($2::text[])
          LIMIT 1`,
        [transaction.provider, levels.map((level) => `${reference}:${level}`)]
      );
      if (existingEnterprise.rows[0]) {
        await client.query("COMMIT");
        return { activated: false, reason: "already_active", subscriptionId: existingEnterprise.rows[0].id };
      }

      const selectedCertifications = normalizeStringArray(
        transactionMetadata.selectedCertifications || transaction.selected_certifications,
        SUBSCRIPTION_CERTIFICATIONS
      );
      if (!selectedCertifications.length) {
        await client.query("ROLLBACK");
        return { activated: false, reason: "missing_selected_certifications" };
      }

      const createdSubscriptions = [];
      for (const level of levels) {
        const levelPlan = await client.query(
          `SELECT id, plan_key, writing_simulator_attempts
             FROM subscription_plans
            WHERE level = $1 AND plan_key = 'intensif' AND is_active = TRUE
            LIMIT 1`,
          [level]
        );
        const planRow = levelPlan.rows[0];
        if (!planRow) {
          await client.query("ROLLBACK");
          return { activated: false, reason: `missing_${level.toLowerCase()}_enterprise_plan` };
        }
        const subscriptionResult = await client.query(
          `INSERT INTO user_subscriptions (
             user_id, plan_id, level, plan_key, status, starts_at, expires_at,
             payment_provider, payment_reference, selected_certifications, amount_paid,
             currency, speaking_simulator_quota_override, grant_reason
           )
           VALUES (
             $1, $2, $3, $4, 'active', NOW(), NOW() + ($5::int * INTERVAL '1 day'),
             $6, $7, $8::jsonb, $9, $10, $11, $12
           )
           RETURNING id`,
          [
            transaction.user_id,
            planRow.id,
            level,
            planRow.plan_key,
            Number(enterpriseOffer.durationDays || transactionMetadata.durationDays || 30),
            transaction.provider,
            `${reference}:${level}`,
            JSON.stringify(selectedCertifications),
            Number(transaction.amount),
            transaction.currency,
            Number(enterpriseOffer.speakingSimulatorQuota || transactionMetadata.speakingSimulatorQuota || 0),
            "Notch Pay verified enterprise payment",
          ]
        );
        const subscriptionId = subscriptionResult.rows[0].id;
        createdSubscriptions.push(subscriptionId);
        await client.query(
          `INSERT INTO writing_simulator_usage (user_id, subscription_id, level, attempts_allowed, attempts_used)
           VALUES ($1, $2, $3, $4, 0)
           ON CONFLICT (user_id, subscription_id, level)
           DO UPDATE SET attempts_allowed = EXCLUDED.attempts_allowed, updated_at = NOW()`,
          [transaction.user_id, subscriptionId, level, Number(planRow.writing_simulator_attempts ?? 10)]
        );
        await client.query(
          `INSERT INTO subscription_admin_events (subscription_id, user_id, action, details)
           VALUES ($1, $2, 'notchpay_enterprise_payment_activated', $3::jsonb)`,
          [
            subscriptionId,
            transaction.user_id,
            safeJson({ providerReference: reference, transactionId: transaction.id, eventType, enterpriseOffer }),
          ]
        );
      }
      await client.query("COMMIT");
      return { activated: true, subscriptionIds: createdSubscriptions, transactionId: transaction.id, enterprise: true };
    }

    const existing = await client.query(
      `SELECT id
         FROM user_subscriptions
        WHERE payment_provider = $1
          AND payment_reference = $2
        LIMIT 1`,
      [transaction.provider, reference]
    );
    if (existing.rows[0]) {
      await client.query("COMMIT");
      return { activated: false, reason: "already_active", subscriptionId: existing.rows[0].id };
    }

    const selectedCertifications = normalizeStringArray(transaction.selected_certifications, SUBSCRIPTION_CERTIFICATIONS);
    if (!selectedCertifications.length) {
      await client.query("ROLLBACK");
      return { activated: false, reason: "missing_selected_certifications" };
    }

    const subscriptionResult = await client.query(
      `INSERT INTO user_subscriptions (
         user_id, plan_id, level, plan_key, status, starts_at, expires_at,
         payment_provider, payment_reference, selected_certifications, amount_paid,
         currency, speaking_simulator_quota_override, grant_reason
       )
       VALUES (
         $1, $2, $3, $4, 'active', NOW(), NOW() + ($5::int * INTERVAL '1 day'),
         $6, $7, $8::jsonb, $9, $10, $11, $12
       )
       RETURNING id`,
      [
        transaction.user_id,
        transaction.plan_id,
        transaction.level,
        transaction.plan_key,
        Number(transaction.duration_days),
        transaction.provider,
        reference,
        JSON.stringify(selectedCertifications),
        Number(transaction.amount),
        transaction.currency,
        Number(transaction.speaking_simulator_quota ?? 0),
        "Notch Pay verified payment",
      ]
    );
    const subscriptionId = subscriptionResult.rows[0].id;
    await client.query(
      `INSERT INTO writing_simulator_usage (user_id, subscription_id, level, attempts_allowed, attempts_used)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (user_id, subscription_id, level)
       DO UPDATE SET attempts_allowed = EXCLUDED.attempts_allowed, updated_at = NOW()`,
      [
        transaction.user_id,
        subscriptionId,
        transaction.level,
        Number(transaction.writing_simulator_attempts ?? 0),
      ]
    );
    await client.query(
      `INSERT INTO subscription_admin_events (subscription_id, user_id, action, details)
       VALUES ($1, $2, 'notchpay_payment_activated', $3::jsonb)`,
      [
        subscriptionId,
        transaction.user_id,
        safeJson({ providerReference: reference, transactionId: transaction.id, eventType }),
      ]
    );
    await client.query("COMMIT");
    return { activated: true, subscriptionId, transactionId: transaction.id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

const cleanPublicText = (value, max = 1000) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);

const stripHtmlForValidation = (value) =>
  String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const pushValidationFlag = (flags, severity, code, message, entityType, entityId = null) => {
  flags.push({ severity, code, message, entityType, entityId });
};

const buildExamContentValidation = async (examId) => {
  const [examResult, sectionResult, questionResult, audioResult] = await Promise.all([
    pool.query(`SELECT id, code, name, section_type, level, provider FROM exams WHERE id = $1`, [examId]),
    pool.query(`SELECT id, title, instructions, section_type, part_number FROM exam_sections WHERE exam_id = $1 ORDER BY position, id`, [examId]),
    pool.query(`SELECT id, section_id, prompt, question_type, options, correct_answer, transcript, position FROM exam_questions WHERE exam_id = $1 ORDER BY position, id`, [examId]),
    pool.query(
      `SELECT id, title, admin_transcript, audio_generation_status, validation_warnings
         FROM exam_listening_audio_items
        WHERE exam_id = $1
        ORDER BY part_number, item_number, id`,
      [examId]
    ).catch(() => ({ rows: [] })),
  ]);
  const exam = examResult.rows[0];
  if (!exam) return null;
  const flags = [];
  if (!sectionResult.rows.length) {
    pushValidationFlag(flags, "error", "missing_sections", "No sections are attached to this exam.", "exam", exam.id);
  }
  if (!questionResult.rows.length) {
    pushValidationFlag(flags, "error", "missing_questions", "No questions are attached to this exam.", "exam", exam.id);
  }
  sectionResult.rows.forEach((section) => {
    if (!stripHtmlForValidation(section.title)) {
      pushValidationFlag(flags, "warning", "empty_section_title", "A section has no title.", "section", section.id);
    }
    if (!stripHtmlForValidation(section.instructions)) {
      pushValidationFlag(flags, "warning", "empty_section_instructions", "A section has no visible instructions.", "section", section.id);
    }
    if (String(section.instructions || "").split("\n").filter((line) => line.trim().length <= 2).length >= 5) {
      pushValidationFlag(flags, "warning", "unusual_line_breaks", "Section instructions contain unusual short line breaks.", "section", section.id);
    }
  });
  questionResult.rows.forEach((question) => {
    const prompt = stripHtmlForValidation(question.prompt);
    const options = Array.isArray(question.options) ? question.options : [];
    const answer = question.correct_answer && typeof question.correct_answer === "object" ? question.correct_answer : {};
    if (!prompt) pushValidationFlag(flags, "error", "empty_question_prompt", "A question has no prompt.", "question", question.id);
    if (["multiple_choice", "matching", "true_false", "yes_no"].includes(question.question_type) && options.length < 2) {
      pushValidationFlag(flags, "warning", "missing_options", "A question appears to need answer options but has fewer than two.", "question", question.id);
    }
    const optionValues = new Set(options.map((option) => String(option?.value ?? option?.id ?? option?.key ?? "").trim()).filter(Boolean));
    const answerValue = String(answer.value ?? answer.answer ?? answer.correct ?? "").trim();
    if (answerValue && optionValues.size && !optionValues.has(answerValue)) {
      pushValidationFlag(flags, "warning", "answer_option_mismatch", "A correction value does not match any visible option value.", "question", question.id);
    }
  });
  if (String(exam.section_type).toLowerCase() === "listen") {
    audioResult.rows.forEach((item) => {
      if (!stripHtmlForValidation(item.admin_transcript)) {
        pushValidationFlag(flags, "error", "missing_audio_transcript", "A listening audio item has no transcript for playback generation.", "audio_item", item.id);
      }
      if (item.audio_generation_status !== "published") {
        pushValidationFlag(flags, "warning", "audio_not_published", "A listening audio item is not published yet.", "audio_item", item.id);
      }
      const warnings = Array.isArray(item.validation_warnings) ? item.validation_warnings : [];
      warnings.forEach((warning, index) => {
        pushValidationFlag(flags, "warning", `audio_warning_${index + 1}`, String(warning), "audio_item", item.id);
      });
    });
  }
  return {
    exam,
    flags,
    counts: {
      errors: flags.filter((flag) => flag.severity === "error").length,
      warnings: flags.filter((flag) => flag.severity !== "error").length,
      sections: sectionResult.rows.length,
      questions: questionResult.rows.length,
      audioItems: audioResult.rows.length,
    },
  };
};

const getClientIp = (req) =>
  String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim()
    .slice(0, 80);

const signAccessToken = (user) => {
  const jti = crypto.randomUUID();
  const token = jwt.sign(
    {
      id: user.id,
      sub: String(user.id),
      email: user.email,
      role: user.role,
    },
    JWT_SECRET,
    {
      expiresIn: ACCESS_TOKEN_EXPIRES_IN,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      jwtid: jti,
    }
  );

  return { token, expiresIn: ACCESS_TOKEN_EXPIRES_IN, jti };
};

const setRefreshCookie = (res, refreshToken) => {
  res.cookie(REFRESH_COOKIE_NAME, refreshToken, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SECURE ? "none" : "lax",
    maxAge: REFRESH_MAX_AGE_MS,
    path: "/",
  });
};

const clearRefreshCookie = (res) => {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: COOKIE_SECURE,
    sameSite: COOKIE_SECURE ? "none" : "lax",
    path: "/",
  });
};

const createRefreshSession = async (userId, req) => {
  const refreshToken = makeToken();
  const expiresAt = new Date(Date.now() + REFRESH_MAX_AGE_MS);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5)`,
    [
      userId,
      tokenHash(refreshToken),
      expiresAt,
      String(req.get("user-agent") || "").slice(0, 500),
      getClientIp(req),
    ]
  );
  return refreshToken;
};

const issueAuthTokens = async (user, req, res) => {
  const access = signAccessToken(user);
  const refreshToken = await createRefreshSession(user.id, req);
  setRefreshCookie(res, refreshToken);
  return access;
};

const revokeAccessToken = async (token) => {
  if (!token) return;
  const payload = jwt.decode(token);
  if (!payload?.jti) return;

  const expiresAt = payload.exp ? new Date(payload.exp * 1000) : new Date(Date.now() + 15 * 60 * 1000);
  await pool.query(
    `INSERT INTO revoked_tokens (jti, user_id, expires_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (jti) DO NOTHING`,
    [payload.jti, Number(payload.sub ?? payload.id) || null, expiresAt]
  );
};

const logUserAction = async (userId, action, req) => {
  try {
    await pool.query(
      `INSERT INTO logs (user_id, action, ip_address) VALUES ($1, $2, $3)`,
      [userId ?? null, action, getClientIp(req)]
    );
  } catch (err) {
    console.error("System log failed", err);
  }
};

const getMailer = () => {
  const host = process.env.EMAIL_SMTP_HOST || process.env.SMTP_HOST;
  const port = Number(process.env.EMAIL_SMTP_PORT || process.env.SMTP_PORT || 587);
  const user =
    process.env.EMAIL_SMTP_USER ||
    process.env.SMTP_USER ||
    process.env.CONTACT_SMTP_USER;
  const pass =
    process.env.EMAIL_SMTP_PASS ||
    process.env.SMTP_PASS ||
    process.env.CONTACT_SMTP_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
  }

  if (user && pass) {
    return nodemailer.createTransport({
      service: "gmail",
      auth: { user, pass },
    });
  }

  return null;
};

const sendTransactionalEmail = async ({ to, subject, text, html }) => {
  const transporter = getMailer();
  const from =
    process.env.EMAIL_FROM ||
    process.env.CONTACT_SMTP_USER ||
    "no-reply@german-exam-app.local";

  if (!transporter) {
    console.log(`[email disabled] ${subject} -> ${to}\n${text}`);
    return { sent: false };
  }

  await transporter.sendMail({
    from: `"Deutsch Prüfungen" <${from}>`,
    to,
    subject,
    text,
    html,
  });
  return { sent: true };
};

const sendVerificationEmail = async (user, token) => {
  const link = `${FRONTEND_URL.replace(/\/$/, "")}/verify-email/${token}`;
  await sendTransactionalEmail({
    to: user.email,
    subject: "Confirmez votre adresse email",
    text: [
      `Bonjour ${user.first_name || user.username || ""},`,
      "",
      "Confirmez votre adresse email pour activer votre compte Deutsch Prüfungen.",
      link,
      "",
      `Ce lien expire dans ${VERIFICATION_HOURS} heures.`,
    ].join("\n"),
    html: `<p>Confirmez votre adresse email pour activer votre compte Deutsch Prüfungen.</p><p><a href="${link}">Confirmer mon email</a></p><p>Ce lien expire dans ${VERIFICATION_HOURS} heures.</p>`,
  });
  return link;
};

const sendResetEmail = async (user, token) => {
  const link = `${FRONTEND_URL.replace(/\/$/, "")}/reset-password/${token}`;
  await sendTransactionalEmail({
    to: user.email,
    subject: "Réinitialisation de votre mot de passe",
    text: [
      `Bonjour ${user.first_name || user.username || ""},`,
      "",
      "Utilisez ce lien pour réinitialiser votre mot de passe Deutsch Prüfungen.",
      link,
      "",
      `Ce lien expire dans ${RESET_MINUTES} minutes. Si vous n'avez rien demandé, ignorez ce message.`,
    ].join("\n"),
    html: `<p>Utilisez ce lien pour réinitialiser votre mot de passe Deutsch Prüfungen.</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p><p>Ce lien expire dans ${RESET_MINUTES} minutes.</p>`,
  });
  return link;
};

const buildFrontendUrl = (pathName, params = {}, overrideEnvName = "") => {
  const configuredUrl = overrideEnvName ? normalizePublicUrl(process.env[overrideEnvName]) : "";
  const url = configuredUrl
    ? new URL(configuredUrl)
    : new URL(pathName, `${getAppBaseUrl()}/`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return url.toString();
};

const sendVerificationCodeEmail = async (user, token, code) => {
  const verifyUrl = buildFrontendUrl("/verify-email", { email: user.email }, "VERIFY_EMAIL_URL");
  const legacyLink = buildFrontendUrl(`/verify-email/${token}`);
  const email = renderVerificationEmail({ user, code, verifyUrl });
  await sendEmail({
    pool,
    userId: user.id,
    to: user.email,
    type: "verification",
    subject: email.subject,
    text: `${email.text}\n\nLien de secours : ${legacyLink}`,
    html: email.html,
    idempotencyKey: `verify-${user.id}-${tokenHash(token).slice(0, 16)}`,
    metadata: { verifyUrl, legacyLink, expiresMinutes: VERIFICATION_CODE_MINUTES },
  });
  return { verifyUrl, legacyLink };
};

const sendPasswordResetEmail = async (user, token) => {
  const resetUrl = buildFrontendUrl("/reset-password", { token }, "RESET_PASSWORD_URL");
  const email = renderResetPasswordEmail({ user, resetUrl });
  await sendEmail({
    pool,
    userId: user.id,
    to: user.email,
    type: "password_reset",
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `reset-${user.id}-${tokenHash(token).slice(0, 16)}`,
    metadata: { resetUrl, expiresMinutes: RESET_MINUTES },
  });
  return resetUrl;
};

const sendWelcomeEmailOnce = async (user) => {
  if (!user?.id || user.welcome_email_sent_at) return false;
  const claimed = await pool.query(
    `UPDATE users
     SET welcome_email_sent_at = NOW()
     WHERE id = $1
       AND welcome_email_sent_at IS NULL
     RETURNING id, email, username, first_name, welcome_email_sent_at`,
    [user.id]
  );
  const row = claimed.rows[0];
  if (!row) return false;
  const email = renderWelcomeEmail({ user: row });
  await sendEmail({
    pool,
    userId: row.id,
    to: row.email,
    type: "welcome",
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `welcome-${row.id}`,
  });
  return true;
};

const sendPasswordChangedNoticeEmail = async (user) => {
  const email = renderPasswordChangedEmail({ user });
  await sendEmail({
    pool,
    userId: user.id,
    to: user.email,
    type: "password_changed",
    subject: email.subject,
    text: email.text,
    html: email.html,
    idempotencyKey: `password-changed-${user.id}-${Date.now()}`,
  });
};

async function ensureSchema() {
  await pool.query(`
    DO $$
    BEGIN
      CREATE TYPE user_role AS ENUM ('user', 'admin');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      CREATE TYPE account_status AS ENUM ('active', 'suspended');
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      username TEXT UNIQUE,
      first_name TEXT,
      last_name TEXT,
      date_of_birth DATE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS date_of_birth DATE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS country TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS phone TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'email';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS google_sub TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_token_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_expires_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS verification_code_expires_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_verification_email_sent_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS welcome_email_sent_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_emails_enabled BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_unsubscribed_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_full_access BOOLEAN NOT NULL DEFAULT FALSE;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS partial_access JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS current_level TEXT NOT NULL DEFAULT 'Not specified';`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS target_level TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS level_updated_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS suspended_at TIMESTAMPTZ;`);
  await pool.query(`UPDATE users SET role = 'user' WHERE role IS NULL OR role::text NOT IN ('user', 'admin');`);
  await pool.query(`UPDATE users SET status = 'active' WHERE status IS NULL OR status::text NOT IN ('active', 'suspended');`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role DROP DEFAULT;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::text::user_role;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN role SET DEFAULT 'user';`);
  await pool.query(`ALTER TABLE users ALTER COLUMN status DROP DEFAULT;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN status TYPE account_status USING status::text::account_status;`);
  await pool.query(`ALTER TABLE users ALTER COLUMN status SET DEFAULT 'active';`);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique_idx
      ON users(username)
      WHERE username IS NOT NULL;
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub_unique_idx
      ON users(google_sub)
      WHERE google_sub IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_role_status_idx
      ON users(role, status);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_verification_token_idx
      ON users(verification_token_hash)
      WHERE verification_token_hash IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_verification_code_idx
      ON users(verification_code_hash)
      WHERE verification_code_hash IS NOT NULL;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS users_reset_token_idx
      ON users(reset_token_hash)
      WHERE reset_token_hash IS NOT NULL;
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS simulations (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      exam_name TEXT NOT NULL,
      taken_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      score_pct INTEGER NOT NULL CHECK (score_pct >= 0 AND score_pct <= 100),
      level_current TEXT,
      level_target TEXT,
      ai_corrections JSONB NOT NULL DEFAULT '{}'::jsonb
    );
  `);
  await pool.query(`ALTER TABLE simulations ADD COLUMN IF NOT EXISTS result_details JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE simulations ADD COLUMN IF NOT EXISTS duration_seconds INTEGER;`);
  await pool.query(`ALTER TABLE simulations ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();`);
  await pool.query(`UPDATE simulations SET created_at = taken_at WHERE created_at IS NULL;`);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS simulations_user_taken_at_idx
      ON simulations(user_id, taken_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS simulations_user_created_at_idx
      ON simulations(user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_plans (
      id SERIAL PRIMARY KEY,
      level TEXT NOT NULL CHECK (level IN ('B1', 'B2')),
      plan_key TEXT NOT NULL CHECK (plan_key IN ('starter', 'standard', 'intensif')),
      plan_name TEXT NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days > 0),
      price_eur NUMERIC(10,2) NOT NULL CHECK (price_eur >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      writing_simulator_attempts INTEGER NOT NULL CHECK (writing_simulator_attempts >= 0),
      certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      unlocked_sections JSONB NOT NULL DEFAULT '[]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(level, plan_key)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS user_subscriptions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      level TEXT NOT NULL CHECK (level IN ('B1', 'B2')),
      plan_key TEXT NOT NULL CHECK (plan_key IN ('starter', 'standard', 'intensif')),
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'failed')),
      starts_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      payment_provider TEXT NOT NULL DEFAULT 'manual',
      payment_reference TEXT,
      selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      amount_paid NUMERIC(10,2) NOT NULL DEFAULT 0,
      currency TEXT NOT NULL DEFAULT 'EUR',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS writing_simulator_usage (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      subscription_id INTEGER NOT NULL REFERENCES user_subscriptions(id) ON DELETE CASCADE,
      level TEXT NOT NULL CHECK (level IN ('B1', 'B2')),
      attempts_allowed INTEGER NOT NULL CHECK (attempts_allowed >= 0),
      attempts_used INTEGER NOT NULL DEFAULT 0 CHECK (attempts_used >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, subscription_id, level)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      plan_id INTEGER NOT NULL REFERENCES subscription_plans(id) ON DELETE RESTRICT,
      provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('stripe', 'cinetpay', 'notchpay', 'notpay', 'manual')),
      provider_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'active', 'expired', 'cancelled', 'failed', 'succeeded')),
      amount NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`ALTER TABLE payment_transactions ADD COLUMN IF NOT EXISTS selected_certifications JSONB NOT NULL DEFAULT '[]'::jsonb;`);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_provider_check;
      ALTER TABLE payment_transactions
        ADD CONSTRAINT payment_transactions_provider_check
        CHECK (provider IN ('stripe', 'cinetpay', 'notchpay', 'notpay', 'manual'));
    END $$;
  `);
  await pool.query(`
    DO $$
    BEGIN
      ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_status_check;
      ALTER TABLE payment_transactions
        ADD CONSTRAINT payment_transactions_status_check
        CHECK (status IN ('pending', 'processing', 'active', 'expired', 'cancelled', 'failed', 'succeeded'));
    END $$;
  `);
  await pool.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS speaking_simulator_quota INTEGER NOT NULL DEFAULT 0;`);
  await pool.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS plan_category TEXT NOT NULL DEFAULT 'standard';`);
  await pool.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS access_months INTEGER;`);
  await pool.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS billed_months INTEGER;`);
  await pool.query(`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;`);
  await pool.query(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS speaking_simulator_quota_override INTEGER;`);
  await pool.query(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS revoked_by INTEGER REFERENCES users(id) ON DELETE SET NULL;`);
  await pool.query(`ALTER TABLE user_subscriptions ADD COLUMN IF NOT EXISTS grant_reason TEXT;`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS industrial_subscription_offers (
      id SERIAL PRIMARY KEY,
      offer_key TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      duration_days INTEGER NOT NULL CHECK (duration_days > 0),
      access_months INTEGER NOT NULL CHECK (access_months > 0),
      billed_months INTEGER NOT NULL CHECK (billed_months > 0),
      price_eur NUMERIC(10,2) NOT NULL CHECK (price_eur >= 0),
      currency TEXT NOT NULL DEFAULT 'EUR',
      speaking_simulator_quota INTEGER NOT NULL CHECK (speaking_simulator_quota >= 0),
      certifications JSONB NOT NULL DEFAULT '["goethe","osd","telc","ecl"]'::jsonb,
      unlocked_sections JSONB NOT NULL DEFAULT '["read","listen","speak","write"]'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS subscription_admin_events (
      id SERIAL PRIMARY KEY,
      subscription_id INTEGER REFERENCES user_subscriptions(id) ON DELETE SET NULL,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      admin_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_subscriptions_user_level_status_idx
      ON user_subscriptions(user_id, level, status, expires_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS user_subscriptions_selected_certifications_idx
      ON user_subscriptions USING GIN (selected_certifications);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS writing_simulator_usage_user_level_idx
      ON writing_simulator_usage(user_id, level);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS payment_transactions_user_created_idx
      ON payment_transactions(user_id, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS payment_transactions_provider_reference_idx
      ON payment_transactions(provider, provider_reference);
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS user_subscriptions_payment_reference_unique_idx
      ON user_subscriptions(payment_provider, payment_reference)
      WHERE payment_reference IS NOT NULL;
  `);
  await pool.query(`ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE writing_simulator_usage ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE industrial_subscription_offers ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE subscription_admin_events ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`
    DO $$
    BEGIN
      CREATE POLICY subscription_plans_read_active
        ON subscription_plans
        FOR SELECT
        USING (is_active = TRUE);
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$;
  `);
  for (const plan of SUBSCRIPTION_PLAN_SEEDS) {
    await pool.query(
      `INSERT INTO subscription_plans (
         level, plan_key, plan_name, duration_days, price_eur, currency,
         writing_simulator_attempts, speaking_simulator_quota, certifications, unlocked_sections,
         plan_category, access_months, billed_months, metadata, is_active, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'EUR', $6, $7, $8::jsonb, $9::jsonb,
               'standard', NULL, NULL, $10::jsonb, TRUE, NOW())
       ON CONFLICT (level, plan_key)
       DO UPDATE SET
         plan_name = EXCLUDED.plan_name,
         duration_days = EXCLUDED.duration_days,
         price_eur = EXCLUDED.price_eur,
         currency = EXCLUDED.currency,
         writing_simulator_attempts = EXCLUDED.writing_simulator_attempts,
         speaking_simulator_quota = EXCLUDED.speaking_simulator_quota,
         certifications = EXCLUDED.certifications,
         unlocked_sections = EXCLUDED.unlocked_sections,
         plan_category = EXCLUDED.plan_category,
         access_months = EXCLUDED.access_months,
         billed_months = EXCLUDED.billed_months,
         metadata = EXCLUDED.metadata,
         is_active = TRUE,
         updated_at = NOW()`,
      [
        plan.level,
        plan.planKey,
        plan.planName,
        plan.durationDays,
        plan.priceEur,
        plan.writingSimulatorAttempts,
        SUBSCRIPTION_SPEAKING_QUOTAS[plan.planKey] ?? 0,
        JSON.stringify(SUBSCRIPTION_CERTIFICATIONS),
        JSON.stringify(SUBSCRIPTION_SECTIONS),
        JSON.stringify({
          speakingSimulatorQuota: SUBSCRIPTION_SPEAKING_QUOTAS[plan.planKey] ?? 0,
        }),
      ]
    );
  }
  for (const offer of INDUSTRIAL_OFFERS) {
    await pool.query(
      `INSERT INTO industrial_subscription_offers (
         offer_key, label, duration_days, access_months, billed_months, price_eur,
         speaking_simulator_quota, certifications, unlocked_sections, is_active, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, TRUE, NOW())
       ON CONFLICT (offer_key)
       DO UPDATE SET
         label = EXCLUDED.label,
         duration_days = EXCLUDED.duration_days,
         access_months = EXCLUDED.access_months,
         billed_months = EXCLUDED.billed_months,
         price_eur = EXCLUDED.price_eur,
         speaking_simulator_quota = EXCLUDED.speaking_simulator_quota,
         certifications = EXCLUDED.certifications,
         unlocked_sections = EXCLUDED.unlocked_sections,
         is_active = TRUE,
         updated_at = NOW()`,
      [
        offer.offerKey,
        offer.label,
        offer.durationDays,
        offer.accessMonths,
        offer.billedMonths,
        offer.priceEur,
        offer.speakingSimulatorQuota,
        JSON.stringify(SUBSCRIPTION_CERTIFICATIONS),
        JSON.stringify(SUBSCRIPTION_SECTIONS),
      ]
    );
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS refresh_tokens (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ,
      replaced_by_token_hash TEXT,
      user_agent TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS refresh_tokens_user_active_idx
      ON refresh_tokens(user_id, expires_at DESC)
      WHERE revoked_at IS NULL;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS revoked_tokens (
      jti TEXT PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      revoked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS revoked_tokens_expires_idx
      ON revoked_tokens(expires_at);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_usage_logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER NOT NULL,
      feature TEXT NOT NULL DEFAULT 'general',
      is_ai_usage BOOLEAN NOT NULL DEFAULT FALSE,
      units INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS api_usage_user_created_idx
      ON api_usage_logs(user_id, created_at DESC);
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS testimonials (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      display_name TEXT NOT NULL,
      role_label TEXT,
      rating INTEGER NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
      comment TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
      admin_note TEXT,
      reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS testimonials_status_created_idx ON testimonials(status, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS testimonials_user_created_idx ON testimonials(user_id, created_at DESC);`);
  await pool.query(`ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS email_events (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      email_type TEXT NOT NULL,
      recipient TEXT NOT NULL,
      subject TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'disabled',
      status TEXT NOT NULL DEFAULT 'logged',
      provider_message_id TEXT,
      error_message TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS email_events_user_created_idx
      ON email_events(user_id, created_at DESC);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS email_events_type_status_idx
      ON email_events(email_type, status, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_logs (
      id SERIAL PRIMARY KEY,
      admin_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      action TEXT NOT NULL,
      target_type TEXT,
      target_id TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS admin_audit_created_idx
      ON admin_audit_logs(created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exams (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      exam_type TEXT NOT NULL,
      level TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_questions (
      id SERIAL PRIMARY KEY,
      exam_id INTEGER NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      module_id TEXT NOT NULL,
      prompt TEXT NOT NULL,
      options JSONB NOT NULL DEFAULT '[]'::jsonb,
      correct_answer JSONB NOT NULL DEFAULT '{}'::jsonb,
      explanation TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_questions_exam_position_idx
      ON exam_questions(exam_id, position, id);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS results (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      exam_type VARCHAR(50),
      score INTEGER,
      completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS results_user_completed_idx
      ON results(user_id, completed_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS copies_ecrites (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      prompt TEXT,
      response TEXT,
      ai_feedback TEXT,
      score INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS copies_ecrites_user_created_idx
      ON copies_ecrites(user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS statistiques (
      id SERIAL PRIMARY KEY,
      total_users INTEGER,
      total_exams INTEGER,
      api_usage INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
      id SERIAL PRIMARY KEY,
      user_id INTEGER,
      action TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS logs_user_created_idx
      ON logs(user_id, created_at DESC);
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_content (
      id SERIAL PRIMARY KEY,
      type VARCHAR(50),
      level VARCHAR(10),
      language VARCHAR(10),
      question TEXT,
      answers JSONB NOT NULL DEFAULT '[]'::jsonb,
      correct_answer TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_content_type_level_idx
      ON exam_content(type, level, created_at DESC);
  `);

  await ensureDocumentImportSchema(pool);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exams_published_catalog_idx
      ON exams (LOWER(provider), UPPER(level), series_number, section_type)
      WHERE is_active = TRUE;
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_sections_exam_part_position_idx
      ON exam_sections (exam_id, part_number, position, id);
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS exam_questions_exam_section_position_idx
      ON exam_questions (exam_id, section_id, position, id);
  `);
  await ensureWritingCorrectionSchema(pool);
  await ensureSpeakingCorrectionSchema(pool);
  await ensureContentStyleSchema(pool);
  await ensureAudioAssetSchema(pool);
}

const getFeature = (req) => {
  if (req.path.startsWith("/api/admin")) return "admin";
  if (req.path.includes("simulation")) return "simulation";
  if (req.path.includes("dashboard")) return "dashboard";
  if (req.path.includes("me")) return "profile";
  if (req.path.includes("login") || req.path.includes("register")) return "auth";
  return "general";
};

const isAiUsage = (req) =>
  Boolean(
    req.path.toLowerCase().includes("ai") ||
      req.body?.aiCorrections ||
      req.body?.aiUsage ||
      req.headers["x-ai-usage"]
  );

app.use((req, res, next) => {
  res.on("finish", () => {
    if (!req.user?.id) return;
    const units = Number(req.body?.aiCorrections?.tokens ?? req.body?.aiUsage?.units ?? 1);
    pool
      .query(
        `INSERT INTO api_usage_logs (user_id, method, path, status_code, feature, is_ai_usage, units)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          req.user.id,
          req.method,
          req.path,
          res.statusCode,
          getFeature(req),
          isAiUsage(req),
          Number.isFinite(units) && units > 0 ? Math.round(units) : 1,
        ]
      )
      .catch((err) => console.error("API usage log failed", err));
  });
  next();
});

const requireAuth = createAuthMiddleware({
  pool,
  jwt,
  jwtSecret: JWT_SECRET,
  issuer: JWT_ISSUER,
  audience: JWT_AUDIENCE,
  emailVerificationRequired: EMAIL_VERIFICATION_REQUIRED,
});
const requireAdmin = [requireAuth, adminMiddleware];

const optionalPaymentAuth = async (req, _res, next) => {
  try {
    const token = getBearerToken(req);
    if (!token) return next();
    const payload = jwt.verify(token, JWT_SECRET, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      ignoreExpiration: true,
    });
    const userId = Number(payload.sub ?? payload.id);
    if (!Number.isInteger(userId) || userId <= 0) return next();
    if (payload.jti) {
      const revoked = await pool.query(`SELECT 1 FROM revoked_tokens WHERE jti = $1 LIMIT 1`, [payload.jti]);
      if (revoked.rows[0]) return next();
    }
    const result = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, country, phone,
              auth_provider, avatar_url, role, status,
              email_verified, has_full_access, partial_access, current_level, target_level,
              marketing_emails_enabled,
              created_at, last_login_at
         FROM users
        WHERE id = $1`,
      [userId]
    );
    const user = result.rows[0];
    if (!user || user.status !== "active" || !["user", "admin"].includes(String(user.role)) || payload.role !== user.role) {
      return next();
    }
    req.token = token;
    req.authPayload = payload;
    req.user = user;
  } catch {
    // Payment status can still be checked by reference; normal protected routes remain strict.
  }
  return next();
};

const auditAdminAction = async (req, action, targetType, targetId, metadata = {}) => {
  try {
    const result = await pool.query(
      `INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [req.user?.id ?? null, action, targetType, String(targetId ?? ""), metadata]
    );
    return { id: result.rows?.[0]?.id ?? null };
  } catch (err) {
    console.error("Admin audit log failed", err);
    return null;
  }
};

app.use(
  [
    "/login",
    "/register",
    "/forgot-password",
    "/reset-password",
    "/resend-verification",
    "/api/auth",
  ],
  authRateLimiter
);

app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).send("DB connection failed");
  }
});

const PUBLIC_EXAM_META = {
  goethe: {
    examId: "goethe",
    examName: "Goethe-Zertifikat",
    accent: "#c10016",
  },
  osd: {
    examId: "osd",
    examName: "OSD Zertifikat",
    accent: "#2563eb",
  },
  telc: {
    examId: "telc",
    examName: "TELC Deutsch",
    accent: "#0f766e",
  },
  ecl: {
    examId: "ecl",
    examName: "ECL Deutsch",
    accent: "#7c3aed",
  },
  testdaf: {
    examId: "testdaf",
    examName: "TestDaF",
    accent: "#2563eb",
  },
  dsh: {
    examId: "dsh",
    examName: "DSH",
    accent: "#7c3aed",
  },
};

const PUBLIC_MODULE_META = {
  read: {
    id: "read",
    label: "Compréhension Écrite",
    shortLabel: "Written comprehension",
    description: "Imported reading tasks from the original exam document.",
    defaultMinutes: 65,
  },
  listen: {
    id: "listen",
    label: "Compréhension Orale",
    shortLabel: "Oral comprehension",
    description: "Imported listening tasks from the original exam document.",
    defaultMinutes: 40,
  },
  write: {
    id: "write",
    label: "Expression Écrite",
    shortLabel: "Written expression",
    description: "Imported writing prompts from the original exam document.",
    defaultMinutes: WRITING_GLOBAL_DURATION_MINUTES,
  },
  speak: {
    id: "speak",
    label: "Expression Orale",
    shortLabel: "Oral expression",
    description: "Imported speaking prompts from the original exam document.",
    defaultMinutes: 15,
  },
  sprach: {
    id: "sprach",
    label: "Sprachbausteine",
    shortLabel: "Language elements",
    description: "Imported TELC grammar and vocabulary cloze tasks.",
    defaultMinutes: 30,
  },
};

const MODULE_ORDER = ["read", "listen", "write", "speak", "sprach"];

const buildUnavailableModuleMeta = (moduleId) => {
  const moduleMeta = PUBLIC_MODULE_META[moduleId];
  if (!moduleMeta) return null;
  return {
    ...moduleMeta,
    available: false,
    sourceExamId: null,
    sourceCode: null,
    sourceLabel: null,
    title: moduleMeta.label,
    questionCount: 0,
    sectionCount: 0,
    durationMinutes: moduleMeta.defaultMinutes,
  };
};

const normalizeProviderId = (value) => {
  const raw = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/ã¶|ã–/g, "o");
  const normalized = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (normalized.includes("goethe")) return "goethe";
  if (normalized.includes("osd") || normalized.includes("oesd")) return "osd";
  if (normalized.includes("testdaf")) return "testdaf";
  if (normalized.includes("telc")) return "telc";
  if (normalized.includes("ecl")) return "ecl";
  if (normalized === "dsh" || normalized.includes("deutsche-sprachpruefung")) return "dsh";
  return normalized;
};

const applyExamAlias = (value, routeMeta = {}) => {
  if (!value || routeMeta.publicProvider !== "osd" || routeMeta.provider !== "goethe") return value;
  return String(value)
    .replace(/Goethe-Zertifikat\s+B1/gi, routeMeta.publicExamType || "OSD Zertifikat B1")
    .replace(/Goethe\s+B1/gi, "OSD B1")
    .replace(/Goethe/gi, "OSD");
};

const getProviderRouteMeta = (value) => {
  const raw = String(value ?? "").trim();
  const levelMatch = raw.match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  const level = levelMatch ? levelMatch[1].toUpperCase() : null;
  const routeProvider = normalizeProviderId(raw);
  if (routeProvider === "osd" && level === "B1") {
    return {
      provider: "osd",
      level,
      publicProvider: "osd",
      publicExamType: "ÖSD Zertifikat B1",
    };
  }
  return {
    provider: routeProvider,
    level,
    publicProvider: routeProvider,
  };
};

const toImportedSeriesId = (provider, level, seriesNumber) =>
  `imported-${provider}-${String(level || "level").toLowerCase()}-series-${String(seriesNumber).padStart(2, "0")}`;

const parseSeriesNumber = (seriesId) => {
  const raw = String(seriesId ?? "").trim();
  if (/^\d+$/.test(raw)) return Number(raw);
  const match = raw.match(/series-(\d+)/i);
  return match ? Number(match[1]) : null;
};

const asJsonObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const stripVisibleImportArtifacts = (value) =>
  String(value ?? "")
    .replace(/---\s*PAGE\s+\d+\s*\/\s*\d+\s*---/gi, "")
    .replace(/\bPAGE\s+\d+\s*\/\s*\d+\b/gi, "")
    .replace(/\bCORRECTIONS?\b\s*$/gim, "")
    .replace(/\bKORREKTUREN?\b\s*$/gim, "");

const cleanText = (value) =>
  stripVisibleImportArtifacts(value)
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const decodeHtmlEntities = (value) =>
  String(value ?? "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));

const cleanPlainText = (value) =>
  cleanText(
    decodeHtmlEntities(value)
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(?:p|div|li|tr|h[1-6])>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );

const clipText = (value, max = 1200) => {
  const text = cleanText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
};

const clipPlainText = (value, max = 1200) => {
  const text = cleanPlainText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}...`;
};

const extractCorrectValue = (correctAnswer) => {
  const correct = asJsonObject(correctAnswer);
  const value = correct.value ?? correct.answer ?? correct.correct ?? correct.correctAnswer;
  return value == null ? "" : cleanPlainText(value);
};

const normalizeChoiceOptions = (options) => {
  if (!Array.isArray(options)) return [];
  return options
    .map((option, index) => {
      const value = option?.value ?? option?.id ?? String.fromCharCode(97 + index);
      const label = option?.label ?? option?.text ?? option?.title ?? value;
      return {
        value: String(value),
        label: clipPlainText(label, 280),
      };
    })
    .filter((option) => option.value && option.label);
};

const LISTENING_STUDENT_INSTRUCTION = "Hören Sie den Audiotext und beantworten Sie die Aufgaben zu diesem Teil.";

const foldPlain = (value) =>
  String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const isListeningSourceLine = (line = "") => {
  const raw = String(line ?? "").trim();
  const rawFolded = foldPlain(raw);
  if (
    /^(?:n\s+)?(?:stimme|figur|stimme\/figur|bruitage|bruitages|sprecher|sprecherin|voice|voix|sfx)\s*[:/]/i.test(rawFolded) ||
    /^\s*n?\s*\[(?:anfang|ende|hintergrund|pause|jingle|signal|gerausch|geraeusch|sound|sfx)/i.test(rawFolded) ||
    /^(?!multiple-choice|richtig\/falsch|aufgabe|aufgaben|frage|fragen|question|questions)\p{L}[\p{L}\s.'-]{1,54}:\s*$/u.test(raw)
  ) {
    return true;
  }
  const folded = foldPlain(line).replace(/^[■•*\-\s]+/, "").trim();
  return (
    /^(type|type de document|voix|voice|sprecher|sprecherin|rolle|role|debit|tempo|style|registre|bruitages|sfx|transcription audio|transkription|transcript|script audio|skript|fiche de production|plan de production|profils? de voix)\b/.test(folded) ||
    /^(femme|homme|female|male|frau|mann),?\s*\d/.test(folded) ||
    /^(debut|milieu|fin)\s*:/.test(folded)
  );
};

const hasListeningProductionMarkers = (value = "") => {
  const folded = foldPlain(value);
  return /stimme\/figur|transcription audio|transkription|script audio|bruitage|bruitages|voix\s*:|sprecher\s*:|speaker\s*:|gehort\s*:|multiple-choice|richtig\/falsch/.test(folded);
};

const extractFirstListeningExercise = (value = "") => {
  const text = cleanText(value);
  const multiple = text.match(
    /Multiple-Choice\s*:\s*([^\n]+)(?:\n\s*a\)\s*([^\n]+))?(?:\n\s*b\)\s*([^\n]+))?(?:\n\s*c\)\s*([^\n]+))?/i
  );
  if (multiple) {
    return [
      multiple[1],
      multiple[2] ? `a) ${multiple[2]}` : null,
      multiple[3] ? `b) ${multiple[3]}` : null,
      multiple[4] ? `c) ${multiple[4]}` : null,
    ].filter(Boolean).join("\n");
  }

  const trueFalse = text.match(/Richtig\s*\/\s*Falsch\s*:\s*([^\n]+)/i);
  if (trueFalse) return trueFalse[1];

  const numbered = text.match(/(?:^|\n)\s*(\d{1,2}[.)]\s+[^\n]+)/);
  return numbered ? numbered[1].trim() : "";
};

const cleanListeningStudentText = (value) =>
  cleanText(value)
    .replace(/\bSprecher\s*:/g, "Person:")
    .replace(/\n\s*(?:FICHE DE CASTING|FICHE DE PRODUCTION|Casting requis|Bruitage de fond|Placement et dur[ée]e|Note\s*:\s*enregistrement)[\s\S]*$/i, "")
    .replace(/[■•]/g, "")
    .replace(/\[\s*_{2,}\s*\]/g, "")
    .replace(/\[\s*(?:\+|–|-|richtig|falsch)?\s*\]/gi, "")
    .replace(/_{2,}/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !isListeningSourceLine(line))
    .filter((line) => !/^(?:korrig|correction|loesung|losung|answer key)\b/i.test(foldPlain(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const cleanListeningOptionLabel = (value) =>
  cleanListeningStudentText(value)
    .replace(/\s*\/\s*Sprecher(?:in)?(?:\s*\d+)?\b/gi, "")
    .replace(/\(\s*Sprecher(?:in)?(?:\s*\d+)?\s*\)/gi, "")
    .replace(/^Sprecherin(?:\s*(\d+))?$/i, (_, number) => `Person${number ? ` ${number}` : ""}`)
    .replace(/^Sprecher(?:\s*(\d+))?$/i, (_, number) => `Person${number ? ` ${number}` : ""}`)
    .replace(/\s{2,}/g, " ")
    .trim();

const extractListeningStudentPrompt = (value, fallbackTitle = "") => {
  const raw = cleanText(value);
  const markers = [
    /(?:^|\n)\s*Aufgaben\s+\d{1,2}/i,
    /(?:^|\n)\s*Aufgabe\s+\d{1,2}\s*:/i,
    /(?:^|\n)\s*Fragen\s+\d{1,2}/i,
    /(?:^|\n)\s*Questions?\s*\/?\s*T(?:A|Â)CHES/i,
    /(?:^|\n)\s*\d{1,2}\.\s+\S/i,
  ];
  const starts = markers
    .map((regex) => raw.match(regex)?.index ?? -1)
    .filter((index) => index >= 0);
  const taskOnly = starts.length ? raw.slice(Math.min(...starts)) : "";
  const cleaned = cleanListeningStudentText(taskOnly || raw);
  const safeTitle = cleanListeningStudentText(fallbackTitle);
  if (hasListeningProductionMarkers(raw) && cleaned.length > 900) {
    const exercise = cleanListeningStudentText(extractFirstListeningExercise(cleaned));
    if (exercise) return `${LISTENING_STUDENT_INSTRUCTION}\n\n${clipText(exercise, 900)}`;
    return safeTitle ? `${LISTENING_STUDENT_INSTRUCTION}\n\n${safeTitle}` : LISTENING_STUDENT_INSTRUCTION;
  }
  if (!cleaned || cleaned.length < 12 || /transcription audio|transkription|script audio/i.test(cleaned.slice(0, 140))) {
    return safeTitle ? `${LISTENING_STUDENT_INSTRUCTION}\n\n${safeTitle}` : LISTENING_STUDENT_INSTRUCTION;
  }
  return `${LISTENING_STUDENT_INSTRUCTION}\n\n${clipText(cleaned, 2400)}`;
};

const toPublicSeriesList = (rows, routeMeta = {}) => {
  const groups = new Map();

  for (const row of rows) {
    const provider = normalizeProviderId(routeMeta.publicProvider || row.provider);
    const meta = PUBLIC_EXAM_META[provider] ?? {
      examId: provider,
      examName: row.exam_type || provider,
      accent: "#111827",
    };
    const examName = routeMeta.publicExamType || row.exam_type || meta.examName;
    const seriesNumber = Number(row.series_number);
    if (!Number.isFinite(seriesNumber)) continue;

    if (!groups.has(seriesNumber)) {
      const publicExamId = routeMeta.level
        ? `${provider}-${String(routeMeta.level).toLowerCase()}`
        : meta.examId;
      groups.set(seriesNumber, {
        id: toImportedSeriesId(provider, row.level, seriesNumber),
        code: `Series ${String(seriesNumber).padStart(2, "0")}`,
        title: "",
        level: row.level || "B1",
        duration: "Imported modules",
        theme: "",
        setting: examName,
        examId: publicExamId,
        accessExamId: meta.examId,
        examName,
        accent: meta.accent,
        isFree: seriesNumber === 1,
        isImported: true,
        source: "database",
        seriesNumber,
        modules: {},
      });
    }

    const series = groups.get(seriesNumber);
    const metadata = asJsonObject(row.metadata);
    const moduleId = row.section_type;
    const moduleMeta = PUBLIC_MODULE_META[moduleId];
    if (!moduleMeta) continue;

    const title = cleanText(applyExamAlias(metadata.title || metadata.sourceLabel || row.name, routeMeta));
    if (!series.title && title) series.title = title;
    if (!series.theme && title) series.theme = title;

    series.modules[moduleId] = {
      ...moduleMeta,
      available: true,
      sourceExamId: row.id,
      sourceCode: row.code,
      sourceLabel: applyExamAlias(metadata.sourceLabel || row.name, routeMeta),
      title: title || moduleMeta.label,
      questionCount: Number(row.question_count) || 0,
      sectionCount: Number(row.section_count) || 0,
      durationMinutes: moduleId === "write"
        ? WRITING_GLOBAL_DURATION_MINUTES
        : Number(row.duration_minutes) ||
          Number(metadata.globalDurationMinutes || metadata.scoring?.globalDurationMinutes) ||
          moduleMeta.defaultMinutes,
    };
  }

  return Array.from(groups.values()).map((series) => {
    const seriesProvider = normalizeProviderId(
      routeMeta.publicProvider || series.accessExamId || series.examId || series.examName
    );
    const expectedModules = seriesProvider === "telc"
      ? MODULE_ORDER
      : MODULE_ORDER.filter((moduleId) => moduleId !== "sprach");
    expectedModules.forEach((moduleId) => {
      if (!series.modules[moduleId]) {
        series.modules[moduleId] = buildUnavailableModuleMeta(moduleId);
      }
    });
    const moduleIds = expectedModules.filter((moduleId) => series.modules[moduleId]);
    const orderedModules = Object.fromEntries(
      moduleIds.map((moduleId) => [moduleId, series.modules[moduleId]])
    );
    return {
      ...series,
      modules: orderedModules,
      title: series.title || `${series.examName} ${series.code}`,
      theme: series.theme || series.examName,
      duration: `${moduleIds.length} module${moduleIds.length > 1 ? "s" : ""}`,
    };
  });
};

const queryImportedExamRows = async (provider, seriesNumber = null, level = null) => {
  const params = [provider];
  const seriesClause = seriesNumber == null ? "" : "AND e.series_number = $2";
  if (seriesNumber != null) params.push(seriesNumber);
  const levelClause = level ? `AND UPPER(COALESCE(e.level, '')) = $${params.length + 1}` : "";
  if (level) params.push(String(level).toUpperCase());

  return pool.query(
    `
      SELECT e.id, e.code, e.name, e.provider, e.exam_type, e.level, e.section_type,
             e.series_number, e.metadata,
             COALESCE(q.question_count, 0)::int AS question_count,
             COALESCE(s.section_count, 0)::int AS section_count,
             COALESCE(s.duration_minutes, 0)::int AS duration_minutes
      FROM exams e
      LEFT JOIN (
        SELECT exam_id, COUNT(*) AS question_count
        FROM exam_questions
        GROUP BY exam_id
      ) q ON q.exam_id = e.id
      LEFT JOIN (
        SELECT exam_id, COUNT(*) AS section_count, SUM(COALESCE(duration_minutes, 0)) AS duration_minutes
        FROM exam_sections
        GROUP BY exam_id
      ) s ON s.exam_id = e.id
      WHERE LOWER(e.provider) = LOWER($1)
        AND e.is_active = TRUE
        AND e.source_import_id IS NOT NULL
        AND e.series_number IS NOT NULL
        ${seriesClause}
        ${levelClause}
      ORDER BY e.series_number,
               CASE e.section_type
                 WHEN 'read' THEN 1
                 WHEN 'listen' THEN 2
                 WHEN 'write' THEN 3
                 WHEN 'speak' THEN 4
                 WHEN 'sprach' THEN 5
                 ELSE 9
               END,
               e.id
    `,
    params
  );
};

const stripStudentHiddenMetadata = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripStudentHiddenMetadata);
  }
  if (!value || typeof value !== "object") return value;

  const hiddenKeys = new Set([
    "generation_prompt",
    "prompt_path",
    "path",
    "privateCorrectionAvailable",
    "fullSourceTextVerbatim",
    "sourceTextVerbatim",
    "correctionTextVerbatim",
    "privateCorrectionText",
    "adminNotes",
    "moderatorNotes",
    "answerKey",
    "solution",
    "solutions",
  ]);

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (hiddenKeys.has(key)) continue;
    next[key] = stripStudentHiddenMetadata(child);
  }
  return next;
};

const buildTaskPartMeta = (question, index = 0) => {
  const metadata = asJsonObject(question.source_metadata);
  const sectionMetadata = asJsonObject(question.section_metadata);
  const partNumber = Number(question.part_number) || Number(question.section_position) || index + 1;
  const partTitle = question.section_title || (partNumber ? `Teil ${partNumber}` : "Part");
  return {
    partKey: `part-${partNumber || index + 1}`,
    partNumber,
    partTitle,
    partInstructions: clipText(question.section_instructions || "", 5200),
    partDurationMinutes: Number(question.section_duration_minutes) || null,
    partPoints: Number(question.section_points) || null,
    sourceQuestionNumber: metadata.sourceQuestionNumber ?? question.position ?? index + 1,
    sourceMetadata: stripStudentHiddenMetadata(metadata),
    partSourceMetadata: stripStudentHiddenMetadata(sectionMetadata),
  };
};

const resolveListeningAudioForQuestion = (question, listeningAudioMap = new Map()) => {
  const metadata = asJsonObject(question.source_metadata);
  const partNumber = Number(question.part_number) || Number(question.section_position) || Number(metadata.partNumber) || 1;
  const itemNumber = Number(metadata.textNumber || metadata.audioItemNumber || metadata.itemNumber) || 1;
  return listeningAudioMap.get(`${partNumber}:${itemNumber}`) || listeningAudioMap.get(`${partNumber}:1`) || null;
};

const buildListeningTask = (question, index = 0, listeningAudioMap = new Map(), sourceFixes = null) => {
  const metadata = asJsonObject(question.source_metadata);
  const partNumber = Number(question.part_number) || Number(question.section_position) || Number(metadata.partNumber) || index + 1;
  const sourceQuestionNumber = Number(metadata.sourceQuestionNumber ?? question.position ?? index + 1);
  const sourceFix = sourceFixes?.[`${partNumber}:${sourceQuestionNumber}`] || null;
  const questionType = String(sourceFix?.questionType || question.question_type || "").toLowerCase();
  const correctValue = sourceFix?.correctAnswer?.value || extractCorrectValue(question.correct_answer);
  const options = normalizeChoiceOptions(sourceFix?.options || question.options)
    .map((option) => ({ ...option, label: cleanListeningOptionLabel(option.label) }))
    .filter((option) => option.label);
  const base = {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || `Hören Teil ${question.part_number || index + 1}`,
    question: sourceFix?.prompt || extractListeningStudentPrompt(question.prompt || question.section_instructions, question.section_title),
    hint: "Hören Sie den Audiotext aufmerksam und beantworten Sie die Aufgaben.",
    explanation: sourceFix?.explanation || question.explanation || "Antwort aus dem importierten Hörverstehen-Modul.",
    sourceQuestionId: question.id,
    audio: resolveListeningAudioForQuestion(question, listeningAudioMap),
    contentStyle: asJsonObject(metadata.contentStyle),
    ...buildTaskPartMeta(question, index),
    partInstructions: LISTENING_STUDENT_INSTRUCTION,
  };

  if (questionType.includes("true_false")) {
    return {
      ...base,
      type: "trueFalse",
      correct: /^(richtig|true|vrai|ja|yes)$/i.test(correctValue) ? "true" : "false",
    };
  }

  if (questionType.includes("multiple") && options.length >= 2) {
    return {
      ...base,
      type: "multiple",
      options,
      correct: correctValue || options[0].value,
    };
  }

  if (questionType.includes("matching") && options.length) {
    return {
      ...base,
      type: "select",
      options,
      correct: correctValue || options[0].value,
      alternatives: correctValue ? [correctValue.toLowerCase(), correctValue.toUpperCase()] : [],
    };
  }

  return {
    ...base,
    type: "blank",
    correct: correctValue,
    alternatives: correctValue ? [correctValue.toLowerCase(), correctValue.toUpperCase()] : [],
  };
};

const buildReadingTask = (question, index = 0) => {
  const questionType = String(question.question_type || "").toLowerCase();
  const correctAnswerData = asJsonObject(question.correct_answer);
  const correctValue = extractCorrectValue(question.correct_answer);
  const options = normalizeChoiceOptions(question.options);
  const metadata = asJsonObject(question.source_metadata);
  const scoring = asJsonObject(question.scoring);
  const taskPoints = Number(scoring.points);
  const base = {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || "Lesen",
    question: clipText(question.prompt, 900),
    hint: question.section_title ? `Relisez ${question.section_title}.` : "Relisez le texte source.",
    explanation: question.explanation || "Réponse issue du document importé.",
    sourceQuestionId: question.id,
    contentStyle: asJsonObject(metadata.contentStyle),
    points: Number.isFinite(taskPoints) ? taskPoints : 1,
    ...buildTaskPartMeta(question, index),
  };

  if (metadata.structuredB2Lesen) {
    const acceptedAnswers = Array.isArray(correctAnswerData.acceptedAnswers)
      ? correctAnswerData.acceptedAnswers.map((value) => cleanPlainText(value)).filter(Boolean)
      : [];
    if (options.length >= 2) {
      return {
        ...base,
        type: questionType.includes("multiple") ? "multiple" : "select",
        options,
        correct: correctValue || options[0].value,
        alternatives: correctValue ? [correctValue.toLowerCase(), correctValue.toUpperCase()] : [],
        uniqueAnswers: metadata.uniqueAnswers === true,
        sourceKeyReviewRequired: metadata.sourceKeyReviewRequired === true,
      };
    }
    return {
      ...base,
      type: "blank",
      correct: correctValue,
      alternatives: acceptedAnswers.filter((value) => value !== correctValue),
      answerNormalization: metadata.answerNormalization || "strict-german",
      manualReviewOnMismatch:
        metadata.manualReviewOnMismatch === true || correctAnswerData.manualReviewOnMismatch === true,
      sourcePrefixMismatch:
        metadata.sourcePrefixMismatch === true || correctAnswerData.sourcePrefixMismatch === true,
      visiblePrefix: metadata.visiblePrefix || correctAnswerData.visiblePrefix || "",
      expectedWord: metadata.expectedWord || correctAnswerData.expectedWord || "",
      requiredConcepts: Array.isArray(correctAnswerData.requiredConcepts)
        ? correctAnswerData.requiredConcepts
        : Array.isArray(metadata.requiredConcepts) ? metadata.requiredConcepts : [],
    };
  }

  if (metadata.goetheB2Lesen && options.length >= 2) {
    return {
      ...base,
      type: questionType.includes("multiple") ? "multiple" : "select",
      options,
      correct: correctValue || options[0].value,
      alternatives: correctValue ? [correctValue.toLowerCase(), correctValue.toUpperCase()] : [],
    };
  }

  if (questionType.includes("true_false")) {
    return {
      ...base,
      type: "trueFalse",
      correct: /^(richtig|true|vrai|ja|yes)$/i.test(correctValue) ? "true" : "false",
    };
  }

  if (questionType.includes("yes_no")) {
    return {
      ...base,
      type: "multiple",
      options: [
        { value: "ja", label: "Ja" },
        { value: "nein", label: "Nein" },
      ],
      correct: /^ja$/i.test(correctValue) ? "ja" : "nein",
    };
  }

  if (questionType.includes("multiple") && options.length >= 2) {
    return {
      ...base,
      type: "multiple",
      options,
      correct: correctValue || options[0].value,
    };
  }

  if (questionType.includes("matching")) {
    const correct = correctValue || "x";
    const matchingOptions = options.length
      ? options
      : "abcdefghijx".split("").map((value) => ({
          value,
          label: value === "x" ? "X - Keine passende Anzeige" : value.toUpperCase(),
        }));
    return {
      ...base,
      type: "select",
      typeLabel: `${base.typeLabel} - Zuordnung`,
      question: `${base.question}\n\nWählen Sie die passende Anzeige. X = keine passende Anzeige.`,
      options: matchingOptions,
      correct,
      alternatives: [correct.toUpperCase(), correct.toLowerCase()],
    };
  }

  return {
    ...base,
    type: options.length >= 2 ? "multiple" : "blank",
    options: options.length >= 2 ? options : undefined,
    correct: options.length >= 2 ? correctValue || options[0].value : correctValue,
    alternatives: correctValue ? [correctValue.toLowerCase(), correctValue.toUpperCase()] : [],
  };
};

const buildWritingTask = (question, index) => {
  const metadata = asJsonObject(question.source_metadata);
  const scoring = asJsonObject(question.scoring);
  const correct = asJsonObject(question.correct_answer);
  const wordTarget = Number(metadata.wordTarget) || (question.part_number === 3 ? 40 : 80);
  const minWords = 80;
  const targetWords = Math.max(wordTarget, minWords);
  const points = Number(scoring.points) || Number(question.section_points) || 0;
  const durationMinutes = Number(scoring.durationMinutes) || Number(question.section_duration_minutes) || null;

  return {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || `Schreiben Teil ${question.part_number || index + 1}`,
    title: question.section_title || `Aufgabe ${index + 1}`,
    register: question.part_number === 1 ? "informell" : question.part_number === 3 ? "halbformell" : "neutral",
    minWords,
    targetWords,
    maxWords: null,
    maxScore: points || null,
    taskWeight: points || null,
    durationMinutes,
    prompt: clipText(question.prompt || question.section_instructions, 2200),
    criteria: [
      "Alle Inhaltspunkte behandeln",
      "Klare Struktur",
      "Passender B1-Wortschatz",
      points ? `${points} Punkte` : null,
    ].filter(Boolean),
    scoring: {
      points: points || null,
      durationMinutes,
    },
    sampleAnswer: correct.sampleAnswer ? clipText(correct.sampleAnswer, 1600) : undefined,
    sourceQuestionId: question.id,
    contentStyle: asJsonObject(metadata.contentStyle),
    ...buildTaskPartMeta(question, index),
  };
};

const buildSpeakingTask = (question, index) => {
  const metadata = asJsonObject(question.source_metadata);
  const scoring = asJsonObject(question.scoring);
  const durationMinutes = Number(scoring.durationMinutes) || Number(question.section_duration_minutes) || 2;
  const points = Number(scoring.points) || Number(question.section_points) || 0;
  const visualAssets = Array.isArray(metadata.visualAssets)
    ? stripStudentHiddenMetadata(metadata.visualAssets)
    : [];
  const primaryVisual = visualAssets.find((asset) => asset?.publicUrl) || null;
  const prepSeconds = Number(scoring.prepSeconds ?? metadata.prepSeconds);
  const responseSeconds = Number(scoring.responseSeconds ?? metadata.responseSeconds);

  return {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || `Sprechen Teil ${question.part_number || index + 1}`,
    title: question.section_title || `Aufgabe ${index + 1}`,
    prepSeconds: Number.isFinite(prepSeconds) ? Math.max(0, Math.round(prepSeconds)) : question.part_number === 1 ? 60 : 45,
    responseSeconds: Number.isFinite(responseSeconds) ? Math.max(30, Math.round(responseSeconds)) : Math.max(60, Math.round(durationMinutes * 60)),
    prompt: clipText(question.prompt || question.section_instructions, 12000),
    checklist: [
      "Aufgabe vollständig bearbeiten",
      "Natürlich reagieren",
      "Beispiele nennen",
      points ? `${points} Punkte` : null,
    ].filter(Boolean),
    sourceQuestionId: question.id,
    sourceExamId: question.exam_id,
    points: points || null,
    visual: Boolean(primaryVisual),
    visualUrl: primaryVisual?.publicUrl || "",
    visualAlt: primaryVisual ? "Bildimpuls fuer die muendliche Aufgabe" : "",
    visualAssets,
    presentation: asJsonObject(metadata.presentation),
    variant: metadata.variant || "",
    contentStyle: asJsonObject(metadata.contentStyle),
    sourceMetadata: stripStudentHiddenMetadata(metadata),
    ...buildTaskPartMeta(question, index),
  };
};

const buildImportedListeningAudio = ({ title, sourceLabel, sections, questions }) => {
  const sectionQuestionsById = new Map();
  questions.forEach((question) => {
    const key = question.section_id ?? "unassigned";
    if (!sectionQuestionsById.has(key)) sectionQuestionsById.set(key, []);
    sectionQuestionsById.get(key).push(question);
  });

  const tracks = sections.map((section, index) => {
    const sectionQuestions = sectionQuestionsById.get(section.id) || [];
    const sectionMetadata = asJsonObject(section.metadata);
    const firstQuestionWithAudio = sectionQuestions.find((question) => Object.keys(asJsonObject(question.audio)).length);
    const firstQuestionWithTranscript = sectionQuestions.find((question) => question.transcript);
    const sectionAudio = {
      ...asJsonObject(firstQuestionWithAudio?.audio),
      ...asJsonObject(sectionMetadata.audio),
    };
    const transcript = cleanText(
      sectionMetadata.transcript ||
      firstQuestionWithTranscript?.transcript ||
      sectionAudio.transcript ||
      ""
    );
    return {
      id: `track-${section.part_number || section.position || index + 1}`,
      partNumber: Number(section.part_number) || Number(section.position) || index + 1,
      title: section.title || `Teil ${index + 1}`,
      transcript,
      audio: {
        ...sectionAudio,
        transcript,
      },
    };
  }).filter((track) => track.transcript || Object.keys(track.audio || {}).length);

  const primaryAudio = tracks[0]?.audio || asJsonObject(questions[0]?.audio);
  const transcriptSet = new Set();
  const transcript = tracks
    .map((track) => track.transcript)
    .filter(Boolean)
    .filter((text) => {
      const key = text.slice(0, 240);
      if (transcriptSet.has(key)) return false;
      transcriptSet.add(key);
      return true;
    })
    .join("\n\n");
  const speakers = tracks.flatMap((track) => Array.isArray(track.audio?.speakers) ? track.audio.speakers : []);
  const speakerMap = new Map();
  speakers.forEach((speaker) => {
    const key = String(speaker?.speaker || speaker?.voiceName || speaker?.id || "").toLowerCase();
    if (key && !speakerMap.has(key)) speakerMap.set(key, speaker);
  });
  const ambience = tracks.flatMap((track) => Array.isArray(track.audio?.ambience) ? track.audio.ambience : []);

  return {
    ...primaryAudio,
    title: primaryAudio.documentType || `${sourceLabel}: ${title}`,
    speaker:
      primaryAudio.situation ||
      Array.from(speakerMap.values()).map((speaker) => speaker.speaker || speaker.voiceName).filter(Boolean).join(" / ") ||
      "Standarddeutsch, moderates Tempo",
    transcript,
    tracks,
    speakers: Array.from(speakerMap.values()),
    ambience: ambience.length ? ambience : primaryAudio.ambience,
    sfx: primaryAudio.sfx || ambience.map((item) => item.name).filter(Boolean).join(", "),
    rate: primaryAudio.rate || 0.9,
  };
};

const attachGeneratedListeningAudio = async ({ examId, audio, provider }) => {
  if (!audio) return audio;
  const selectedProvider = normalizeProvider(provider || getConfiguredProvider());
  const { contentHash, asset } = await getAudioAssetForExam({
    pool,
    examId,
    audio,
    provider: selectedProvider,
  });
  const latest = await pool.query(
    `SELECT id, status, error_message, provider, provider_model, byte_size, duration_seconds, updated_at
       FROM exam_audio_assets
      WHERE source_exam_id = $1
      ORDER BY updated_at DESC
      LIMIT 1`,
    [examId]
  );
  const fallback = latest.rows[0] || null;
  const readyAsset = asset?.status === "ready" ? asset : null;
  return {
    ...audio,
    contentHash,
    provider: selectedProvider,
    productionStatus: readyAsset ? "ready" : fallback?.status === "failed" ? "failed" : "missing",
    productionUpdatedAt: readyAsset?.updated_at || fallback?.updated_at || null,
    productionMessage: readyAsset
      ? "Production audio ready."
      : fallback?.status === "failed"
        ? "Production audio generation failed. An administrator must regenerate it."
        : "Production audio has not been generated yet.",
    audioUrl: readyAsset ? `/api/audio/generated/${readyAsset.id}` : "",
    providerModel: readyAsset?.provider_model || fallback?.provider_model || null,
    byteSize: readyAsset?.byte_size || 0,
    durationSeconds: readyAsset?.duration_seconds || null,
  };
};

const stripPublicListeningTranscriptFields = (value) => {
  if (Array.isArray(value)) {
    return value.map(stripPublicListeningTranscriptFields);
  }
  if (!value || typeof value !== "object") return value;

  const next = {};
  for (const [key, child] of Object.entries(value)) {
    if (["transcript", "adminTranscript", "admin_transcript", "script", "prompt", "timing", "sfx", "ambience"].includes(key)) {
      continue;
    }
    next[key] = stripPublicListeningTranscriptFields(child);
  }
  return next;
};

const buildPublicListeningAudioSummary = (listeningAudioItems = []) => {
  const firstItem = Array.isArray(listeningAudioItems) ? listeningAudioItems[0] : null;
  if (!firstItem) {
    return {
      title: "Hören",
      speaker: "Standarddeutsch",
      audioUrl: "",
      productionStatus: "missing",
      listeningCount: 2,
    };
  }

  const metadata = asJsonObject(firstItem.source_metadata);
  const isBrowserFallback = metadata.browserTtsFallback === true;
  const speechText = isBrowserFallback ? stripProductionMarkers(firstItem.admin_transcript || "") : "";
  return {
    id: `audio-item-${firstItem.id}`,
    title: firstItem.title || `Audio ${firstItem.item_number || 1}`,
    speaker: "Standarddeutsch",
    audioUrl: firstItem.asset_id ? `/api/audio/generated/${firstItem.asset_id}` : "",
    fallbackEngine: isBrowserFallback ? "browser-speech" : "",
    productionLabel: isBrowserFallback ? "Browser TTS (no MP3)" : "MP3",
    transcript: speechText,
    tracks: isBrowserFallback ? [{
      id: `browser-tts-${firstItem.id}`,
      title: firstItem.title || `Audio ${firstItem.item_number || 1}`,
      transcript: speechText,
      audio: { transcript: speechText },
    }] : [],
    speakers: Array.isArray(firstItem.voice_profile_map) ? firstItem.voice_profile_map : [],
    productionStatus: "ready",
    listeningCount: Number(firstItem.listening_count) || 2,
    durationSeconds: Number(firstItem.duration_seconds) || null,
    partNumber: Number(firstItem.part_number) || 1,
    itemNumber: Number(firstItem.item_number) || 1,
  };
};

const getGoetheB1HoerenQuestionFixesForExam = (exam) => {
  const provider = normalizeProviderId(exam?.provider || exam?.exam_type || "");
  const level = String(exam?.level || "").toUpperCase();
  const sectionType = String(exam?.section_type || "").toLowerCase();
  const seriesNumber = String(Number(exam?.series_number) || "");
  if (provider !== "goethe" || level !== "B1" || sectionType !== "listen" || !seriesNumber) return null;
  return goetheB1HoerenQuestionFixes[seriesNumber] || null;
};

const buildImportedModuleContent = ({ exam, sections, questions, routeMeta = {}, listeningAudioItems = [] }) => {
  const moduleId = exam.section_type;
  const moduleMeta = PUBLIC_MODULE_META[moduleId] ?? PUBLIC_MODULE_META.read;
  const metadata = asJsonObject(exam.metadata);
  const sourceLabel = applyExamAlias(
    metadata.sourceLabel || `Series ${String(exam.series_number).padStart(2, "0")}`,
    routeMeta
  );
  const title = applyExamAlias(metadata.title || sourceLabel || exam.name, routeMeta);
  const examType = routeMeta.publicExamType || exam.exam_type || "Goethe-Zertifikat";
  const sectionSummaries = sections.map((section) => ({
    id: `part-${section.part_number || section.position}`,
    label: `Teil ${section.part_number || section.position}`,
    number: Number(section.part_number) || Number(section.position) || null,
    heading: applyExamAlias(section.title, routeMeta),
    text: moduleId === "listen"
      ? LISTENING_STUDENT_INSTRUCTION
      : clipText(applyExamAlias(section.instructions || section.title, routeMeta), moduleId === "speak" ? 12000 : 2600),
    instructions: moduleId === "listen"
      ? LISTENING_STUDENT_INSTRUCTION
      : clipText(applyExamAlias(section.instructions || section.title, routeMeta), moduleId === "speak" ? 12000 : 5200),
    durationMinutes: Number(section.duration_minutes) || null,
    points: Number(section.points) || null,
    sourceMetadata: stripStudentHiddenMetadata(asJsonObject(section.metadata)),
  }));

  let tasks;
  const listeningAudioMap = new Map(
    (Array.isArray(listeningAudioItems) ? listeningAudioItems : []).map((item) => {
      const isBrowserFallback = asJsonObject(item.source_metadata).browserTtsFallback === true;
      const speechText = isBrowserFallback ? stripProductionMarkers(item.admin_transcript || "") : "";
      return [
        `${Number(item.part_number) || 1}:${Number(item.item_number) || 1}`,
        {
        id: `audio-item-${item.id}`,
        title: item.title || `Audio ${item.item_number || 1}`,
        speaker: "Standarddeutsch",
        audioUrl: item.asset_id ? `/api/audio/generated/${item.asset_id}` : "",
        fallbackEngine: isBrowserFallback ? "browser-speech" : "",
        productionLabel: isBrowserFallback ? "Browser TTS (no MP3)" : "MP3",
        transcript: speechText,
        tracks: isBrowserFallback ? [{
          id: `browser-tts-${item.id}`,
          title: item.title || `Audio ${item.item_number || 1}`,
          transcript: speechText,
          audio: { transcript: speechText },
        }] : [],
        speakers: Array.isArray(item.voice_profile_map) ? item.voice_profile_map : [],
        productionStatus: "ready",
        listeningCount: Number(item.listening_count) || 2,
        durationSeconds: Number(item.duration_seconds) || null,
        partNumber: Number(item.part_number) || 1,
        itemNumber: Number(item.item_number) || 1,
        },
      ];
    })
  );

  if (moduleId === "write") {
    tasks = questions.map((question, index) => buildWritingTask(question, index));
  } else if (moduleId === "speak") {
    tasks = questions.map((question, index) => buildSpeakingTask(question, index));
  } else if (moduleId === "listen") {
    const sourceFixes = getGoetheB1HoerenQuestionFixesForExam(exam);
    tasks = questions.map((question, index) => buildListeningTask(question, index, listeningAudioMap, sourceFixes));
  } else {
    tasks = questions.map((question, index) => buildReadingTask(question, index));
  }

  return {
    id: moduleId,
    isImported: true,
    available: tasks.length > 0,
    label: moduleMeta.label,
    shortLabel: moduleMeta.shortLabel,
    theme: title,
    focus: [
      examType,
      sourceLabel,
      moduleMeta.label,
      `${tasks.length} question${tasks.length > 1 ? "s" : ""}`,
    ],
    advancement: [
      "Contenu importé depuis les documents originaux",
      "Structure conservée par parties",
      "Questions reliées à leur série",
      "Correction basée sur les réponses extraites",
    ],
    parts: sectionSummaries,
    passage:
      moduleId === "read" || moduleId === "sprach"
        ? {
            title: `${sourceLabel}: ${title}`,
            intro: applyExamAlias(metadata.instructions || "Lisez les textes et répondez aux questions.", routeMeta),
            paragraphs: sectionSummaries.length
              ? sectionSummaries
              : [{ id: "A", text: "Texte importé depuis le document source." }],
          }
        : undefined,
    audio: moduleId === "listen"
      ? (() => {
          const audioSummary = buildPublicListeningAudioSummary(listeningAudioItems);
          return audioSummary.fallbackEngine === "browser-speech"
            ? audioSummary
            : stripPublicListeningTranscriptFields(audioSummary);
        })()
      : undefined,
    globalDurationMinutes: moduleId === "write"
      ? WRITING_GLOBAL_DURATION_MINUTES
      : Number(metadata.globalDurationMinutes || metadata.scoring?.globalDurationMinutes) || null,
    tasks,
    sourceExamId: exam.id,
  };
};

app.get("/api/exams/:provider/series", async (req, res) => {
  try {
    const routeMeta = getProviderRouteMeta(req.params.provider);
    const { provider, level } = routeMeta;
    if (!provider) return res.status(400).json({ ok: false, error: "Invalid exam provider" });

    const importedRows = await queryImportedExamRows(provider, null, level);
    const series = toPublicSeriesList(importedRows.rows, routeMeta);
    return res.json({ ok: true, source: "database", series });
  } catch (err) {
    console.error("Imported series lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/exams/:provider/series/:seriesId/:moduleId", async (req, res) => {
  try {
    const routeMeta = getProviderRouteMeta(req.params.provider);
    const { provider, level } = routeMeta;
    const seriesNumber = parseSeriesNumber(req.params.seriesId);
    const moduleId = String(req.params.moduleId || "").trim().toLowerCase();
    if (!provider || !seriesNumber || !PUBLIC_MODULE_META[moduleId]) {
      return res.status(400).json({ ok: false, error: "Invalid imported module request" });
    }

    const importedRows = await queryImportedExamRows(provider, seriesNumber, level);
    const series = toPublicSeriesList(importedRows.rows, routeMeta)[0];
    const sourceExamId = Number(series?.modules?.[moduleId]?.sourceExamId);
    const exam =
      importedRows.rows.find((row) => Number(row.id) === sourceExamId) ||
      importedRows.rows.find((row) => row.section_type === moduleId);
    if (!series) {
      return res.status(404).json({ ok: false, error: "Imported module not found" });
    }
    if (!exam) {
      const moduleMeta = PUBLIC_MODULE_META[moduleId];
      return res.json({
        ok: true,
        source: "database",
        series,
        content: {
          id: moduleId,
          isImported: true,
          available: false,
          label: moduleMeta.label,
          shortLabel: moduleMeta.shortLabel,
          theme: series.title || series.examName,
          focus: [series.examName, series.code, moduleMeta.label, "Non disponible"],
          advancement: [],
          parts: [],
          tasks: [],
          sourceExamId: null,
        },
      });
    }

    const sections = await pool.query(
      `SELECT *
       FROM exam_sections
       WHERE exam_id = $1
       ORDER BY position, id`,
      [exam.id]
    );
    const questions = await pool.query(
      `SELECT q.*, e.level, s.title AS section_title, s.part_number,
              s.instructions AS section_instructions,
              s.duration_minutes AS section_duration_minutes,
              s.points AS section_points,
              s.scoring AS section_scoring,
              s.metadata AS section_metadata,
              s.position AS section_position
       FROM exam_questions q
       JOIN exams e ON e.id = q.exam_id
       LEFT JOIN exam_sections s ON s.id = q.section_id
       WHERE q.exam_id = $1
       ORDER BY COALESCE(s.position, 0), q.position, q.id`,
      [exam.id]
    );

    const listeningAudioItems = moduleId === "listen" ? await getPublishedAudioItemsForExam(exam.id) : [];
    const content = buildImportedModuleContent({
      exam,
      sections: sections.rows,
      questions: questions.rows,
      routeMeta,
      listeningAudioItems,
    });
    return res.json({ ok: true, source: "database", series, content });
  } catch (err) {
    console.error("Imported module lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const buildGoogleUsernameBase = (profile) => {
  const preferred = [
    profile.given_name,
    profile.name,
    String(profile.email || "").split("@")[0],
    "google-user",
  ].find(Boolean);
  return String(preferred || "google-user")
    .normalize("NFKD")
    .replace(/[^\w.\-]+/g, ".")
    .replace(/_+/g, "_")
    .replace(/\.+/g, ".")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .toLowerCase()
    .slice(0, 24) || "google-user";
};

const buildUniqueGoogleUsername = async (profile) => {
  const base = buildGoogleUsernameBase(profile);
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const suffix = attempt === 0 ? "" : `.${crypto.randomInt(1000, 9999)}`;
    const candidate = `${base}${suffix}`.slice(0, 30);
    const existing = await pool.query(`SELECT 1 FROM users WHERE username = $1 LIMIT 1`, [candidate]);
    if (!existing.rows[0]) return candidate;
  }
  return `google.${crypto.randomUUID().slice(0, 8)}`;
};

const assertGoogleAudience = (audience) => {
  if (!GOOGLE_CLIENT_IDS.length) {
    const err = new Error("Google authentication is not configured.");
    err.statusCode = 503;
    throw err;
  }
  if (!GOOGLE_CLIENT_IDS.includes(String(audience || ""))) {
    const err = new Error("Google authentication could not be verified.");
    err.statusCode = 401;
    throw err;
  }
};

const getAllowedGoogleRedirectOrigins = () => {
  const origins = new Set();
  [
    FRONTEND_URL,
    process.env.PUBLIC_APP_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "",
    process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ].forEach((value) => {
    try {
      if (value) origins.add(new URL(value).origin);
    } catch {
      // Ignore malformed optional deployment URLs.
    }
  });
  return origins;
};

const assertGooglePopupRequest = (req, redirectUri) => {
  if (req.get("x-requested-with") !== "XmlHttpRequest") {
    const err = new Error("Invalid Google authentication request.");
    err.statusCode = 403;
    throw err;
  }
  let redirectOrigin;
  try {
    redirectOrigin = new URL(redirectUri).origin;
  } catch {
    const err = new Error("Invalid Google redirect origin.");
    err.statusCode = 400;
    throw err;
  }
  const requestOrigin = req.get("origin") || "";
  const allowedOrigins = getAllowedGoogleRedirectOrigins();
  if (requestOrigin && requestOrigin !== redirectOrigin) {
    const err = new Error("Google authentication origin mismatch.");
    err.statusCode = 403;
    throw err;
  }
  if (!allowedOrigins.has(redirectOrigin) && !/\.vercel\.app$/i.test(new URL(redirectOrigin).hostname)) {
    const err = new Error("Google authentication origin is not allowed.");
    err.statusCode = 403;
    throw err;
  }
};

const exchangeGoogleCode = async ({ code, redirectUri }) => {
  if (!code || typeof code !== "string") {
    const err = new Error("Missing Google authorization code.");
    err.statusCode = 400;
    throw err;
  }
  if (!GOOGLE_CLIENT_IDS.length || !GOOGLE_CLIENT_SECRET) {
    const err = new Error("Google authentication is not configured.");
    err.statusCode = 503;
    throw err;
  }

  const body = new URLSearchParams({
    code,
    client_id: GOOGLE_CLIENT_IDS[0],
    client_secret: GOOGLE_CLIENT_SECRET,
    redirect_uri: new URL(redirectUri).origin,
    grant_type: "authorization_code",
  });
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.id_token || !tokens.access_token) {
    const err = new Error("Google authentication could not be verified.");
    err.statusCode = 401;
    throw err;
  }
  return tokens;
};

const verifyGoogleCode = async (req) => {
  const redirectUri = req.body?.redirectUri;
  assertGooglePopupRequest(req, redirectUri);
  const tokens = await exchangeGoogleCode({ code: req.body?.code, redirectUri });

  const tokenInfoResponse = await fetch(
    `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(tokens.id_token)}`
  );
  if (!tokenInfoResponse.ok) {
    const err = new Error("Google identity could not be verified.");
    err.statusCode = 401;
    throw err;
  }
  const tokenInfo = await tokenInfoResponse.json();
  assertGoogleAudience(tokenInfo.aud);

  const userInfoResponse = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!userInfoResponse.ok) {
    const err = new Error("Google profile could not be loaded.");
    err.statusCode = 401;
    throw err;
  }
  const profile = await userInfoResponse.json();
  if (!profile.sub || !isEmail(profile.email) || profile.email_verified !== true) {
    const err = new Error("Google account email must be verified.");
    err.statusCode = 401;
    throw err;
  }

  return {
    sub: String(profile.sub),
    email: normalizeEmail(profile.email),
    name: String(profile.name || "").trim(),
    given_name: String(profile.given_name || "").trim(),
    family_name: String(profile.family_name || "").trim(),
    picture: String(profile.picture || "").trim(),
  };
};

const googleAuthHandler = async (req, res) => {
  try {
    const googleProfile = await verifyGoogleCode(req);
    const existingBySub = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, country, phone, password_hash,
              role, status, email_verified, has_full_access, partial_access, current_level, target_level,
              marketing_emails_enabled, auth_provider, google_sub, avatar_url, created_at, last_login_at
       FROM users
       WHERE google_sub = $1
       LIMIT 1`,
      [googleProfile.sub]
    );
    let user = existingBySub.rows[0] ?? null;

    if (!user) {
      const existingByEmail = await pool.query(
        `SELECT id, email, username, first_name, last_name, date_of_birth, country, phone, password_hash,
                role, status, email_verified, has_full_access, partial_access, current_level, target_level,
                marketing_emails_enabled, auth_provider, google_sub, avatar_url, created_at, last_login_at
         FROM users
         WHERE email = $1
         LIMIT 1`,
        [googleProfile.email]
      );
      user = existingByEmail.rows[0] ?? null;
    }

    if (user?.google_sub && user.google_sub !== googleProfile.sub) {
      return res.status(409).json({
        ok: false,
        error: "This email is already linked to a different Google account.",
      });
    }

    if (user) {
      const updated = await pool.query(
        `UPDATE users
         SET google_sub = COALESCE(google_sub, $1),
             auth_provider = CASE
               WHEN auth_provider IS NULL OR auth_provider = 'email' THEN 'email_google'
               ELSE auth_provider
             END,
             email_verified = TRUE,
             email_verified_at = COALESCE(email_verified_at, NOW()),
             first_name = COALESCE(NULLIF(first_name, ''), $2),
             last_name = COALESCE(NULLIF(last_name, ''), $3),
             avatar_url = COALESCE(NULLIF(avatar_url, ''), $4),
             last_login_at = NOW()
         WHERE id = $5
         RETURNING id, email, username, first_name, last_name, date_of_birth, country, phone,
                   role, status, email_verified, has_full_access, partial_access, current_level, target_level,
                   marketing_emails_enabled, auth_provider, google_sub, avatar_url, created_at, last_login_at`,
        [
          googleProfile.sub,
          googleProfile.given_name || null,
          googleProfile.family_name || null,
          googleProfile.picture || null,
          user.id,
        ]
      );
      user = updated.rows[0];
    } else {
      const username = await buildUniqueGoogleUsername(googleProfile);
      const passwordHash = await bcrypt.hash(makeToken(), 12);
      const inserted = await pool.query(
        `INSERT INTO users (
           email, username, first_name, last_name, password_hash, role, status,
           email_verified, email_verified_at, auth_provider, google_sub, avatar_url, last_login_at
         )
         VALUES ($1, $2, $3, $4, $5, 'user', 'active', TRUE, NOW(), 'google', $6, $7, NOW())
         RETURNING id, email, username, first_name, last_name, date_of_birth, country, phone,
                   role, status, email_verified, has_full_access, partial_access, current_level, target_level,
                   marketing_emails_enabled, auth_provider, google_sub, avatar_url, created_at, last_login_at`,
        [
          googleProfile.email,
          username,
          googleProfile.given_name || null,
          googleProfile.family_name || null,
          passwordHash,
          googleProfile.sub,
          googleProfile.picture || null,
        ]
      );
      user = inserted.rows[0];
      await sendWelcomeEmailOnce(user).catch((emailErr) => {
        console.error("Google welcome email failed", emailErr);
      });
    }

    if (user.status !== "active") {
      return res.status(403).json({ ok: false, error: "Account is suspended" });
    }

    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE user_id = $1 AND expires_at <= NOW() AND revoked_at IS NULL`,
      [user.id]
    );
    const auth = await issueAuthTokens(user, req, res);
    await logUserAction(user.id, "auth.google", req);
    return res.json({
      ok: true,
      token: auth.token,
      accessToken: auth.token,
      expiresIn: auth.expiresIn,
      redirectTo: user.role === "admin" ? "/admin/dashboard" : "/dashboard",
      user: await sanitizeUserWithSubscriptions(user),
    });
  } catch (err) {
    const statusCode = err.statusCode || 500;
    if (statusCode >= 500) console.error("Google auth failed", err);
    return res.status(statusCode).json({
      ok: false,
      error: statusCode === 503
        ? "Google authentication is not configured yet."
        : "Google authentication failed. Please try again.",
    });
  }
};

app.post("/api/auth/google", googleAuthHandler);

const registerHandler = async (req, res) => {
  try {
    const { email, password, username, firstName, lastName, country, phone, marketingEmailsEnabled } = req.body ?? {};

    if (!isEmail(email) || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "A valid email and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    }

    const safeUsername = typeof username === "string" ? username.trim().toLowerCase() : "";
    if (!/^[a-z0-9._-]{3,30}$/.test(safeUsername)) {
      return res.status(400).json({ ok: false, error: "Username must be 3-30 chars (a-z, 0-9, . _ -)" });
    }

    const normalizedEmail = normalizeEmail(email);
    const safeFirst = typeof firstName === "string" ? firstName.trim().slice(0, 80) : null;
    const safeLast = typeof lastName === "string" ? lastName.trim().slice(0, 80) : null;
    const safeCountry = typeof country === "string" ? country.trim().toUpperCase() : "";
    const safePhone = typeof phone === "string" ? phone.trim().slice(0, 40) : "";
    if (!/^[A-Z]{2}$/.test(safeCountry)) {
      return res.status(400).json({ ok: false, error: "A valid country is required" });
    }
    if (!/^\+[\d\s().-]{7,}$/.test(safePhone)) {
      return res.status(400).json({ ok: false, error: "A valid international phone number is required" });
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = EMAIL_VERIFICATION_ENABLED ? makeToken() : null;
    const verificationCode = EMAIL_VERIFICATION_ENABLED ? makeVerificationCode() : null;
    const marketingOptIn = marketingEmailsEnabled === true;

    const insert = await pool.query(
      `INSERT INTO users (
         email, username, first_name, last_name, country, phone, password_hash, role, status,
         email_verified, verification_token_hash, verification_expires_at,
         verification_code_hash, verification_code_expires_at,
         last_verification_email_sent_at, marketing_emails_enabled
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'user', 'active', $8, $9, $10, $11, $12, NULL, $13)
       RETURNING id, email, username, first_name, last_name, country, phone, email_verified, marketing_emails_enabled`,
      [
        normalizedEmail,
        safeUsername,
        safeFirst,
        safeLast,
        safeCountry,
        safePhone,
        passwordHash,
        !EMAIL_VERIFICATION_ENABLED,
        verificationToken ? tokenHash(verificationToken) : null,
        verificationToken ? expiresFromNow(VERIFICATION_HOURS, "hours") : null,
        verificationCode ? verificationCodeHash(normalizedEmail, verificationCode) : null,
        verificationCode ? expiresFromNow(VERIFICATION_CODE_MINUTES, "minutes") : null,
        marketingOptIn,
      ]
    );
    let verificationUrl = null;
    let emailDeliveryFailed = false;
    if (verificationToken) {
      try {
        verificationUrl = await sendVerificationCodeEmail(insert.rows[0], verificationToken, verificationCode);
        await pool.query(`UPDATE users SET last_verification_email_sent_at = NOW() WHERE id = $1`, [insert.rows[0].id]);
      } catch (emailErr) {
        emailDeliveryFailed = true;
        console.error("Verification email delivery failed", emailErr);
      }
    }
    return res.status(201).json({
      ok: true,
      requiresEmailVerification: EMAIL_VERIFICATION_ENABLED,
      emailDeliveryFailed,
      message: EMAIL_VERIFICATION_ENABLED
        ? emailDeliveryFailed
          ? "Compte créé. L'email de vérification n'a pas pu être envoyé pour le moment; vous pouvez demander un nouveau code depuis la page de vérification."
          : "Compte créé. Entrez le code de vérification envoyé par email."
        : "Account created. You can now log in.",
      devVerificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl?.legacyLink,
    });
  } catch (err) {
    if (err && err.code === "23505") {
      const message = err.constraint?.includes("username")
        ? "Username already taken"
        : "Email already registered";
      return res.status(409).json({ ok: false, error: message });
    }
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/register", registerHandler);
app.post("/api/auth/register", registerHandler);

const resendVerificationHandler = async (req, res) => {
  try {
    if (!EMAIL_VERIFICATION_ENABLED) {
      return res.json({ ok: true, message: "Email verification is currently disabled." });
    }

    const email = normalizeEmail(req.body?.email);
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "A valid email is required" });
    }

    const r = await pool.query(
      `SELECT id, email, username, first_name, email_verified, last_verification_email_sent_at FROM users WHERE email = $1`,
      [email]
    );
    const user = r.rows[0];
    if (!user || user.email_verified) {
      return res.json({ ok: true, message: "If verification is needed, an email has been sent." });
    }

    if (
      user.last_verification_email_sent_at &&
      Date.now() - new Date(user.last_verification_email_sent_at).getTime() < 60_000
    ) {
      return res.status(429).json({ ok: false, error: "Veuillez attendre une minute avant de demander un nouveau code." });
    }

    const token = makeToken();
    const code = makeVerificationCode();
    await pool.query(
      `UPDATE users
       SET verification_token_hash = $1,
           verification_expires_at = $2,
           verification_code_hash = $3,
           verification_code_expires_at = $4,
           last_verification_email_sent_at = NULL
       WHERE id = $5`,
      [
        tokenHash(token),
        expiresFromNow(VERIFICATION_HOURS, "hours"),
        verificationCodeHash(email, code),
        expiresFromNow(VERIFICATION_CODE_MINUTES, "minutes"),
        user.id,
      ]
    );
    let verificationUrl;
    try {
      verificationUrl = await sendVerificationCodeEmail(user, token, code);
      await pool.query(`UPDATE users SET last_verification_email_sent_at = NOW() WHERE id = $1`, [user.id]);
    } catch (emailErr) {
      console.error("Verification resend delivery failed", emailErr);
      return res.status(502).json({
        ok: false,
        error: "L'email de vérification n'a pas pu être envoyé pour le moment. Réessayez dans quelques minutes.",
      });
    }
    return res.json({
      ok: true,
      message: "Si une vérification est nécessaire, un nouveau code a été envoyé.",
      cooldownSeconds: 60,
      devVerificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl?.legacyLink,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/resend-verification", resendVerificationHandler);
app.post("/api/auth/resend-verification", resendVerificationHandler);

const verifyEmailToken = async (token) => {
  if (!token || typeof token !== "string") return null;
  const r = await pool.query(
    `UPDATE users
     SET email_verified = TRUE,
         email_verified_at = NOW(),
         verification_token_hash = NULL,
         verification_expires_at = NULL,
         verification_code_hash = NULL,
         verification_code_expires_at = NULL
     WHERE verification_token_hash = $1
       AND verification_expires_at > NOW()
     RETURNING id, email, username, first_name, last_name, date_of_birth, country, phone,
               auth_provider, avatar_url, role, status,
               email_verified, has_full_access, partial_access, current_level, target_level,
               marketing_emails_enabled, welcome_email_sent_at, created_at, last_login_at`,
    [tokenHash(token)]
  );
  return r.rows[0] ?? null;
};

const verifyEmailCode = async (email, code) => {
  const normalizedEmail = normalizeEmail(email);
  const normalizedCode = String(code || "").trim();
  if (!isEmail(normalizedEmail) || !/^\d{6}$/.test(normalizedCode)) return null;

  const r = await pool.query(
    `UPDATE users
     SET email_verified = TRUE,
         email_verified_at = NOW(),
         verification_token_hash = NULL,
         verification_expires_at = NULL,
         verification_code_hash = NULL,
         verification_code_expires_at = NULL
     WHERE email = $1
       AND verification_code_hash = $2
       AND verification_code_expires_at > NOW()
     RETURNING id, email, username, first_name, last_name, date_of_birth, country, phone,
               auth_provider, avatar_url, role, status,
               email_verified, has_full_access, partial_access, current_level, target_level,
               marketing_emails_enabled, welcome_email_sent_at, created_at, last_login_at`,
    [normalizedEmail, verificationCodeHash(normalizedEmail, normalizedCode)]
  );
  return r.rows[0] ?? null;
};

const verifyEmailGetHandler = async (req, res) => {
  try {
    const user = await verifyEmailToken(req.params.token);
    if (!user) return res.status(400).json({ ok: false, error: "Invalid or expired verification link" });
    await sendWelcomeEmailOnce(user);
    return res.json({ ok: true, user: await sanitizeUserWithSubscriptions(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.get("/api/auth/verify-email/:token", verifyEmailGetHandler);
if (!isProduction) app.get("/verify-email/:token", verifyEmailGetHandler);

const verifyEmailPostHandler = async (req, res) => {
  try {
    const user = req.body?.token
      ? await verifyEmailToken(req.body.token)
      : await verifyEmailCode(req.body?.email, req.body?.code);
    if (!user) return res.status(400).json({ ok: false, error: "Invalid or expired verification code" });
    await sendWelcomeEmailOnce(user);
    return res.json({ ok: true, user: await sanitizeUserWithSubscriptions(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/api/auth/verify-email", verifyEmailPostHandler);
app.post("/verify-email", verifyEmailPostHandler);

const loginHandler = async (req, res) => {
  try {
    const { email, identifier, password, rememberMe } = req.body ?? {};
    const rawIdentifier = String(identifier ?? email ?? "").trim();
    const isEmailIdentifier = isEmail(rawIdentifier);
    const safeUsername = rawIdentifier.toLowerCase();

    if (!rawIdentifier || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Email/username and password are required" });
    }
    if (!isEmailIdentifier && !/^[a-z0-9._-]{3,30}$/.test(safeUsername)) {
      return res.status(400).json({ ok: false, error: "Enter a valid email or username" });
    }

    const userRes = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, country, phone,
              auth_provider, avatar_url, password_hash, role, status,
              email_verified, has_full_access, partial_access, current_level, target_level,
              marketing_emails_enabled, created_at, last_login_at
       FROM users
       WHERE email = $1 OR username = $2
       LIMIT 1`,
      [isEmailIdentifier ? normalizeEmail(rawIdentifier) : "", safeUsername]
    );
    const user = userRes.rows[0];
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    if (!user.password_hash) {
      return res.status(401).json({ ok: false, error: "Use Google sign-in for this account or reset your password." });
    }

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
    }
    if (user.status !== "active") {
      return res.status(403).json({ ok: false, error: "Account is suspended" });
    }
    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = $1`, [user.id]);
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = NOW()
       WHERE user_id = $1 AND expires_at <= NOW() AND revoked_at IS NULL`,
      [user.id]
    );
    const auth = await issueAuthTokens(user, req, res);
    await logUserAction(user.id, "auth.login", req);
    return res.json({
      ok: true,
      token: auth.token,
      accessToken: auth.token,
      expiresIn: auth.expiresIn,
      redirectTo: user.role === "admin" ? "/admin/dashboard" : "/dashboard",
      requiresEmailVerification: EMAIL_VERIFICATION_ENABLED && !user.email_verified,
      user: await sanitizeUserWithSubscriptions({ ...user, last_login_at: new Date().toISOString() }),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/login", loginHandler);
app.post("/api/auth/login", loginHandler);

const refreshHandler = async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (!refreshToken) {
      return res.status(401).json({ ok: false, error: "Missing refresh token" });
    }

    const hashed = tokenHash(refreshToken);
    const tokenRes = await pool.query(
      `SELECT rt.id AS refresh_token_id, rt.user_id, rt.expires_at, rt.revoked_at,
              u.email, u.username, u.first_name, u.last_name, u.date_of_birth, u.country, u.phone,
              u.auth_provider, u.avatar_url,
              u.role, u.status, u.email_verified, u.has_full_access, u.partial_access,
              u.current_level, u.target_level, u.marketing_emails_enabled, u.created_at, u.last_login_at
       FROM refresh_tokens rt
       JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = $1
       LIMIT 1`,
      [hashed]
    );
    const row = tokenRes.rows[0];
    if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
      clearRefreshCookie(res);
      return res.status(401).json({ ok: false, error: "Invalid refresh token" });
    }
    if (row.status !== "active") {
      await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [row.user_id]);
      clearRefreshCookie(res);
      return res.status(403).json({ ok: false, error: "Account is suspended" });
    }
    const nextRefreshToken = makeToken();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        `UPDATE refresh_tokens
         SET revoked_at = NOW(), replaced_by_token_hash = $1
         WHERE id = $2`,
        [tokenHash(nextRefreshToken), row.refresh_token_id]
      );
      await client.query(
        `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          row.user_id,
          tokenHash(nextRefreshToken),
          new Date(Date.now() + REFRESH_MAX_AGE_MS),
          String(req.get("user-agent") || "").slice(0, 500),
          getClientIp(req),
        ]
      );
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }

    const user = {
      id: row.user_id,
      email: row.email,
      username: row.username,
      first_name: row.first_name,
      last_name: row.last_name,
      date_of_birth: row.date_of_birth,
      country: row.country,
      phone: row.phone,
      auth_provider: row.auth_provider,
      avatar_url: row.avatar_url,
      role: row.role,
      status: row.status,
      email_verified: row.email_verified,
      has_full_access: row.has_full_access,
      partial_access: row.partial_access,
      current_level: row.current_level,
      target_level: row.target_level,
      marketing_emails_enabled: row.marketing_emails_enabled,
      created_at: row.created_at,
      last_login_at: row.last_login_at,
    };
    const auth = signAccessToken(user);
    setRefreshCookie(res, nextRefreshToken);
    return res.json({
      ok: true,
      token: auth.token,
      accessToken: auth.token,
      expiresIn: auth.expiresIn,
      user: await sanitizeUserWithSubscriptions(user),
    });
  } catch (err) {
    console.error(err);
    clearRefreshCookie(res);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/api/auth/refresh", refreshHandler);

const logoutHandler = async (req, res) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME];
    if (refreshToken) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE token_hash = $1 AND revoked_at IS NULL`,
        [tokenHash(refreshToken)]
      );
    }
    await revokeAccessToken(req.token);
    await logUserAction(req.user?.id, "auth.logout", req);
    clearRefreshCookie(res);
    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    clearRefreshCookie(res);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/api/auth/logout", requireAuth, logoutHandler);
app.post("/logout", requireAuth, logoutHandler);

const forgotPasswordHandler = async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "A valid email is required" });
    }

    const r = await pool.query(
      `SELECT id, email, username, first_name, status, email_verified FROM users WHERE email = $1`,
      [email]
    );
    const user = r.rows[0];
    let resetUrl;

    if (user && user.status === "active") {
      const token = makeToken();
      await pool.query(
        `UPDATE users SET reset_token_hash = $1, reset_expires_at = $2 WHERE id = $3`,
        [tokenHash(token), expiresFromNow(RESET_MINUTES, "minutes"), user.id]
      );
      try {
        resetUrl = await sendPasswordResetEmail(user, token);
      } catch (emailErr) {
        console.error("Password reset email delivery failed", emailErr);
        await pool.query(`UPDATE users SET reset_token_hash = NULL, reset_expires_at = NULL WHERE id = $1`, [user.id]);
        return res.status(502).json({
          ok: false,
          error: "L'email de réinitialisation n'a pas pu être envoyé pour le moment. Réessayez dans quelques minutes.",
        });
      }
    }

    return res.json({
      ok: true,
      message: "If this email exists, a reset link has been sent.",
      devResetUrl: process.env.NODE_ENV === "production" ? undefined : resetUrl,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/forgot-password", forgotPasswordHandler);
app.post("/api/auth/forgot-password", forgotPasswordHandler);

const resetPasswordHandler = async (req, res) => {
  try {
    const { token, password } = req.body ?? {};
    if (typeof token !== "string" || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Token and password are required" });
    }
    if (password.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    }

    const passwordHash = await bcrypt.hash(password, 12);
    const updated = await pool.query(
      `UPDATE users
       SET password_hash = $1,
           reset_token_hash = NULL,
           reset_expires_at = NULL
       WHERE reset_token_hash = $2
         AND reset_expires_at > NOW()
         AND status = 'active'
       RETURNING id, email, username, first_name`,
      [passwordHash, tokenHash(token)]
    );

    if (!updated.rows[0]) {
      return res.status(400).json({ ok: false, error: "Invalid or expired reset link" });
    }
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [updated.rows[0].id]);
    await logUserAction(updated.rows[0].id, "auth.password_reset", req);
    try {
      await sendPasswordChangedNoticeEmail(updated.rows[0]);
    } catch (emailErr) {
      console.error("Password changed notice failed", emailErr);
    }
    return res.json({ ok: true, message: "Password updated. You can now log in." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/reset-password", resetPasswordHandler);
app.post("/api/auth/reset-password", resetPasswordHandler);

const profileHandler = async (req, res) => {
  return res.json({ ok: true, user: await sanitizeUserWithSubscriptions(req.user) });
};

app.get("/me", requireAuth, profileHandler);
app.get("/api/user/profile", requireAuth, profileHandler);

const getTotalAvailableExams = async () => {
  const configuredTotal = Number.isFinite(DEFAULT_TOTAL_AVAILABLE_EXAMS)
    ? DEFAULT_TOTAL_AVAILABLE_EXAMS
    : 0;
  const exams = await pool.query(`SELECT COUNT(*)::int AS total FROM exams WHERE is_active = TRUE`);
  const content = await pool.query(`SELECT COUNT(*)::int AS total FROM exam_content`);
  return Math.max(Number(exams.rows[0]?.total ?? 0), Number(content.rows[0]?.total ?? 0), configuredTotal, 0);
};

const normalizeLevel = (value) => {
  const match = String(value ?? "").match(/\b(A1|A2|B1|B2|C1|C2)\b/i);
  return match ? match[1].toUpperCase() : null;
};

const getNextDisplayLevel = (level) => {
  const normalized = normalizeLevel(level);
  if (!normalized) return null;
  const index = LEVEL_ORDER.indexOf(normalized);
  return LEVEL_ORDER[Math.min(LEVEL_ORDER.length - 1, index + 1)] ?? normalized;
};

const getSimulationLevel = (row) =>
  normalizeLevel(row?.level_current) ||
  normalizeLevel(row?.result_details?.level) ||
  normalizeLevel(row?.result_details?.series?.level) ||
  normalizeLevel(row?.exam_name);

const getExerciseKey = (row) => {
  const details = row?.result_details || {};
  return [
    details.examCode || details.series?.examId || row?.exam_name || row?.id,
    details.series?.id || details.series?.code || "",
    details.moduleId || details.moduleTitle || "",
  ]
    .filter(Boolean)
    .join(":")
    .toLowerCase();
};

const getTotalAvailableExamsByLevel = async (level) => {
  const normalized = normalizeLevel(level);
  if (!normalized) return 0;
  const configuredTotal = Math.max(1, Math.ceil((Number(DEFAULT_TOTAL_AVAILABLE_EXAMS) || 20) / 2));
  const exams = await pool.query(
    `SELECT COUNT(*)::int AS total FROM exams WHERE is_active = TRUE AND UPPER(COALESCE(level, '')) = $1`,
    [normalized]
  );
  const content = await pool.query(
    `SELECT COUNT(*)::int AS total FROM exam_content WHERE UPPER(COALESCE(level, '')) = $1`,
    [normalized]
  );
  return Math.max(
    Number(exams.rows[0]?.total ?? 0),
    Number(content.rows[0]?.total ?? 0),
    configuredTotal
  );
};

const getUserLevelSnapshot = async (userId, options = {}) => {
  const [result, userResult] = await Promise.all([
    pool.query(
    `SELECT id, exam_name, score_pct, level_current, level_target, result_details, created_at
     FROM simulations
     WHERE user_id = $1
     ORDER BY created_at ASC, id ASC`,
    [userId]
    ),
    pool.query(`SELECT current_level, target_level FROM users WHERE id = $1`, [userId]),
  ]);
  const storedLevel = normalizeLevel(userResult.rows[0]?.current_level);

  const rows = result.rows
    .map((row) => ({ ...row, activityLevel: getSimulationLevel(row) }))
    .filter((row) => row.activityLevel);
  const additionalLevel = normalizeLevel(options.additionalLevel);
  if (additionalLevel) {
    rows.push({
      id: `activity-${additionalLevel}-${Date.now()}`,
      exam_name: `${additionalLevel} activity`,
      score_pct: 0,
      result_details: { moduleId: "started" },
      activityLevel: additionalLevel,
    });
  }

  if (!rows.length) {
    const currentLevel = storedLevel || NOT_SPECIFIED_LEVEL;
    return {
      currentLevel,
      targetLevel: getNextDisplayLevel(currentLevel),
      b1MasteryPercent: 0,
      totalActivities: 0,
    };
  }

  const latestLevel = rows[rows.length - 1].activityLevel;
  const hasB1Activity = rows.some((row) => row.activityLevel === "B1");
  const hasB2Activity = rows.some((row) => row.activityLevel === "B2");
  const masteredB1Keys = new Set(
    rows
      .filter((row) => row.activityLevel === "B1" && Number(row.score_pct) >= 70)
      .map(getExerciseKey)
  );
  const attemptedB1Keys = new Set(
    rows
      .filter((row) => row.activityLevel === "B1")
      .map(getExerciseKey)
  );
  const totalB1Available = Math.max(await getTotalAvailableExamsByLevel("B1"), attemptedB1Keys.size, 1);
  const b1MasteryPercent = Math.min(100, Math.round((masteredB1Keys.size / totalB1Available) * 100));

  let currentLevel = latestLevel;
  if (hasB1Activity) {
    currentLevel = hasB2Activity && b1MasteryPercent >= 50 ? "B2" : "B1";
  } else if (hasB2Activity) {
    currentLevel = "B2";
  }
  if (storedLevel && LEVEL_ORDER.indexOf(storedLevel) > LEVEL_ORDER.indexOf(currentLevel)) {
    currentLevel = storedLevel;
  }

  return {
    currentLevel,
    targetLevel: getNextDisplayLevel(currentLevel),
    b1MasteryPercent,
    totalActivities: rows.length,
  };
};

const syncUserLevelSnapshot = async (userId, options = {}) => {
  const snapshot = await getUserLevelSnapshot(userId, options);
  await pool.query(
    `UPDATE users
     SET current_level = $2,
         target_level = $3,
         level_updated_at = NOW()
     WHERE id = $1`,
    [userId, snapshot.currentLevel, snapshot.targetLevel]
  );
  return snapshot;
};

const getUserProgressSnapshot = async (userId) => {
  const [completedFromSimulations, completedFromResults, total, levelSnapshot] = await Promise.all([
    pool.query(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(result_details->>'examCode', ''), NULLIF(exam_name, ''), id::text))::int AS completed
       FROM simulations
       WHERE user_id = $1`,
      [userId]
    ),
    pool.query(
      `SELECT COUNT(DISTINCT COALESCE(NULLIF(exam_type, ''), id::text))::int AS completed
       FROM results
       WHERE user_id = $1`,
      [userId]
    ),
    getTotalAvailableExams(),
    getUserLevelSnapshot(userId),
  ]);

  const completed = Math.max(
    Number(completedFromSimulations.rows[0]?.completed ?? 0),
    Number(completedFromResults.rows[0]?.completed ?? 0),
    0
  );
  const percentage = total > 0 ? Math.min(100, Math.round((completed / total) * 100)) : 0;

  return {
    completed,
    total,
    percentage,
    currentLevel: levelSnapshot.currentLevel,
    targetLevel: levelSnapshot.targetLevel,
    b1MasteryPercent: levelSnapshot.b1MasteryPercent,
  };
};

const userProgressHandler = async (req, res) => {
  try {
    const progress = await getUserProgressSnapshot(req.user.id);
    return res.json(progress);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.get("/api/progress", requireAuth, userProgressHandler);
app.get("/api/user/progress", requireAuth, userProgressHandler);

const levelActivityHandler = async (req, res) => {
  try {
    const level = normalizeLevel(req.body?.level);
    if (!level) {
      return res.status(400).json({ ok: false, error: "A valid activity level is required" });
    }
    const snapshot = await syncUserLevelSnapshot(req.user.id, { additionalLevel: level });
    return res.json({ ok: true, level: snapshot });
  } catch (err) {
    console.error(err);
    return res.status(err.status && err.status < 500 ? err.status : 500).json({
      ok: false,
      error: err.status && err.status < 500 ? err.message : "Server error",
    });
  }
};

app.post("/api/user/level-activity", requireAuth, levelActivityHandler);

const recentSimulationsHandler = async (req, res) => {
  try {
    const sims = await pool.query(
      `SELECT id, exam_name, taken_at, created_at, score_pct, level_current, level_target,
              ai_corrections, result_details, duration_seconds
       FROM simulations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [req.user.id]
    );
    return res.json({ ok: true, simulations: sims.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.get("/api/user/simulations", requireAuth, recentSimulationsHandler);

const dashboardHandler = async (req, res) => {
  try {
    const userId = req.user.id;

    const simsRes = await pool.query(
      `SELECT id, exam_name, taken_at, created_at, score_pct, level_current, level_target, ai_corrections, result_details, duration_seconds
       FROM simulations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT 5`,
      [userId]
    );
    const simulations = simsRes.rows;

    const statsRes = await pool.query(
      `SELECT
         COUNT(*)::int AS total_tests,
         COALESCE(ROUND(AVG(score_pct))::int, 0) AS avg_score
       FROM simulations
       WHERE user_id = $1`,
      [userId]
    );
    const stats = statsRes.rows[0] ?? { total_tests: 0, avg_score: 0 };
    const progressSnapshot = await getUserProgressSnapshot(userId);

    const latest = simulations[0];
    const progressPct = progressSnapshot.percentage;

    const recommendations =
      latest?.ai_corrections?.recommendations && Array.isArray(latest.ai_corrections.recommendations)
        ? latest.ai_corrections.recommendations.slice(0, 6)
        : [
            "Réviser les déclinaisons de l'adjectif (cas génitif)",
            "Pratiquer l'écoute des journaux télévisés allemands",
            "Renforcer le vocabulaire lié à l'environnement",
          ];

    const skills = {
      read: Math.max(0, Math.min(100, progressPct + (stats.total_tests > 0 ? 4 : 0))),
      listen: Math.max(0, Math.min(100, progressPct + (stats.total_tests > 0 ? -8 : 0))),
      write: Math.max(0, Math.min(100, progressPct + (stats.total_tests > 0 ? -2 : 0))),
      speak: Math.max(0, Math.min(100, progressPct + (stats.total_tests > 0 ? 6 : 0))),
      grammar: Math.max(0, Math.min(100, progressPct + (stats.total_tests > 0 ? -12 : 0))),
      vocabulary: Math.max(0, Math.min(100, progressPct + (stats.total_tests > 0 ? 2 : 0))),
    };
    const visibleRecommendations = stats.total_tests > 0 ? recommendations : [];

    return res.json({
      ok: true,
      user: await sanitizeUserWithSubscriptions({
        ...req.user,
        current_level: progressSnapshot.currentLevel,
        target_level: progressSnapshot.targetLevel,
      }),
      progress: {
        percent: progressPct,
        completed: progressSnapshot.completed,
        total: progressSnapshot.total,
        percentage: progressSnapshot.percentage,
        currentLevel: progressSnapshot.currentLevel,
        targetLevel: progressSnapshot.targetLevel,
        b1MasteryPercent: progressSnapshot.b1MasteryPercent,
        totalTests: stats.total_tests,
        avgScore: stats.avg_score,
      },
      recommendations: visibleRecommendations,
      skills,
      simulations,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.get("/api/dashboard", requireAuth, dashboardHandler);
if (!isProduction) app.get("/dashboard", requireAuth, dashboardHandler);

const updateProfileHandler = async (req, res) => {
  try {
    const { username, firstName, lastName, email, dateOfBirth, marketingEmailsEnabled } = req.body ?? {};
    if (
      typeof username !== "string" ||
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof email !== "string"
    ) {
      return res.status(400).json({
        ok: false,
        error: "username, firstName, lastName and email are required",
      });
    }

    const safeUsername = username.trim().toLowerCase();
    const safeFirst = firstName.trim().slice(0, 80);
    const safeLast = lastName.trim().slice(0, 80);
    const safeEmail = normalizeEmail(email);
    const safeDob = typeof dateOfBirth === "string" ? dateOfBirth.trim() : "";

    if (!/^[a-z0-9._-]{3,30}$/.test(safeUsername)) {
      return res.status(400).json({ ok: false, error: "Username must be 3-30 chars (a-z, 0-9, . _ -)" });
    }
    if (!safeFirst || !safeLast) {
      return res.status(400).json({ ok: false, error: "First name and last name are required" });
    }
    if (!isEmail(safeEmail)) {
      return res.status(400).json({ ok: false, error: "A valid email is required" });
    }
    if (safeDob && !/^\d{4}-\d{2}-\d{2}$/.test(safeDob)) {
      return res.status(400).json({ ok: false, error: "dateOfBirth must be in YYYY-MM-DD format" });
    }

    const emailChanged = safeEmail !== req.user.email;
    const shouldTrustEmail = !EMAIL_VERIFICATION_REQUIRED && emailChanged;
    const shouldSendVerification = EMAIL_VERIFICATION_ENABLED && emailChanged;
    const verificationToken = shouldSendVerification ? makeToken() : null;
    const verificationCode = shouldSendVerification ? makeVerificationCode() : null;
    const marketingPreference =
      typeof marketingEmailsEnabled === "boolean"
        ? marketingEmailsEnabled
        : Boolean(req.user.marketing_emails_enabled);

    const updated = await pool.query(
      `UPDATE users
       SET username = $1,
           first_name = $2,
           last_name = $3,
           email = $4,
           date_of_birth = COALESCE($5::date, date_of_birth),
           email_verified = CASE WHEN $6 THEN FALSE WHEN $11 THEN TRUE ELSE email_verified END,
           email_verified_at = CASE WHEN $6 THEN NULL WHEN $11 THEN NOW() ELSE email_verified_at END,
           verification_token_hash = CASE WHEN $6 THEN $7 ELSE verification_token_hash END,
           verification_expires_at = CASE WHEN $6 THEN $8 ELSE verification_expires_at END,
           verification_code_hash = CASE WHEN $6 THEN $9 ELSE verification_code_hash END,
           verification_code_expires_at = CASE WHEN $6 THEN $10 ELSE verification_code_expires_at END,
           last_verification_email_sent_at = CASE WHEN $6 THEN NOW() ELSE last_verification_email_sent_at END,
           marketing_emails_enabled = $12,
           marketing_unsubscribed_at = CASE WHEN $12 THEN NULL ELSE COALESCE(marketing_unsubscribed_at, NOW()) END
       WHERE id = $13
       RETURNING id, email, username, first_name, last_name, date_of_birth, country, phone,
                 auth_provider, avatar_url, role, status,
                 email_verified, has_full_access, partial_access, current_level, target_level,
                 marketing_emails_enabled, welcome_email_sent_at, created_at, last_login_at`,
      [
        safeUsername,
        safeFirst,
        safeLast,
        safeEmail,
        safeDob || null,
        shouldSendVerification,
        verificationToken ? tokenHash(verificationToken) : null,
        verificationToken ? expiresFromNow(VERIFICATION_HOURS, "hours") : null,
        verificationCode ? verificationCodeHash(safeEmail, verificationCode) : null,
        verificationCode ? expiresFromNow(VERIFICATION_CODE_MINUTES, "minutes") : null,
        shouldTrustEmail,
        marketingPreference,
        req.user.id,
      ]
    );

    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "User not found" });
    let verificationUrl;
    if (shouldSendVerification) {
      verificationUrl = await sendVerificationCodeEmail(updated.rows[0], verificationToken, verificationCode);
    }
    return res.json({
      ok: true,
      user: await sanitizeUserWithSubscriptions(updated.rows[0]),
      requiresEmailVerification: shouldSendVerification,
      devVerificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl?.legacyLink,
    });
  } catch (err) {
    if (err && err.code === "23505") {
      return res.status(409).json({ ok: false, error: "Username or email already taken" });
    }
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.put("/me", requireAuth, updateProfileHandler);
app.put("/api/user/profile", requireAuth, updateProfileHandler);

const updateEmailPreferencesHandler = async (req, res) => {
  try {
    const marketingEnabled = req.body?.marketingEmailsEnabled === true;
    const updated = await pool.query(
      `UPDATE users
       SET marketing_emails_enabled = $2,
           marketing_unsubscribed_at = CASE WHEN $2 THEN NULL ELSE COALESCE(marketing_unsubscribed_at, NOW()) END
       WHERE id = $1
       RETURNING id, email, username, first_name, last_name, date_of_birth, country, phone,
                 auth_provider, avatar_url, role, status,
                 email_verified, has_full_access, partial_access, current_level, target_level,
                 marketing_emails_enabled, created_at, last_login_at`,
      [req.user.id, marketingEnabled]
    );
    return res.json({ ok: true, user: await sanitizeUserWithSubscriptions(updated.rows[0]) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.put("/api/user/email-preferences", requireAuth, updateEmailPreferencesHandler);

const createSimulationHandler = async (req, res) => {
  try {
    const { examName, scorePct, levelCurrent, levelTarget, aiCorrections, resultDetails, durationSeconds } = req.body ?? {};
    if (typeof examName !== "string" || !examName.trim()) {
      return res.status(400).json({ ok: false, error: "examName is required" });
    }
    const score = Number(scorePct);
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      return res.status(400).json({ ok: false, error: "scorePct must be 0..100" });
    }

    const insert = await pool.query(
      `INSERT INTO simulations (
         user_id, exam_name, score_pct, level_current, level_target, ai_corrections,
         result_details, duration_seconds
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, exam_name, taken_at, created_at, score_pct, level_current, level_target, ai_corrections, result_details, duration_seconds`,
      [
        req.user.id,
        examName.trim().slice(0, 140),
        Math.round(score),
        typeof levelCurrent === "string" ? levelCurrent.trim().slice(0, 10) : null,
        typeof levelTarget === "string" ? levelTarget.trim().slice(0, 10) : null,
        aiCorrections && typeof aiCorrections === "object" ? aiCorrections : {},
        resultDetails && typeof resultDetails === "object" ? resultDetails : {},
        Number.isFinite(Number(durationSeconds)) ? Math.max(0, Math.round(Number(durationSeconds))) : null,
      ]
    );
    await pool.query(
      `INSERT INTO results (user_id, exam_type, score, completed_at)
       VALUES ($1, $2, $3, $4)`,
      [req.user.id, examName.trim().slice(0, 50), Math.round(score), insert.rows[0].created_at]
    );
    const levelSnapshot = await syncUserLevelSnapshot(req.user.id);
    await logUserAction(req.user.id, "simulation.completed", req);

    return res.status(201).json({
      ok: true,
      simulation: insert.rows[0],
      userLevel: levelSnapshot,
      writingCorrection: null,
      correctionPending: isWritingSimulation(insert.rows[0]),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/simulations", requireAuth, createSimulationHandler);
app.post("/api/user/simulations", requireAuth, createSimulationHandler);

const getOwnedSimulation = async (req, res) => {
  const simulationId = Number(req.params.simulationId || req.params.id);
  if (!Number.isInteger(simulationId) || simulationId <= 0) {
    res.status(400).json({ ok: false, error: "Invalid simulation id" });
    return null;
  }

  const params = [simulationId];
  const ownerClause = req.user.role === "admin" ? "" : "AND user_id = $2";
  if (req.user.role !== "admin") params.push(req.user.id);

  const simulation = await pool.query(
    `SELECT id, user_id, exam_name, taken_at, created_at, score_pct, level_current, level_target,
            ai_corrections, result_details, duration_seconds
     FROM simulations
     WHERE id = $1 ${ownerClause}
     LIMIT 1`,
    params
  );

  if (!simulation.rows[0]) {
    res.status(404).json({ ok: false, error: "Simulation not found" });
    return null;
  }
  return simulation.rows[0];
};

app.get("/api/simulations/:simulationId/writing-correction", requireAuth, async (req, res) => {
  try {
    const simulation = await getOwnedSimulation(req, res);
    if (!simulation) return;
    const correction = await getWritingCorrectionForSimulation(pool, simulation.id);
    return res.json({ ok: true, correction });
  } catch (err) {
    console.error("Writing correction lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/simulations/:simulationId/writing-correction", requireAuth, async (req, res) => {
  try {
    const simulation = await getOwnedSimulation(req, res);
    if (!simulation) return;
    if (!isWritingSimulation(simulation)) {
      return res.status(400).json({ ok: false, error: "Simulation is not a writing module" });
    }
    const correction = await correctWritingSimulation(pool, simulation, {
      force: req.query.force === "true" || req.body?.force === true,
    });
    return res.json({ ok: true, correction });
  } catch (err) {
    console.error("Writing correction request failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/speaking/recordings", requireAuth, speakingAudioUpload.single("audio"), async (req, res) => {
  try {
    const recording = await saveSpeakingRecording(pool, {
      userId: req.user.id,
      file: req.file,
      body: req.body,
    });
    return res.status(201).json({
      ok: true,
      recording: {
        id: recording.id,
        taskId: recording.task_id,
        mimeType: recording.mime_type,
        byteSize: recording.byte_size,
        durationSeconds: recording.duration_seconds,
        status: recording.status,
        createdAt: recording.created_at,
      },
    });
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error("Speaking recording upload failed", err);
    return res.status(status).json({ ok: false, error: status >= 500 ? "Server error" : err.message });
  }
});

app.get("/api/simulations/:simulationId/speaking-correction", requireAuth, async (req, res) => {
  try {
    const simulation = await getOwnedSimulation(req, res);
    if (!simulation) return;
    const correction = await getSpeakingCorrectionForSimulation(pool, simulation.id);
    return res.json({ ok: true, correction });
  } catch (err) {
    console.error("Speaking correction lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/simulations/:simulationId/speaking-correction", requireAuth, async (req, res) => {
  try {
    const simulation = await getOwnedSimulation(req, res);
    if (!simulation) return;
    if (!isSpeakingSimulation(simulation)) {
      return res.status(400).json({ ok: false, error: "Simulation is not a speaking module" });
    }
    const correction = await correctSpeakingSimulation(pool, simulation, {
      force: req.query.force === "true" || req.body?.force === true,
    });
    return res.json({ ok: true, correction });
  } catch (err) {
    console.error("Speaking correction request failed", err);
    return res.status(err.status || 500).json({ ok: false, error: err.status ? err.message : "Server error" });
  }
});

app.post("/contact", async (req, res) => {
  try {
    const { firstName, lastName, email, phone, message } = req.body ?? {};
    if (
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      !isEmail(email) ||
      typeof message !== "string"
    ) {
      return res.status(400).json({ ok: false, error: "Invalid contact payload" });
    }

    const safeFirst = firstName.trim().slice(0, 80);
    const safeLast = lastName.trim().slice(0, 80);
    const safeEmail = normalizeEmail(email);
    const safePhone = typeof phone === "string" ? phone.trim().slice(0, 40) : "";
    const safeMessage = message.trim().slice(0, 5000);

    if (!safeFirst || !safeLast || !safeMessage) {
      return res.status(400).json({ ok: false, error: "Please provide valid contact details" });
    }

    await sendEmail({
      pool,
      to: process.env.CONTACT_TO || process.env.SUPPORT_EMAIL || "support@n-deutschprüfungen.com",
      type: "contact",
      subject: `Nouveau message contact: ${safeFirst} ${safeLast}`,
      text: [
        `Nom: ${safeLast}`,
        `Prénom: ${safeFirst}`,
        `Email: ${safeEmail}`,
        `Téléphone: ${safePhone || "-"}`,
        "",
        "Message:",
        safeMessage,
      ].join("\n"),
    });

    return res.json({ ok: true });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Unable to send message" });
  }
});

app.get("/api/testimonials", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, display_name, role_label, rating, comment, created_at
         FROM testimonials
        WHERE status = 'approved'
        ORDER BY created_at DESC
        LIMIT 12`
    );
    return res.json({
      ok: true,
      testimonials: result.rows.map((row) => ({
        id: row.id,
        displayName: row.display_name,
        roleLabel: row.role_label,
        rating: Number(row.rating),
        comment: row.comment,
        createdAt: row.created_at,
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/testimonials", testimonialRateLimiter, requireAuth, async (req, res) => {
  try {
    const comment = cleanPublicText(req.body?.comment, 1000);
    const rating = Math.max(1, Math.min(5, Math.round(Number(req.body?.rating || 5))));
    const displayName = cleanPublicText(
      req.body?.displayName || req.user.first_name || req.user.username || req.user.email,
      80
    );
    const roleLabel = cleanPublicText(req.body?.roleLabel || "Candidat", 80);
    if (comment.length < 20) {
      return res.status(400).json({ ok: false, error: "Le commentaire doit contenir au moins 20 caractères." });
    }
    const recent = await pool.query(
      `SELECT COUNT(*)::int AS count
         FROM testimonials
        WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [req.user.id]
    );
    if (Number(recent.rows[0]?.count || 0) >= 3) {
      return res.status(429).json({ ok: false, error: "Veuillez patienter avant d'envoyer un autre avis." });
    }
    const inserted = await pool.query(
      `INSERT INTO testimonials (user_id, display_name, role_label, rating, comment, status)
       VALUES ($1, $2, $3, $4, $5, 'pending')
       RETURNING id, status, created_at`,
      [req.user.id, displayName || "Candidat", roleLabel, rating, comment]
    );
    return res.status(201).json({
      ok: true,
      testimonial: inserted.rows[0],
      message: "Merci. Votre avis sera publié après validation.",
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/admin/users", requireAdmin, async (req, res) => {
  try {
    const users = await pool.query(`
      SELECT u.id, u.email, u.username, u.first_name, u.last_name, u.role, u.status,
             u.email_verified, u.has_full_access, u.partial_access, u.created_at, u.last_login_at, u.suspended_at,
             COUNT(s.id)::int AS simulation_count,
             COALESCE(ROUND(AVG(s.score_pct))::int, 0) AS avg_score
      FROM users u
      LEFT JOIN simulations s ON s.user_id = u.id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    return res.json({ ok: true, users: users.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const updateAdminUserStatusHandler = async (req, res) => {
  try {
    const targetId = Number(req.params.id);
    const { status, hasFullAccess, role, partialAccess } = req.body ?? {};
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid user id" });
    }
    if (targetId === req.user.id && status === "suspended") {
      return res.status(400).json({ ok: false, error: "You cannot suspend your own admin account" });
    }
    const nextStatus = status === "suspended" ? "suspended" : status === "active" ? "active" : null;
    const nextRole = role === "admin" || role === "user" ? role : null;
    const nextPartialAccess = Array.isArray(partialAccess) ? normalizePartialAccess(partialAccess) : null;
    const nextHasFullAccess = typeof hasFullAccess === "boolean" ? hasFullAccess : null;

    const updated = await pool.query(
      `UPDATE users
       SET status = COALESCE($1, status),
           suspended_at = CASE WHEN $1 = 'suspended' THEN NOW() WHEN $1 = 'active' THEN NULL ELSE suspended_at END,
           has_full_access = COALESCE($2, has_full_access),
           role = COALESCE($3, role),
           partial_access = COALESCE($4::jsonb, partial_access)
       WHERE id = $5
       RETURNING id, email, username, first_name, last_name, role, status,
                 email_verified, has_full_access, partial_access, created_at, last_login_at, suspended_at`,
      [
        nextStatus,
        nextHasFullAccess,
        nextRole,
        nextPartialAccess ? JSON.stringify(nextPartialAccess) : null,
        targetId,
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "User not found" });
    if (nextStatus === "suspended" || nextRole) {
      await pool.query(
        `UPDATE refresh_tokens SET revoked_at = NOW()
         WHERE user_id = $1 AND revoked_at IS NULL`,
        [targetId]
      );
    }
    await auditAdminAction(req, "user.update_access", "user", targetId, {
      status: nextStatus,
      hasFullAccess: nextHasFullAccess,
      partialAccess: nextPartialAccess,
      role: nextRole,
    });
    await logUserAction(targetId, nextStatus === "suspended" ? "account.suspended" : "account.updated", req);
    return res.json({ ok: true, user: updated.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.patch("/api/admin/users/:id/status", requireAdmin, updateAdminUserStatusHandler);
app.patch("/api/admin/users/:id/suspend", requireAdmin, (req, res) => {
  req.body = { ...(req.body ?? {}), status: req.body?.status === "active" ? "active" : "suspended" };
  return updateAdminUserStatusHandler(req, res);
});

app.get("/api/admin/testimonials", requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT t.*, u.email AS user_email, a.email AS reviewed_by_email
         FROM testimonials t
         LEFT JOIN users u ON u.id = t.user_id
         LEFT JOIN users a ON a.id = t.reviewed_by
        ORDER BY t.created_at DESC
        LIMIT 200`
    );
    return res.json({ ok: true, testimonials: result.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.patch("/api/admin/testimonials/:id", requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const status = ["pending", "approved", "rejected"].includes(req.body?.status) ? req.body.status : null;
    const displayName = req.body?.displayName == null ? null : cleanPublicText(req.body.displayName, 80);
    const roleLabel = req.body?.roleLabel == null ? null : cleanPublicText(req.body.roleLabel, 80);
    const comment = req.body?.comment == null ? null : cleanPublicText(req.body.comment, 1000);
    const rating = req.body?.rating == null ? null : Math.max(1, Math.min(5, Math.round(Number(req.body.rating))));
    const adminNote = req.body?.adminNote == null ? null : cleanPublicText(req.body.adminNote, 500);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: "Invalid testimonial id" });
    if (comment != null && comment.length < 20) {
      return res.status(400).json({ ok: false, error: "Comment is too short" });
    }
    const updated = await pool.query(
      `UPDATE testimonials
          SET status = COALESCE($1, status),
              display_name = COALESCE(NULLIF($2, ''), display_name),
              role_label = COALESCE($3, role_label),
              comment = COALESCE($4, comment),
              rating = COALESCE($5, rating),
              admin_note = COALESCE($6, admin_note),
              reviewed_by = CASE WHEN $1 IS NULL THEN reviewed_by ELSE $7 END,
              reviewed_at = CASE WHEN $1 IS NULL THEN reviewed_at ELSE NOW() END,
              updated_at = NOW()
        WHERE id = $8
        RETURNING *`,
      [status, displayName, roleLabel, comment, rating, adminNote, req.user.id, id]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Testimonial not found" });
    await auditAdminAction(req, "testimonial.update", "testimonial", id, {
      status,
      edited: Boolean(displayName || roleLabel || comment || rating || adminNote),
    });
    return res.json({ ok: true, testimonial: updated.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const adminAnalyticsHandler = async (req, res) => {
  try {
    const [users, simulations, exams, audit] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*)::int AS total_users,
          COUNT(*) FILTER (WHERE status = 'active')::int AS active_users,
          COUNT(*) FILTER (WHERE status = 'suspended')::int AS suspended_users,
          COUNT(*) FILTER (WHERE email_verified)::int AS verified_users,
          COUNT(*) FILTER (WHERE role = 'admin')::int AS admin_users
        FROM users
      `),
      pool.query(`
        SELECT
          COUNT(*)::int AS total_simulations,
          COALESCE(ROUND(AVG(score_pct))::int, 0) AS avg_score,
          COUNT(*) FILTER (WHERE taken_at > NOW() - INTERVAL '7 days')::int AS simulations_7d
        FROM simulations
      `),
      pool.query(`
        SELECT exam_name, COUNT(*)::int AS attempts, COALESCE(ROUND(AVG(score_pct))::int, 0) AS avg_score
        FROM simulations
        GROUP BY exam_name
        ORDER BY attempts DESC
        LIMIT 8
      `),
      pool.query(`
        SELECT a.id, a.action, a.target_type, a.target_id, a.metadata, a.created_at,
               u.email AS admin_email
        FROM admin_audit_logs a
        LEFT JOIN users u ON u.id = a.admin_user_id
        ORDER BY a.created_at DESC
        LIMIT 10
      `),
    ]);
    return res.json({
      ok: true,
      analytics: {
        ...users.rows[0],
        ...simulations.rows[0],
        exam_usage: exams.rows,
        recent_audit: audit.rows,
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.get("/api/admin/analytics", requireAdmin, adminAnalyticsHandler);
app.get("/api/admin/stats", requireAdmin, adminAnalyticsHandler);

app.get("/api/admin/api-usage", requireAdmin, async (req, res) => {
  try {
    const usage = await pool.query(`
      SELECT u.id AS user_id, u.email, u.username,
             COUNT(l.id)::int AS total_calls,
             COUNT(l.id) FILTER (WHERE l.is_ai_usage)::int AS ai_calls,
             COALESCE(SUM(l.units) FILTER (WHERE l.is_ai_usage), 0)::int AS ai_units,
             MAX(l.created_at) AS last_call_at
      FROM users u
      LEFT JOIN api_usage_logs l ON l.user_id = u.id
      GROUP BY u.id
      ORDER BY total_calls DESC, last_call_at DESC NULLS LAST
      LIMIT 100
    `);
    const recent = await pool.query(`
      SELECT l.id, l.method, l.path, l.status_code, l.feature, l.is_ai_usage, l.units, l.created_at,
             u.email
      FROM api_usage_logs l
      LEFT JOIN users u ON u.id = l.user_id
      ORDER BY l.created_at DESC
      LIMIT 50
    `);
    const summary = await pool.query(`
      SELECT
        COUNT(*)::int AS total_calls,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours')::int AS calls_24h,
        COUNT(*) FILTER (WHERE is_ai_usage)::int AS ai_requests,
        COALESCE(SUM(units) FILTER (WHERE is_ai_usage), 0)::int AS token_usage
      FROM api_usage_logs
    `);
    const tokenUsage = Number(summary.rows[0]?.token_usage ?? 0);
    const costPerThousand = Number(process.env.AI_COST_PER_1K_TOKENS || 0.002);
    return res.json({
      ok: true,
      usage: usage.rows,
      recent: recent.rows,
      summary: {
        ...summary.rows[0],
        estimated_cost: Number(((tokenUsage / 1000) * costPerThousand).toFixed(4)),
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const normalizeOptionalText = (value, maxLength = 5000) => {
  if (value === undefined) return undefined;
  if (value === null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, maxLength) : null;
};

const normalizeJsonPayload = (value, fallback = {}) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return fallback;
  if (typeof value === "string") {
    const text = value.trim();
    if (!text) return fallback;
    return JSON.parse(text);
  }
  return value;
};

const normalizeInteger = (value, fallback = null) => {
  if (value === undefined) return undefined;
  if (value === null || value === "") return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : fallback;
};

const touchExam = (examId, client = pool) =>
  client.query(`UPDATE exams SET updated_at = NOW() WHERE id = $1`, [examId]);

registerContentStyleRoutes({ app, pool, requireAdmin, auditAdminAction });

const loadListeningExamAudioContext = async (examId) => {
  const examResult = await pool.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
  const exam = examResult.rows[0];
  if (!exam) return { error: "Exam not found", status: 404 };
  if (exam.section_type !== "listen") return { error: "Audio generation is only available for Hoeren exams.", status: 400 };
  const sections = await pool.query(
    `SELECT *
       FROM exam_sections
      WHERE exam_id = $1
      ORDER BY position, id`,
    [examId]
  );
  const questions = await pool.query(
    `SELECT q.*, e.level, s.title AS section_title, s.part_number,
            s.instructions AS section_instructions,
            s.duration_minutes AS section_duration_minutes,
            s.points AS section_points,
            s.scoring AS section_scoring,
            s.metadata AS section_metadata,
            s.position AS section_position
       FROM exam_questions q
       JOIN exams e ON e.id = q.exam_id
       LEFT JOIN exam_sections s ON s.id = q.section_id
      WHERE q.exam_id = $1
      ORDER BY COALESCE(s.position, 0), q.position, q.id`,
    [examId]
  );
  const metadata = asJsonObject(exam.metadata);
  const sourceLabel = metadata.sourceLabel || `Series ${String(exam.series_number || "").padStart(2, "0")}`;
  return {
    exam,
    sections: sections.rows,
    questions: questions.rows,
    audio: buildImportedListeningAudio({
      title: metadata.title || sourceLabel || exam.name,
      sourceLabel,
      sections: sections.rows,
      questions: questions.rows,
    }),
  };
};

const ensureListeningAudioProductionSchema = async () => {
  await ensureDocumentImportSchema(pool);
  await ensureAudioAssetSchema(pool);
  await ensureVoiceProfileSchema(pool);
  await pool.query(`
    ALTER TABLE exam_listening_audio_items
      ADD COLUMN IF NOT EXISTS voice_profile_map JSONB NOT NULL DEFAULT '{}'::jsonb,
      ADD COLUMN IF NOT EXISTS admin_notes TEXT,
      ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
      ADD COLUMN IF NOT EXISTS generation_log JSONB NOT NULL DEFAULT '[]'::jsonb;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS exam_listening_audio_items_exam_status_idx ON exam_listening_audio_items(exam_id, audio_generation_status, part_number, item_number);`);
  await pool.query(`CREATE UNIQUE INDEX IF NOT EXISTS exam_listening_audio_items_exam_part_item_uidx ON exam_listening_audio_items(exam_id, part_number, item_number);`);
};

const inferListeningVoiceSettings = ({ transcript, itemNumber, audioSettings = {}, profiles = [] }) => {
  const text = `${transcript || ""}\n${JSON.stringify(audioSettings || {})}`;
  const ignoredLabel = /^(?:(?:der|die|das)\s+.+|sie|text|track|audio|teil|thema|das thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|geh[oö]rt|format|transkription|transcription|type de t[aâ]che|heute|und|dann|erstens|zweitens|drittens|au[ßs]erdem|überraschungen|ueberraschungen|kluft|weltbild|sprache|achtsamkeit|pakete|qualit[aä]tsfinanzierung|qualitaetsfinanzierung|vorteile|nachteile|optionen|zum abschluss)\s*\d*$/i;
  const dialogueLabels = parseSpeakerSegments({
    transcript,
    tracks: [{
      id: `listening-item-${itemNumber || "admin"}`,
      transcript,
      audio: { transcript },
    }],
  })
    .map((segment) => String(segment.speaker || "").trim())
    .filter((label) => label && label !== "Narrator" && !ignoredLabel.test(label));
  const hasDialogue = dialogueLabels.length > 0;
  const femaleProfiles = profiles.filter((profile) => profile.gender === "female");
  const maleProfiles = profiles.filter((profile) => profile.gender === "male");
  const pick = (list, index = 0) => list[index % Math.max(1, list.length)] || {};
  const configuredSpeakers = Array.isArray(audioSettings?.speakers) ? audioSettings.speakers : [];
  const configuredGenderFor = (name) => {
    const folded = foldPlain(name);
    const match = configuredSpeakers.find((speaker) => {
      const labels = [speaker.speaker, speaker.voiceName, speaker.id].map(foldPlain).filter(Boolean);
      return labels.some((label) => folded && (folded === label || folded.includes(label)));
    });
    return String(match?.suggestedGender || match?.gender || "").toLowerCase();
  };
  if (!hasDialogue) {
    const prefersMale = /\b(?:homme|male|mann|maennlich|sprecher\s*b|speaker\s*b)\b/i.test(text) && Number(itemNumber) % 2 === 0;
    const profile = prefersMale ? pick(maleProfiles) : pick(femaleProfiles);
    return [{
      speaker: "Narrator",
      gender: profile.gender || (prefersMale ? "male" : "female"),
      suggestedGender: profile.gender || (prefersMale ? "male" : "female"),
      voiceId: profile.voice_id || undefined,
      voiceName: profile.label || undefined,
      role: "narration",
      style: profile.style || "Deutsch, klar, pruefungsgerecht",
      ...(asJsonObject(profile.settings)),
    }];
  }

  const speakers = [];
  const seen = new Set();
  dialogueLabels.forEach((name) => {
    const key = foldPlain(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const configuredGender = configuredGenderFor(name);
    const looksFemale = /\b(?:frau|mutter|tochter|freundin|kundin|mitarbeiterin|beraterin|reiseberaterin|anna|julia|julie|maria|sara|clara|eva|gabi|moderatorin|sprecherin|reporterin|katrin|monika|lena|hannah|nadja|klara|nina|mira|petra|sabine|lara|greta|sophie)\b/i.test(name);
    const looksMale = /\b(?:herr|vater|sohn|freund|ben|daniel|frank|mike|moderator|sprecher|reporter|thomas|klaus|marco|tobias|lukas|pawel|bernd|otto|markus|stefan|robert|tim|felix|karl|ralf|tom|kunde|student|reisender|dr\.\s*(?:felix|stark|haas|schulz))\b/i.test(name);
    const gender = looksFemale && !looksMale
      ? "female"
      : looksMale && !looksFemale
        ? "male"
        : configuredGender === "male" || configuredGender === "female"
      ? configuredGender
      : "female";
    const list = gender === "male" ? maleProfiles : femaleProfiles;
    const profile = pick(list, speakers.filter((speaker) => speaker.gender === gender).length);
    speakers.push({
      speaker: name,
      gender,
      suggestedGender: gender,
      voiceId: profile.voice_id || undefined,
      voiceName: profile.label || undefined,
      role: "dialogue",
      style: profile.style || "natuerlich, klar, dialogisch",
      ...(asJsonObject(profile.settings)),
    });
  });
  return speakers.length ? speakers : inferListeningVoiceSettings({ transcript: "", itemNumber, audioSettings, profiles });
};

const isListeningTemplateTranscript = (transcript) =>
  /\bsprecher(?:in)?\s*:\s*_+/i.test(transcript) ||
  /\(not found in source|manual review required\)/i.test(transcript) ||
  /_{3,}/.test(transcript);

const isListeningProductionLine = (line) =>
  /^(?:(?:der|die|das)\s+[^:]+|sie|thema|das thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|format|transkription|transcription|type de t[aâ]che|heute|und|dann|erstens|zweitens|drittens|au[ßs]erdem|überraschungen|ueberraschungen|kluft|weltbild|sprache|achtsamkeit|pakete|qualit[aä]tsfinanzierung|qualitaetsfinanzierung|vorteile|nachteile|optionen|zum abschluss)\s*:/i.test(line) ||
  /^\s*(?:n|■|-)?\s*\[?(?:anfang|ende|pause|sfx|audio script|zweite wiedergabe|wiederholung)\]?/i.test(line);

const extractListeningDialogueSpeakerLabels = ({ transcript, settings }) => {
  const settingLabels = [];
  const transcriptLabels = [];
  const add = (target, value) => {
    const normalized = String(value || "")
      .replace(/^\s*(?:n|■|-)\s*/i, "")
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .trim();
    if (!normalized || /^(?:(?:der|die|das)\s+.+|sie|text|track|audio|teil|thema|das thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|geh[oö]rt|format|transkription|transcription|type de t[aâ]che|heute|und|dann|erstens|zweitens|drittens|au[ßs]erdem|überraschungen|ueberraschungen|kluft|weltbild|sprache|achtsamkeit|pakete|qualit[aä]tsfinanzierung|qualitaetsfinanzierung|vorteile|nachteile|optionen|zum abschluss)\s*\d*$/i.test(normalized)) return;
    const folded = foldPlain(normalized);
    if (!folded || target.some((label) => foldPlain(label) === folded)) return;
    target.push(normalized);
  };
  const speakers = Array.isArray(settings?.speakers) ? settings.speakers : [];
  speakers.forEach((speaker) => add(settingLabels, speaker.speaker || speaker.voiceName || speaker.id));
  Array.from(String(transcript || "").matchAll(/(?:^|\n)\s*(?:n|■|-)?\s*((?:Herr|Frau|Dr\.?\s+[A-ZÄÖÜ][^:\n]{0,28}|Moderator|Moderatorin|Gast|Reporter|Reporterin|Sprecher|Sprecherin)(?:\s+[A-ZÄÖÜ][^:\n]{0,36})?)\s*:/g))
    .forEach((match) => add(transcriptLabels, match[1]));
  if (transcriptLabels.length < 2 && settingLabels.length < 2) {
    Array.from(String(transcript || "").matchAll(/(?:^|\n)\s*([A-ZÄÖÜ][^:\n]{1,36})\s*:/gu))
      .forEach((match) => add(transcriptLabels, match[1]));
  }
  return (transcriptLabels.length >= 2 ? transcriptLabels : settingLabels).slice(0, 4);
};

const findKnownListeningSpeakerLabel = (label, speakerLabels) => {
  const folded = foldPlain(label);
  return speakerLabels.find((speaker) => {
    const speakerFolded = foldPlain(speaker);
    return folded === speakerFolded || folded.includes(speakerFolded);
  }) || "";
};

const prepareListeningTranscriptForTts = ({ transcript, title, settings }) => {
  if (isListeningTemplateTranscript(transcript || "")) return "";
  const normalized = stripProductionMarkers(transcript || "");
  if (!normalized || isListeningTemplateTranscript(normalized)) return "";
  if (!/\b(?:radiointerview|radiogespr[aä]ch|radiogespraech|dialog|dialogue|interview|diskussion|discussion)\b/i.test(`${title || ""} ${JSON.stringify(settings || {})}`)) {
    return normalized;
  }
  const speakerLabels = extractListeningDialogueSpeakerLabels({ transcript: normalized, settings });
  if (speakerLabels.length < 2) return normalized;
  let turnIndex = 0;
  const prepared = normalized.split(/\n+/).map((line) => line.trim()).filter(Boolean).reduce((lines, rawLine) => {
    const line = rawLine.replace(/^\s*(?:format|transkription|transcription)\s*:\s*/i, "").trim();
    if (isListeningProductionLine(line)) return lines;
    if (/^\s*(?:n|■|-)?\s*(?:Moderator|Moderatorin|Gast|Reporter|Reporterin|Sprecher|Sprecherin)\b[^:\n]*:/i.test(line)) return lines;
    const labelMatch = line.match(/^\s*(?:n|■|-)?\s*([A-ZÄÖÜ][^:\n]{1,48})\s*:\s*(.*)$/u);
    if (labelMatch) {
      const knownLabel = findKnownListeningSpeakerLabel(labelMatch[1], speakerLabels);
      if (knownLabel) {
        lines.push(`${knownLabel}: ${labelMatch[2]}`.trim());
      } else if (labelMatch[2]) {
        lines.push(`${speakerLabels[turnIndex % speakerLabels.length]}: ${labelMatch[2]}`.trim());
        turnIndex += 1;
      }
      return lines;
    }
    lines.push(`${speakerLabels[turnIndex % speakerLabels.length]}: ${line}`);
    turnIndex += 1;
    return lines;
  }, []);
  return prepared.join("\n").trim() || normalized;
};

const buildAudioFromListeningItem = (item, profiles = []) => {
  const settings = asJsonObject(item.audio_engine_settings);
  const transcript = prepareListeningTranscriptForTts({
    transcript: item.admin_transcript || "",
    title: item.title || "",
    settings,
  });
  const speakers = inferListeningVoiceSettings({
    transcript,
    itemNumber: item.item_number,
    audioSettings: settings,
    profiles,
  });
  return {
    title: item.title || `Hoeren Teil ${item.part_number || 1}`,
    speaker: speakers.map((speaker) => speaker.speaker).join(" / ") || "Standarddeutsch",
    scene: settings.scene || settings.situation || "",
    situation: settings.situation || "",
    transcript,
    speakers,
    tracks: [{
      id: `listening-item-${item.id}`,
      partNumber: Number(item.part_number) || 1,
      title: item.title || `Text ${item.item_number || 1}`,
      transcript,
      audio: { transcript, speakers },
    }],
    ambience: [],
    sfx: "",
    rate: settings.rate || 0.92,
  };
};

const appendAudioItemLog = async (itemId, entry) => {
  await pool.query(
    `UPDATE exam_listening_audio_items
        SET generation_log = COALESCE(generation_log, '[]'::jsonb) || $2::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [itemId, JSON.stringify([{ at: new Date().toISOString(), ...entry }])]
  );
};

const getLatestListeningPreviewDraft = async (exam) => {
  const result = await pool.query(
    `SELECT id, draft_content
       FROM exam_document_imports
      WHERE LOWER(provider) = LOWER($1)
        AND UPPER(level) = UPPER($2)
        AND section_type = 'listen'
        AND draft_content <> '{}'::jsonb
      ORDER BY updated_at DESC, id DESC
      LIMIT 1`,
    [exam.provider || exam.exam_type || "", exam.level || "B1"]
  );
  return result.rows[0] || null;
};

const splitTranscriptByTextNumber = (transcript = "", itemNumber = 1) => {
  const text = stripProductionMarkers(transcript || "");
  const number = Number(itemNumber) || 1;
  const escaped = String(number).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const next = String(number + 1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`(?:^|\\s)(?:Text|Track|Audio)\\s*${escaped}\\s*[:.-]\\s*([\\s\\S]*?)(?=(?:\\s(?:Text|Track|Audio)\\s*${next}\\s*[:.-])|$)`, "i"),
    new RegExp(`(?:^|\\s)${escaped}\\s*[.)-]\\s*([\\s\\S]*?)(?=(?:\\s${next}\\s*[.)-]\\s)|$)`, "i"),
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1] && match[1].trim().length > 20) return stripProductionMarkers(match[1]);
  }
  return text;
};

const syncListeningAudioItemsFromExamContent = async (examId) => {
  await ensureListeningAudioProductionSchema();
  const examResult = await pool.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
  const exam = examResult.rows[0];
  if (!exam) return { error: "Exam not found", status: 404 };
  if (exam.section_type !== "listen") return { error: "Audio item sync is only available for Hoeren exams.", status: 400 };
  const sections = await pool.query(`SELECT * FROM exam_sections WHERE exam_id = $1 ORDER BY position, id`, [examId]);
  const questions = await pool.query(
    `SELECT id, section_id, position, prompt, transcript, audio, source_metadata
       FROM exam_questions
      WHERE exam_id = $1
      ORDER BY position, id`,
    [examId]
  );
  const questionsBySection = new Map();
  questions.rows.forEach((question) => {
    const key = question.section_id || "unassigned";
    if (!questionsBySection.has(key)) questionsBySection.set(key, []);
    questionsBySection.get(key).push(question);
  });
  const upserted = [];
  for (const section of sections.rows) {
    const partNumber = Number(section.part_number) || Number(section.position) || upserted.length + 1;
    const sectionMetadata = asJsonObject(section.metadata);
    const sectionQuestions = questionsBySection.get(section.id) || [];
    const textNumbers = Array.from(new Set(sectionQuestions
      .map((question) => Number(asJsonObject(question.source_metadata).textNumber || asJsonObject(question.source_metadata).audioItemNumber || asJsonObject(question.source_metadata).itemNumber))
      .filter(Boolean)))
      .sort((a, b) => a - b);
    const itemNumbers = textNumbers.length ? textNumbers : [1];
    const sectionAudio = {
      ...asJsonObject(sectionMetadata.audio),
      ...asJsonObject(sectionQuestions.find((question) => Object.keys(asJsonObject(question.audio)).length)?.audio),
    };
    const fullTranscript = cleanPlainText(
      sectionMetadata.transcript ||
      sectionQuestions.find((question) => question.transcript)?.transcript ||
      sectionAudio.transcript ||
      section.instructions ||
      ""
    );
    if (!fullTranscript || fullTranscript.length < 20) continue;
    for (const itemNumber of itemNumbers) {
      const transcript = splitTranscriptByTextNumber(fullTranscript, itemNumber);
      if (!transcript || transcript.length < 20) continue;
      const result = await pool.query(
        `INSERT INTO exam_listening_audio_items (
           exam_id, section_id, source_import_id, provider, level, series_number,
           part_number, item_number, title, instructions, admin_transcript,
           audio_engine_settings, listening_count, audio_generation_status,
           validation_warnings, source_metadata, position, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, 'draft', $14::jsonb, $15::jsonb, $16, NOW())
         ON CONFLICT (exam_id, part_number, item_number)
         DO UPDATE SET
           section_id = EXCLUDED.section_id,
           title = EXCLUDED.title,
           instructions = EXCLUDED.instructions,
           admin_transcript = CASE
             WHEN exam_listening_audio_items.audio_generation_status IN ('published', 'approved', 'generated')
               THEN exam_listening_audio_items.admin_transcript
             ELSE EXCLUDED.admin_transcript
           END,
           audio_engine_settings = EXCLUDED.audio_engine_settings,
           validation_warnings = EXCLUDED.validation_warnings,
           source_metadata = EXCLUDED.source_metadata,
           position = EXCLUDED.position,
           updated_at = NOW()
         RETURNING *`,
        [
          examId,
          section.id,
          exam.source_import_id || null,
          exam.provider || exam.exam_type || null,
          exam.level || null,
          Number(exam.series_number) || null,
          partNumber,
          itemNumber,
          itemNumbers.length > 1 ? `Teil ${partNumber} - Text ${itemNumber}` : (section.title || `Teil ${partNumber}`),
          LISTENING_STUDENT_INSTRUCTION,
          transcript,
          JSON.stringify(sectionAudio),
          Number(sectionAudio.listeningCount || sectionMetadata.listeningCount || 2),
          JSON.stringify(["Background/SFX mixing is not enabled in this deployment; generated audio is clean voice-only."]),
          JSON.stringify({ source: "published-exam-content", sectionId: section.id, partNumber, itemNumber }),
          (partNumber * 100) + itemNumber,
        ]
      );
      upserted.push(result.rows[0]);
    }
  }
  return { exam, items: upserted };
};

const syncListeningAudioItemsFromDraft = async (examId) => {
  await ensureListeningAudioProductionSchema();
  const examResult = await pool.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
  const exam = examResult.rows[0];
  if (!exam) return { error: "Exam not found", status: 404 };
  if (exam.section_type !== "listen") return { error: "Audio item sync is only available for Hoeren exams.", status: 400 };
  const draft = await getLatestListeningPreviewDraft(exam);
  if (!draft) return { error: "No Hoeren preview draft found for this provider/level.", status: 404 };
  const sections = await pool.query(`SELECT * FROM exam_sections WHERE exam_id = $1 ORDER BY position, id`, [examId]);
  const sectionsByPart = new Map(sections.rows.map((section) => [Number(section.part_number) || Number(section.position), section]));
  const content = asJsonObject(draft.draft_content);
  const series = Array.isArray(content.series) ? content.series[0] : null;
  const draftSections = Array.isArray(series?.sections) ? series.sections : [];
  const upserted = [];

  for (const draftSection of draftSections) {
    const partNumber = Number(draftSection.partNumber || draftSection.part || draftSection.position) || upserted.length + 1;
    const section = sectionsByPart.get(partNumber) || null;
    const audioItems = Array.isArray(draftSection.audioItems) && draftSection.audioItems.length
      ? draftSection.audioItems
      : [{ itemNumber: 1, title: draftSection.title || `Teil ${partNumber}`, transcript: draftSection.transcript || draftSection.instructions || "", audioSettings: draftSection.audioSettings || {} }];
    for (const audioItem of audioItems) {
      const itemNumber = Number(audioItem.itemNumber || audioItem.number || audioItems.indexOf(audioItem) + 1) || 1;
      const transcript = stripProductionMarkers(audioItem.adminTranscript || audioItem.transcript || audioItem.script || audioItem.audioText || "");
      if (!transcript) continue;
      const result = await pool.query(
        `INSERT INTO exam_listening_audio_items (
           exam_id, section_id, source_import_id, provider, level, series_number,
           part_number, item_number, title, instructions, admin_transcript,
           audio_engine_settings, listening_count, audio_generation_status,
           validation_warnings, source_metadata, position, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, 'draft', $14::jsonb, $15::jsonb, $16, NOW())
         ON CONFLICT (exam_id, part_number, item_number)
         DO UPDATE SET
           section_id = EXCLUDED.section_id,
           title = EXCLUDED.title,
           instructions = EXCLUDED.instructions,
           admin_transcript = EXCLUDED.admin_transcript,
           audio_engine_settings = EXCLUDED.audio_engine_settings,
           validation_warnings = EXCLUDED.validation_warnings,
           source_metadata = EXCLUDED.source_metadata,
           position = EXCLUDED.position,
           updated_at = NOW()
         RETURNING *`,
        [
          examId,
          section?.id || null,
          draft.id,
          exam.provider || exam.exam_type || null,
          exam.level || null,
          Number(exam.series_number) || 1,
          partNumber,
          itemNumber,
          audioItem.title || draftSection.title || `Teil ${partNumber} - Text ${itemNumber}`,
          LISTENING_STUDENT_INSTRUCTION,
          transcript,
          JSON.stringify(audioItem.audioEngineSettings || audioItem.audioSettings || draftSection.audioEngineSettings || draftSection.audioSettings || {}),
          Number(audioItem.listeningCount || draftSection.listeningCount || 2),
          JSON.stringify([
            "Background/SFX mixing is not enabled in this deployment; generated audio is clean voice-only.",
          ]),
          JSON.stringify({ previewImportId: draft.id, draftPartNumber: partNumber, draftItemNumber: itemNumber }),
          (partNumber * 100) + itemNumber,
        ]
      );
      upserted.push(result.rows[0]);
    }
  }
  return { exam, draftId: draft.id, items: upserted };
};

const getPublishedAudioItemsForExam = async (examId) => {
  await ensureListeningAudioProductionSchema();
  const result = await pool.query(
    `SELECT i.id, i.exam_id, i.section_id, i.part_number, i.item_number, i.title,
            i.listening_count, i.audio_generation_status, i.generated_audio_asset_id,
            i.admin_transcript, i.voice_profile_map, i.source_metadata,
            a.id AS asset_id, a.status AS asset_status, a.byte_size, a.duration_seconds, a.updated_at AS asset_updated_at
       FROM exam_listening_audio_items i
       LEFT JOIN exam_audio_assets a ON a.id = i.generated_audio_asset_id
      WHERE i.exam_id = $1
        AND i.audio_generation_status = 'published'
        AND (
          a.status = 'ready'
          OR COALESCE(i.source_metadata->>'browserTtsFallback', 'false') = 'true'
        )
      ORDER BY i.part_number, i.item_number, i.id`,
    [examId]
  );
  return result.rows;
};

const generateListeningAudioForPublishedExams = async ({ exams = [], adminId = null }) => {
  const results = [];
  for (const exam of exams) {
    if (String(exam?.section_type ?? "").toLowerCase() !== "listen") continue;
    const examId = Number(exam.id);
    const provider = getConfiguredProvider();
    try {
      const context = await loadListeningExamAudioContext(examId);
      if (context.error) {
        results.push({ examId, ok: false, error: context.error });
        continue;
      }
      const generated = await generateAndStoreExamAudio({
        pool,
        examId,
        audio: context.audio,
        adminId,
        provider,
        force: false,
      });
      results.push({
        examId,
        ok: true,
        cached: Boolean(generated.cached),
        assetId: generated.asset?.id ?? null,
        provider,
      });
    } catch (err) {
      results.push({
        examId,
        ok: false,
        setupRequired: err instanceof TtsConfigurationError,
        error: err.publicMessage || "Production audio generation failed. You can regenerate it from the CMS.",
      });
    }
  }
  return results;
};

app.get("/api/audio/generated/:assetId", async (req, res) => {
  try {
    const assetId = Number(req.params.assetId);
    if (!Number.isInteger(assetId)) return res.status(404).json({ ok: false, error: "Audio not found" });
    const asset = await getAudioAssetById({ pool, assetId });
    if (!asset) return res.status(404).json({ ok: false, error: "Audio not found" });
    res.setHeader("Content-Type", asset.mime_type || "audio/mpeg");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("ETag", `"${asset.content_hash}"`);
    res.setHeader("Content-Length", String(asset.byte_size || asset.audio_data.length));
    return res.send(asset.audio_data);
  } catch (err) {
    console.error("Generated audio stream failed", err);
    return res.status(500).json({ ok: false, error: "Audio unavailable" });
  }
});

app.get("/api/subscription-plans", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, level, plan_key, plan_name, duration_days, price_eur, currency,
              writing_simulator_attempts, speaking_simulator_quota, certifications, unlocked_sections,
              plan_category, access_months, billed_months
       FROM subscription_plans
       WHERE is_active = TRUE
       ORDER BY level, CASE plan_key WHEN 'starter' THEN 1 WHEN 'standard' THEN 2 ELSE 3 END`
    );
    const industrial = await pool.query(
      `SELECT id, offer_key, label, duration_days, access_months, billed_months, price_eur, currency,
              speaking_simulator_quota, certifications, unlocked_sections
         FROM industrial_subscription_offers
        WHERE is_active = TRUE
        ORDER BY duration_days`
    );
    return res.json({
      ok: true,
      plans: result.rows.map((row) => ({
        id: row.id,
        level: row.level,
        planKey: row.plan_key,
        planName: row.plan_name,
        durationDays: Number(row.duration_days),
        priceEur: Number(row.price_eur),
        currency: row.currency,
        writingSimulatorAttempts: Number(row.writing_simulator_attempts),
        speakingSimulatorQuota: Number(row.speaking_simulator_quota ?? 0),
        planCategory: row.plan_category || "standard",
        accessMonths: row.access_months ? Number(row.access_months) : null,
        billedMonths: row.billed_months ? Number(row.billed_months) : null,
        certifications: normalizeStringArray(row.certifications, SUBSCRIPTION_CERTIFICATIONS),
        unlockedSections: normalizeStringArray(row.unlocked_sections, SUBSCRIPTION_SECTIONS),
      })),
      industrialOffers: industrial.rows.map((row) => ({
        id: row.id,
        offerKey: row.offer_key,
        label: row.label,
        durationDays: Number(row.duration_days),
        accessMonths: Number(row.access_months),
        billedMonths: Number(row.billed_months),
        priceEur: Number(row.price_eur),
        currency: row.currency,
        speakingSimulatorQuota: Number(row.speaking_simulator_quota),
        certifications: normalizeStringArray(row.certifications, SUBSCRIPTION_CERTIFICATIONS),
        unlockedSections: normalizeStringArray(row.unlocked_sections, SUBSCRIPTION_SECTIONS),
      })),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/subscriptions/me", requireAuth, async (req, res) => {
  try {
    return res.json({
      ok: true,
      activeSubscriptions: await getActiveSubscriptionsForUser(req.user.id),
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/subscriptions/access", requireAuth, async (req, res) => {
  try {
    const level = normalizeSubscriptionLevel(req.query.level);
    if (!level) return res.status(400).json({ ok: false, error: "A valid B1 or B2 level is required" });
    const certification = normalizeStringArray([req.query.certification], SUBSCRIPTION_CERTIFICATIONS)[0] || "";
    const subscription = await getActiveSubscriptionForUser(req.user.id, level, certification);
    const canAccess = userHasSubscriptionAccess(req.user, subscription, req.query.certification, req.query.section);
    return res.json({
      ok: true,
      level,
      certification,
      canAccess,
      subscription,
      remainingWritingAttempts: subscription?.writingAttemptsRemaining ?? 0,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const getCheckoutPlanAndQuote = async ({ level, planKey, selectedCertifications, country = "CM" }) => {
  const planResult = await pool.query(
    `SELECT id, level, plan_key, plan_name, duration_days, price_eur, currency,
            writing_simulator_attempts, speaking_simulator_quota, certifications, unlocked_sections
       FROM subscription_plans
       WHERE level = $1 AND plan_key = $2 AND is_active = TRUE
       LIMIT 1`,
    [level, planKey]
  );
  const plan = planResult.rows[0];
  if (!plan) return { plan: null, quote: null };
  const countryCode = normalizeMobileMoneyCountry(country) || "CM";
  const countryConfig = MOBILE_MONEY_COUNTRIES[countryCode] || MOBILE_MONEY_COUNTRIES.CM;
  const basePriceEur = Number(plan.price_eur);
  const selectedCertificationCount = selectedCertifications.length;
  const finalPriceEur = Number((basePriceEur * selectedCertificationCount).toFixed(2));
  const paymentCurrency = countryConfig.currency;
  const paymentAmount = eurToNotchPayAmount(finalPriceEur, paymentCurrency);
  return {
    plan,
    quote: {
      level: plan.level,
      planKey: plan.plan_key,
      planName: plan.plan_name,
      durationDays: Number(plan.duration_days),
      basePriceEur,
      selectedCertifications,
      selectedCertificationCount,
      finalPriceEur,
      paymentAmount,
      paymentCurrency,
      country: countryCode,
      countryLabel: countryConfig.label,
      exchangeRate: NOTCHPAY_XAF_PER_EUR,
      writingSimulatorAttempts: Number(plan.writing_simulator_attempts),
      speakingSimulatorQuota: Number(plan.speaking_simulator_quota ?? 0),
      unlockedSections: normalizeStringArray(plan.unlocked_sections, SUBSCRIPTION_SECTIONS),
    },
  };
};

const getEnterpriseOfferAndQuote = async ({ offerKey, country = "CM" }) => {
  const offerResult = await pool.query(
    `SELECT id, offer_key, label, duration_days, access_months, billed_months, price_eur, currency,
            speaking_simulator_quota, certifications, unlocked_sections
       FROM industrial_subscription_offers
      WHERE offer_key = $1 AND is_active = TRUE
      LIMIT 1`,
    [String(offerKey || "").trim()]
  );
  const offer = offerResult.rows[0];
  if (!offer) return { offer: null, billingPlan: null, quote: null };
  const billingPlan = await getEnterpriseBillingPlan();
  if (!billingPlan) return { offer, billingPlan: null, quote: null };
  const countryCode = normalizeMobileMoneyCountry(country) || "CM";
  const countryConfig = MOBILE_MONEY_COUNTRIES[countryCode] || MOBILE_MONEY_COUNTRIES.CM;
  const selectedCertifications = normalizeStringArray(offer.certifications, SUBSCRIPTION_CERTIFICATIONS);
  const finalPriceEur = Number(offer.price_eur);
  const paymentCurrency = countryConfig.currency;
  const paymentAmount = eurToNotchPayAmount(finalPriceEur, paymentCurrency);
  return {
    offer,
    billingPlan,
    quote: {
      offerType: "enterprise",
      offerKey: offer.offer_key,
      label: offer.label,
      level: "B1+B2",
      planKey: "enterprise",
      planName: offer.label,
      durationDays: Number(offer.duration_days),
      accessMonths: Number(offer.access_months),
      billedMonths: Number(offer.billed_months),
      basePriceEur: finalPriceEur,
      selectedCertifications,
      selectedCertificationCount: selectedCertifications.length,
      finalPriceEur,
      paymentAmount,
      paymentCurrency,
      country: countryCode,
      countryLabel: countryConfig.label,
      exchangeRate: NOTCHPAY_XAF_PER_EUR,
      writingSimulatorAttempts: 10,
      speakingSimulatorQuota: Number(offer.speaking_simulator_quota ?? 0),
      unlockedSections: normalizeStringArray(offer.unlocked_sections, SUBSCRIPTION_SECTIONS),
    },
  };
};

app.post("/api/checkout/quote", requireAuth, async (req, res) => {
  try {
    const offerKey = String(req.body?.offerKey || "").trim();
    if (offerKey) {
      const { offer, quote } = await getEnterpriseOfferAndQuote({ offerKey, country: req.body?.country });
      if (!offer || !quote) return res.status(404).json({ ok: false, error: "Offre entreprise introuvable." });
      return res.json({ ok: true, quote });
    }
    const level = normalizeSubscriptionLevel(req.body?.level);
    const planKey = normalizePlanKey(req.body?.planKey);
    const rawSelectedCertifications = Array.isArray(req.body?.selectedCertifications)
      ? req.body.selectedCertifications
      : [];
    const selectedCertifications = normalizeStringArray(rawSelectedCertifications, SUBSCRIPTION_CERTIFICATIONS);
    if (!level || !planKey) return res.status(400).json({ ok: false, error: "Plan invalide." });
    if (!selectedCertifications.length) {
      return res.status(400).json({ ok: false, error: "Selectionnez au moins une certification." });
    }
    if (selectedCertifications.length !== rawSelectedCertifications.length) {
      return res.status(400).json({ ok: false, error: "Une certification selectionnee est invalide." });
    }
    const { plan, quote } = await getCheckoutPlanAndQuote({
      level,
      planKey,
      selectedCertifications,
      country: req.body?.country,
    });
    if (!plan) return res.status(404).json({ ok: false, error: "Plan introuvable." });
    return res.json({ ok: true, quote });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "La preparation du paiement a echoue." });
  }
});

app.post("/api/checkout/session", requireAuth, async (req, res) => {
  try {
    const publicBaseUrl = getRequestPublicBaseUrl(req);
    const offerKey = String(req.body?.offerKey || "").trim();
    const level = normalizeSubscriptionLevel(req.body?.level);
    const planKey = normalizePlanKey(req.body?.planKey);
    const provider = normalizePaymentProvider(req.body?.provider);
    const paymentMethod = String(req.body?.paymentMethod || "mobile_money").trim().toLowerCase();
    const idempotencyKey = String(req.body?.idempotencyKey || "").trim().slice(0, 120);
    const rawSelectedCertifications = Array.isArray(req.body?.selectedCertifications)
      ? req.body.selectedCertifications
      : [];
    const selectedCertifications = normalizeStringArray(rawSelectedCertifications, SUBSCRIPTION_CERTIFICATIONS);
    if (!offerKey && (!level || !planKey)) {
      return res.status(400).json({ ok: false, error: "A valid pricing plan is required" });
    }
    if (!offerKey && !selectedCertifications.length) {
      return res.status(400).json({ ok: false, error: "Select at least one certification" });
    }
    if (!offerKey && selectedCertifications.length !== rawSelectedCertifications.length) {
      return res.status(400).json({ ok: false, error: "One or more selected certifications are invalid" });
    }
    if (paymentMethod !== "mobile_money") {
      return res.status(400).json({ ok: false, error: "Ce moyen de paiement n'est pas encore actif." });
    }
    const mobileMoneyValidation = validateMobileMoneySelection({
      country: req.body?.mobileMoney?.country || req.body?.country || "CM",
      provider: req.body?.mobileMoney?.provider,
      phone: req.body?.mobileMoney?.phone,
    });
    if (!mobileMoneyValidation.ok) {
      return res.status(400).json({ ok: false, error: mobileMoneyValidation.error });
    }
    const enterpriseQuoteResult = offerKey
      ? await getEnterpriseOfferAndQuote({ offerKey, country: mobileMoneyValidation.country })
      : null;
    const normalQuoteResult = offerKey
      ? null
      : await getCheckoutPlanAndQuote({
          level,
          planKey,
          selectedCertifications,
          country: mobileMoneyValidation.country,
        });
    const plan = offerKey ? enterpriseQuoteResult?.billingPlan : normalQuoteResult?.plan;
    const quote = offerKey ? enterpriseQuoteResult?.quote : normalQuoteResult?.quote;
    const selectedForTransaction = quote?.selectedCertifications || selectedCertifications;
    if (!plan) return res.status(404).json({ ok: false, error: "Pricing plan not found" });
    if (idempotencyKey) {
      const existing = await pool.query(
        `SELECT id, status, provider_reference, metadata
           FROM payment_transactions
          WHERE user_id = $1
            AND provider = $2
            AND metadata->>'idempotencyKey' = $3
            AND status IN ('pending', 'processing', 'succeeded')
          ORDER BY created_at DESC
          LIMIT 1`,
        [req.user.id, provider, idempotencyKey]
      );
      const existingTransaction = existing.rows[0];
      if (existingTransaction) {
        const existingMetadata = asPlainObject(existingTransaction.metadata);
        const existingNotchPay = asPlainObject(existingMetadata.notchpay);
        let existingReference =
          existingTransaction.provider_reference ||
          existingNotchPay.reference ||
          existingNotchPay.merchantReference ||
          "";
        let existingMerchantReference = existingNotchPay.merchantReference || "";
        let existingAuthorizationUrl = existingNotchPay.authorizationUrl || "";
        let customerMessage = existingMetadata.customerMessage || "Paiement deja en cours. Verifiez votre telephone.";

        if (provider === "notchpay" && ["pending", "processing"].includes(normalizePaymentStatus(existingTransaction.status))) {
          let notchPaySession = null;
          let processing = null;
          let processingError = null;
          let providerStatus = "processing";
          let processMethod = "";
          try {
            if (!existingReference) {
              existingMerchantReference = existingMerchantReference || buildNotchPayReference(existingTransaction.id);
              notchPaySession = await createNotchPayPayment({
                user: req.user,
                transactionId: existingTransaction.id,
                reference: existingMerchantReference,
                amountEur: quote.finalPriceEur,
                plan,
                selectedCertifications: selectedForTransaction,
                callbackBaseUrl: publicBaseUrl,
                currency: quote.paymentCurrency,
                lockedCountry: mobileMoneyValidation.country,
                phone: mobileMoneyValidation.phone,
              });
              existingReference = getNotchPayReferenceFromPayload(notchPaySession) || existingMerchantReference;
              existingAuthorizationUrl = getNotchPayAuthorizationUrlFromPayload(notchPaySession);
            }
            const prompt = await startNotchPayMobileMoneyPrompt({
              references: [existingReference, existingMerchantReference],
              channel: mobileMoneyValidation.channel,
              phone: mobileMoneyValidation.phone,
              clientIp: getRequestClientIp(req),
            });
            existingReference = prompt.providerReference || existingReference;
            processing = prompt.processing;
            providerStatus = prompt.providerStatus;
            processMethod = prompt.processMethod;
            customerMessage = "Nouvelle demande Mobile Money envoyee. Validez-la sur votre telephone pour terminer l'abonnement.";
          } catch (err) {
            processingError = getNotchPayPromptErrorDetails(err);
            customerMessage = processingError.message
              ? `La demande Mobile Money n'a pas encore pu etre envoyee: ${processingError.message}. Vous pouvez verifier le paiement ou reessayer dans quelques instants.`
              : "La demande Mobile Money n'a pas encore pu etre envoyee. Vous pouvez verifier le paiement ou reessayer dans quelques instants.";
            console.warn("Existing Notch Pay Mobile Money prompt retry failed", {
              transactionId: existingTransaction.id,
              providerReference: existingReference,
              status: processingError.status,
              message: processingError.message,
            });
          }
          await updateNotchPayTransactionPromptMetadata({
            transactionId: existingTransaction.id,
            providerReference: existingReference || existingTransaction.id,
            merchantReference: existingMerchantReference,
            authorizationUrl: existingAuthorizationUrl,
            notchPaySession,
            processing,
            processingError,
            providerStatus,
            processMethod,
            customerMessage,
          });
        }

        existingReference = existingReference || existingTransaction.provider_reference || existingTransaction.id;
        return res.json({
          ok: true,
          duplicate: true,
          checkoutSession: {
            provider,
            paymentMethod,
            status: existingTransaction.status,
            transactionId: existingTransaction.id,
            providerReference: existingReference,
            merchantReference: existingMerchantReference,
            authorizationUrl: existingAuthorizationUrl,
            ...(existingMetadata.quote || quote),
            mobileMoney: existingMetadata.mobileMoney,
            message: customerMessage,
          },
        });
      }
    }
    const transactionMetadata = {
      ...quote,
      quote,
      offerType: offerKey ? "enterprise" : "individual",
      enterpriseOffer: offerKey ? quote : null,
      selectedCertifications: selectedForTransaction,
      requestedProvider: provider,
      paymentMethod,
      idempotencyKey: idempotencyKey || null,
      mobileMoney: {
        country: mobileMoneyValidation.country,
        countryLabel: mobileMoneyValidation.countryLabel,
        provider: mobileMoneyValidation.provider,
        providerLabel: mobileMoneyValidation.providerLabel,
        channel: mobileMoneyValidation.channel,
        phone: mobileMoneyValidation.phone,
      },
    };

    const transaction = await pool.query(
      `INSERT INTO payment_transactions (user_id, plan_id, provider, status, amount, currency, selected_certifications, metadata)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id, status, created_at`,
      [
        req.user.id,
        plan.id,
        provider,
        quote.paymentAmount,
        quote.paymentCurrency,
        JSON.stringify(selectedForTransaction),
        safeJson(transactionMetadata),
      ]
    );
    const transactionId = transaction.rows[0].id;
    let providerReference = "";
    let merchantReference = "";
    let authorizationUrl = "";
    let checkoutCustomerMessage = "Confirmez le paiement sur votre telephone pour terminer l'abonnement.";
    if (provider === "notchpay") {
      merchantReference = buildNotchPayReference(transactionId);
      const notchPaySession = await createNotchPayPayment({
        user: req.user,
        transactionId,
        reference: merchantReference,
        amountEur: quote.finalPriceEur,
        plan,
        selectedCertifications: selectedForTransaction,
        callbackBaseUrl: publicBaseUrl,
        currency: quote.paymentCurrency,
        lockedCountry: mobileMoneyValidation.country,
        phone: mobileMoneyValidation.phone,
      });
      providerReference = getNotchPayReferenceFromPayload(notchPaySession) || merchantReference;
      authorizationUrl = getNotchPayAuthorizationUrlFromPayload(notchPaySession);
      let processing = null;
      let processingError = null;
      let providerStatus = "processing";
      let processMethod = "";
      try {
        const prompt = await startNotchPayMobileMoneyPrompt({
          references: [providerReference, merchantReference],
          channel: mobileMoneyValidation.channel,
          phone: mobileMoneyValidation.phone,
          clientIp: getRequestClientIp(req),
        });
        providerReference = prompt.providerReference || providerReference;
        processing = prompt.processing;
        providerStatus = prompt.providerStatus;
        processMethod = prompt.processMethod;
      } catch (err) {
        processingError = getNotchPayPromptErrorDetails(err);
        console.warn("Notch Pay Mobile Money prompt was delayed", {
          transactionId,
          providerReference,
          status: processingError.status,
          message: processingError.message,
        });
        checkoutCustomerMessage =
          processingError.message
            ? `La demande Mobile Money n'a pas encore pu etre envoyee: ${processingError.message}. Vous pouvez verifier le paiement ou reessayer dans quelques instants.`
            : "La demande Mobile Money n'a pas encore pu etre envoyee. Vous pouvez verifier le paiement ou reessayer dans quelques instants.";
      }
      await updateNotchPayTransactionPromptMetadata({
        transactionId,
        providerReference,
        merchantReference,
        authorizationUrl,
        notchPaySession,
        processing,
        processingError,
        providerStatus,
        processMethod,
        customerMessage: checkoutCustomerMessage,
      });
    }

    return res.json({
      ok: true,
      checkoutSession: {
        provider,
        paymentMethod,
        status: "processing",
        transactionId,
        providerReference,
        merchantReference,
        authorizationUrl,
        planId: plan.id,
        amount: quote.finalPriceEur,
        ...quote,
        certifications: selectedForTransaction,
        unlockedSections: normalizeStringArray(plan.unlocked_sections, SUBSCRIPTION_SECTIONS),
        mobileMoney: transactionMetadata.mobileMoney,
        message: checkoutCustomerMessage,
      },
    });
  } catch (err) {
    console.error(err);
    const status = Number(err.status || err.statusCode || 500);
    const providerMessage =
      err?.data?.message ||
      err?.data?.error ||
      err?.message ||
      "Payment session could not be prepared.";
    return res.status(status >= 400 && status < 500 ? status : 502).json({
      ok: false,
      error: "La session de paiement n'a pas pu etre preparee. Veuillez reessayer dans quelques instants.",
      details: isProduction ? undefined : providerMessage,
    });
  }
});

app.get("/api/checkout/session/:reference/status", optionalPaymentAuth, async (req, res) => {
  try {
    const reference = String(req.params.reference || "").trim();
    if (!reference) return res.status(400).json({ ok: false, error: "Reference de paiement manquante." });
    const result = await pool.query(
      `SELECT id, user_id, provider, provider_reference, status, amount, currency, metadata
         FROM payment_transactions
        WHERE (
          provider_reference = $1
          OR metadata #>> '{notchpay,merchantReference}' = $1
          OR metadata #>> '{notchpay,reference}' = $1
          OR id::text = $1
        )
        ORDER BY created_at DESC
        LIMIT 1`,
      [reference]
    );
    const transaction = result.rows[0];
    if (!transaction) return res.status(404).json({ ok: false, error: "Paiement introuvable." });

    let status = normalizePaymentStatus(transaction.status);
    let providerStatus = "";
    let providerMessage = "";
    let activated = null;
    const transactionMetadata = asPlainObject(transaction.metadata);
    const notchPayMetadata = asPlainObject(transactionMetadata.notchpay);
    const providerLookupReferences = [
      transaction.provider_reference,
      notchPayMetadata.reference,
      notchPayMetadata.merchantReference,
      reference,
    ];
    let providerLookupReference = providerLookupReferences.find(Boolean) || reference;
    if (transaction.provider === "notchpay" && ["pending", "processing"].includes(status)) {
      try {
        const lookup = await retrieveNotchPayPaymentWithFallback(providerLookupReferences);
        const payment = lookup.payment;
        providerLookupReference = lookup.reference || providerLookupReference;
        providerStatus = getNotchPayStatusFromPayload(payment);
        providerMessage = getNotchPayMessageFromPayload(payment);
        if (isSuccessfulPaymentStatus(providerStatus)) {
          activated = await activateSubscriptionFromTransaction({
            providerReference: providerLookupReference,
            providerPayload: payment,
            eventType: "status_check",
          });
          status = "succeeded";
        } else if (isFailedPaymentStatus(providerStatus)) {
          status = "failed";
          await pool.query(
            `UPDATE payment_transactions
                SET status = 'failed',
                    metadata = metadata || $2::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [transaction.id, safeJson({ notchpayStatusCheck: payment, notchpayStatus: providerStatus, notchpayMessage: providerMessage })]
          );
        } else {
          await pool.query(
            `UPDATE payment_transactions
                SET metadata = metadata || $2::jsonb,
                    updated_at = NOW()
              WHERE id = $1`,
            [transaction.id, safeJson({ notchpayStatusCheck: payment, notchpayStatus: providerStatus, notchpayMessage: providerMessage })]
          );
        }
      } catch (error) {
        console.warn("Notch Pay status check failed", error?.message || error);
        providerMessage = error?.data?.message || error?.data?.error || error?.message || "";
        const metadataStatus =
          notchPayMetadata.providerStatus ||
          notchPayMetadata.processing?.status ||
          notchPayMetadata.processing?.payment_status ||
          notchPayMetadata.processingError?.status ||
          "";
        const metadataMessage =
          notchPayMetadata.processingError?.message ||
          notchPayMetadata.notchpayMessage ||
          notchPayMetadata.message ||
          "";
        providerStatus = providerStatus || metadataStatus;
        providerMessage = providerMessage || metadataMessage;
      }
    }

    const responseMessage = buildPaymentStatusMessage(status, providerStatus, providerMessage);
    const ownsTransaction = Number(req.user?.id) === Number(transaction.user_id);
    const refreshedAuth = status === "succeeded" && ownsTransaction ? signAccessToken(req.user) : null;
    return res.json({
      ok: true,
      status,
      providerStatus,
      providerMessage,
      activated,
      providerReference: providerLookupReference,
      transactionId: transaction.id,
      quote: transactionMetadata.quote || null,
      mobileMoney: transactionMetadata.mobileMoney || null,
      user: status === "succeeded" && ownsTransaction ? await sanitizeUserWithSubscriptions(req.user) : null,
      accessToken: refreshedAuth?.token || null,
      expiresIn: refreshedAuth?.expiresIn || null,
      message: responseMessage,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Impossible de verifier le paiement pour le moment." });
  }
});

app.get("/api/payments/notchpay/callback", async (req, res) => {
  const reference = String(req.query.reference || req.query.transaction_id || req.query.transaction || "").trim();
  const redirectRoot = getRequestPublicBaseUrl(req);
  const redirectBase = `${redirectRoot}/offers`;
  if (!reference) return res.redirect(`${redirectBase}?payment=missing_reference`);
  try {
    const payment = await retrieveNotchPayPayment(reference);
    const status = getNotchPayStatusFromPayload(payment);
    if (isSuccessfulPaymentStatus(status)) {
      await activateSubscriptionFromTransaction({
        providerReference: reference,
        providerPayload: payment,
        eventType: "callback",
      });
      return res.redirect(`${redirectRoot}/dashboard?payment=success`);
    }
    if (isFailedPaymentStatus(status)) {
      await pool.query(
        `UPDATE payment_transactions
            SET status = 'failed',
                metadata = metadata || $2::jsonb,
                updated_at = NOW()
          WHERE provider = 'notchpay' AND provider_reference = $1`,
        [reference, safeJson({ notchpayCallback: payment, notchpayStatus: status })]
      );
      return res.redirect(`${redirectBase}?payment=failed`);
    }
    await pool.query(
      `UPDATE payment_transactions
          SET metadata = metadata || $2::jsonb,
              updated_at = NOW()
        WHERE provider = 'notchpay' AND provider_reference = $1`,
      [reference, safeJson({ notchpayCallback: payment, notchpayStatus: status })]
    );
    return res.redirect(`${redirectBase}?payment=pending`);
  } catch (err) {
    console.error("Notch Pay callback failed", err);
    return res.redirect(`${redirectBase}?payment=verification_error`);
  }
});

app.post("/api/payments/notchpay/webhook", async (req, res) => {
  try {
    const rawPayload = req.rawBody || Buffer.from(JSON.stringify(req.body || {}));
    const signature = req.get("x-notch-signature");
    if (!verifyNotchPaySignature(rawPayload, signature)) {
      return res.status(403).json({ ok: false, error: "Invalid signature" });
    }
    const event = req.body || parseJsonBody(rawPayload.toString("utf8"));
    const reference = getNotchPayReferenceFromPayload(event);
    const status = getNotchPayStatusFromPayload(event);
    const eventType = String(event.event || event.type || event.action || status || "").trim();
    if (!reference) return res.status(202).json({ ok: true, ignored: "missing_reference" });

    if (isSuccessfulPaymentStatus(status) || /payment\.(complete|completed|success|successful|paid)/i.test(eventType)) {
      const activated = await activateSubscriptionFromTransaction({
        providerReference: reference,
        providerPayload: event,
        eventType,
      });
      return res.json({ ok: true, received: true, activated });
    }
    if (isFailedPaymentStatus(status) || /payment\.(failed|cancelled|canceled|expired|declined)/i.test(eventType)) {
      await pool.query(
        `UPDATE payment_transactions
            SET status = 'failed',
                metadata = metadata || $2::jsonb,
                updated_at = NOW()
          WHERE provider = 'notchpay' AND provider_reference = $1`,
        [reference, safeJson({ notchpayWebhook: event, notchpayStatus: status, eventType })]
      );
      return res.json({ ok: true, received: true, status: "failed" });
    }

    await pool.query(
      `UPDATE payment_transactions
          SET metadata = metadata || $2::jsonb,
              updated_at = NOW()
        WHERE provider = 'notchpay' AND provider_reference = $1`,
      [reference, safeJson({ notchpayWebhook: event, notchpayStatus: status, eventType })]
    );
    return res.json({ ok: true, received: true, status: "pending" });
  } catch (err) {
    console.error("Notch Pay webhook failed", err);
    return res.status(500).json({ ok: false, error: "Webhook processing failed" });
  }
});

app.get("/api/admin/subscriptions", requireAdmin, async (req, res) => {
  try {
    const [plans, industrialOffers, subscriptions, events] = await Promise.all([
      pool.query(
        `SELECT id, level, plan_key, plan_name, duration_days, price_eur, currency,
                writing_simulator_attempts, speaking_simulator_quota, certifications, unlocked_sections
           FROM subscription_plans
          WHERE is_active = TRUE
          ORDER BY level, CASE plan_key WHEN 'starter' THEN 1 WHEN 'standard' THEN 2 ELSE 3 END`
      ),
      pool.query(
        `SELECT id, offer_key, label, duration_days, access_months, billed_months, price_eur, currency,
                speaking_simulator_quota, certifications, unlocked_sections
           FROM industrial_subscription_offers
          WHERE is_active = TRUE
          ORDER BY duration_days`
      ),
      pool.query(
        `SELECT us.id, us.user_id, u.email, u.username, us.plan_id, us.level, us.plan_key, us.status,
                us.starts_at, us.expires_at, us.selected_certifications, us.amount_paid, us.currency,
                us.payment_provider, us.payment_reference, us.speaking_simulator_quota_override,
                us.revoked_at, us.grant_reason, us.created_at, us.updated_at,
                sp.plan_name, sp.duration_days, sp.price_eur, sp.writing_simulator_attempts,
                sp.speaking_simulator_quota, sp.unlocked_sections
           FROM user_subscriptions us
           JOIN users u ON u.id = us.user_id
           JOIN subscription_plans sp ON sp.id = us.plan_id
          ORDER BY us.created_at DESC
          LIMIT 200`
      ),
      pool.query(
        `SELECT e.id, e.subscription_id, e.user_id, u.email, e.action, e.details, e.created_at,
                a.email AS admin_email
           FROM subscription_admin_events e
           LEFT JOIN users u ON u.id = e.user_id
           LEFT JOIN users a ON a.id = e.admin_id
          ORDER BY e.created_at DESC
          LIMIT 80`
      ),
    ]);

    return res.json({
      ok: true,
      plans: plans.rows.map((row) => ({
        id: row.id,
        level: row.level,
        planKey: row.plan_key,
        planName: row.plan_name,
        durationDays: Number(row.duration_days),
        priceEur: Number(row.price_eur),
        currency: row.currency,
        writingSimulatorAttempts: Number(row.writing_simulator_attempts),
        speakingSimulatorQuota: Number(row.speaking_simulator_quota ?? 0),
        certifications: normalizeStringArray(row.certifications, SUBSCRIPTION_CERTIFICATIONS),
        unlockedSections: normalizeStringArray(row.unlocked_sections, SUBSCRIPTION_SECTIONS),
      })),
      industrialOffers: industrialOffers.rows.map((row) => ({
        id: row.id,
        offerKey: row.offer_key,
        label: row.label,
        durationDays: Number(row.duration_days),
        accessMonths: Number(row.access_months),
        billedMonths: Number(row.billed_months),
        priceEur: Number(row.price_eur),
        currency: row.currency,
        speakingSimulatorQuota: Number(row.speaking_simulator_quota),
      })),
      subscriptions: subscriptions.rows.map((row) => ({
        ...mapSubscriptionRow(row),
        userId: row.user_id,
        email: row.email,
        username: row.username,
        paymentProvider: row.payment_provider,
        paymentReference: row.payment_reference,
        grantReason: row.grant_reason,
        revokedAt: row.revoked_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      events: events.rows.map((row) => ({
        id: row.id,
        subscriptionId: row.subscription_id,
        userId: row.user_id,
        email: row.email,
        adminEmail: row.admin_email,
        action: row.action,
        details: row.details,
        createdAt: row.created_at,
      })),
      paymentProviderStatus: {
        automaticActivationReady: false,
        message: "No verified payment webhook is configured. Manual admin grants are available.",
      },
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/subscriptions/manual-grant", requireAdmin, async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = Number(req.body?.userId);
    const planId = Number(req.body?.planId);
    const selectedCertifications = normalizeStringArray(req.body?.selectedCertifications, SUBSCRIPTION_CERTIFICATIONS);
    const startsAt = req.body?.startsAt ? new Date(req.body.startsAt) : new Date();
    const requestedExpiresAt = req.body?.expiresAt ? new Date(req.body.expiresAt) : null;
    const quotaOverride = req.body?.speakingSimulatorQuotaOverride === "" || req.body?.speakingSimulatorQuotaOverride == null
      ? null
      : Number(req.body.speakingSimulatorQuotaOverride);
    const grantReason = String(req.body?.grantReason || "Manual admin grant").trim().slice(0, 500);

    if (!Number.isInteger(userId) || userId <= 0) return res.status(400).json({ ok: false, error: "Valid userId is required" });
    if (!Number.isInteger(planId) || planId <= 0) return res.status(400).json({ ok: false, error: "Valid planId is required" });
    if (!selectedCertifications.length) return res.status(400).json({ ok: false, error: "Select at least one certification" });
    if (Number.isFinite(quotaOverride) && quotaOverride < 0) return res.status(400).json({ ok: false, error: "Quota override must be positive" });
    if (Number.isNaN(startsAt.getTime())) return res.status(400).json({ ok: false, error: "Invalid start date" });

    await client.query("BEGIN");
    const user = await client.query(`SELECT id, email FROM users WHERE id = $1`, [userId]);
    if (!user.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "User not found" });
    }
    const planResult = await client.query(
      `SELECT id, level, plan_key, plan_name, duration_days, price_eur, currency, writing_simulator_attempts
         FROM subscription_plans
        WHERE id = $1 AND is_active = TRUE`,
      [planId]
    );
    const plan = planResult.rows[0];
    if (!plan) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Plan not found" });
    }
    const expiresAt = requestedExpiresAt && !Number.isNaN(requestedExpiresAt.getTime())
      ? requestedExpiresAt
      : new Date(startsAt.getTime() + Number(plan.duration_days) * 24 * 60 * 60 * 1000);
    if (expiresAt <= startsAt) {
      await client.query("ROLLBACK");
      return res.status(400).json({ ok: false, error: "End date must be after start date" });
    }

    const finalPrice = Number((Number(plan.price_eur) * selectedCertifications.length).toFixed(2));
    const inserted = await client.query(
      `INSERT INTO user_subscriptions (
         user_id, plan_id, level, plan_key, status, starts_at, expires_at,
         payment_provider, payment_reference, selected_certifications, amount_paid,
         currency, speaking_simulator_quota_override, grant_reason
       )
       VALUES ($1, $2, $3, $4, 'active', $5, $6, 'manual', $7, $8::jsonb, $9, $10, $11, $12)
       RETURNING *`,
      [
        userId,
        plan.id,
        plan.level,
        plan.plan_key,
        startsAt,
        expiresAt,
        `manual-admin-${Date.now()}`,
        JSON.stringify(selectedCertifications),
        finalPrice,
        plan.currency,
        Number.isFinite(quotaOverride) ? quotaOverride : null,
        grantReason,
      ]
    );
    await client.query(
      `INSERT INTO writing_simulator_usage (user_id, subscription_id, level, attempts_allowed, attempts_used)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (user_id, subscription_id, level)
       DO UPDATE SET attempts_allowed = EXCLUDED.attempts_allowed, updated_at = NOW()`,
      [userId, inserted.rows[0].id, plan.level, Number(plan.writing_simulator_attempts)]
    );
    await client.query(
      `INSERT INTO subscription_admin_events (subscription_id, user_id, admin_id, action, details)
       VALUES ($1, $2, $3, 'manual_grant', $4::jsonb)`,
      [
        inserted.rows[0].id,
        userId,
        req.user.id,
        JSON.stringify({
          planId: plan.id,
          level: plan.level,
          planKey: plan.plan_key,
          selectedCertifications,
          startsAt: startsAt.toISOString(),
          expiresAt: expiresAt.toISOString(),
          speakingSimulatorQuotaOverride: Number.isFinite(quotaOverride) ? quotaOverride : null,
          grantReason,
        }),
      ]
    );
    await client.query("COMMIT");
    return res.status(201).json({ ok: true, subscription: inserted.rows[0] });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  } finally {
    client.release();
  }
});

app.patch("/api/admin/subscriptions/:id/revoke", requireAdmin, async (req, res) => {
  try {
    const subscriptionId = Number(req.params.id);
    if (!Number.isInteger(subscriptionId)) return res.status(400).json({ ok: false, error: "Invalid subscription id" });
    const reason = String(req.body?.reason || "Manual revoke").trim().slice(0, 500);
    const updated = await pool.query(
      `UPDATE user_subscriptions
          SET status = 'cancelled',
              revoked_at = NOW(),
              revoked_by = $1,
              grant_reason = COALESCE(NULLIF($2, ''), grant_reason),
              updated_at = NOW()
        WHERE id = $3
        RETURNING *`,
      [req.user.id, reason, subscriptionId]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Subscription not found" });
    await pool.query(
      `INSERT INTO subscription_admin_events (subscription_id, user_id, admin_id, action, details)
       VALUES ($1, $2, $3, 'revoke', $4::jsonb)`,
      [subscriptionId, updated.rows[0].user_id, req.user.id, JSON.stringify({ reason })]
    );
    return res.json({ ok: true, subscription: updated.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/writing-simulator/attempts/consume", requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    const level = normalizeSubscriptionLevel(req.body?.level);
    if (!level) return res.status(400).json({ ok: false, error: "A valid B1 or B2 level is required" });
    const active = await client.query(
      `SELECT us.id, us.user_id, us.level, sp.writing_simulator_attempts
       FROM user_subscriptions us
       JOIN subscription_plans sp ON sp.id = us.plan_id
       WHERE us.user_id = $1
         AND us.level = $2
         AND us.status = 'active'
         AND us.starts_at <= NOW()
         AND us.expires_at > NOW()
         AND sp.is_active = TRUE
       ORDER BY us.expires_at DESC
       LIMIT 1`,
      [req.user.id, level]
    );
    const subscription = active.rows[0];
    if (!subscription && !(req.user.role === "admin" || req.user.has_full_access)) {
      return res.status(403).json({ ok: false, error: "No active subscription for this level" });
    }
    if (!subscription && (req.user.role === "admin" || req.user.has_full_access)) {
      return res.json({ ok: true, level, remainingWritingAttempts: null, unlimited: true });
    }

    await client.query("BEGIN");
    await client.query(
      `INSERT INTO writing_simulator_usage (user_id, subscription_id, level, attempts_allowed, attempts_used)
       VALUES ($1, $2, $3, $4, 0)
       ON CONFLICT (user_id, subscription_id, level)
       DO UPDATE SET attempts_allowed = EXCLUDED.attempts_allowed, updated_at = NOW()`,
      [req.user.id, subscription.id, level, Number(subscription.writing_simulator_attempts)]
    );
    const consumed = await client.query(
      `UPDATE writing_simulator_usage
       SET attempts_used = attempts_used + 1, updated_at = NOW()
       WHERE user_id = $1
         AND subscription_id = $2
         AND level = $3
         AND attempts_used < attempts_allowed
       RETURNING attempts_allowed, attempts_used`,
      [req.user.id, subscription.id, level]
    );
    if (!consumed.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(403).json({ ok: false, error: "No writing simulator attempts remaining" });
    }
    await client.query("COMMIT");
    const usage = consumed.rows[0];
    return res.json({
      ok: true,
      level,
      attemptsAllowed: Number(usage.attempts_allowed),
      attemptsUsed: Number(usage.attempts_used),
      remainingWritingAttempts: Math.max(0, Number(usage.attempts_allowed) - Number(usage.attempts_used)),
    });
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  } finally {
    client.release();
  }
});

app.get("/api/admin/tts/status", requireAdmin, async (req, res) => {
  try {
    await ensureListeningAudioProductionSchema();
    return res.json({ ok: true, ...getProviderStatus(), voiceProfiles: await getVoiceProfiles(pool) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/listening-audio/:examId/sync", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const mode = String(req.body?.mode || req.query.mode || "auto").toLowerCase();
    let result = mode === "content"
      ? await syncListeningAudioItemsFromExamContent(examId)
      : await syncListeningAudioItemsFromDraft(examId);
    if (result.error && mode === "auto") {
      result = await syncListeningAudioItemsFromExamContent(examId);
    }
    if (result.error) return res.status(result.status || 400).json({ ok: false, error: result.error });
    await auditAdminAction(req, "listening_audio.sync", "exam", examId, {
      draftId: result.draftId,
      itemCount: result.items.length,
    });
    return res.json({ ok: true, draftId: result.draftId, items: result.items });
  } catch (err) {
    console.error("Listening audio sync failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/listening-audio/sync-all", requireAdmin, async (req, res) => {
  try {
    await ensureListeningAudioProductionSchema();
    const provider = req.body?.provider ? String(req.body.provider).trim().toLowerCase() : "";
    const level = req.body?.level ? String(req.body.level).trim().toUpperCase() : "";
    const params = [];
    let where = "WHERE section_type = 'listen' AND is_active = TRUE";
    if (provider) {
      params.push(provider);
      where += ` AND LOWER(provider) = $${params.length}`;
    }
    if (level) {
      params.push(level);
      where += ` AND UPPER(level) = $${params.length}`;
    }
    const exams = await pool.query(`SELECT id FROM exams ${where} ORDER BY provider, level, series_number, id`, params);
    const results = [];
    for (const exam of exams.rows) {
      const result = await syncListeningAudioItemsFromExamContent(exam.id);
      results.push({
        examId: exam.id,
        ok: !result.error,
        itemCount: result.items?.length || 0,
        error: result.error || null,
      });
    }
    await auditAdminAction(req, "listening_audio.sync_all", "exam", null, {
      provider: provider || null,
      level: level || null,
      examCount: results.length,
      itemCount: results.reduce((sum, row) => sum + Number(row.itemCount || 0), 0),
    });
    return res.json({ ok: true, results });
  } catch (err) {
    console.error("Listening audio sync-all failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/admin/listening-audio/:examId/items", requireAdmin, async (req, res) => {
  try {
    await ensureListeningAudioProductionSchema();
    const examId = Number(req.params.examId);
    const items = await pool.query(
      `SELECT i.*, a.status AS asset_status, a.byte_size, a.provider_model, a.voice_summary, a.updated_at AS asset_updated_at
         FROM exam_listening_audio_items i
         LEFT JOIN exam_audio_assets a ON a.id = i.generated_audio_asset_id
        WHERE i.exam_id = $1
        ORDER BY i.part_number, i.item_number, i.id`,
      [examId]
    );
    return res.json({
      ok: true,
      providerStatus: getProviderStatus(),
      voiceProfiles: await getVoiceProfiles(pool),
      items: items.rows.map((item) => ({
        ...item,
        preview_url: item.generated_audio_asset_id ? `/api/audio/generated/${item.generated_audio_asset_id}` : "",
        admin_transcript_preview: clipPlainText(item.admin_transcript, 900),
      })),
    });
  } catch (err) {
    console.error("Listening audio item lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/api/admin/listening-audio/items/:itemId", requireAdmin, async (req, res) => {
  try {
    await ensureListeningAudioProductionSchema();
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId)) return res.status(400).json({ ok: false, error: "Invalid audio item id" });
    const title = cleanPublicText(req.body?.title, 180);
    const transcript = String(req.body?.transcript ?? req.body?.adminTranscript ?? "").trim();
    const listeningCount = Number(req.body?.listeningCount);
    const audioEngineSettings = req.body?.audioEngineSettings && typeof req.body.audioEngineSettings === "object"
      ? req.body.audioEngineSettings
      : {};
    const validationWarnings = Array.isArray(req.body?.validationWarnings)
      ? req.body.validationWarnings.map((item) => cleanPublicText(item, 300)).filter(Boolean)
      : [];
    if (!transcript) return res.status(400).json({ ok: false, error: "Transcript is required" });
    const updated = await pool.query(
      `UPDATE exam_listening_audio_items
          SET title = COALESCE(NULLIF($2, ''), title),
              admin_transcript = $3,
              listening_count = CASE WHEN $4::int BETWEEN 1 AND 3 THEN $4::int ELSE listening_count END,
              audio_engine_settings = COALESCE($5::jsonb, audio_engine_settings),
              validation_warnings = $6::jsonb,
              audio_generation_status = CASE
                WHEN generated_audio_asset_id IS NOT NULL THEN 'generated'
                ELSE audio_generation_status
              END,
              updated_at = NOW()
        WHERE id = $1
        RETURNING *`,
      [
        itemId,
        title,
        transcript,
        Number.isFinite(listeningCount) ? Math.round(listeningCount) : null,
        JSON.stringify(audioEngineSettings),
        JSON.stringify(validationWarnings),
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Audio item not found" });
    await auditAdminAction(req, "listening_audio.item_update", "listening_audio_item", itemId, {
      examId: updated.rows[0].exam_id,
      hasTranscript: Boolean(transcript),
    });
    return res.json({ ok: true, item: updated.rows[0] });
  } catch (err) {
    console.error("Listening audio item update failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/listening-audio/items/:itemId/generate", requireAdmin, async (req, res) => {
  try {
    await ensureListeningAudioProductionSchema();
    const itemId = Number(req.params.itemId);
    const itemResult = await pool.query(`SELECT * FROM exam_listening_audio_items WHERE id = $1`, [itemId]);
    const item = itemResult.rows[0];
    if (!item) return res.status(404).json({ ok: false, error: "Audio item not found" });
    const profiles = await getVoiceProfiles(pool);
    const audio = buildAudioFromListeningItem(item, profiles);
    const provider = normalizeProvider(req.body?.provider || "elevenlabs");
    await pool.query(
      `UPDATE exam_listening_audio_items
          SET audio_generation_status = 'generating',
              admin_notes = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [itemId]
    );
    const result = await generateAndStoreExamAudio({
      pool,
      examId: item.exam_id,
      audio,
      adminId: req.user.id,
      provider,
      force: Boolean(req.body?.force),
    });
    await pool.query(
      `UPDATE exam_listening_audio_items
          SET generated_audio_asset_id = $2,
              generated_audio_url = $3,
              audio_generation_status = 'generated',
              voice_profile_map = $4::jsonb,
              source_metadata = (COALESCE(source_metadata, '{}'::jsonb)
                - 'browserTtsFallback'
                - 'fallbackEngine'
                - 'fallbackReason'
                - 'fallbackMarkedAt') || jsonb_build_object('mp3GeneratedAt', NOW()),
              validation_warnings = COALESCE(validation_warnings, '[]'::jsonb) || $5::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        itemId,
        result.asset?.id || null,
        result.asset?.id ? `/api/audio/generated/${result.asset.id}` : "",
        JSON.stringify(audio.speakers || []),
        JSON.stringify([
          {
            at: new Date().toISOString(),
            warning: "Clean voice audio generated. Background/SFX mixing is not enabled in this server runtime.",
          },
        ]),
      ]
    );
    await appendAudioItemLog(itemId, {
      action: "generate",
      provider,
      cached: Boolean(result.cached),
      assetId: result.asset?.id || null,
    });
    await auditAdminAction(req, "listening_audio.generate", "exam_listening_audio_item", itemId, {
      provider,
      cached: Boolean(result.cached),
      assetId: result.asset?.id,
    });
    return res.status(result.cached ? 200 : 201).json({
      ok: true,
      cached: Boolean(result.cached),
      provider,
      asset: result.asset,
      previewUrl: result.asset?.id ? `/api/audio/generated/${result.asset.id}` : "",
      warnings: ["Background/SFX mixing skipped; clean voice audio is ready for admin review."],
    });
  } catch (err) {
    const status = err instanceof TtsConfigurationError ? 400 : 502;
    const itemId = Number(req.params.itemId);
    await pool.query(
      `UPDATE exam_listening_audio_items
          SET audio_generation_status = 'failed',
              admin_notes = $2,
              updated_at = NOW()
        WHERE id = $1`,
      [itemId, err.publicMessage || "Audio generation failed."]
    ).catch(() => {});
    await appendAudioItemLog(itemId, { action: "generate_failed", error: err.publicMessage || err.message }).catch(() => {});
    console.error("Listening audio item generation failed", err.message);
    return res.status(status).json({
      ok: false,
      setupRequired: err instanceof TtsConfigurationError,
      error: err.publicMessage || "Audio generation failed.",
    });
  }
});

app.post("/api/admin/listening-audio/generate-batch", requireAdmin, async (req, res) => {
  try {
    await ensureListeningAudioProductionSchema();
    const providerFilter = req.body?.examProvider ? String(req.body.examProvider).trim().toLowerCase() : "";
    const levelFilter = req.body?.level ? String(req.body.level).trim().toUpperCase() : "";
    const limit = Math.max(1, Math.min(100, Number(req.body?.limit) || 10));
    const force = Boolean(req.body?.force);
    const publish = req.body?.publish !== false;
    const params = [];
    let where = `
      WHERE i.admin_transcript IS NOT NULL
        AND LENGTH(TRIM(i.admin_transcript)) >= 20
        AND (i.generated_audio_asset_id IS NULL OR i.audio_generation_status IN ('draft', 'failed', 'queued', 'generating') OR $1::boolean = TRUE)
    `;
    params.push(force);
    if (providerFilter) {
      params.push(providerFilter);
      where += ` AND LOWER(i.provider) = $${params.length}`;
    }
    if (levelFilter) {
      params.push(levelFilter);
      where += ` AND UPPER(i.level) = $${params.length}`;
    }
    params.push(limit);
    const items = await pool.query(
      `SELECT i.*
         FROM exam_listening_audio_items i
        ${where}
        ORDER BY i.provider, i.level, i.series_number, i.part_number, i.item_number, i.id
        LIMIT $${params.length}`,
      params
    );
    const profiles = await getVoiceProfiles(pool);
    const results = [];
    for (const item of items.rows) {
      try {
        const audio = buildAudioFromListeningItem(item, profiles);
        const provider = normalizeProvider(req.body?.provider || "elevenlabs");
        await pool.query(
          `UPDATE exam_listening_audio_items
              SET audio_generation_status = 'generating',
                  admin_notes = NULL,
                  updated_at = NOW()
            WHERE id = $1`,
          [item.id]
        );
        const generated = await generateAndStoreExamAudio({
          pool,
          examId: item.exam_id,
          audio,
          adminId: req.user.id,
          provider,
          force,
        });
        const nextStatus = publish ? "published" : "generated";
        await pool.query(
          `UPDATE exam_listening_audio_items
              SET generated_audio_asset_id = $2,
                  generated_audio_url = $3,
                  audio_generation_status = $4,
                  voice_profile_map = $5::jsonb,
                  source_metadata = (COALESCE(source_metadata, '{}'::jsonb)
                    - 'browserTtsFallback'
                    - 'fallbackEngine'
                    - 'fallbackReason'
                    - 'fallbackMarkedAt') || jsonb_build_object('mp3GeneratedAt', NOW()),
                  approved_at = CASE WHEN $4 IN ('approved','published') THEN COALESCE(approved_at, NOW()) ELSE approved_at END,
                  published_at = CASE WHEN $4 = 'published' THEN NOW() ELSE published_at END,
                  validation_warnings = COALESCE(validation_warnings, '[]'::jsonb) || $6::jsonb,
                  updated_at = NOW()
            WHERE id = $1`,
          [
            item.id,
            generated.asset?.id || null,
            generated.asset?.id ? `/api/audio/generated/${generated.asset.id}` : "",
            nextStatus,
            JSON.stringify(audio.speakers || []),
            JSON.stringify([{ at: new Date().toISOString(), warning: "Clean voice MP3 generated; background/SFX mixing skipped on this runtime." }]),
          ]
        );
        await appendAudioItemLog(item.id, {
          action: "batch_generate",
          provider,
          cached: Boolean(generated.cached),
          assetId: generated.asset?.id || null,
          status: nextStatus,
        });
        results.push({ itemId: item.id, examId: item.exam_id, ok: true, assetId: generated.asset?.id || null, cached: Boolean(generated.cached), status: nextStatus });
      } catch (err) {
        await pool.query(
          `UPDATE exam_listening_audio_items
              SET audio_generation_status = 'failed',
                  admin_notes = $2,
                  updated_at = NOW()
            WHERE id = $1`,
          [item.id, err.publicMessage || err.message || "Audio generation failed."]
        ).catch(() => {});
        await appendAudioItemLog(item.id, { action: "batch_generate_failed", error: err.publicMessage || err.message }).catch(() => {});
        results.push({ itemId: item.id, examId: item.exam_id, ok: false, setupRequired: err instanceof TtsConfigurationError, error: err.publicMessage || "Audio generation failed." });
        if (err instanceof TtsConfigurationError || Number(err.status) === 401 || Number(err.status) === 402 || Number(err.status) === 429) {
          break;
        }
      }
    }
    await auditAdminAction(req, "listening_audio.generate_batch", "exam_listening_audio_item", null, {
      provider: req.body?.provider || "elevenlabs",
      limit,
      force,
      publish,
      generated: results.filter((row) => row.ok).length,
      failed: results.filter((row) => !row.ok).length,
    });
    return res.json({ ok: true, requestedLimit: limit, processed: results.length, results });
  } catch (err) {
    console.error("Listening audio batch generation failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/listening-audio/items/:itemId/approve", requireAdmin, async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    const result = await pool.query(
      `UPDATE exam_listening_audio_items
          SET audio_generation_status = 'approved',
              approved_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND generated_audio_asset_id IS NOT NULL
          AND audio_generation_status IN ('generated', 'approved', 'published')
        RETURNING *`,
      [itemId]
    );
    if (!result.rows[0]) return res.status(400).json({ ok: false, error: "Generate audio before approving this item." });
    await appendAudioItemLog(itemId, { action: "approve", adminId: req.user.id });
    await auditAdminAction(req, "listening_audio.approve", "exam_listening_audio_item", itemId, {});
    return res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error("Listening audio approve failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/listening-audio/items/:itemId/publish", requireAdmin, async (req, res) => {
  try {
    const itemId = Number(req.params.itemId);
    const result = await pool.query(
      `UPDATE exam_listening_audio_items
          SET audio_generation_status = 'published',
              approved_at = COALESCE(approved_at, NOW()),
              published_at = NOW(),
              updated_at = NOW()
        WHERE id = $1
          AND generated_audio_asset_id IS NOT NULL
          AND audio_generation_status IN ('generated', 'approved', 'published')
        RETURNING *`,
      [itemId]
    );
    if (!result.rows[0]) return res.status(400).json({ ok: false, error: "Generate audio before publishing this item." });
    await appendAudioItemLog(itemId, { action: "publish", adminId: req.user.id });
    await auditAdminAction(req, "listening_audio.publish", "exam_listening_audio_item", itemId, {});
    return res.json({ ok: true, item: result.rows[0] });
  } catch (err) {
    console.error("Listening audio publish failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.get("/api/health", async (req, res) => {
  return res.json({
    ok: true,
    service: "german-exam-app-api",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/admin/exams/:examId/audio", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const context = await loadListeningExamAudioContext(examId);
    if (context.error) return res.status(context.status).json({ ok: false, error: context.error });
    const provider = normalizeProvider(req.query.provider || getConfiguredProvider());
    const { contentHash, asset } = await getAudioAssetForExam({
      pool,
      examId,
      audio: context.audio,
      provider,
    });
    return res.json({
      ok: true,
      provider,
      providerStatus: getProviderStatus(),
      contentHash,
      audio: await attachGeneratedListeningAudio({ examId, audio: context.audio, provider }),
      asset,
    });
  } catch (err) {
    console.error("Audio status failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/exams/:examId/audio/generate", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const context = await loadListeningExamAudioContext(examId);
    if (context.error) return res.status(context.status).json({ ok: false, error: context.error });
    const provider = normalizeProvider(req.body?.provider || getConfiguredProvider());
    const result = await generateAndStoreExamAudio({
      pool,
      examId,
      audio: context.audio,
      adminId: req.user.id,
      provider,
      force: Boolean(req.body?.force),
    });
    await auditAdminAction(req, "exam.audio_generate", "exam", examId, {
      provider,
      cached: result.cached,
      assetId: result.asset?.id,
    });
    return res.status(result.cached ? 200 : 201).json({
      ok: true,
      cached: result.cached,
      provider,
      asset: result.asset,
      audio: await attachGeneratedListeningAudio({ examId, audio: context.audio, provider }),
    });
  } catch (err) {
    const status = err instanceof TtsConfigurationError ? 400 : 502;
    console.error("Audio generation failed", err.message);
    return res.status(status).json({
      ok: false,
      setupRequired: err instanceof TtsConfigurationError,
      error: err.publicMessage || "Audio generation failed. Keep the previous audio and try again later.",
    });
  }
});

app.get("/api/admin/exams", requireAdmin, async (req, res) => {
  try {
    const exams = await pool.query(`
      SELECT e.*,
             COALESCE(q.question_count, 0)::int AS question_count,
             COALESCE(s.section_count, 0)::int AS section_count,
             COALESCE(s.total_points, 0)::int AS total_points,
             COALESCE(s.total_duration_minutes, 0)::int AS total_duration_minutes
      FROM exams e
      LEFT JOIN (
        SELECT exam_id, COUNT(*) AS question_count
        FROM exam_questions
        GROUP BY exam_id
      ) q ON q.exam_id = e.id
      LEFT JOIN (
        SELECT exam_id,
               COUNT(*) AS section_count,
               SUM(COALESCE(points, 0)) AS total_points,
               SUM(COALESCE(duration_minutes, 0)) AS total_duration_minutes
        FROM exam_sections
        GROUP BY exam_id
      ) s ON s.exam_id = e.id
      ORDER BY e.updated_at DESC, e.created_at DESC
    `);
    const sections = await pool.query(`
      SELECT *
      FROM exam_sections
      ORDER BY exam_id, position, id
    `);
    const questions = await pool.query(`
      SELECT q.*, s.title AS section_title, s.part_number AS section_part_number
      FROM exam_questions q
      LEFT JOIN exam_sections s ON s.id = q.section_id
      ORDER BY q.exam_id, COALESCE(s.position, 0), q.position, q.id
    `);
    const imports = await pool.query(`
      SELECT id, filename, provider, exam_type, level, section_type, total_series,
             total_sections, total_questions, parse_status, validation_warnings,
             confidence, imported_exam_ids, error_message, created_at, updated_at, published_at,
             CASE WHEN draft_content <> '{}'::jsonb THEN TRUE ELSE FALSE END AS has_draft
      FROM exam_document_imports
      ORDER BY updated_at DESC, created_at DESC
      LIMIT 25
    `);
    return res.json({
      ok: true,
      exams: exams.rows,
      sections: sections.rows,
      questions: questions.rows,
      imports: imports.rows,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

async function insertExamPayload(payload, adminId) {
  const code = String(payload?.code ?? "").trim().toLowerCase();
  const name = String(payload?.name ?? "").trim();
  const examType = String(payload?.examType ?? payload?.exam_type ?? "custom").trim();
  const level = String(payload?.level ?? "").trim() || null;
  const isActive = typeof payload?.isActive === "boolean" ? payload.isActive : true;
  if (!code || !name) throw new Error("Exam code and name are required");

  const exam = await pool.query(
    `INSERT INTO exams (code, name, exam_type, level, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (code)
     DO UPDATE SET name = EXCLUDED.name,
                   exam_type = EXCLUDED.exam_type,
                   level = EXCLUDED.level,
                   is_active = EXCLUDED.is_active,
                   updated_at = NOW()
     RETURNING *`,
    [code.slice(0, 80), name.slice(0, 160), examType.slice(0, 80), level?.slice(0, 40) ?? null, isActive, adminId]
  );

  if (Array.isArray(payload?.questions)) {
    for (const [index, question] of payload.questions.entries()) {
      await pool.query(
        `INSERT INTO exam_questions (exam_id, module_id, prompt, options, correct_answer, explanation, position)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          exam.rows[0].id,
          String(question.moduleId ?? question.module_id ?? "read").slice(0, 40),
          String(question.prompt ?? "").slice(0, 5000),
          Array.isArray(question.options) ? question.options : [],
          question.correctAnswer ?? question.correct_answer ?? {},
          typeof question.explanation === "string" ? question.explanation.slice(0, 5000) : null,
          Number.isInteger(question.position) ? question.position : index,
        ]
      );
    }
  }

  return exam.rows[0];
}

const buildGeneratedExamContent = ({ type, serie, level, moduleCategory }, index) => {
  const safeType = String(type || "custom").slice(0, 50);
  const safeSerie = String(serie || "serie-1").slice(0, 50);
  const safeLevel = String(level || "B2").slice(0, 10);
  const safeModule = String(moduleCategory || "reading").slice(0, 50);
  const topic = `${safeType} ${safeSerie} ${safeModule}`;

  return {
    type: safeType,
    level: safeLevel,
    language: "de",
    question: `Lesen Sie die Aufgabe ${index + 1} zum Thema ${topic} und waehlen Sie die passende Antwort.`,
    answers: [
      "Ich bereite mich regelmaessig auf die Deutschpruefung vor.",
      "Der Termin wurde gestern ohne Begruendung abgesagt.",
      "Viele Studierende nutzen die Bibliothek am Abend.",
      "Die Anmeldung erfolgt ueber das Online-Portal.",
    ],
    correct_answer: "Ich bereite mich regelmaessig auf die Deutschpruefung vor.",
  };
};

app.post("/api/admin/exams/generate", requireAdmin, async (req, res) => {
  try {
    const quantity = Math.max(1, Math.min(50, Number(req.body?.quantity) || 1));
    const generated = [];

    for (let index = 0; index < quantity; index += 1) {
      const item = buildGeneratedExamContent(req.body ?? {}, index);
      const inserted = await pool.query(
        `INSERT INTO exam_content (type, level, language, question, answers, correct_answer, created_by)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
         RETURNING *`,
        [
          item.type,
          item.level,
          item.language,
          item.question,
          JSON.stringify(item.answers),
          item.correct_answer,
          req.user.id,
        ]
      );
      generated.push(inserted.rows[0]);
    }

    await auditAdminAction(req, "exam.generate", "exam_content", "bulk", {
      quantity,
      type: req.body?.type,
      serie: req.body?.serie,
      level: req.body?.level,
      moduleCategory: req.body?.moduleCategory,
    });
    return res.status(201).json({ ok: true, generated });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/exams", requireAdmin, async (req, res) => {
  try {
    const exam = await insertExamPayload(req.body, req.user.id);
    await auditAdminAction(req, "exam.create", "exam", exam.id, { code: exam.code });
    return res.status(201).json({ ok: true, exam });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || "Invalid exam payload" });
  }
});

app.post("/api/admin/exams/bulk", requireAdmin, async (req, res) => {
  try {
    const exams = Array.isArray(req.body?.exams) ? req.body.exams : [];
    if (!exams.length) return res.status(400).json({ ok: false, error: "exams array is required" });
    const inserted = [];
    for (const payload of exams) {
      inserted.push(await insertExamPayload(payload, req.user.id));
    }
    await auditAdminAction(req, "exam.bulk_create", "exam", "bulk", { count: inserted.length });
    return res.status(201).json({ ok: true, exams: inserted });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || "Invalid bulk exam payload" });
  }
});

app.post("/api/admin/exams/upload-json", requireAdmin, async (req, res) => {
  try {
    const payload = req.body?.payload ?? req.body;
    const exams = Array.isArray(payload) ? payload : Array.isArray(payload?.exams) ? payload.exams : [payload];
    if (!exams.length) return res.status(400).json({ ok: false, error: "Upload JSON must include exam data" });
    const inserted = [];
    for (const exam of exams) {
      inserted.push(await insertExamPayload(exam, req.user.id));
    }
    await auditAdminAction(req, "exam.upload_json", "exam", "json", { count: inserted.length });
    return res.status(201).json({ ok: true, exams: inserted });
  } catch (err) {
    return res.status(400).json({ ok: false, error: err.message || "Invalid JSON upload" });
  }
});

const toImportWizardPayload = (row, parsed = row?.draft_content, validation = null) => {
  if (!row) return null;
  const draft = parsed && typeof parsed === "object" ? parsed : {};
  const currentValidation = validation || validateImportDraftContent(draft);
  return {
    import: {
      id: row.id,
      filename: row.filename,
      provider: row.provider,
      examType: row.exam_type,
      level: row.level,
      sectionType: row.section_type,
      totalSeries: row.total_series,
      totalSections: row.total_sections,
      totalQuestions: row.total_questions,
      parseStatus: row.parse_status,
      validationWarnings: row.validation_warnings,
      confidence: row.confidence,
      importedExamIds: row.imported_exam_ids,
      errorMessage: row.error_message,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      publishedAt: row.published_at,
    },
    analysis: {
      documentHash: draft.documentHash || row.document_hash,
      filename: draft.filename || row.filename,
      sizeBytes: draft.sizeBytes || row.size_bytes,
      extraction: draft.extraction || { method: row.extraction_method },
      metadata: draft.metadata || {
        provider: row.provider,
        examType: row.exam_type,
        level: row.level,
        sectionType: row.section_type,
      },
      confidence: draft.confidence || row.confidence || {},
      validation: currentValidation,
      outline: summarizeOutline(draft),
    },
    draft,
  };
};

app.post("/api/admin/exams/analyze-document", requireAdmin, documentUpload.single("document"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Document file is required" });
    }
    const parsed = await analyzeExamDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    await auditAdminAction(req, "exam.document_analyze", "document", parsed.documentHash, {
      filename: parsed.filename,
      provider: parsed.metadata.provider,
      sectionType: parsed.metadata.sectionType,
      series: parsed.series.length,
      questions: parsed.validation.questionCount,
    });
    return res.json({
      ok: true,
      analysis: {
        documentHash: parsed.documentHash,
        filename: parsed.filename,
        sizeBytes: parsed.sizeBytes,
        extraction: parsed.extraction,
        metadata: parsed.metadata,
        validation: parsed.validation,
        outline: summarizeOutline(parsed),
      },
    });
  } catch (err) {
    console.error("Document analysis failed", err);
    return res.status(400).json({ ok: false, error: err.message || "Document analysis failed" });
  }
});

app.post("/api/admin/exams/import-wizard/analyze", requireAdmin, documentUpload.single("document"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Document file is required" });
    }
    const parsed = await analyzeExamDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    const draft = await saveExamImportDraft({
      pool,
      parsed,
      adminId: req.user.id,
    });
    await auditAdminAction(req, "exam.import_wizard_analyze", "document", parsed.documentHash, {
      importId: draft.import?.id,
      duplicate: draft.duplicate,
      filename: parsed.filename,
      provider: parsed.metadata.provider,
      sectionType: parsed.metadata.sectionType,
      series: parsed.series.length,
      questions: draft.validation?.counts?.questionCount ?? parsed.validation.questionCount,
    });
    return res.status(draft.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: draft.duplicate,
      ...toImportWizardPayload(draft.import, draft.parsed, draft.validation),
    });
  } catch (err) {
    console.error("Import wizard analysis failed", err);
    return res.status(400).json({ ok: false, error: err.message || "Import wizard analysis failed" });
  }
});

app.post("/api/admin/hoeren-import/foundation", requireAdmin, documentUpload.single("document"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "DOCX document file is required" });
    }
    const filename = req.file.originalname || "";
    if (!/\.docx$/i.test(filename)) {
      return res.status(400).json({ ok: false, error: "Only DOCX files are supported in the Hören foundation step" });
    }
    const foundation = await buildHoerenParsedPreview({
      buffer: req.file.buffer,
      filename,
      mimetype: req.file.mimetype,
      provider: req.body?.provider,
      level: req.body?.level,
      maxSeries: req.body?.maxSeries ? Number(req.body.maxSeries) : null,
    });
    const saved = await saveListeningImportFoundationDraft({
      pool,
      foundation,
      adminId: req.user.id,
    });
    await auditAdminAction(req, "hoeren_import.foundation_draft", "document_import", saved.import?.id || foundation.documentHash, {
      duplicate: saved.duplicate,
      filename,
      provider: foundation.metadata.provider,
      level: foundation.metadata.level,
      markers: foundation.draft.markerCounts,
    });
    return res.status(saved.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: saved.duplicate,
      import: saved.import,
      draft: saved.draft,
    });
  } catch (err) {
    console.error("Hören import foundation failed", err);
    return res.status(400).json({ ok: false, error: err.message || "Hören import foundation failed" });
  }
});

app.get("/api/admin/exams/import-wizard/:id", requireAdmin, async (req, res) => {
  try {
    const row = await getExamImportDraft({ pool, importId: Number(req.params.id) });
    if (!row) return res.status(404).json({ ok: false, error: "Import draft not found" });
    return res.json({ ok: true, ...toImportWizardPayload(row) });
  } catch (err) {
    console.error("Import wizard lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/api/admin/exams/import-wizard/:id", requireAdmin, async (req, res) => {
  try {
    const draftContent = req.body?.draft ?? req.body?.draftContent;
    if (!draftContent || typeof draftContent !== "object") {
      return res.status(400).json({ ok: false, error: "Draft content is required" });
    }
    const updated = await updateExamImportDraft({
      pool,
      importId: Number(req.params.id),
      draftContent,
    });
    if (!updated.import) return res.status(404).json({ ok: false, error: "Import draft not found" });
    await auditAdminAction(req, "exam.import_wizard_update", "document_import", req.params.id, {
      questions: updated.validation.counts.questionCount,
      errors: updated.validation.errors.length,
    });
    return res.json({ ok: true, ...toImportWizardPayload(updated.import, updated.parsed, updated.validation) });
  } catch (err) {
    console.error("Import wizard save failed", err);
    return res.status(400).json({ ok: false, error: err.message || "Import wizard save failed" });
  }
});

app.post("/api/admin/exams/import-wizard/:id/validate", requireAdmin, async (req, res) => {
  try {
    const row = await getExamImportDraft({ pool, importId: Number(req.params.id) });
    if (!row) return res.status(404).json({ ok: false, error: "Import draft not found" });
    const validation = validateImportDraftContent(row.draft_content);
    return res.json({ ok: true, validation });
  } catch (err) {
    console.error("Import wizard validation failed", err);
    return res.status(400).json({ ok: false, error: err.message || "Import wizard validation failed" });
  }
});

app.post("/api/admin/exams/import-wizard/:id/publish", requireAdmin, async (req, res) => {
  try {
    const force = req.query.force === "true" || req.body?.force === true;
    const row = await getExamImportDraft({ pool, importId: Number(req.params.id) });
    if (!row) return res.status(404).json({ ok: false, error: "Import draft not found" });
    const preValidation = validateImportDraftContent(row.draft_content);
    if (!force && preValidation.warnings?.length) {
      return res.status(409).json({
        ok: false,
        error: "Unresolved validation warnings found. Review them before publishing or publish with force after admin approval.",
        validation: preValidation,
        canForce: true,
      });
    }
    const result = await publishExamImportDraft({
      pool,
      importId: Number(req.params.id),
      adminId: req.user.id,
    });
    const audioGeneration = await generateListeningAudioForPublishedExams({
      exams: result.exams,
      adminId: req.user.id,
    });
    await auditAdminAction(req, result.duplicate ? "exam.import_wizard_duplicate" : "exam.import_wizard_publish", "document_import", req.params.id, {
      exams: result.exams.length,
      provider: result.parsed?.metadata?.provider,
      sectionType: result.parsed?.metadata?.sectionType,
      questions: result.validation?.counts?.questionCount,
      audioGeneration,
    });
    return res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      exams: result.exams,
      audioGeneration,
      ...toImportWizardPayload(result.import, result.parsed, result.validation),
    });
  } catch (err) {
    console.error("Import wizard publish failed", err);
    return res.status(400).json({
      ok: false,
      error: err.message || "Import wizard publish failed",
      validation: err.validation || null,
    });
  }
});

app.post("/api/admin/exams/import-document", requireAdmin, documentUpload.single("document"), async (req, res) => {
  try {
    if (!req.file?.buffer) {
      return res.status(400).json({ ok: false, error: "Document file is required" });
    }
    const parsed = await analyzeExamDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      mimetype: req.file.mimetype,
    });
    const result = await importParsedExamDocument({
      pool,
      parsed,
      adminId: req.user.id,
    });
    const audioGeneration = await generateListeningAudioForPublishedExams({
      exams: result.exams,
      adminId: req.user.id,
    });
    await auditAdminAction(
      req,
      result.duplicate ? "exam.document_duplicate" : "exam.document_import",
      "document",
      parsed.documentHash,
      {
        filename: parsed.filename,
        importId: result.import?.id,
        duplicate: result.duplicate,
        exams: result.exams.length,
        provider: parsed.metadata.provider,
        sectionType: parsed.metadata.sectionType,
        series: parsed.series.length,
        questions: parsed.validation.questionCount,
        audioGeneration,
      }
    );
    return res.status(result.duplicate ? 200 : 201).json({
      ok: true,
      duplicate: result.duplicate,
      import: result.import,
      exams: result.exams,
      audioGeneration,
      analysis: {
        documentHash: parsed.documentHash,
        filename: parsed.filename,
        sizeBytes: parsed.sizeBytes,
        extraction: parsed.extraction,
        metadata: parsed.metadata,
        validation: parsed.validation,
        outline: summarizeOutline(parsed),
      },
    });
  } catch (err) {
    console.error("Document import failed", err);
    return res.status(400).json({ ok: false, error: err.message || "Document import failed" });
  }
});

app.get("/api/admin/exams/:id/validation", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.id);
    if (!Number.isInteger(examId)) return res.status(400).json({ ok: false, error: "Invalid exam id" });
    const validation = await buildExamContentValidation(examId);
    if (!validation) return res.status(404).json({ ok: false, error: "Exam not found" });
    return res.json({ ok: true, validation });
  } catch (err) {
    console.error("Exam validation failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/api/admin/exams/:id", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.id);
    const { code, name, examType, level, isActive, provider, sectionType, seriesNumber, metadata } = req.body ?? {};
    let parsedMetadata;
    try {
      parsedMetadata = normalizeJsonPayload(metadata);
    } catch {
      return res.status(400).json({ ok: false, error: "Exam metadata must be valid JSON" });
    }
    const updated = await pool.query(
      `UPDATE exams
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           exam_type = COALESCE($3, exam_type),
           level = COALESCE($4, level),
           is_active = COALESCE($5, is_active),
           provider = COALESCE($6, provider),
           section_type = COALESCE($7, section_type),
           series_number = COALESCE($8, series_number),
           metadata = COALESCE($9::jsonb, metadata),
           updated_at = NOW()
       WHERE id = $10
       RETURNING *`,
      [
        normalizeOptionalText(code, 80)?.toLowerCase() ?? null,
        normalizeOptionalText(name, 160),
        normalizeOptionalText(examType, 80),
        normalizeOptionalText(level, 40),
        typeof isActive === "boolean" ? isActive : null,
        normalizeOptionalText(provider, 80),
        normalizeOptionalText(sectionType, 40),
        normalizeInteger(seriesNumber),
        parsedMetadata === undefined ? null : JSON.stringify(parsedMetadata),
        examId,
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Exam not found" });
    await auditAdminAction(req, "exam.update", "exam", examId, req.body);
    return res.json({ ok: true, exam: updated.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/exams/:id/duplicate", requireAdmin, async (req, res) => {
  const examId = Number(req.params.id);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const original = await client.query(`SELECT * FROM exams WHERE id = $1`, [examId]);
    if (!original.rows[0]) {
      await client.query("ROLLBACK");
      return res.status(404).json({ ok: false, error: "Exam not found" });
    }

    const source = original.rows[0];
    const duplicateCode = `${String(source.code).slice(0, 58)}-copy-${Date.now().toString(36)}`.slice(0, 80);
    const metadata = {
      ...((source.metadata && typeof source.metadata === "object") ? source.metadata : {}),
      duplicatedFromExamId: source.id,
      duplicatedAt: new Date().toISOString(),
    };
    const insertedExam = await client.query(
      `INSERT INTO exams (
         code, name, exam_type, level, is_active, created_by, provider, section_type,
         series_number, source_import_id, metadata
       )
       VALUES ($1, $2, $3, $4, FALSE, $5, $6, $7, $8, $9, $10::jsonb)
       RETURNING *`,
      [
        duplicateCode,
        `${source.name} (copy)`.slice(0, 160),
        source.exam_type,
        source.level,
        req.user.id,
        source.provider,
        source.section_type,
        source.series_number,
        source.source_import_id,
        JSON.stringify(metadata),
      ]
    );
    const copy = insertedExam.rows[0];

    const sections = await client.query(`SELECT * FROM exam_sections WHERE exam_id = $1 ORDER BY position, id`, [examId]);
    const sectionIdMap = new Map();
    for (const section of sections.rows) {
      const insertedSection = await client.query(
        `INSERT INTO exam_sections (
           exam_id, section_type, part_number, title, instructions, duration_minutes,
           points, scoring, metadata, position
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
         RETURNING *`,
        [
          copy.id,
          section.section_type,
          section.part_number,
          section.title,
          section.instructions,
          section.duration_minutes,
          section.points,
          JSON.stringify(section.scoring || {}),
          JSON.stringify(section.metadata || {}),
          section.position,
        ]
      );
      sectionIdMap.set(section.id, insertedSection.rows[0].id);
    }

    const questions = await client.query(`SELECT * FROM exam_questions WHERE exam_id = $1 ORDER BY position, id`, [examId]);
    for (const question of questions.rows) {
      await client.query(
        `INSERT INTO exam_questions (
           exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
           position, question_type, transcript, audio, scoring, source_metadata
         )
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)`,
        [
          copy.id,
          question.section_id ? sectionIdMap.get(question.section_id) ?? null : null,
          question.module_id,
          question.prompt,
          JSON.stringify(question.options || []),
          JSON.stringify(question.correct_answer || {}),
          question.explanation,
          question.position,
          question.question_type,
          question.transcript,
          JSON.stringify(question.audio || {}),
          JSON.stringify(question.scoring || {}),
          JSON.stringify(question.source_metadata || {}),
        ]
      );
    }

    await client.query("COMMIT");
    await auditAdminAction(req, "exam.duplicate", "exam", copy.id, { sourceExamId: examId });
    return res.status(201).json({ ok: true, exam: copy });
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  } finally {
    client.release();
  }
});

app.post("/api/admin/exams/:examId/sections", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const exam = await pool.query(`SELECT id, section_type FROM exams WHERE id = $1`, [examId]);
    if (!exam.rows[0]) return res.status(404).json({ ok: false, error: "Exam not found" });

    let scoring;
    let metadata;
    try {
      scoring = normalizeJsonPayload(req.body?.scoring, {});
      metadata = normalizeJsonPayload(req.body?.metadata, {});
    } catch {
      return res.status(400).json({ ok: false, error: "Section scoring and metadata must be valid JSON" });
    }

    const requestedPosition = normalizeInteger(req.body?.position);
    const nextPosition = requestedPosition == null
      ? await pool.query(`SELECT COALESCE(MAX(position), 0) + 1 AS position FROM exam_sections WHERE exam_id = $1`, [examId])
      : null;
    const inserted = await pool.query(
      `INSERT INTO exam_sections (
         exam_id, section_type, part_number, title, instructions, duration_minutes,
         points, scoring, metadata, position
       )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)
       RETURNING *`,
      [
        examId,
        normalizeOptionalText(req.body?.sectionType, 40) || exam.rows[0].section_type || "read",
        normalizeInteger(req.body?.partNumber, 1) || 1,
        normalizeOptionalText(req.body?.title, 2000) || "New section",
        normalizeOptionalText(req.body?.instructions, 12000),
        normalizeInteger(req.body?.durationMinutes),
        normalizeInteger(req.body?.points),
        JSON.stringify(scoring || {}),
        JSON.stringify(metadata || {}),
        requestedPosition == null ? Number(nextPosition.rows[0]?.position) || 1 : requestedPosition,
      ]
    );
    await touchExam(examId);
    await auditAdminAction(req, "exam.section_create", "section", inserted.rows[0].id, { examId });
    return res.status(201).json({ ok: true, section: inserted.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/api/admin/exams/:examId/sections/:sectionId", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const sectionId = Number(req.params.sectionId);
    let scoring;
    let metadata;
    try {
      scoring = normalizeJsonPayload(req.body?.scoring);
      metadata = normalizeJsonPayload(req.body?.metadata);
    } catch {
      return res.status(400).json({ ok: false, error: "Section scoring and metadata must be valid JSON" });
    }

    const updated = await pool.query(
      `UPDATE exam_sections
       SET section_type = COALESCE($1, section_type),
           part_number = COALESCE($2, part_number),
           title = COALESCE($3, title),
           instructions = COALESCE($4, instructions),
           duration_minutes = COALESCE($5, duration_minutes),
           points = COALESCE($6, points),
           scoring = COALESCE($7::jsonb, scoring),
           metadata = COALESCE($8::jsonb, metadata),
           position = COALESCE($9, position),
           updated_at = NOW()
       WHERE id = $10 AND exam_id = $11
       RETURNING *`,
      [
        normalizeOptionalText(req.body?.sectionType, 40),
        normalizeInteger(req.body?.partNumber),
        normalizeOptionalText(req.body?.title, 2000),
        normalizeOptionalText(req.body?.instructions, 12000),
        normalizeInteger(req.body?.durationMinutes),
        normalizeInteger(req.body?.points),
        scoring === undefined ? null : JSON.stringify(scoring || {}),
        metadata === undefined ? null : JSON.stringify(metadata || {}),
        normalizeInteger(req.body?.position),
        sectionId,
        examId,
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Section not found" });
    await touchExam(examId);
    await auditAdminAction(req, "exam.section_update", "section", sectionId, { examId });
    return res.json({ ok: true, section: updated.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.delete("/api/admin/exams/:examId/sections/:sectionId", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const sectionId = Number(req.params.sectionId);
    const linked = await pool.query(
      `SELECT COUNT(*)::int AS question_count FROM exam_questions WHERE exam_id = $1 AND section_id = $2`,
      [examId, sectionId]
    );
    if (Number(linked.rows[0]?.question_count) > 0) {
      return res.status(409).json({ ok: false, error: "Move or delete section questions before deleting this section" });
    }
    const deleted = await pool.query(
      `DELETE FROM exam_sections WHERE id = $1 AND exam_id = $2 RETURNING *`,
      [sectionId, examId]
    );
    if (!deleted.rows[0]) return res.status(404).json({ ok: false, error: "Section not found" });
    await touchExam(examId);
    await auditAdminAction(req, "exam.section_delete", "section", sectionId, { examId });
    return res.json({ ok: true, section: deleted.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/api/admin/exams/:examId/questions", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const exam = await pool.query(`SELECT id, section_type FROM exams WHERE id = $1`, [examId]);
    if (!exam.rows[0]) return res.status(404).json({ ok: false, error: "Exam not found" });

    const sectionId = normalizeInteger(req.body?.sectionId);
    let section = null;
    if (sectionId != null) {
      const sectionResult = await pool.query(`SELECT * FROM exam_sections WHERE id = $1 AND exam_id = $2`, [sectionId, examId]);
      section = sectionResult.rows[0];
      if (!section) return res.status(400).json({ ok: false, error: "Section does not belong to this exam" });
    }

    let options;
    let correctAnswer;
    let audio;
    let scoring;
    let sourceMetadata;
    try {
      options = normalizeJsonPayload(req.body?.options, []);
      correctAnswer = normalizeJsonPayload(req.body?.correctAnswer ?? req.body?.correct_answer, {});
      audio = normalizeJsonPayload(req.body?.audio, {});
      scoring = normalizeJsonPayload(req.body?.scoring, {});
      sourceMetadata = normalizeJsonPayload(req.body?.sourceMetadata ?? req.body?.source_metadata, {});
    } catch {
      return res.status(400).json({ ok: false, error: "Question JSON fields must be valid JSON" });
    }
    if (!Array.isArray(options)) {
      return res.status(400).json({ ok: false, error: "Question options must be a JSON array" });
    }

    const requestedPosition = normalizeInteger(req.body?.position);
    const nextPosition = requestedPosition == null
      ? await pool.query(`SELECT COALESCE(MAX(position), 0) + 1 AS position FROM exam_questions WHERE exam_id = $1`, [examId])
      : null;
    const inserted = await pool.query(
      `INSERT INTO exam_questions (
         exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
         position, question_type, transcript, audio, scoring, source_metadata
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, $11::jsonb, $12::jsonb, $13::jsonb)
       RETURNING *`,
      [
        examId,
        sectionId ?? null,
        normalizeOptionalText(req.body?.moduleId, 40) || section?.section_type || exam.rows[0].section_type || "read",
        normalizeOptionalText(req.body?.prompt, 12000) || "New prompt",
        JSON.stringify(options),
        JSON.stringify(correctAnswer || {}),
        normalizeOptionalText(req.body?.explanation, 5000),
        requestedPosition == null ? Number(nextPosition.rows[0]?.position) || 1 : requestedPosition,
        normalizeOptionalText(req.body?.questionType, 80) || "prompt",
        normalizeOptionalText(req.body?.transcript, 12000),
        JSON.stringify(audio || {}),
        JSON.stringify(scoring || {}),
        JSON.stringify(sourceMetadata || {}),
      ]
    );
    await touchExam(examId);
    await auditAdminAction(req, "exam.question_create", "question", inserted.rows[0].id, { examId, sectionId });
    return res.status(201).json({ ok: true, question: inserted.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.put("/api/admin/exams/:examId/questions/:questionId", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    const {
      sectionId,
      moduleId,
      prompt,
      options,
      correctAnswer,
      correct_answer: legacyCorrectAnswer,
      explanation,
      position,
      questionType,
      transcript,
      audio,
      scoring,
      sourceMetadata,
      source_metadata: legacySourceMetadata,
    } = req.body ?? {};
    const normalizedSectionId = normalizeInteger(sectionId);
    if (normalizedSectionId != null) {
      const section = await pool.query(`SELECT id FROM exam_sections WHERE id = $1 AND exam_id = $2`, [normalizedSectionId, examId]);
      if (!section.rows[0]) return res.status(400).json({ ok: false, error: "Section does not belong to this exam" });
    }
    let parsedOptions;
    let parsedCorrectAnswer;
    let parsedAudio;
    let parsedScoring;
    let parsedSourceMetadata;
    try {
      parsedOptions = normalizeJsonPayload(options);
      parsedCorrectAnswer = normalizeJsonPayload(correctAnswer ?? legacyCorrectAnswer);
      parsedAudio = normalizeJsonPayload(audio);
      parsedScoring = normalizeJsonPayload(scoring);
      parsedSourceMetadata = normalizeJsonPayload(sourceMetadata ?? legacySourceMetadata);
    } catch {
      return res.status(400).json({ ok: false, error: "Question JSON fields must be valid JSON" });
    }
    if (parsedOptions !== undefined && !Array.isArray(parsedOptions)) {
      return res.status(400).json({ ok: false, error: "Question options must be a JSON array" });
    }
    const updated = await pool.query(
      `UPDATE exam_questions
       SET section_id = COALESCE($1, section_id),
           module_id = COALESCE($2, module_id),
           prompt = COALESCE($3, prompt),
           options = COALESCE($4::jsonb, options),
           correct_answer = COALESCE($5::jsonb, correct_answer),
           explanation = COALESCE($6, explanation),
           position = COALESCE($7, position),
           question_type = COALESCE($8, question_type),
           transcript = COALESCE($9, transcript),
           audio = COALESCE($10::jsonb, audio),
           scoring = COALESCE($11::jsonb, scoring),
           source_metadata = COALESCE($12::jsonb, source_metadata),
           updated_at = NOW()
       WHERE id = $13 AND exam_id = $14
       RETURNING *`,
      [
        normalizedSectionId,
        typeof moduleId === "string" && moduleId.trim() ? moduleId.trim().slice(0, 40) : null,
        typeof prompt === "string" && prompt.trim() ? prompt.trim().slice(0, 5000) : null,
        parsedOptions === undefined ? null : JSON.stringify(parsedOptions),
        parsedCorrectAnswer === undefined ? null : JSON.stringify(parsedCorrectAnswer || {}),
        typeof explanation === "string" ? explanation.slice(0, 5000) : null,
        Number.isInteger(position) ? position : null,
        normalizeOptionalText(questionType, 80),
        normalizeOptionalText(transcript, 12000),
        parsedAudio === undefined ? null : JSON.stringify(parsedAudio || {}),
        parsedScoring === undefined ? null : JSON.stringify(parsedScoring || {}),
        parsedSourceMetadata === undefined ? null : JSON.stringify(parsedSourceMetadata || {}),
        questionId,
        examId,
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Question not found" });
    await touchExam(examId);
    await auditAdminAction(req, "exam.question_update", "question", questionId, { examId });
    return res.json({ ok: true, question: updated.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.delete("/api/admin/exams/:examId/questions/:questionId", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    const deleted = await pool.query(
      `DELETE FROM exam_questions WHERE id = $1 AND exam_id = $2 RETURNING *`,
      [questionId, examId]
    );
    if (!deleted.rows[0]) return res.status(404).json({ ok: false, error: "Question not found" });
    await touchExam(examId);
    await auditAdminAction(req, "exam.question_delete", "question", questionId, { examId });
    return res.json({ ok: true, question: deleted.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const csvEscape = (value) => {
  const text = value == null ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
};

const makeSimplePdf = (title, rows) => {
  const lines = [
    title,
    "",
    ...rows.slice(0, 40).map((row) =>
      Object.entries(row)
        .slice(0, 6)
        .map(([key, value]) => `${key}: ${value == null ? "" : String(value)}`)
        .join(" | ")
    ),
  ].join("\n");
  const escaped = lines.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
    `4 0 obj << /Length ${escaped.length + 64} >> stream\nBT /F1 10 Tf 40 752 Td 14 TL (${escaped}) Tj ET\nendstream endobj`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
  ];
  let offset = "%PDF-1.4\n".length;
  const xref = ["0000000000 65535 f "];
  const body = objects
    .map((object) => {
      xref.push(`${String(offset).padStart(10, "0")} 00000 n `);
      offset += object.length + 1;
      return object;
    })
    .join("\n");
  const xrefStart = "%PDF-1.4\n".length + body.length + 1;
  return [
    "%PDF-1.4",
    body,
    `xref\n0 ${xref.length}\n${xref.join("\n")}`,
    `trailer << /Size ${xref.length} /Root 1 0 R >>`,
    `startxref\n${xrefStart}`,
    "%%EOF",
  ].join("\n");
};

const adminExportHandler = async (req, res) => {
  try {
    const type = String(req.query.type || "users");
    const format = String(req.query.format || "json");
    let rows;
    let filename;

    if (type === "results") {
      const r = await pool.query(`
        SELECT s.id, s.exam_name, s.taken_at, s.score_pct, s.level_current, s.level_target,
               s.duration_seconds, u.email, u.username
        FROM simulations s
        JOIN users u ON u.id = s.user_id
        ORDER BY s.taken_at DESC
      `);
      rows = r.rows;
      filename = "results";
    } else if (type === "statistics" || type === "statistiques") {
      const r = await pool.query(`
        SELECT id, total_users, total_exams, api_usage, created_at
        FROM statistiques
        ORDER BY created_at DESC
      `);
      rows = r.rows;
      filename = "statistics";
    } else if (type === "written-copies" || type === "copies_ecrites") {
      const r = await pool.query(`
        SELECT c.id, c.prompt, c.response, c.ai_feedback, c.score, c.created_at,
               u.email, u.username
        FROM copies_ecrites c
        LEFT JOIN users u ON u.id = c.user_id
        ORDER BY c.created_at DESC
      `);
      rows = r.rows;
      filename = "written-copies";
    } else {
      const r = await pool.query(`
        SELECT id, email, username, first_name, last_name, role, status, email_verified,
               has_full_access, created_at, last_login_at
        FROM users
        ORDER BY created_at DESC
      `);
      rows = r.rows;
      filename = "users";
    }

    await auditAdminAction(req, "export.download", type, format, { rows: rows.length });

    if (format === "csv" || format === "excel" || format === "xlsx") {
      const headers = rows[0] ? Object.keys(rows[0]) : [];
      const csv = [
        headers.map(csvEscape).join(","),
        ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
      ].join("\n");
      res.setHeader(
        "Content-Type",
        format === "csv" ? "text/csv; charset=utf-8" : "application/vnd.ms-excel; charset=utf-8"
      );
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.${format === "csv" ? "csv" : "xls"}"`);
      return res.send(csv);
    }

    if (format === "pdf") {
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}.pdf"`);
      return res.send(Buffer.from(makeSimplePdf(filename, rows), "utf8"));
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}.json"`);
    return res.send(JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.get("/api/admin/exports", requireAdmin, adminExportHandler);
app.get("/api/admin/export", requireAdmin, adminExportHandler);

app.get("/api/admin/audit-logs", requireAdmin, async (req, res) => {
  try {
    const logs = await pool.query(`
      SELECT a.*, u.email AS admin_email
      FROM admin_audit_logs a
      LEFT JOIN users u ON u.id = a.admin_user_id
      ORDER BY a.created_at DESC
      LIMIT 100
    `);
    return res.json({ ok: true, logs: logs.rows });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

if (!isProduction) {
  app.get("/", (req, res) => {
    res.send("Server is running");
  });
}

if (isProduction && SERVE_CLIENT) {
  app.use(express.static(CLIENT_DIST_DIR, { index: "index.html" }));
  app.use((req, res, next) => {
    const acceptsHtml = req.accepts(["html", "json"]) === "html";
    if (req.method !== "GET" || !acceptsHtml) return next();
    return res.sendFile(CLIENT_INDEX_FILE, (err) => {
      if (err) return next(err);
      return undefined;
    });
  });
}

if (isProduction && !SERVE_CLIENT) {
  app.get("/", (req, res) => {
    res.json({ ok: true, service: "german-exam-app-api" });
  });
}

let schemaReady;

function initializeSchema() {
  if (!schemaReady) {
    schemaReady = ensureSchema().catch((err) => {
      schemaReady = null;
      throw err;
    });
  }
  return schemaReady;
}

if (require.main === module) {
  initializeSchema()
    .then(() => {
      app.listen(PORT, () => {
        console.log(`Server running on port ${PORT}`);
      });
    })
    .catch((err) => {
      console.error("Schema init failed", err);
      process.exit(1);
    });
}

module.exports = {
  app,
  ensureSchema: initializeSchema,
};
