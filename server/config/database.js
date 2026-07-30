const isTruthy = (value) => /^(1|true|yes)$/i.test(String(value ?? "").trim());

const isExplicitlyFalse = (value) => /^(0|false|no)$/i.test(String(value ?? "").trim());

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const isSupabasePoolerHost = (host = "") => /\.pooler\.supabase\.com$/i.test(String(host).trim());

const shouldPreferTransactionPooler = (env) => {
  const mode = String(env.DATABASE_POOL_MODE || env.SUPABASE_POOLER_MODE || "").trim().toLowerCase();
  if (mode === "session") return false;
  if (mode === "transaction") return true;
  return isTruthy(env.VERCEL);
};

const normalizeSupabasePoolerUrl = (databaseUrl, env) => {
  const url = new URL(databaseUrl);
  if (isSupabasePoolerHost(url.hostname) && shouldPreferTransactionPooler(env) && (!url.port || url.port === "5432")) {
    url.port = "6543";
  }
  return url.toString();
};

const decodeSslCertificate = (env) => {
  const base64 = String(env.DATABASE_SSL_CA_BASE64 || "").trim();
  const raw = base64
    ? Buffer.from(base64, "base64").toString("utf8")
    : String(env.DATABASE_SSL_CA || "").replace(/\\n/g, "\n").trim();
  if (!raw) return "";
  if (!raw.includes("-----BEGIN CERTIFICATE-----") || !raw.includes("-----END CERTIFICATE-----")) {
    throw new Error("DATABASE_SSL_CA or DATABASE_SSL_CA_BASE64 is not a valid PEM certificate.");
  }
  return raw;
};

const buildSslOptions = ({ env, host }) => {
  if (isExplicitlyFalse(env.DATABASE_SSL) || /^(localhost|127\.0\.0\.1)$/i.test(String(host || ""))) {
    return false;
  }

  const productionRuntime = env.NODE_ENV === "production" || isTruthy(env.VERCEL);
  const rejectUnauthorized = env.DATABASE_SSL_REJECT_UNAUTHORIZED
    ? !isExplicitlyFalse(env.DATABASE_SSL_REJECT_UNAUTHORIZED)
    : productionRuntime;
  const ca = decodeSslCertificate(env);

  if (productionRuntime && isSupabasePoolerHost(host) && rejectUnauthorized && !ca) {
    throw new Error(
      "Verified Supabase TLS requires DATABASE_SSL_CA_BASE64 (or DATABASE_SSL_CA) in production."
    );
  }

  return {
    rejectUnauthorized,
    ...(ca ? { ca } : {}),
  };
};

const buildSharedPoolOptions = (env) => {
  const isServerless = isTruthy(env.VERCEL) || isTruthy(env.AWS_LAMBDA_FUNCTION_NAME);
  return {
    max: parsePositiveInt(env.DB_POOL_MAX, isServerless ? 1 : 10),
    idleTimeoutMillis: parsePositiveInt(env.DB_IDLE_TIMEOUT_MS, isServerless ? 5000 : 30000),
    connectionTimeoutMillis: parsePositiveInt(env.DB_CONNECTION_TIMEOUT_MS, 10000),
    maxUses: parsePositiveInt(env.DB_POOL_MAX_USES, 750),
    allowExitOnIdle: isServerless,
    application_name: env.DB_APPLICATION_NAME || "german-exam-app",
  };
};

function buildPoolConfig(env = process.env) {
  const databaseUrl = env.DATABASE_URL?.trim();
  const shared = buildSharedPoolOptions(env);
  if (databaseUrl) {
    const normalizedUrl = normalizeSupabasePoolerUrl(databaseUrl, env);
    const url = new URL(normalizedUrl);
    return {
      ...shared,
      connectionString: normalizedUrl,
      ssl: buildSslOptions({ env, host: url.hostname }),
    };
  }

  const host = env.DB_HOST;
  const requestedPort = env.DB_PORT;
  const port =
    isSupabasePoolerHost(host) && shouldPreferTransactionPooler(env) && (!requestedPort || requestedPort === "5432")
      ? 6543
      : requestedPort;

  return {
    ...shared,
    host,
    port,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    ssl: buildSslOptions({ env, host }),
  };
}

module.exports = {
  buildPoolConfig,
  buildSslOptions,
  decodeSslCertificate,
  isSupabasePoolerHost,
  normalizeSupabasePoolerUrl,
};
