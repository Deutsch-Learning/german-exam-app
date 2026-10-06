const assert = require("node:assert/strict");
const test = require("node:test");

const { buildPoolConfig, decodeSslCertificate } = require("../config/database");

const TEST_CERTIFICATE = [
  "-----BEGIN CERTIFICATE-----",
  "test-certificate-data",
  "-----END CERTIFICATE-----",
].join("\n");

test("production Supabase connections require a trusted CA", () => {
  assert.throws(
    () =>
      buildPoolConfig({
        NODE_ENV: "production",
        DB_HOST: "aws-0-eu-central-1.pooler.supabase.com",
        DB_PORT: "6543",
        DB_USER: "app.example",
        DB_PASSWORD: "secret",
        DB_NAME: "postgres",
      }),
    /Verified Supabase TLS requires/
  );
});

test("production Supabase connections verify the configured CA", () => {
  const config = buildPoolConfig({
    NODE_ENV: "production",
    DB_HOST: "aws-0-eu-central-1.pooler.supabase.com",
    DB_PORT: "6543",
    DB_USER: "app.example",
    DB_PASSWORD: "secret",
    DB_NAME: "postgres",
    DATABASE_SSL_CA_BASE64: Buffer.from(TEST_CERTIFICATE).toString("base64"),
  });

  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, TEST_CERTIFICATE);
});

test("local PostgreSQL can explicitly disable TLS", () => {
  const config = buildPoolConfig({
    DB_HOST: "localhost",
    DB_PORT: "5432",
    DB_USER: "postgres",
    DB_PASSWORD: "postgres",
    DB_NAME: "postgres",
  });

  assert.equal(config.ssl, false);
});

test("Vercel managed Postgres URL is accepted when DATABASE_URL is absent", () => {
  const config = buildPoolConfig({
    VERCEL: "1",
    NODE_ENV: "production",
    POSTGRES_URL: "postgres://app:secret@db.example.com:5432/appdb?sslmode=require",
    DATABASE_SSL_CA_BASE64: Buffer.from(TEST_CERTIFICATE).toString("base64"),
  });

  assert.equal(config.connectionString, "postgres://app:secret@db.example.com:5432/appdb");
  assert.equal(config.ssl.rejectUnauthorized, true);
  assert.equal(config.ssl.ca, TEST_CERTIFICATE);
  assert.equal(config.max, 1);
});

test("Vercel managed Postgres component variables are accepted", () => {
  const config = buildPoolConfig({
    POSTGRES_HOST: "db.example.com",
    POSTGRES_PORT: "5433",
    POSTGRES_USER: "app",
    POSTGRES_PASSWORD: "secret",
    POSTGRES_DATABASE: "appdb",
  });

  assert.equal(config.host, "db.example.com");
  assert.equal(config.port, "5433");
  assert.equal(config.user, "app");
  assert.equal(config.password, "secret");
  assert.equal(config.database, "appdb");
});

test("invalid CA values fail before a connection is opened", () => {
  assert.throws(() => decodeSslCertificate({ DATABASE_SSL_CA_BASE64: Buffer.from("invalid").toString("base64") }));
});
