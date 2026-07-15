const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");
const {
  analyzeExamDocument,
  publishExamImportDraft,
  saveExamImportDraft,
} = require("../services/documentImport");

const files = {
  ecl: "ECL_B2_LESEVERSTEHEN_20_Sujets_RESTRUCTURED_Admin_Codex.docx",
  telc: "TELC_B2_LESEN_20_Uebungshefte_RESTRUCTURED_Admin_Codex.docx",
  osd: "OeSD_B2_LESEN_20_Modellpruefungen_RESTRUCTURED_Admin_Codex.docx",
};

const provider = String(process.argv[2] || "").toLowerCase();
if (!files[provider]) {
  console.error("Usage: node server/scripts/publish-b2-reading-document.js <ecl|telc|osd>");
  process.exit(1);
}

const run = async () => {
  const filename = files[provider];
  const filePath = path.resolve(__dirname, "../../B2_lessen modifications", filename);
  const buffer = await fs.readFile(filePath);
  const parsed = await analyzeExamDocument({
    buffer,
    filename,
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (parsed.metadata.provider !== provider || parsed.metadata.level !== "B2" || parsed.metadata.sectionType !== "read") {
    throw new Error(`Unexpected scope: ${JSON.stringify(parsed.metadata)}`);
  }
  if (parsed.series.length !== 20) throw new Error(`Expected 20 series, received ${parsed.series.length}`);

  const draft = await saveExamImportDraft({ pool, parsed });
  const published = draft.duplicate
    ? { ...draft, exams: [] }
    : await publishExamImportDraft({ pool, importId: draft.import.id });

  const verification = await pool.query(
    `SELECT COUNT(*)::int AS exam_count,
            COALESCE(SUM(section_count), 0)::int AS section_count,
            COALESCE(SUM(question_count), 0)::int AS question_count
     FROM (
       SELECT e.id,
              COUNT(DISTINCT s.id)::int AS section_count,
              COUNT(DISTINCT q.id)::int AS question_count
       FROM exams e
       LEFT JOIN exam_sections s ON s.exam_id = e.id
       LEFT JOIN exam_questions q ON q.exam_id = e.id
       WHERE LOWER(e.provider) = $1
         AND UPPER(e.level) = 'B2'
         AND e.section_type = 'read'
         AND e.is_active = TRUE
       GROUP BY e.id
     ) active_scope`,
    [provider]
  );
  const counts = verification.rows[0];
  if (counts.exam_count !== 20) throw new Error(`Published verification failed: ${JSON.stringify(counts)}`);
  console.log(JSON.stringify({
    provider,
    duplicate: Boolean(draft.duplicate),
    importId: draft.import.id,
    warnings: parsed.validation.warnings,
    counts,
    insertedExamCount: published.exams.length,
  }, null, 2));
};

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
