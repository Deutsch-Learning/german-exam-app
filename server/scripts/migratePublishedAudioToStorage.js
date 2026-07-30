require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const pool = require("../db");

const parseIntegerOption = (name, fallback) => {
  const prefix = `--${name}=`;
  const argument = process.argv.find((value) => value.startsWith(prefix));
  const parsed = Number(argument?.slice(prefix.length));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const invokeUrl = String(process.env.AUDIO_MIGRATION_FUNCTION_URL || "").trim();
const serviceRoleKey = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const limit = parseIntegerOption("limit", 1000);
const concurrency = Math.min(5, parseIntegerOption("concurrency", 2));
const commitMetadata = !process.argv.includes("--no-commit");

const migrateOne = async (assetId) => {
  const response = await fetch(invokeUrl, {
    method: "POST",
    headers: {
      apikey: serviceRoleKey,
      authorization: `Bearer ${serviceRoleKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ assetId, commitMetadata }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload.ok) {
    throw new Error(`Asset ${assetId}: ${payload.error || `HTTP ${response.status}`}`);
  }
  return payload;
};

const main = async () => {
  if (!invokeUrl || !serviceRoleKey) {
    throw new Error("AUDIO_MIGRATION_FUNCTION_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
  }

  const result = await pool.query(
    `SELECT DISTINCT a.id
       FROM exam_audio_assets a
       JOIN exam_listening_audio_items i ON i.generated_audio_asset_id = a.id
      WHERE i.audio_generation_status = 'published'
        AND a.status = 'ready'
        AND a.audio_data IS NOT NULL
        AND COALESCE((a.audio_config->'storage'->>'verified')::boolean, FALSE) = FALSE
      ORDER BY a.id
      LIMIT $1`,
    [limit]
  );
  const queue = result.rows.map((row) => Number(row.id));
  console.log(JSON.stringify({ event: "migration_start", assets: queue.length, concurrency, commitMetadata }));

  let cursor = 0;
  let completed = 0;
  let bytes = 0;
  const failures = [];
  const worker = async () => {
    while (cursor < queue.length) {
      const index = cursor;
      cursor += 1;
      const assetId = queue[index];
      try {
        const payload = await migrateOne(assetId);
        completed += 1;
        bytes += Number(payload.byteSize) || 0;
        console.log(JSON.stringify({ event: "asset_verified", assetId, completed, total: queue.length, byteSize: payload.byteSize }));
      } catch (error) {
        failures.push({ assetId, error: error.message });
        console.error(JSON.stringify({ event: "asset_failed", assetId, error: error.message }));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  console.log(JSON.stringify({ event: "migration_complete", completed, failed: failures.length, bytes, failures }));
  if (failures.length) process.exitCode = 1;
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
