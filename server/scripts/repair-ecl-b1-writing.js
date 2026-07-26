const assert = require("node:assert/strict");
const pool = require("../db");
const { cleanEclB1WritingArtifacts } = require("../services/documentImport");

const GLOBAL_DURATION_MINUTES = 35;
const EXAM_INSTRUCTIONS =
  "ECL B1 Schriftliche Kommunikation: zwei Schreibaufgaben, 35 Minuten, 25 Punkte.";
const standaloneFPattern = /(^|>|\n)[ \t]*F(?:[ \t\u00a0]+|&nbsp;)+(?=[A-ZÄÖÜ])/gu;
const pageHeaderPattern =
  /ECL\s+B1\s*[\u2010-\u2015-]\s*Schriftliche Kommunikation\s*[·•]/giu;

const artifactCounts = (value) => ({
  standaloneF: (String(value ?? "").match(standaloneFPattern) || []).length,
  pageHeaders: (String(value ?? "").match(pageHeaderPattern) || []).length,
});

const cleanArtifactValue = (value) => {
  if (typeof value === "string") return cleanEclB1WritingArtifacts(value);
  if (Array.isArray(value)) return value.map(cleanArtifactValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cleanArtifactValue(item)]));
  }
  return value;
};

const countArtifactValue = (value, totals) => {
  if (typeof value === "string") {
    const counts = artifactCounts(value);
    totals.standaloneF += counts.standaloneF;
    totals.pageHeaders += counts.pageHeaders;
    return;
  }
  if (Array.isArray(value)) value.forEach((item) => countArtifactValue(item, totals));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => countArtifactValue(item, totals));
};

const readScope = (client, lock = false) => client.query(
  `SELECT e.id AS exam_id,
          e.series_number,
          e.metadata AS exam_metadata,
          s.id AS section_id,
          s.part_number,
          s.instructions,
          s.duration_minutes,
          s.global_duration_minutes,
          s.scoring AS section_scoring,
          q.id AS question_id,
          q.position,
          q.prompt,
          q.correct_answer,
          q.explanation,
          q.scoring AS question_scoring
     FROM exams e
     JOIN exam_sections s ON s.exam_id = e.id
     JOIN exam_questions q ON q.exam_id = e.id AND q.section_id = s.id
    WHERE LOWER(e.provider) = 'ecl'
      AND UPPER(e.level) = 'B1'
      AND e.section_type = 'write'
      AND e.is_active = TRUE
    ORDER BY e.series_number, s.part_number, q.position${lock ? " FOR UPDATE OF e, s, q" : ""}`
);

const assertCompleteScope = (rows) => {
  assert.equal(rows.length, 40, "expected 40 ECL B1 Schreiben tasks");
  const exams = new Map();
  rows.forEach((row) => {
    const seriesNumber = Number(row.series_number);
    if (!exams.has(seriesNumber)) exams.set(seriesNumber, []);
    exams.get(seriesNumber).push(Number(row.part_number));
  });
  assert.deepEqual([...exams.keys()], Array.from({ length: 20 }, (_, index) => index + 1), "series 01-20");
  exams.forEach((parts, seriesNumber) => {
    assert.deepEqual(parts, [1, 2], `series ${seriesNumber}: Aufgaben 1 and 2`);
  });
};

