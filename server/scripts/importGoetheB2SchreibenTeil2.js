const fs = require("fs");
const path = require("path");
const pool = require("../db");

const NEW_TEIL2_PDF =
  process.env.GOETHE_B2_SCHREIBEN_TEIL2_PDF ||
  "C:/Users/walner tech/Downloads/Goethe_B2_Schreiben_Teil2_20_Aufgaben (1).pdf";
const ORIGINAL_SCHREIBEN_PDF =
  process.env.GOETHE_B2_SCHREIBEN_ORIGINAL_PDF ||
  "C:/Users/walner tech/Downloads/Goethe B2_Schreiben_20_Sujets.pdf";

const APPLY = process.argv.includes("--apply");
const SERIES_ARG = process.argv.find((arg) => arg.startsWith("--series="));
const ONLY_SERIES = SERIES_ARG
  ? new Set(SERIES_ARG.slice("--series=".length).split(",").map((value) => Number(value.trim())).filter(Boolean))
  : null;

const clean = (value) =>
  String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const compact = (value) =>
  clean(value)
    .replace(/\n+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();

const stripPageMarkers = (value) =>
  clean(value)
    .replace(/\n?--\s*\d+\s+of\s+\d+\s*--\n?/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const loadPdfText = async (pdfPath) => {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: fs.readFileSync(pdfPath) });
  try {
    const result = await parser.getText();
    return clean(result.text);
  } finally {
    await parser.destroy();
  }
};

const parseTeil2Tasks = (text) => {
  const tasks = new Map();
  const keyStart = text.lastIndexOf("Lösungsschlüssel");
  const taskText = keyStart >= 0 ? text.slice(0, keyStart) : text;
  const taskRe = /Aufgabe\s+(\d{1,2})\/20\s*\n([^\n]+)\nSituation\n([\s\S]*?)\nAufgabe\n([\s\S]*?)(?=\n\s*--\s*\d+\s+of\s+25\s*--|\nÜBUNGSHEFT B2 \| SCHREIBEN|$)/g;
  let match;
  while ((match = taskRe.exec(taskText))) {
    const number = Number(match[1]);
    const title = compact(match[2]);
    const situation = compact(match[3]);
    const body = clean(match[4]);
    const leitpunkte = [...body.matchAll(/(?:^|\n)l\s+([^\n]+)/g)].map((item) => compact(item[1]));
    const instruction = compact(body.split(/\nl\s+/)[0]);
    const reminder = compact(body.match(/Achten Sie auf eine passende Anrede und einen passenden Gruß\./)?.[0] || "");
    tasks.set(number, {
      number,
      title,
      situation,
      instruction,
      leitpunkte,
      reminder,
    });
  }

  const keyText = keyStart >= 0 ? text.slice(keyStart) : "";
  const keyRe = /Aufgabe\s+(\d{2})\s+[–-]\s*([^\n]+)\n([\s\S]*?)(?=\nAufgabe\s+\d{2}\s+[–-]|$)/g;
  while ((match = keyRe.exec(keyText))) {
    const number = Number(match[1]);
    const task = tasks.get(number);
    if (!task) continue;
    const guidanceLines = stripPageMarkers(match[3])
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => line.replace(/^l\s+/, "- "));
    task.evaluationGuidance = guidanceLines.join("\n");
  }

  return tasks;
};

const parseOriginalSerie10Teil1 = (text) => {
  const normalized = text.replace(/\r/g, "");
  const start = normalized.search(/\n1\s*\n0\s+Universitätsstudium kostenlos machen\s+—\s+Bildung/i);
  const end = normalized.search(/\nTEIL 2\s+—\s+FORMELLE NACHRICHT/i);
  if (start < 0 || end < 0 || end <= start) return null;
  const raw = stripPageMarkers(normalized.slice(start, end))
    .replace(/^\s*1\s*\n\s*0\s+/, "10 ")
    .trim();
  const title = "Universitätsstudium kostenlos machen — Bildung";
  return {
    title,
    prompt: raw,
    sourceMetadata: {
      b2Fallback: true,
      partNumber: 1,
      sourceLabel: "Goethe-Zertifikat B2 10",
      sourceSeriesNumber: 10,
      restoredFromOriginalImport: true,
      restoredBy: "importGoetheB2SchreibenTeil2",
    },
  };
};

