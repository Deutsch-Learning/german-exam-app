const assert = require("node:assert/strict");
const test = require("node:test");

const {
  REQUIRED_SCHEMA_VERSION,
  SchemaNotReadyError,
  clearSchemaReadinessCache,
  ensureSchemaReady,
} = require("../services/schemaReadiness");

test("readiness is checked once per pool", async () => {
  let calls = 0;
  const pool = {
    async query(sql, parameters) {
      calls += 1;
      assert.match(sql, /app_private\.schema_versions/);
      assert.deepEqual(parameters, [REQUIRED_SCHEMA_VERSION]);
      return { rows: [{ version: REQUIRED_SCHEMA_VERSION }] };
    },
  };

  await Promise.all([
    ensureSchemaReady(pool, "first feature"),
    ensureSchemaReady(pool, "second feature"),
  ]);
  await ensureSchemaReady(pool, "third feature");

  assert.equal(calls, 1);
  clearSchemaReadinessCache(pool);
});

test("a missing migration fails with a stable application error", async () => {
  const pool = { query: async () => ({ rows: [] }) };

  await assert.rejects(
    ensureSchemaReady(pool, "test startup"),
    (error) =>
      error instanceof SchemaNotReadyError &&
      error.code === "APP_SCHEMA_NOT_READY" &&
      error.message.includes(REQUIRED_SCHEMA_VERSION)
  );
});

test("a transient query failure is not cached", async () => {
  let calls = 0;
  const pool = {
    async query() {
      calls += 1;
      if (calls === 1) throw new Error("temporary connection failure");
      return { rows: [{ version: REQUIRED_SCHEMA_VERSION }] };
    },
  };

  await assert.rejects(
    ensureSchemaReady(pool, "test startup"),
    (error) => error.code === "APP_SCHEMA_NOT_READY"
  );
  assert.equal(await ensureSchemaReady(pool, "test retry"), true);
  assert.equal(calls, 2);
  clearSchemaReadinessCache(pool);
});