const run = async () => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const before = await readScope(client, true);
    assertCompleteScope(before.rows);

    const totalsBefore = before.rows.reduce((totals, row) => {
      [row.instructions, row.prompt, row.correct_answer, row.explanation]
        .forEach((value) => countArtifactValue(value, totals));
      return totals;
    }, { standaloneF: 0, pageHeaders: 0 });
    const expectedSections = new Map();
    const expectedQuestions = new Map();
    for (const row of before.rows) {
      expectedSections.set(row.section_id, cleanEclB1WritingArtifacts(row.instructions));
      expectedQuestions.set(row.question_id, {
        prompt: cleanEclB1WritingArtifacts(row.prompt),
        correctAnswer: cleanArtifactValue(row.correct_answer || {}),
        explanation: cleanArtifactValue(row.explanation),
      });
    }

    for (const [sectionId, instructions] of expectedSections) {
      await client.query(
        `UPDATE exam_sections
            SET instructions = $2,
                duration_minutes = NULL,
                global_duration_minutes = $3,
                scoring = COALESCE(scoring, '{}'::jsonb) - 'durationMinutes',
                updated_at = NOW()
          WHERE id = $1`,
        [sectionId, instructions, GLOBAL_DURATION_MINUTES]
      );
    }

    for (const [questionId, question] of expectedQuestions) {
      await client.query(
        `UPDATE exam_questions
            SET prompt = $2,
                correct_answer = $3::jsonb,
                explanation = $4,
                scoring = COALESCE(scoring, '{}'::jsonb) - 'durationMinutes',
                updated_at = NOW()
          WHERE id = $1`,
        [questionId, question.prompt, JSON.stringify(question.correctAnswer), question.explanation]
      );
    }

    const examIds = [...new Set(before.rows.map((row) => Number(row.exam_id)))];
    for (const examId of examIds) {
      await client.query(
        `UPDATE exams
            SET metadata = jsonb_set(
                  COALESCE(metadata, '{}'::jsonb) || jsonb_build_object(
                    'instructions', $2::text,
                    'globalDurationMinutes', $3::int
                  ),
                  '{scoring}',
                  COALESCE(metadata->'scoring', '{}'::jsonb) || jsonb_build_object('globalDurationMinutes', $3::int),
                  TRUE
                ),
                updated_at = NOW()
          WHERE id = $1`,
        [examId, EXAM_INSTRUCTIONS, GLOBAL_DURATION_MINUTES]
      );
    }

    const after = await readScope(client);
    assertCompleteScope(after.rows);
    after.rows.forEach((row) => {
      assert.equal(row.instructions, expectedSections.get(row.section_id), `section ${row.section_id}: instructions`);
      const expectedQuestion = expectedQuestions.get(row.question_id);
      assert.equal(row.prompt, expectedQuestion.prompt, `question ${row.question_id}: prompt`);
      assert.deepEqual(row.correct_answer, expectedQuestion.correctAnswer, `question ${row.question_id}: correction`);
      assert.equal(row.explanation, expectedQuestion.explanation, `question ${row.question_id}: explanation`);
      assert.deepEqual(artifactCounts(row.instructions), { standaloneF: 0, pageHeaders: 0 }, `section ${row.section_id}: artifacts`);
      assert.deepEqual(artifactCounts(row.prompt), { standaloneF: 0, pageHeaders: 0 }, `question ${row.question_id}: artifacts`);
      assert.deepEqual(cleanArtifactValue(row.correct_answer), row.correct_answer, `question ${row.question_id}: correction artifacts`);
      assert.deepEqual(cleanArtifactValue(row.explanation), row.explanation, `question ${row.question_id}: explanation artifacts`);
      assert.equal(row.duration_minutes, null, `section ${row.section_id}: no divided duration`);
      assert.equal(Number(row.global_duration_minutes), GLOBAL_DURATION_MINUTES, `section ${row.section_id}: global duration`);
      assert.equal(Object.hasOwn(row.section_scoring || {}, "durationMinutes"), false, `section ${row.section_id}: scoring duration`);
      assert.equal(Object.hasOwn(row.question_scoring || {}, "durationMinutes"), false, `question ${row.question_id}: scoring duration`);
      assert.equal(Number(row.exam_metadata?.globalDurationMinutes), GLOBAL_DURATION_MINUTES, `series ${row.series_number}: metadata duration`);
    });

    await client.query("COMMIT");
    console.log(JSON.stringify({
      repairedSeries: examIds.length,
      repairedSections: expectedSections.size,
      repairedQuestions: expectedQuestions.size,
      removedArtifacts: totalsBefore,
      globalDurationMinutes: GLOBAL_DURATION_MINUTES,
    }, null, 2));
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
