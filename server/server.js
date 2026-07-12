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
const { createAuthMiddleware } = require("./middleware/auth");
const adminMiddleware = require("./middleware/admin");
const {
  analyzeExamDocument,
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
  ensureContentStyleSchema,
  registerContentStyleRoutes,
} = require("./services/contentStyleTemplates");
const {
  buildAudioContentHash,
  ensureAudioAssetSchema,
  generateAndStoreExamAudio,
  getAudioAssetById,
  getAudioAssetForExam,
  getConfiguredProvider,
  getProviderStatus,
  normalizeProvider,
  TtsConfigurationError,
} = require("./services/ttsService");
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
const SUBSCRIPTION_PLAN_SEEDS = [
  { level: "B1", planKey: "starter", planName: "Starter", durationDays: 5, priceEur: 14.99, writingSimulatorAttempts: 3 },
  { level: "B1", planKey: "standard", planName: "Standard", durationDays: 15, priceEur: 29.99, writingSimulatorAttempts: 6 },
  { level: "B1", planKey: "intensif", planName: "Intensif", durationDays: 30, priceEur: 54.99, writingSimulatorAttempts: 10 },
  { level: "B2", planKey: "starter", planName: "Starter", durationDays: 5, priceEur: 19.99, writingSimulatorAttempts: 3 },
  { level: "B2", planKey: "standard", planName: "Standard", durationDays: 15, priceEur: 34.99, writingSimulatorAttempts: 6 },
  { level: "B2", planKey: "intensif", planName: "Intensif", durationDays: 30, priceEur: 64.99, writingSimulatorAttempts: 10 },
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
    allowedHeaders: ["Content-Type", "Authorization", "Accept-Language"],
    credentials: true,
  })
);
app.use(express.json({ limit: "8mb" }));

const documentUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 30 * 1024 * 1024,
    files: 1,
  },
});

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const TOKEN_BYTES = 32;
const VERIFICATION_HOURS = 24;
const VERIFICATION_CODE_MINUTES = 15;
const RESET_MINUTES = 60;

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
  return ["stripe", "cinetpay", "notpay", "manual"].includes(provider) ? provider : "manual";
};

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
});

