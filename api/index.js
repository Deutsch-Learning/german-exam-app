const { app, ensureSchema } = require("../server/server");

module.exports = async function handler(req, res) {
  try {
    await ensureSchema();
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
