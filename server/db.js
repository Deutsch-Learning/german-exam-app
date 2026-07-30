const { Pool } = require("pg");
const { buildPoolConfig } = require("./config/database");

const pool = new Pool(buildPoolConfig());

module.exports = pool;
