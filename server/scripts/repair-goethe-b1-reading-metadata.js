const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");
const { analyzeExamDocument } = require("../services/documentImport");

const sourcePath = path.resolve(
  __dirname,
  "../..",
  "Goethe change",
  "GOETHE_B1_Lesen_20_Pruefungshefte_RESTRUCTURED.docx"
);

const run = async () => {
  const buffer = await fs.readFile(sourcePath);
  const parsed = await analyzeExamDocument({
    buffer,
    filename: path.basename(sourcePath),
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });

  assert.equal(parsed.metadata.provider, "goethe", "unexpected document provider");
  assert.equal(parsed.metadata.level, "B1", "unexpected document level");
  assert.equal(parsed.metadata.sectionType, "read", "unexpected document module");
  assert.equal(parsed.series.length, 20, "expected 20 Goethe B1 Lesen series");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const series of parsed.series) {
      const sourceLabel = `Goethe B1 Lesen ${String(series.seriesNumber).padStart(2, "0")}`;
      const result = await client.query(
        `UPDATE exams
            SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                  'title', $2::text,
                  'theme', $2::text,
                  'sourceLabel', $3::text
                ),
                updated_at = NOW()
          WHERE LOWER(provider) = 'goethe'
            AND UPPER(level) = 'B1'
            AND section_type = 'read'
            AND series_number = $1
            AND is_active = TRUE
            AND COALESCE((metadata->>'structuredB1Lesen')::boolean, FALSE) = TRUE
          RETURNING id`,
        [series.seriesNumber, series.title, sourceLabel]
      );
      assert.equal(result.rowCount, 1, `series ${series.seriesNumber}: expected one active exam`);
    }

    const verification = await client.query(
      `SELECT series_number,
              metadata->>'title' AS title,
              metadata->>'theme' AS theme,
              metadata->>'sourceLabel' AS source_label
         FROM exams
        WHERE LOWER(provider) = 'goethe'
          AND UPPER(level) = 'B1'
          AND section_type = 'read'
          AND is_active = TRUE
          AND COALESCE((metadata->>'structuredB1Lesen')::boolean, FALSE) = TRUE
        ORDER BY series_number`
    );

    assert.equal(verification.rowCount, 20, "expected 20 repaired active exams");
    verification.rows.forEach((row, index) => {
      const series = parsed.series[index];
      assert.equal(Number(row.series_number), series.seriesNumber, `series ${index + 1}: numbering`);
      assert.equal(row.title, series.title, `series ${index + 1}: title`);
      assert.equal(row.theme, series.title, `series ${index + 1}: theme`);
      assert.equal(
        row.source_label,
        `Goethe B1 Lesen ${String(series.seriesNumber).padStart(2, "0")}`,
        `series ${index + 1}: source label`
      );
    });

    await client.query("COMMIT");
    console.log(JSON.stringify({ repaired: verification.rowCount, series: verification.rows }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
};

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