const getActiveSubscriptionsForUser = async (userId) => {
  if (!Number.isInteger(Number(userId)) || Number(userId) <= 0) return [];
  const result = await pool.query(
    `SELECT us.id, us.plan_id, us.level, us.plan_key, us.status, us.starts_at, us.expires_at,
            us.amount_paid, us.currency, us.selected_certifications,
            sp.plan_name, sp.duration_days, sp.price_eur, sp.writing_simulator_attempts,
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
      provider TEXT NOT NULL DEFAULT 'manual' CHECK (provider IN ('stripe', 'cinetpay', 'notpay', 'manual')),
      provider_reference TEXT,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'expired', 'cancelled', 'failed', 'succeeded')),
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
  await pool.query(`ALTER TABLE subscription_plans ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE user_subscriptions ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE writing_simulator_usage ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE payment_transactions ENABLE ROW LEVEL SECURITY;`);
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
         writing_simulator_attempts, certifications, unlocked_sections, is_active, updated_at
       )
       VALUES ($1, $2, $3, $4, $5, 'EUR', $6, $7::jsonb, $8::jsonb, TRUE, NOW())
       ON CONFLICT (level, plan_key)
       DO UPDATE SET
         plan_name = EXCLUDED.plan_name,
         duration_days = EXCLUDED.duration_days,
         price_eur = EXCLUDED.price_eur,
         currency = EXCLUDED.currency,
         writing_simulator_attempts = EXCLUDED.writing_simulator_attempts,
         certifications = EXCLUDED.certifications,
         unlocked_sections = EXCLUDED.unlocked_sections,
         is_active = TRUE,
         updated_at = NOW()`,
      [
        plan.level,
        plan.planKey,
        plan.planName,
        plan.durationDays,
        plan.priceEur,
        plan.writingSimulatorAttempts,
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
  await ensureWritingCorrectionSchema(pool);
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
    defaultMinutes: 60,
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
      groups.set(seriesNumber, {
        id: toImportedSeriesId(provider, row.level, seriesNumber),
        code: `Series ${String(seriesNumber).padStart(2, "0")}`,
        title: "",
        level: row.level || "B1",
        duration: "Imported modules",
        theme: "",
        setting: examName,
        examId: meta.examId,
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
      durationMinutes: Number(row.duration_minutes) || moduleMeta.defaultMinutes,
    };
  }

  return Array.from(groups.values()).map((series) => {
    const expectedModules = series.examId === "telc"
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

const buildTaskPartMeta = (question, index = 0) => {
  const metadata = asJsonObject(question.source_metadata);
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
  };
};

const buildListeningTask = (question, index = 0) => {
  const questionType = String(question.question_type || "").toLowerCase();
  const correctValue = extractCorrectValue(question.correct_answer);
  const options = normalizeChoiceOptions(question.options)
    .map((option) => ({ ...option, label: cleanListeningOptionLabel(option.label) }))
    .filter((option) => option.label);
  const metadata = asJsonObject(question.source_metadata);
  const base = {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || `Hören Teil ${question.part_number || index + 1}`,
    question: extractListeningStudentPrompt(question.prompt || question.section_instructions, question.section_title),
    hint: "Hören Sie den Audiotext aufmerksam und beantworten Sie die Aufgaben.",
    explanation: question.explanation || "Antwort aus dem importierten Hörverstehen-Modul.",
    sourceQuestionId: question.id,
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
  const correctValue = extractCorrectValue(question.correct_answer);
  const options = normalizeChoiceOptions(question.options);
  const metadata = asJsonObject(question.source_metadata);
  const base = {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || "Lesen",
    question: clipText(question.prompt, 900),
    hint: question.section_title ? `Relisez ${question.section_title}.` : "Relisez le texte source.",
    explanation: question.explanation || "Réponse issue du document importé.",
    sourceQuestionId: question.id,
    contentStyle: asJsonObject(metadata.contentStyle),
    ...buildTaskPartMeta(question, index),
  };

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

  return {
    id: `db-question-${question.id}`,
    level: question.level || "B1",
    typeLabel: question.section_title || `Sprechen Teil ${question.part_number || index + 1}`,
    title: question.section_title || `Aufgabe ${index + 1}`,
    prepSeconds: question.part_number === 1 ? 60 : 45,
    responseSeconds: Math.max(60, Math.round(durationMinutes * 60)),
    prompt: clipText(question.prompt || question.section_instructions, 2200),
    checklist: [
      "Aufgabe vollständig bearbeiten",
      "Natürlich reagieren",
      "Beispiele nennen",
      points ? `${points} Punkte` : null,
    ].filter(Boolean),
    sourceQuestionId: question.id,
    contentStyle: asJsonObject(metadata.contentStyle),
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

const buildImportedModuleContent = ({ exam, sections, questions, routeMeta = {} }) => {
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
      : clipText(applyExamAlias(section.instructions || section.title, routeMeta), 2600),
    instructions: moduleId === "listen"
      ? LISTENING_STUDENT_INSTRUCTION
      : clipText(applyExamAlias(section.instructions || section.title, routeMeta), 5200),
    durationMinutes: Number(section.duration_minutes) || null,
    points: Number(section.points) || null,
  }));

  let tasks;
  if (moduleId === "write") {
    tasks = questions.map((question, index) => buildWritingTask(question, index));
  } else if (moduleId === "speak") {
    tasks = questions.map((question, index) => buildSpeakingTask(question, index));
  } else if (moduleId === "listen") {
    tasks = questions.map((question, index) => buildListeningTask(question, index));
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
    audio: moduleId === "listen" ? buildImportedListeningAudio({ title, sourceLabel, sections, questions }) : undefined,
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

    const content = buildImportedModuleContent({
      exam,
      sections: sections.rows,
      questions: questions.rows,
      routeMeta,
    });
    if (moduleId === "listen") {
      content.audio = await attachGeneratedListeningAudio({
        examId: exam.id,
        audio: content.audio,
      });
    }
    return res.json({ ok: true, source: "database", series, content });
  } catch (err) {
    console.error("Imported module lookup failed", err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const registerHandler = async (req, res) => {
  try {
    const { email, password, username, firstName, lastName, marketingEmailsEnabled } = req.body ?? {};

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
    const passwordHash = await bcrypt.hash(password, 12);
    const verificationToken = EMAIL_VERIFICATION_ENABLED ? makeToken() : null;
    const verificationCode = EMAIL_VERIFICATION_ENABLED ? makeVerificationCode() : null;
    const marketingOptIn = marketingEmailsEnabled === true;

    const insert = await pool.query(
      `INSERT INTO users (
         email, username, first_name, last_name, password_hash, role, status,
         email_verified, verification_token_hash, verification_expires_at,
         verification_code_hash, verification_code_expires_at,
         last_verification_email_sent_at, marketing_emails_enabled
       )
       VALUES ($1, $2, $3, $4, $5, 'user', 'active', $6, $7, $8, $9, $10, NULL, $11)
       RETURNING id, email, username, first_name, last_name, email_verified, marketing_emails_enabled`,
      [
        normalizedEmail,
        safeUsername,
        safeFirst,
        safeLast,
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
     RETURNING id, email, username, first_name, last_name, date_of_birth, role, status,
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
     RETURNING id, email, username, first_name, last_name, date_of_birth, role, status,
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
    const { email, password, rememberMe } = req.body ?? {};

    if (!isEmail(email) || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Email and password are required" });
    }

    const userRes = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, password_hash, role, status,
              email_verified, has_full_access, partial_access, current_level, target_level,
              marketing_emails_enabled, created_at, last_login_at
       FROM users
       WHERE email = $1`,
      [normalizeEmail(email)]
    );
    const user = userRes.rows[0];
    if (!user) {
      return res.status(401).json({ ok: false, error: "Invalid credentials" });
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
              u.email, u.username, u.first_name, u.last_name, u.date_of_birth,
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
    return res.status(500).json({ ok: false, error: "Server error" });
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
       RETURNING id, email, username, first_name, last_name, date_of_birth, role, status,
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
       RETURNING id, email, username, first_name, last_name, date_of_birth, role, status,
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
              writing_simulator_attempts, certifications, unlocked_sections
       FROM subscription_plans
       WHERE is_active = TRUE
       ORDER BY level, CASE plan_key WHEN 'starter' THEN 1 WHEN 'standard' THEN 2 ELSE 3 END`
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

app.post("/api/checkout/session", requireAuth, async (req, res) => {
  try {
    const level = normalizeSubscriptionLevel(req.body?.level);
    const planKey = normalizePlanKey(req.body?.planKey);
    const provider = normalizePaymentProvider(req.body?.provider);
    const rawSelectedCertifications = Array.isArray(req.body?.selectedCertifications)
      ? req.body.selectedCertifications
      : [];
    const selectedCertifications = normalizeStringArray(rawSelectedCertifications, SUBSCRIPTION_CERTIFICATIONS);
    if (!level || !planKey) {
      return res.status(400).json({ ok: false, error: "A valid pricing plan is required" });
    }
    if (!selectedCertifications.length) {
      return res.status(400).json({ ok: false, error: "Select at least one certification" });
    }
    if (selectedCertifications.length !== rawSelectedCertifications.length) {
      return res.status(400).json({ ok: false, error: "One or more selected certifications are invalid" });
    }

    const planResult = await pool.query(
      `SELECT id, level, plan_key, plan_name, duration_days, price_eur, currency,
              writing_simulator_attempts, certifications, unlocked_sections
       FROM subscription_plans
       WHERE level = $1 AND plan_key = $2 AND is_active = TRUE
       LIMIT 1`,
      [level, planKey]
    );
    const plan = planResult.rows[0];
    if (!plan) return res.status(404).json({ ok: false, error: "Pricing plan not found" });
    const basePriceEur = Number(plan.price_eur);
    const selectedCertificationCount = selectedCertifications.length;
    const finalPriceEur = Number((basePriceEur * selectedCertificationCount).toFixed(2));

    const transaction = await pool.query(
      `INSERT INTO payment_transactions (user_id, plan_id, provider, status, amount, currency, selected_certifications, metadata)
       VALUES ($1, $2, $3, 'pending', $4, $5, $6::jsonb, $7::jsonb)
       RETURNING id, status, created_at`,
      [
        req.user.id,
        plan.id,
        provider,
        finalPriceEur,
        plan.currency,
        JSON.stringify(selectedCertifications),
        JSON.stringify({
          level: plan.level,
          planKey: plan.plan_key,
          planName: plan.plan_name,
          durationDays: Number(plan.duration_days),
          basePriceEur,
          selectedCertifications,
          selectedCertificationCount,
          finalPriceEur,
          writingSimulatorAttempts: Number(plan.writing_simulator_attempts),
          requestedProvider: provider,
        }),
      ]
    );

    return res.json({
      ok: true,
      checkoutSession: {
        provider,
        status: transaction.rows[0].status,
        transactionId: transaction.rows[0].id,
        planId: plan.id,
        level: plan.level,
        planKey: plan.plan_key,
        planName: plan.plan_name,
        amount: finalPriceEur,
        basePriceEur,
        selectedCertifications,
        selectedCertificationCount,
        finalPriceEur,
        currency: plan.currency,
        durationDays: Number(plan.duration_days),
        writingSimulatorAttempts: Number(plan.writing_simulator_attempts),
        certifications: selectedCertifications,
        unlockedSections: normalizeStringArray(plan.unlocked_sections, SUBSCRIPTION_SECTIONS),
        message: "Paiement bientôt disponible. Ce pack est prêt pour l’intégration du paiement.",
      },
    });
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
    return res.json({ ok: true, ...getProviderStatus() });
  } catch (err) {
    console.error(err);
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
    const foundation = await buildListeningImportFoundation({
      buffer: req.file.buffer,
      filename,
      mimetype: req.file.mimetype,
      provider: req.body?.provider,
      level: req.body?.level,
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