const buildTeil2Prompt = (task) => [
  `Aufgabe ${String(task.number).padStart(2, "0")}: ${task.title}`,
  "Situation",
  task.situation,
  "Aufgabe",
  task.instruction,
  ...task.leitpunkte.map((point) => `- ${point}`),
  task.reminder,
].filter(Boolean).join("\n");

const buildTeil2Metadata = (task, importId) => ({
  goetheB2SchreibenTeil2: {
    taskNumber: task.number,
    title: task.title,
    situation: task.situation,
    instruction: task.instruction,
    leitpunkte: task.leitpunkte,
    reminder: task.reminder,
    targetWordCount: 100,
    recommendedTimeMinutes: 25,
    publicationStatus: "published",
    sourceDocument: path.basename(NEW_TEIL2_PDF),
    sourceImportId: importId || null,
  },
  wordTarget: 100,
  minWordsGuidance: 60,
  sourceLabel: `Goethe B2 Schreiben Teil 2 Aufgabe ${String(task.number).padStart(2, "0")}`,
  sourceSeriesNumber: task.number,
});

const buildTeil2CorrectAnswer = (task) => ({
  expectedPerformance: task.evaluationGuidance || "",
  evaluationGuidance: task.evaluationGuidance || "",
});

const getTeil2ImportId = async (client) => {
  const result = await client.query(
    `SELECT id FROM exam_document_imports
      WHERE filename = $1
      ORDER BY id DESC
      LIMIT 1`,
    [path.basename(NEW_TEIL2_PDF)]
  );
  return result.rows[0]?.id || null;
};

const getActiveGoetheB2WritingExams = async (client) => {
  const result = await client.query(
    `SELECT id, series_number
       FROM exams
      WHERE LOWER(provider) = 'goethe'
        AND UPPER(COALESCE(level, '')) = 'B2'
        AND section_type = 'write'
        AND is_active = TRUE
      ORDER BY series_number, id`
  );
  return result.rows;
};

const restoreSerie10Teil1IfNeeded = async (client, examId, originalTeil1) => {
  if (!originalTeil1) throw new Error("Could not recover Serie 10 Teil 1 from original source PDF.");
  const sections = await client.query(
    `SELECT s.*, COUNT(q.id)::int AS question_count
       FROM exam_sections s
       LEFT JOIN exam_questions q ON q.section_id = s.id
      WHERE s.exam_id = $1
      GROUP BY s.id
      ORDER BY s.position, s.id`,
    [examId]
  );
  const hasPart1 = sections.rows.some((section) => Number(section.part_number) === 1);
  if (hasPart1) return { action: "kept-serie10-teil1" };

  const placeholder = sections.rows.find((section) => Number(section.part_number) === 2 && Number(section.question_count) === 1) || sections.rows[0];
  if (!placeholder) {
    if (!APPLY) return { action: "would-insert-serie10-teil1" };
    const insertedSection = await client.query(
      `INSERT INTO exam_sections (
         exam_id, section_type, part_number, title, instructions, duration_minutes,
         points, scoring, metadata, position
       )
       VALUES ($1, 'write', 1, $2, $3, 50, 60, $4::jsonb, $5::jsonb, 1)
       RETURNING id`,
      [
        examId,
        originalTeil1.title,
        originalTeil1.prompt,
        JSON.stringify({ points: 60, durationMinutes: 50, totalPoints: 100 }),
        JSON.stringify({ restoredFromOriginalImport: true }),
      ]
    );
    await client.query(
      `INSERT INTO exam_questions (
         exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
         position, question_type, scoring, source_metadata
       )
       VALUES ($1, $2, 'write', $3, '[]'::jsonb, '{}'::jsonb, NULL, 1,
               'writing_forum_post', $4::jsonb, $5::jsonb)`,
      [
        examId,
        insertedSection.rows[0].id,
        originalTeil1.prompt,
        JSON.stringify({ points: 60, durationMinutes: 50, totalPoints: 100 }),
        JSON.stringify(originalTeil1.sourceMetadata),
      ]
    );
    return { action: "inserted-serie10-teil1" };
  }

  if (!APPLY) return { action: "would-update-serie10-placeholder-to-teil1", sectionId: placeholder.id };
  await client.query(
    `UPDATE exam_sections
        SET part_number = 1,
            title = $2,
            instructions = $3,
            duration_minutes = 50,
            points = 60,
            scoring = $4::jsonb,
            metadata = $5::jsonb,
            position = 1,
            updated_at = NOW()
      WHERE id = $1`,
    [
      placeholder.id,
      originalTeil1.title,
      originalTeil1.prompt,
      JSON.stringify({ points: 60, durationMinutes: 50, totalPoints: 100 }),
      JSON.stringify({ restoredFromOriginalImport: true }),
    ]
  );
  await client.query(
    `UPDATE exam_questions
        SET module_id = 'write',
            prompt = $2,
            options = '[]'::jsonb,
            correct_answer = '{}'::jsonb,
            explanation = NULL,
            position = 1,
            question_type = 'writing_forum_post',
            scoring = $3::jsonb,
            source_metadata = $4::jsonb,
            updated_at = NOW()
      WHERE exam_id = $1
        AND section_id = $5`,
    [
      examId,
      originalTeil1.prompt,
      JSON.stringify({ points: 60, durationMinutes: 50, totalPoints: 100 }),
      JSON.stringify(originalTeil1.sourceMetadata),
      placeholder.id,
    ]
  );
  return { action: "updated-serie10-placeholder-to-teil1", sectionId: placeholder.id };
};

