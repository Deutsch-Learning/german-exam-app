const assert = require("node:assert/strict");
const pool = require("../db");

const expected = {
  goethe: {
    partTypes: ["reading_true_false", "reading_mcq", "situation_ad_match", "opinion_yes_no", "reading_mcq"],
    questionCounts: [6, 6, 7, 7, 4],
    sourceQuestionStarts: [1, 7, 13, 20, 27],
  },
  telc: {
    partTypes: ["heading_text_match", "reading_mcq", "situation_ad_match"],
    questionCounts: [5, 5, 10],
  },
  ecl: {
    partTypes: ["reading_true_false_not_in_text", "reading_mcq"],
    questionCounts: [10, 5],
  },
  osd: {
    partTypes: ["reading_true_false", "reading_mcq", "situation_ad_match", "opinion_for_against", "reading_mcq"],
    questionCounts: [6, 6, 7, 7, 4],
  },
};

const readJson = (value) => {
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value);
  return value;
};

const verifyProvider = async (provider, contract) => {
  const result = await pool.query(
    `SELECT e.id AS exam_id,
            e.series_number,
            e.metadata AS exam_metadata,
            s.id AS section_id,
            s.part_number,
            s.metadata AS section_metadata,
            q.id AS question_id,
            q.position,
            q.options,
            q.correct_answer
       FROM exams e
       LEFT JOIN exam_sections s ON s.exam_id = e.id
       LEFT JOIN exam_questions q ON q.exam_id = e.id AND q.section_id = s.id
      WHERE LOWER(e.provider) = $1
        AND UPPER(e.level) = 'B1'
        AND e.section_type = 'read'
        AND e.is_active = TRUE
      ORDER BY e.series_number, s.part_number, q.position`,
    [provider]
  );

  const exams = new Map();
  result.rows.forEach((row) => {
    if (!exams.has(row.exam_id)) {
      exams.set(row.exam_id, {
        seriesNumber: Number(row.series_number),
        metadata: readJson(row.exam_metadata),
        sections: new Map(),
      });
    }
    const exam = exams.get(row.exam_id);
    if (row.section_id && !exam.sections.has(row.section_id)) {
      exam.sections.set(row.section_id, {
        partNumber: Number(row.part_number),
        metadata: readJson(row.section_metadata),
        questions: [],
      });
    }
    if (row.question_id) {
      exam.sections.get(row.section_id).questions.push({
        position: Number(row.position),
        options: readJson(row.options),
        correctAnswer: readJson(row.correct_answer),
      });
    }
  });

  assert.equal(exams.size, 20, `${provider}: active exam count`);
  const sortedExams = [...exams.values()].sort((a, b) => a.seriesNumber - b.seriesNumber);
  sortedExams.forEach((exam, seriesIndex) => {
    const label = `${provider.toUpperCase()} series ${seriesIndex + 1}`;
    assert.equal(exam.seriesNumber, seriesIndex + 1, `${label}: series numbering`);
    assert.equal(exam.metadata.structuredB1Lesen, true, `${label}: structured import marker`);
    const sections = [...exam.sections.values()].sort((a, b) => a.partNumber - b.partNumber);
    assert.equal(sections.length, contract.partTypes.length, `${label}: part count`);
    sections.forEach((section, partIndex) => {
      const partLabel = `${label} part ${partIndex + 1}`;
      const metadata = section.metadata.structuredB1Lesen || {};
      assert.equal(section.partNumber, partIndex + 1, `${partLabel}: part numbering`);
      assert.equal(metadata.partType, contract.partTypes[partIndex], `${partLabel}: task type`);
      assert.equal(section.questions.length, contract.questionCounts[partIndex], `${partLabel}: question count`);
      section.questions.forEach((question, questionIndex) => {
        assert.equal(
          question.position,
          (contract.sourceQuestionStarts?.[partIndex] || 1) + questionIndex,
          `${partLabel}: question position`
        );
        const options = Array.isArray(question.options) ? question.options : [];
        const correctValue = String(question.correctAnswer.value || "");
        assert.ok(correctValue, `${partLabel}: missing answer key`);
        assert.ok(options.some((option) => String(option.value) === correctValue), `${partLabel}: answer key not in options`);
      });
      if (metadata.uniqueAnswers) {
        const reusableAnswers = new Set(metadata.reusableAnswers || []);
        const uniqueAnswers = section.questions
          .map((question) => String(question.correctAnswer.value))
          .filter((value) => !reusableAnswers.has(value));
        assert.equal(new Set(uniqueAnswers).size, uniqueAnswers.length, `${partLabel}: duplicate unique-use answer`);
      }
    });
  });

  return {
    provider,
    exams: exams.size,
    sections: sortedExams.reduce((sum, exam) => sum + exam.sections.size, 0),
    questions: sortedExams.reduce(
      (sum, exam) => sum + [...exam.sections.values()].reduce((partSum, section) => partSum + section.questions.length, 0),
      0
    ),
  };
};

const run = async () => {
  const results = [];
  for (const [provider, contract] of Object.entries(expected)) {
    results.push(await verifyProvider(provider, contract));
  }
  console.log(JSON.stringify(results, null, 2));
};

run()
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
