require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const pool = require("../db");

const baseUrl = String(
  process.env.AUDIO_VERIFICATION_BASE_URL ||
  process.env.APP_BASE_URL ||
  "https://xn--n-deutschprfungen-d3b.com"
).replace(/\/$/, "");
const concurrency = Math.max(1, Math.min(12, Number(process.env.AUDIO_VERIFICATION_CONCURRENCY) || 8));
const requestedIds = String(process.argv.find((value) => value.startsWith("--ids="))?.slice(6) || "")
  .split(",")
  .map(Number)
  .filter((value) => Number.isInteger(value) && value > 0);

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

const fetchWithRetry = async (url, options) => {
  let lastError = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      return await fetch(url, options);
    } catch (error) {
      lastError = error;
      if (attempt < 3) await wait(attempt * 250);
    }
  }
  throw lastError;
};

const main = async () => {
  const result = await pool.query(
    `SELECT DISTINCT a.id, a.byte_size,
            a.audio_config->'storage'->>'publicUrl' AS public_url,
            i.provider, i.level
       FROM exam_audio_assets a
       JOIN exam_listening_audio_items i ON i.generated_audio_asset_id = a.id
      WHERE i.audio_generation_status = 'published'
        AND a.status = 'ready'
        AND COALESCE((a.audio_config->'storage'->>'verified')::boolean, FALSE) = TRUE
        AND ($1::int[] IS NULL OR a.id = ANY($1::int[]))
      ORDER BY a.id`,
    [requestedIds.length ? requestedIds : null]
  );
  const queue = result.rows;
  const failures = [];
  const coverage = new Map();
  let cursor = 0;
  let verified = 0;

  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const asset = queue[index];
      try {
        const routeResponse = await fetchWithRetry(`${baseUrl}/api/audio/generated/${asset.id}`, {
          method: "HEAD",
          redirect: "manual",
        });
        const location = routeResponse.headers.get("location") || "";
        if (routeResponse.status !== 307 || location !== asset.public_url) {
          throw new Error(`route=${routeResponse.status}, locationMatch=${location === asset.public_url}`);
        }
        const objectResponse = await fetchWithRetry(location, { method: "HEAD", cache: "no-store" });
        const objectSize = Number(objectResponse.headers.get("content-length")) || 0;
        if (!objectResponse.ok || objectSize !== Number(asset.byte_size)) {
          throw new Error(`object=${objectResponse.status}, size=${objectSize}/${asset.byte_size}`);
        }
        verified += 1;
        const key = `${asset.provider || "unknown"}:${asset.level || "unknown"}`;
        coverage.set(key, (coverage.get(key) || 0) + 1);
      } catch (error) {
        failures.push({ assetId: asset.id, error: error.message });
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(JSON.stringify({
    ok: failures.length === 0 && verified === queue.length,
    baseUrl,
    assets: queue.length,
    verified,
    failures,
    coverage: Object.fromEntries([...coverage.entries()].sort()),
  }, null, 2));
  if (failures.length || verified !== queue.length) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
