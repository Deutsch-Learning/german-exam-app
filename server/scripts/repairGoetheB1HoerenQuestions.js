require("dotenv").config({ path: require("path").join(__dirname, "..", ".env"), quiet: true });

const pool = require("../db");
const fixes = require("../data/goetheB1HoerenQuestionFixes.json");

const normalizeQuestionType = (value) => {
  const raw = String(value || "").toLowerCase();
  if (raw.includes("true")) return "true_false";
  if (raw.includes("multiple")) return "multiple_choice";
  if (raw.includes("matching")) return "matching";
  return value || "multiple_choice";
};

const main = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const rows = await client.query(`
      SELECT e.id AS exam_id, e.series_number, q.id AS question_id, q.position, s.part_number
      FROM exams e
      JOIN exam_questions q ON q.exam_id = e.id
      LEFT JOIN exam_sections s ON s.id = q.section_id
      WHERE LOWER(e.provider) = LOWER('goethe')
        AND UPPER(COALESCE(e.level, '')) = 'B1'
        AND e.section_type = 'listen'
        AND e.is_active = TRUE
        AND e.source_import_id IS NOT NULL
      ORDER BY e.series_number, s.part_number, q.position, q.id
    `);

    let updated = 0;
    let skipped = 0;
    for (const row of rows.rows) {
      const fix = fixes[String(Number(row.series_number))]?.[`${Number(row.part_number)}:${Number(row.position)}`];
      if (!fix) {
        skipped += 1;
        continue;
      }
      await client.query(
        `UPDATE exam_questions
         SET prompt = $2,
             options = $3::jsonb,
             correct_answer = $4::jsonb,
             explanation = $5,
             question_type = $6,
             source_metadata = COALESCE(source_metadata, '{}'::jsonb)
               || jsonb_build_object('goetheB1HoerenSourceRepair', true),
             updated_at = NOW()
         WHERE id = $1`,
        [
          row.question_id,
          fix.prompt,
          JSON.stringify(fix.options || []),
          JSON.stringify(fix.correctAnswer || {}),
          fix.explanation || null,
          normalizeQuestionType(fix.questionType),
        ]
      );
      updated += 1;
    }

    await client.query("COMMIT");
    console.log(JSON.stringify({ ok: true, updated, skipped }));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((err) => {
  console.error("Goethe B1 Hoeren repair failed:", err.message);
  process.exit(1);
});