const upsertTeil2 = async (client, examId, task, importId) => {
  const existing = await client.query(
    `SELECT s.id AS section_id, q.id AS question_id, q.source_metadata
       FROM exam_sections s
       LEFT JOIN exam_questions q ON q.section_id = s.id
      WHERE s.exam_id = $1
        AND s.part_number = 2
      ORDER BY s.position, q.position, q.id
      LIMIT 1`,
    [examId]
  );
  const title = `Teil 2: ${task.title}`;
  const prompt = buildTeil2Prompt(task);
  const scoring = { points: 40, durationMinutes: 25, totalPoints: 100 };
  const metadata = buildTeil2Metadata(task, importId);
  const correctAnswer = buildTeil2CorrectAnswer(task);

  if (!existing.rows[0]) {
    if (!APPLY) return { action: "would-insert-teil2" };
    const insertedSection = await client.query(
      `INSERT INTO exam_sections (
         exam_id, section_type, part_number, title, instructions, duration_minutes,
         points, scoring, metadata, position
       )
       VALUES ($1, 'write', 2, $2, $3, 25, 40, $4::jsonb, $5::jsonb, 2)
       RETURNING id`,
      [examId, title, prompt, JSON.stringify(scoring), JSON.stringify(metadata)]
    );
    const insertedQuestion = await client.query(
      `INSERT INTO exam_questions (
         exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
         position, question_type, scoring, source_metadata
       )
       VALUES ($1, $2, 'write', $3, '[]'::jsonb, $4::jsonb, $5, 2,
               'writing_formal_message', $6::jsonb, $7::jsonb)
       RETURNING id`,
      [
        examId,
        insertedSection.rows[0].id,
        prompt,
        JSON.stringify(correctAnswer),
        correctAnswer.expectedPerformance || null,
        JSON.stringify(scoring),
        JSON.stringify(metadata),
      ]
    );
    return { action: "inserted-teil2", sectionId: insertedSection.rows[0].id, questionId: insertedQuestion.rows[0].id };
  }

  if (!APPLY) return { action: "would-update-teil2", sectionId: existing.rows[0].section_id, questionId: existing.rows[0].question_id };
  await client.query(
    `UPDATE exam_sections
        SET title = $2,
            instructions = $3,
            duration_minutes = 25,
            points = 40,
            scoring = $4::jsonb,
            metadata = $5::jsonb,
            position = 2,
            updated_at = NOW()
      WHERE id = $1`,
    [existing.rows[0].section_id, title, prompt, JSON.stringify(scoring), JSON.stringify(metadata)]
  );
  if (existing.rows[0].question_id) {
    await client.query(
      `UPDATE exam_questions
          SET prompt = $2,
              options = '[]'::jsonb,
              correct_answer = $3::jsonb,
              explanation = $4,
              position = 2,
              question_type = 'writing_formal_message',
              scoring = $5::jsonb,
              source_metadata = $6::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        existing.rows[0].question_id,
        prompt,
        JSON.stringify(correctAnswer),
        correctAnswer.expectedPerformance || null,
        JSON.stringify(scoring),
        JSON.stringify(metadata),
      ]
    );
    return { action: "updated-teil2", sectionId: existing.rows[0].section_id, questionId: existing.rows[0].question_id };
  }
  const insertedQuestion = await client.query(
    `INSERT INTO exam_questions (
       exam_id, section_id, module_id, prompt, options, correct_answer, explanation,
       position, question_type, scoring, source_metadata
     )
     VALUES ($1, $2, 'write', $3, '[]'::jsonb, $4::jsonb, $5, 2,
             'writing_formal_message', $6::jsonb, $7::jsonb)
     RETURNING id`,
    [
      examId,
      existing.rows[0].section_id,
      prompt,
      JSON.stringify(correctAnswer),
      correctAnswer.expectedPerformance || null,
      JSON.stringify(scoring),
      JSON.stringify(metadata),
    ]
  );
  return { action: "inserted-teil2-question", sectionId: existing.rows[0].section_id, questionId: insertedQuestion.rows[0].id };
};

const updateImportRecord = async (client, importId, examIds) => {
  if (!APPLY || !importId) return;
  await client.query(
    `UPDATE exam_document_imports
        SET total_series = 20,
            total_sections = 20,
            total_questions = 20,
            parse_status = 'published',
            validation_warnings = '[]'::jsonb,
            imported_exam_ids = $2::jsonb,
            updated_at = NOW(),
            published_at = COALESCE(published_at, NOW())
      WHERE id = $1`,
    [importId, JSON.stringify(examIds)]
  );
};

const main = async () => {
  const teil2Text = await loadPdfText(NEW_TEIL2_PDF);
  const originalText = await loadPdfText(ORIGINAL_SCHREIBEN_PDF);
  const teil2Tasks = parseTeil2Tasks(teil2Text);
  const originalSerie10Teil1 = parseOriginalSerie10Teil1(originalText);

  if (teil2Tasks.size !== 20) throw new Error(`Expected 20 Teil 2 tasks, parsed ${teil2Tasks.size}.`);
  for (let number = 1; number <= 20; number += 1) {
    const task = teil2Tasks.get(number);
    if (!task) throw new Error(`Missing Aufgabe ${number}.`);
    if (task.leitpunkte.length !== 4) throw new Error(`Aufgabe ${number} has ${task.leitpunkte.length} Leitpunkte.`);
    if (!task.evaluationGuidance) throw new Error(`Aufgabe ${number} has no Bewertungshinweise.`);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const importId = await getTeil2ImportId(client);
    const exams = await getActiveGoetheB2WritingExams(client);
    const selectedExams = exams.filter((exam) => !ONLY_SERIES || ONLY_SERIES.has(Number(exam.series_number)));
    const seenSeries = new Set(selectedExams.map((exam) => Number(exam.series_number)));
    for (let number = 1; number <= 20; number += 1) {
      if ((!ONLY_SERIES || ONLY_SERIES.has(number)) && !seenSeries.has(number)) {
        throw new Error(`Missing active Goethe B2 Schreiben Serie ${number}.`);
      }
    }

    const actions = [];
    for (const exam of selectedExams) {
      const seriesNumber = Number(exam.series_number);
      if (seriesNumber === 10) {
        actions.push({ series: 10, ...(await restoreSerie10Teil1IfNeeded(client, exam.id, originalSerie10Teil1)) });
      }
      actions.push({
        series: seriesNumber,
        task: `Aufgabe ${String(seriesNumber).padStart(2, "0")}`,
        ...(await upsertTeil2(client, exam.id, teil2Tasks.get(seriesNumber), importId)),
      });
      if (APPLY) await client.query(`UPDATE exams SET updated_at = NOW() WHERE id = $1`, [exam.id]);
    }

    await updateImportRecord(client, importId, exams.map((exam) => exam.id));
    if (APPLY) await client.query("COMMIT");
    else await client.query("ROLLBACK");
    console.log(JSON.stringify({ ok: true, apply: APPLY, series: selectedExams.length, actions }, null, 2));
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
};

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
