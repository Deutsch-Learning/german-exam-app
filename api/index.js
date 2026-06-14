const { app, ensureSchema } = require("../server/server");

let schemaReadyPromise;

const ensureSchemaOnce = () => {
  if (!schemaReadyPromise) {
    schemaReadyPromise = ensureSchema().catch((err) => {
      schemaReadyPromise = undefined;
      throw err;
    });
  }
  return schemaReadyPromise;
};

module.exports = async function handler(req, res) {
  try {
    await ensureSchemaOnce();
    return app(req, res);
  } catch (err) {
    console.error("API handler failed", err);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader("content-type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ ok: false, error: "Server error" }));
    }
    return undefined;
  }
};
