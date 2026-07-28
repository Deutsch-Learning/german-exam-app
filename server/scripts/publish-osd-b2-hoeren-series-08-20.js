require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const path = require("path");
const pool = require("../db");

const SOURCE_FILENAME = "OSD_B2_Hoeren_Series_08_to_20_RESTRUCTURED_Admin_Codex.docx";

const main = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const source = await client.query(
      `SELECT id
         FROM exam_document_imports
        WHERE filename = $1
        ORDER BY id DESC
        LIMIT 1`,
      [SOURCE_FILENAME]
    );
    if (!source.rows[0]) throw new Error(`Source import not found: ${SOURCE_FILENAME}`);
    const sourceImportId = source.rows[0].id;

    const audit = await client.query(
      `SELECT e.id, e.series_number, COUNT(q.id)::int AS questions
         FROM exams e
         LEFT JOIN exam_questions q ON q.exam_id = e.id
        WHERE e.source_import_id = $1
          AND e.provider = 'osd'
          AND e.level = 'B2'
          AND e.section_type = 'listen'
          AND e.series_number BETWEEN 8 AND 20
        GROUP BY e.id, e.series_number
        ORDER BY e.series_number`,
      [sourceImportId]
    );
    if (audit.rows.length !== 13 || audit.rows.some((row) => Number(row.questions) !== 40)) {
      throw new Error("The authoritative import must contain exactly 13 series with 40 questions each.");
    }

    await client.query(
      `UPDATE exams
          SET is_active = FALSE,
              updated_at = NOW()
        WHERE provider = 'osd'
          AND level = 'B2'
          AND section_type = 'listen'
          AND series_number BETWEEN 8 AND 20
          AND source_import_id <> $1`,
      [sourceImportId]
    );

    const published = await client.query(
      `UPDATE exams
          SET is_active = TRUE,
              metadata = COALESCE(metadata, '{}'::jsonb)
                || jsonb_build_object('publicationStatus', 'published')
                || CASE WHEN series_number = 20
                     THEN jsonb_build_object('correctionPublicationOverride', 'approved-by-project-owner')
                     ELSE '{}'::jsonb
                   END,
              updated_at = NOW()
        WHERE source_import_id = $1
          AND provider = 'osd'
          AND level = 'B2'
          AND section_type = 'listen'
          AND series_number BETWEEN 8 AND 20
      RETURNING id, series_number, is_active`,
      [sourceImportId]
    );
    if (published.rows.length !== 13 || published.rows.some((row) => !row.is_active)) {
      throw new Error("Not all Series 08-20 were activated.");
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({
      ok: true,
      sourceImportId,
      publishedSeries: published.rows.map((row) => Number(row.series_number)).sort((a, b) => a - b),
    }, null, 2));
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
