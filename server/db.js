const { Pool } = require("pg");
require("dotenv").config();

function buildPoolConfig() {
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (databaseUrl) {
    const disableSsl =
      process.env.DATABASE_SSL === "false" ||
      /\blocalhost\b/i.test(databaseUrl) ||
      databaseUrl.includes("127.0.0.1");
    return {
      connectionString: databaseUrl,
      ssl: disableSsl ? false : { rejectUnauthorized: false },
    };
  }

  return {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

const pool = new Pool(buildPoolConfig());

module.exports = pool;
