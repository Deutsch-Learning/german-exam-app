const { Pool } = require("pg");
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env"), quiet: true });

const isTruthy = (value) => /^(1|true|yes)$/i.test(String(value ?? "").trim());

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isSupabasePoolerHost = (host = "") => /\.pooler\.supabase\.com$/i.test(String(host).trim());

const shouldPreferTransactionPooler = () => {
  const mode = String(process.env.DATABASE_POOL_MODE || process.env.SUPABASE_POOLER_MODE || "").trim().toLowerCase();
  if (mode === "session") return false;
  if (mode === "transaction") return true;
  return isTruthy(process.env.VERCEL);
};

const normalizeSupabasePoolerUrl = (databaseUrl) => {
  const url = new URL(databaseUrl);
  if (isSupabasePoolerHost(url.hostname) && shouldPreferTransactionPooler() && (!url.port || url.port === "5432")) {
    url.port = "6543";
  }
  return url.toString();
};

function buildSharedPoolOptions() {
  const isServerless = isTruthy(process.env.VERCEL) || isTruthy(process.env.AWS_LAMBDA_FUNCTION_NAME);
  return {
    max: parsePositiveInt(process.env.DB_POOL_MAX, isServerless ? 1 : 10),
    idleTimeoutMillis: parsePositiveInt(process.env.DB_IDLE_TIMEOUT_MS, isServerless ? 5000 : 30000),
    connectionTimeoutMillis: parsePositiveInt(process.env.DB_CONNECTION_TIMEOUT_MS, 10000),
    maxUses: parsePositiveInt(process.env.DB_POOL_MAX_USES, 750),
    allowExitOnIdle: isServerless,
    application_name: process.env.DB_APPLICATION_NAME || "german-exam-app",
  };
}

function buildPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  const shared = buildSharedPoolOptions();
  if (databaseUrl) {
    const disableSsl =
      process.env.DATABASE_SSL === "false" ||
      /\blocalhost\b/i.test(databaseUrl) ||
      databaseUrl.includes("127.0.0.1");
    return {
      ...shared,
      connectionString: normalizeSupabasePoolerUrl(databaseUrl),
      ssl: disableSsl ? false : { rejectUnauthorized: false },
    };
  }

  const host = process.env.DB_HOST;
  const requestedPort = process.env.DB_PORT;
  const port =
    isSupabasePoolerHost(host) && shouldPreferTransactionPooler() && (!requestedPort || requestedPort === "5432")
      ? 6543
      : requestedPort;

  return {
    ...shared,
    host,
    port,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    ssl: process.env.DATABASE_SSL === "false" ? false : { rejectUnauthorized: false },
  };
}

const pool = new Pool(buildPoolConfig());

module.exports = pool;
