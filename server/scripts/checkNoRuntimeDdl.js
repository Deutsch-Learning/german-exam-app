const fs = require("fs");
const path = require("path");

const serverRoot = path.resolve(__dirname, "..");
const ignoredDirectories = new Set(["node_modules"]);
const ddlPattern = /`[^`]*\b(?:CREATE|ALTER|DROP)\s+(?:TABLE|INDEX|TYPE|SCHEMA|POLICY|EXTENSION)\b[^`]*`|`[^`]*\bREVOKE\s+ALL\s+ON\b[^`]*`|`[^`]*\bGRANT\s+(?:ALL|SELECT|INSERT|UPDATE|DELETE|USAGE|EXECUTE)\b[^`]*\bON\b[^`]*`/i;

const findJavaScriptFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) return [];
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) return findJavaScriptFiles(absolutePath);
    return entry.isFile() && entry.name.endsWith(".js") ? [absolutePath] : [];
  });

const violations = findJavaScriptFiles(serverRoot)
  .filter((file) => file !== __filename)
  .filter((file) => ddlPattern.test(fs.readFileSync(file, "utf8")))
  .map((file) => path.relative(serverRoot, file));

if (violations.length) {
  console.error("Runtime DDL is forbidden. Move schema changes into supabase/migrations:");
  violations.forEach((file) => console.error(`- ${file}`));
  process.exit(1);
}

console.log("Runtime DDL guard passed.");
