const fs = require("node:fs/promises");
const path = require("node:path");
const pool = require("../db");
const {
  analyzeExamDocument,
  publishExamImportDraft,
  saveExamImportDraft,
} = require("../services/documentImport");

const files = {
  telc: "TELC_B1_Lesen_20_Serien_RESTRUCTURED.docx",
  ecl: "ECL_B1_Leseverstehen_20_Serien_RESTRUCTURED.docx",
  osd: "OESD_B1_Lesen_20_Modellsaetze_RESTRUCTURED.docx",
};

const expectedCounts = {
  telc: { exams: 20, sections: 60, questions: 400 },
  ecl: { exams: 20, sections: 40, questions: 300 },
  osd: { exams: 20, sections: 100, questions: 600 },
};

const requestedProvider = String(process.argv[2] || "all").toLowerCase();
const providers = requestedProvider === "all" ? Object.keys(files) : [requestedProvider];
if (providers.some((provider) => !files[provider])) {
  console.error("Usage: node server/scripts/publish-b1-reading-documents.js [all|telc|ecl|osd]");
  process.exit(1);
}

const publishProvider = async (provider) => {
  const filename = files[provider];
  const filePath = path.resolve(__dirname, "../../Lessen Change", filename);
  const buffer = await fs.readFile(filePath);
  const parsed = await analyzeExamDocument({
    buffer,
    filename,
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  if (parsed.metadata.provider !== provider || parsed.metadata.level !== "B1" || parsed.metadata.sectionType !== "read") {
    throw new Error(`${provider}: unexpected scope ${JSON.stringify(parsed.metadata)}`);
  }
  if (parsed.series.length !== 20) throw new Error(`${provider}: expected 20 series, received ${parsed.series.length}`);
  if (!parsed.series.every((series) => series.metadata?.structuredB1Lesen === true)) {
    throw new Error(`${provider}: structured B1 parser was not selected`);
  }

  const draft = await saveExamImportDraft({ pool, parsed });
  const published = draft.duplicate
    ? { ...draft, exams: [] }
    : await publishExamImportDraft({ pool, importId: draft.import.id });

  const verification = await pool.query(
    `SELECT COUNT(DISTINCT e.id)::int AS exam_count,
            COUNT(DISTINCT s.id)::int AS section_count,
            COUNT(DISTINCT q.id)::int AS question_count,
            COUNT(DISTINCT e.series_number)::int AS series_count
       FROM exams e
       LEFT JOIN exam_sections s ON s.exam_id = e.id
       LEFT JOIN exam_questions q ON q.exam_id = e.id
      WHERE LOWER(e.provider) = $1
        AND UPPER(e.level) = 'B1'
        AND e.section_type = 'read'
        AND e.is_active = TRUE
        AND COALESCE((e.metadata->>'structuredB1Lesen')::boolean, FALSE) = TRUE`,
    [provider]
  );
  const counts = verification.rows[0];
  const expected = expectedCounts[provider];
  if (
    counts.exam_count !== expected.exams ||
    counts.series_count !== expected.exams ||
    counts.section_count !== expected.sections ||
    counts.question_count !== expected.questions
  ) {
    throw new Error(`${provider}: published verification failed ${JSON.stringify(counts)}`);
  }
  return {
    provider,
    duplicate: Boolean(draft.duplicate),
    importId: draft.import.id,
    insertedExamCount: published.exams.length,
    validationWarnings: parsed.validation.warnings,
    counts,
  };
};

const run = async () => {
  const results = [];
  for (const provider of providers) results.push(await publishProvider(provider));
  console.log(JSON.stringify(results, null, 2));
};

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
