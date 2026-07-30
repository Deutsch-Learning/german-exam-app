const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..", "..");

test("Vercel deployment configuration does not package the complete server directory", () => {
  const config = JSON.parse(fs.readFileSync(path.join(projectRoot, "vercel.json"), "utf8"));
  const apiFunction = config.functions?.["api/index.js"] || {};

  assert.equal(apiFunction.includeFiles, undefined);
});

test("real environment files are excluded from Vercel uploads", () => {
  const ignore = fs.readFileSync(path.join(projectRoot, ".vercelignore"), "utf8");

  assert.match(ignore, /^\*\*\/\.env$/m);
  assert.match(ignore, /^\*\*\/\.env\.\*$/m);
});

test("server runtime entry points do not load a local environment file", () => {
  const source = ["server/db.js", "server/server.js"]
    .map((relativePath) => fs.readFileSync(path.join(projectRoot, relativePath), "utf8"))
    .join("\n");

  assert.doesNotMatch(source, /require\s*\(\s*["']dotenv(?:\/config)?["']\s*\)/);
  assert.doesNotMatch(source, /dotenv\.config\s*\(/);
  assert.doesNotMatch(source, /readFileSync\s*\([^)]*["'][^"']*\.env(?:\.[^"']*)?["']/);
});
