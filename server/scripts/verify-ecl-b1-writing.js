const assert = require("node:assert/strict");
const pool = require("../db");
const { cleanEclB1WritingArtifacts } = require("../services/documentImport");

const baseUrl = String(process.argv[2] || "").replace(/\/$/, "");
const GLOBAL_DURATION_MINUTES = 35;

const assertCleanValue = (value, label) => {
  if (typeof value === "string") {
    assert.equal(cleanEclB1WritingArtifacts(value), value, label);
    return;
  }
  if (Array.isArray(value)) value.forEach((item, index) => assertCleanValue(item, `${label}[${index}]`));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) => assertCleanValue(item, `${label}.${key}`));
  }
};

const verifyDatabase = async () => {
  const result = await pool.query(
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
      ORDER BY e.series_number, s.part_number, q.position`
  );

  assert.equal(result.rowCount, 40, "database: task count");
  assert.equal(new Set(result.rows.map((row) => row.exam_id)).size, 20, "database: series count");
  result.rows.forEach((row) => {
    assert.equal(cleanEclB1WritingArtifacts(row.instructions), row.instructions, `series ${row.series_number} part ${row.part_number}: instructions clean`);
    assert.equal(cleanEclB1WritingArtifacts(row.prompt), row.prompt, `series ${row.series_number} part ${row.part_number}: prompt clean`);
    assertCleanValue(row.correct_answer, `series ${row.series_number} part ${row.part_number}: correction clean`);
    assertCleanValue(row.explanation, `series ${row.series_number} part ${row.part_number}: explanation clean`);
    assert.equal(row.duration_minutes, null, `series ${row.series_number} part ${row.part_number}: no part timer`);
    assert.equal(Number(row.global_duration_minutes), GLOBAL_DURATION_MINUTES, `series ${row.series_number} part ${row.part_number}: section global timer`);
    assert.equal(Number(row.exam_metadata?.globalDurationMinutes), GLOBAL_DURATION_MINUTES, `series ${row.series_number}: exam global timer`);
    assert.equal(Object.hasOwn(row.section_scoring || {}, "durationMinutes"), false, `series ${row.series_number}: section duration metadata`);
    assert.equal(Object.hasOwn(row.question_scoring || {}, "durationMinutes"), false, `series ${row.series_number}: question duration metadata`);
  });
  return { series: 20, sections: 40, tasks: 40 };
};

const readJson = async (pathname) => {
  const response = await fetch(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `${pathname}: HTTP ${response.status}`);
  return response.json();
};

const verifyApi = async () => {
  if (!baseUrl) return null;
  const listPayload = await readJson("/api/exams/ecl-b1/series");
  const series = listPayload.series || [];
  assert.equal(series.length, 20, "API: series count");
  series.forEach((item) => {
    Object.values(item.modules || {}).forEach((module) => {
      if (module.available) assert.equal(module.durationMinutes, GLOBAL_DURATION_MINUTES, `${item.id}/${module.id}: duration`);
    });
  });

  for (const item of series) {
    const payload = await readJson(`/api/exams/ecl-b1/series/${item.id}/write`);
    const content = payload.content || {};
    assert.equal(content.globalDurationMinutes, GLOBAL_DURATION_MINUTES, `${item.id}: global duration`);
    assert.equal(content.parts?.length, 2, `${item.id}: part count`);
    assert.equal(content.tasks?.length, 2, `${item.id}: task count`);
    assertCleanValue(content, `${item.id}: public content clean`);
    content.tasks.forEach((task) => {
      assert.equal(cleanEclB1WritingArtifacts(task.prompt), task.prompt, `${item.id}: task prompt clean`);
      assert.equal(task.partDurationMinutes, null, `${item.id}: no part duration`);
    });
  }

  for (const examId of ["goethe-b1", "telc-b1", "osd-b1", "ecl-b2"]) {
    const payload = await readJson(`/api/exams/${examId}/series`);
    const firstWritingModule = payload.series?.find((item) => item.modules?.write?.available)?.modules?.write;
    if (firstWritingModule) assert.equal(firstWritingModule.durationMinutes, 60, `${examId}: writing timer unchanged`);
  }
  return { series: 20, parts: 40, tasks: 40 };
};

Promise.all([verifyDatabase(), verifyApi()])
  .then(([database, api]) => console.log(JSON.stringify({ database, api, baseUrl: baseUrl || null }, null, 2)))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
