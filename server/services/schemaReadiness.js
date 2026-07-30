const REQUIRED_SCHEMA_VERSION = "20260730025449";

const readinessByPool = new WeakMap();

class SchemaNotReadyError extends Error {
  constructor(message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "SchemaNotReadyError";
    this.code = "APP_SCHEMA_NOT_READY";
  }
}

const ensureSchemaReady = async (pool, context = "application") => {
  if (!pool || typeof pool.query !== "function") {
    throw new TypeError("A PostgreSQL pool is required for the schema readiness check.");
  }

  if (readinessByPool.has(pool)) return readinessByPool.get(pool);

  const readiness = pool
    .query(
      `SELECT version
         FROM app_private.schema_versions
        WHERE version = $1
        LIMIT 1`,
      [REQUIRED_SCHEMA_VERSION]
    )
    .then((result) => {
      if (!result.rows[0]) {
        throw new SchemaNotReadyError(
          `Database migration ${REQUIRED_SCHEMA_VERSION} is required before starting ${context}.`
        );
      }
      return true;
    })
    .catch((error) => {
      readinessByPool.delete(pool);
      if (error instanceof SchemaNotReadyError) throw error;
      throw new SchemaNotReadyError(
        `Database schema readiness check failed for ${context}. Apply the pending Supabase migrations before retrying.`,
        error
      );
    });

  readinessByPool.set(pool, readiness);
  return readiness;
};

const clearSchemaReadinessCache = (pool) => {
  if (pool) readinessByPool.delete(pool);
};

module.exports = {
  REQUIRED_SCHEMA_VERSION,
  SchemaNotReadyError,
  clearSchemaReadinessCache,
  ensureSchemaReady,
};
