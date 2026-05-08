require("dotenv").config();
const crypto = require("crypto");
const express = require("express");
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

const app = express();
const PORT = Number(process.env.PORT || 3000);
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:5173";

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
const COOKIE_SECURE = process.env.NODE_ENV === "production";
const DEFAULT_TOTAL_AVAILABLE_EXAMS = Number(process.env.TOTAL_AVAILABLE_EXAMS || 20);

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
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
app.use(express.json({ limit: "1mb" }));

const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

const TOKEN_BYTES = 32;
const VERIFICATION_HOURS = 24;
const RESET_MINUTES = 60;

const isEmail = (value) =>
  typeof value === "string" && /^\S+@\S+\.\S+$/.test(value.trim());

const normalizeEmail = (value) => String(value ?? "").trim().toLowerCase();
const tokenHash = (token) =>
  crypto.createHash("sha256").update(token).digest("hex");
const makeToken = () => crypto.randomBytes(TOKEN_BYTES).toString("hex");
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
  created_at: user.created_at,
  last_login_at: user.last_login_at,
});

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
    from: `"Deutsch Learning" <${from}>`,
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
      "Confirmez votre adresse email pour activer votre compte Deutsch Learning.",
      link,
      "",
      `Ce lien expire dans ${VERIFICATION_HOURS} heures.`,
    ].join("\n"),
    html: `<p>Confirmez votre adresse email pour activer votre compte Deutsch Learning.</p><p><a href="${link}">Confirmer mon email</a></p><p>Ce lien expire dans ${VERIFICATION_HOURS} heures.</p>`,
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
      "Utilisez ce lien pour réinitialiser votre mot de passe Deutsch Learning.",
      link,
      "",
      `Ce lien expire dans ${RESET_MINUTES} minutes. Si vous n'avez rien demandé, ignorez ce message.`,
    ].join("\n"),
    html: `<p>Utilisez ce lien pour réinitialiser votre mot de passe Deutsch Learning.</p><p><a href="${link}">Réinitialiser mon mot de passe</a></p><p>Ce lien expire dans ${RESET_MINUTES} minutes.</p>`,
  });
  return link;
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
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_token_hash TEXT;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS reset_expires_at TIMESTAMPTZ;`);
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS has_full_access BOOLEAN NOT NULL DEFAULT FALSE;`);
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
    CREATE INDEX IF NOT EXISTS users_reset_token_idx
      ON users(reset_token_hash)
      WHERE reset_token_hash IS NOT NULL;
  `);
  await pool.query(`
    UPDATE users
    SET email_verified = TRUE,
        email_verified_at = COALESCE(email_verified_at, NOW())
    WHERE email_verified = FALSE
      AND verification_token_hash IS NULL;
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
});
const requireAdmin = [requireAuth, adminMiddleware];

