const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const projectRoot = path.resolve(__dirname, "..", "..");
const clientRoot = path.join(projectRoot, "client", "gem-app", "src");
const loaderSource = fs.readFileSync(path.join(clientRoot, "components", "AppLoader.jsx"), "utf8");
const loaderStyles = fs.readFileSync(path.join(clientRoot, "components", "AppLoader.module.css"), "utf8");

const walkSourceFiles = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const resolved = path.join(directory, entry.name);
  if (entry.isDirectory()) return walkSourceFiles(resolved);
  return /\.(?:css|jsx?)$/i.test(entry.name) ? [resolved] : [];
});

test("AppLoader exposes accessible viewport and reduced-motion behavior", () => {
  assert.match(loaderSource, /role="status"/);
  assert.match(loaderSource, /aria-live="polite"/);
  assert.match(loaderSource, /useReducedMotion/);
  assert.match(loaderStyles, /position:\s*fixed/);
  assert.match(loaderStyles, /inset:\s*0/);
  assert.match(loaderStyles, /100dvh/);
  assert.match(loaderStyles, /prefers-reduced-motion:\s*reduce/);
});

test("legacy three-dot and spinner loader selectors are absent from client source", () => {
  const legacyPatterns = [
    /simple-loading-dots/i,
    /importedLoadingDots/,
    /pricing-button-spinner/,
    /loading-dots/i,
    /className=["']spinner(?:-small)?["']/,
  ];
  const failures = [];

  for (const file of walkSourceFiles(clientRoot)) {
    const source = fs.readFileSync(file, "utf8");
    legacyPatterns.forEach((pattern) => {
      if (pattern.test(source)) failures.push(`${path.relative(projectRoot, file)}: ${pattern}`);
    });
  }

  assert.deepEqual(failures, []);
});
