const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { getOwnedPaymentTransaction, normalizePaymentReference } = require("../services/paymentStatusSecurity");

test("payment status lookup is constrained to the authenticated owner", async () => {
  let captured;
  const pool = {
    async query(sql, parameters) {
      captured = { sql, parameters };
      return { rows: [{ id: 42, user_id: 7 }] };
    },
  };

  const transaction = await getOwnedPaymentTransaction(pool, { reference: "  provider-reference  ", userId: 7 });

  assert.equal(transaction.id, 42);
  assert.deepEqual(captured.parameters, ["provider-reference", 7]);
  assert.match(captured.sql, /WHERE user_id = \$2/);
  assert.doesNotMatch(captured.sql, /id::text/i);
});

test("payment status lookup rejects a missing authenticated user", async () => {
  await assert.rejects(
    getOwnedPaymentTransaction({ query: async () => ({ rows: [] }) }, { reference: "ref", userId: undefined }),
    /authenticated user/
  );
});

test("payment references are normalized and bounded", () => {
  assert.equal(normalizePaymentReference("  abc  "), "abc");
  assert.equal(normalizePaymentReference("x".repeat(300)).length, 180);
});

test("the payment status route remains authenticated and omits private payment metadata", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "..", "server.js"), "utf8");
  const start = source.indexOf('app.get("/api/checkout/session/:reference/status"');
  const end = source.indexOf('app.get("/api/payments/notchpay/callback"', start);
  const route = source.slice(start, end);
  const responseStart = route.lastIndexOf("return res.json({");
  const responseEnd = route.indexOf("});", responseStart);
  const responsePayload = route.slice(responseStart, responseEnd);

  assert.ok(start >= 0 && end > start);
  assert.ok(responseStart >= 0 && responseEnd > responseStart);
  assert.match(route, /requireAuth/);
  assert.doesNotMatch(route, /id::text/);
  assert.doesNotMatch(responsePayload, /mobileMoney\s*:/);
  assert.doesNotMatch(responsePayload, /quote\s*:/);
  assert.doesNotMatch(responsePayload, /transactionId\s*:/);
  assert.doesNotMatch(responsePayload, /providerReference\s*:/);
});