const auditAdminAction = async (req, action, targetType, targetId, metadata = {}) => {
  try {
    await pool.query(
      `INSERT INTO admin_audit_logs (admin_user_id, action, target_type, target_id, metadata)
       VALUES ($1, $2, $3, $4, $5)`,
      [req.user?.id ?? null, action, targetType, String(targetId ?? ""), metadata]
    );
  } catch (err) {
    console.error("Admin audit log failed", err);
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

const registerHandler = async (req, res) => {
  try {
    const { email, password, username, firstName, lastName } = req.body ?? {};

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
    const verificationToken = makeToken();

    const insert = await pool.query(
      `INSERT INTO users (
         email, username, first_name, last_name, password_hash, role, status,
         email_verified, verification_token_hash, verification_expires_at
       )
       VALUES ($1, $2, $3, $4, $5, 'user', 'active', FALSE, $6, $7)
       RETURNING id, email, username, first_name, last_name`,
      [
        normalizedEmail,
        safeUsername,
        safeFirst,
        safeLast,
        passwordHash,
        tokenHash(verificationToken),
        expiresFromNow(VERIFICATION_HOURS, "hours"),
      ]
    );
    const verificationUrl = await sendVerificationEmail(insert.rows[0], verificationToken);
    return res.status(201).json({
      ok: true,
      message: "Account created. Please confirm your email before logging in.",
      devVerificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl,
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

app.post("/resend-verification", async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    if (!isEmail(email)) {
      return res.status(400).json({ ok: false, error: "A valid email is required" });
    }

    const r = await pool.query(
      `SELECT id, email, username, first_name, email_verified FROM users WHERE email = $1`,
      [email]
    );
    const user = r.rows[0];
    if (!user || user.email_verified) {
      return res.json({ ok: true, message: "If verification is needed, an email has been sent." });
    }

    const token = makeToken();
    await pool.query(
      `UPDATE users
       SET verification_token_hash = $1, verification_expires_at = $2
       WHERE id = $3`,
      [tokenHash(token), expiresFromNow(VERIFICATION_HOURS, "hours"), user.id]
    );
    const verificationUrl = await sendVerificationEmail(user, token);
    return res.json({
      ok: true,
      message: "If verification is needed, an email has been sent.",
      devVerificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl,
    });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const verifyEmailToken = async (token) => {
  if (!token || typeof token !== "string") return null;
  const r = await pool.query(
    `UPDATE users
     SET email_verified = TRUE,
         email_verified_at = NOW(),
         verification_token_hash = NULL,
         verification_expires_at = NULL
     WHERE verification_token_hash = $1
       AND verification_expires_at > NOW()
     RETURNING id, email, username, first_name, last_name, date_of_birth, role, status,
               email_verified, has_full_access, created_at, last_login_at`,
    [tokenHash(token)]
  );
  return r.rows[0] ?? null;
};

app.get("/verify-email/:token", async (req, res) => {
  try {
    const user = await verifyEmailToken(req.params.token);
    if (!user) return res.status(400).json({ ok: false, error: "Invalid or expired verification link" });
    return res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

app.post("/verify-email", async (req, res) => {
  try {
    const user = await verifyEmailToken(req.body?.token);
    if (!user) return res.status(400).json({ ok: false, error: "Invalid or expired verification link" });
    return res.json({ ok: true, user: sanitizeUser(user) });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const loginHandler = async (req, res) => {
  try {
    const { email, password, rememberMe } = req.body ?? {};

    if (!isEmail(email) || typeof password !== "string") {
      return res.status(400).json({ ok: false, error: "Email and password are required" });
    }

    const userRes = await pool.query(
      `SELECT id, email, username, first_name, last_name, date_of_birth, password_hash, role, status,
              email_verified, has_full_access, created_at, last_login_at
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
      user: sanitizeUser({ ...user, last_login_at: new Date().toISOString() }),
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
              u.role, u.status, u.email_verified, u.has_full_access, u.created_at, u.last_login_at
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
      user: sanitizeUser(user),
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

app.post("/forgot-password", async (req, res) => {
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

    if (user && user.status === "active" && user.email_verified) {
      const token = makeToken();
      await pool.query(
        `UPDATE users SET reset_token_hash = $1, reset_expires_at = $2 WHERE id = $3`,
        [tokenHash(token), expiresFromNow(RESET_MINUTES, "minutes"), user.id]
      );
      resetUrl = await sendResetEmail(user, token);
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
});

app.post("/reset-password", async (req, res) => {
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
       RETURNING id`,
      [passwordHash, tokenHash(token)]
    );

    if (!updated.rows[0]) {
      return res.status(400).json({ ok: false, error: "Invalid or expired reset link" });
    }
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL`, [updated.rows[0].id]);
    await logUserAction(updated.rows[0].id, "auth.password_reset", req);
    return res.json({ ok: true, message: "Password updated. You can now log in." });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
});

const profileHandler = async (req, res) => {
  return res.json({ ok: true, user: sanitizeUser(req.user) });
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

const getUserProgressSnapshot = async (userId) => {
  const [completedFromSimulations, completedFromResults, total] = await Promise.all([
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

app.get("/dashboard", requireAuth, async (req, res) => {
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
      user: sanitizeUser(req.user),
      progress: {
        percent: progressPct,
        completed: progressSnapshot.completed,
        total: progressSnapshot.total,
        percentage: progressSnapshot.percentage,
        currentLevel: latest?.level_current ?? "B2",
        targetLevel: latest?.level_target ?? "C1",
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
});

const updateProfileHandler = async (req, res) => {
  try {
    const { username, firstName, lastName, email, dateOfBirth } = req.body ?? {};
    if (
      typeof username !== "string" ||
      typeof firstName !== "string" ||
      typeof lastName !== "string" ||
      typeof email !== "string" ||
      typeof dateOfBirth !== "string"
    ) {
      return res.status(400).json({
        ok: false,
        error: "username, firstName, lastName, email and dateOfBirth are required",
      });
    }

    const safeUsername = username.trim().toLowerCase();
    const safeFirst = firstName.trim().slice(0, 80);
    const safeLast = lastName.trim().slice(0, 80);
    const safeEmail = normalizeEmail(email);
    const safeDob = dateOfBirth.trim();

    if (!/^[a-z0-9._-]{3,30}$/.test(safeUsername)) {
      return res.status(400).json({ ok: false, error: "Username must be 3-30 chars (a-z, 0-9, . _ -)" });
    }
    if (!safeFirst || !safeLast) {
      return res.status(400).json({ ok: false, error: "First name and last name are required" });
    }
    if (!isEmail(safeEmail)) {
      return res.status(400).json({ ok: false, error: "A valid email is required" });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(safeDob)) {
      return res.status(400).json({ ok: false, error: "dateOfBirth must be in YYYY-MM-DD format" });
    }

    const emailChanged = safeEmail !== req.user.email;
    const verificationToken = emailChanged ? makeToken() : null;

    const updated = await pool.query(
      `UPDATE users
       SET username = $1,
           first_name = $2,
           last_name = $3,
           email = $4,
           date_of_birth = $5::date,
           email_verified = CASE WHEN $6 THEN FALSE ELSE email_verified END,
           email_verified_at = CASE WHEN $6 THEN NULL ELSE email_verified_at END,
           verification_token_hash = CASE WHEN $6 THEN $7 ELSE verification_token_hash END,
           verification_expires_at = CASE WHEN $6 THEN $8 ELSE verification_expires_at END
       WHERE id = $9
       RETURNING id, email, username, first_name, last_name, date_of_birth, role, status,
                 email_verified, has_full_access, created_at, last_login_at`,
      [
        safeUsername,
        safeFirst,
        safeLast,
        safeEmail,
        safeDob,
        emailChanged,
        verificationToken ? tokenHash(verificationToken) : null,
        verificationToken ? expiresFromNow(VERIFICATION_HOURS, "hours") : null,
        req.user.id,
      ]
    );

    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "User not found" });
    let verificationUrl;
    if (emailChanged) {
      verificationUrl = await sendVerificationEmail(updated.rows[0], verificationToken);
    }
    return res.json({
      ok: true,
      user: sanitizeUser(updated.rows[0]),
      requiresEmailVerification: emailChanged,
      devVerificationUrl: process.env.NODE_ENV === "production" ? undefined : verificationUrl,
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
    await logUserAction(req.user.id, "simulation.completed", req);

    return res.status(201).json({ ok: true, simulation: insert.rows[0] });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok: false, error: "Server error" });
  }
};

app.post("/simulations", requireAuth, createSimulationHandler);
app.post("/api/user/simulations", requireAuth, createSimulationHandler);

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

    await sendTransactionalEmail({
      to: process.env.CONTACT_TO || "appgerman989@gmail.com",
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
             u.email_verified, u.has_full_access, u.created_at, u.last_login_at, u.suspended_at,
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
    const { status, hasFullAccess, role } = req.body ?? {};
    if (!Number.isInteger(targetId) || targetId <= 0) {
      return res.status(400).json({ ok: false, error: "Invalid user id" });
    }
    if (targetId === req.user.id && status === "suspended") {
      return res.status(400).json({ ok: false, error: "You cannot suspend your own admin account" });
    }
    const nextStatus = status === "suspended" ? "suspended" : status === "active" ? "active" : null;
    const nextRole = role === "admin" || role === "user" ? role : null;

    const updated = await pool.query(
      `UPDATE users
       SET status = COALESCE($1, status),
           suspended_at = CASE WHEN $1 = 'suspended' THEN NOW() WHEN $1 = 'active' THEN NULL ELSE suspended_at END,
           has_full_access = COALESCE($2, has_full_access),
           role = COALESCE($3, role)
       WHERE id = $4
       RETURNING id, email, username, first_name, last_name, role, status,
                 email_verified, has_full_access, created_at, last_login_at, suspended_at`,
      [
        nextStatus,
        typeof hasFullAccess === "boolean" ? hasFullAccess : null,
        nextRole,
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
      hasFullAccess,
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

app.get("/api/admin/exams", requireAdmin, async (req, res) => {
  try {
    const exams = await pool.query(`
      SELECT e.*,
             COUNT(q.id)::int AS question_count
      FROM exams e
      LEFT JOIN exam_questions q ON q.exam_id = e.id
      GROUP BY e.id
      ORDER BY e.updated_at DESC, e.created_at DESC
    `);
    const questions = await pool.query(`
      SELECT * FROM exam_questions ORDER BY exam_id, position, id
    `);
    return res.json({ ok: true, exams: exams.rows, questions: questions.rows });
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

app.put("/api/admin/exams/:id", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.id);
    const { code, name, examType, level, isActive } = req.body ?? {};
    const updated = await pool.query(
      `UPDATE exams
       SET code = COALESCE($1, code),
           name = COALESCE($2, name),
           exam_type = COALESCE($3, exam_type),
           level = COALESCE($4, level),
           is_active = COALESCE($5, is_active),
           updated_at = NOW()
       WHERE id = $6
       RETURNING *`,
      [
        typeof code === "string" && code.trim() ? code.trim().toLowerCase().slice(0, 80) : null,
        typeof name === "string" && name.trim() ? name.trim().slice(0, 160) : null,
        typeof examType === "string" && examType.trim() ? examType.trim().slice(0, 80) : null,
        typeof level === "string" ? level.trim().slice(0, 40) : null,
        typeof isActive === "boolean" ? isActive : null,
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

app.put("/api/admin/exams/:examId/questions/:questionId", requireAdmin, async (req, res) => {
  try {
    const examId = Number(req.params.examId);
    const questionId = Number(req.params.questionId);
    const { moduleId, prompt, options, correctAnswer, explanation, position } = req.body ?? {};
    const updated = await pool.query(
      `UPDATE exam_questions
       SET module_id = COALESCE($1, module_id),
           prompt = COALESCE($2, prompt),
           options = COALESCE($3::jsonb, options),
           correct_answer = COALESCE($4::jsonb, correct_answer),
           explanation = COALESCE($5, explanation),
           position = COALESCE($6, position),
           updated_at = NOW()
       WHERE id = $7 AND exam_id = $8
       RETURNING *`,
      [
        typeof moduleId === "string" && moduleId.trim() ? moduleId.trim().slice(0, 40) : null,
        typeof prompt === "string" && prompt.trim() ? prompt.trim().slice(0, 5000) : null,
        Array.isArray(options) ? JSON.stringify(options) : null,
        correctAnswer !== undefined ? JSON.stringify(correctAnswer) : null,
        typeof explanation === "string" ? explanation.slice(0, 5000) : null,
        Number.isInteger(position) ? position : null,
        questionId,
        examId,
      ]
    );
    if (!updated.rows[0]) return res.status(404).json({ ok: false, error: "Question not found" });
    await auditAdminAction(req, "exam.question_update", "question", questionId, { examId });
    return res.json({ ok: true, question: updated.rows[0] });
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

app.get("/", (req, res) => {
  res.send("Server is running🚀");
});

ensureSchema()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Schema init failed", err);
    process.exit(1);
  });
