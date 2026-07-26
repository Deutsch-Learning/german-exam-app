const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const mammoth = require("mammoth");
const { parseB1StructuredLesenSeries } = require("../services/b1StructuredLesenParser");
const { analyzeExamDocument } = require("../services/documentImport");

const root = path.resolve(__dirname, "../..");
const fixtures = [
  {
    provider: "goethe",
    folder: "Goethe change",
    file: "GOETHE_B1_Lesen_20_Pruefungshefte_RESTRUCTURED.docx",
    partTypes: ["reading_true_false", "reading_mcq", "situation_ad_match", "opinion_yes_no", "reading_mcq"],
    questionCounts: [6, 6, 7, 7, 4],
    optionCounts: [2, 3, 11, 2, 3],
    sourceQuestionStarts: [1, 7, 13, 20, 27],
    duration: 60,
  },
  {
    provider: "telc",
    folder: "Lessen Change",
    file: "TELC_B1_Lesen_20_Serien_RESTRUCTURED.docx",
    partTypes: ["heading_text_match", "reading_mcq", "situation_ad_match"],
    questionCounts: [5, 5, 10],
    optionCounts: [7, 3, 20],
    duration: 60,
  },
  {
    provider: "ecl",
    folder: "Lessen Change",
    file: "ECL_B1_Leseverstehen_20_Serien_RESTRUCTURED.docx",
    partTypes: ["reading_true_false_not_in_text", "reading_mcq"],
    questionCounts: [10, 5],
    optionCounts: [3, 3],
    duration: 35,
  },
  {
    provider: "osd",
    folder: "Lessen Change",
    file: "OESD_B1_Lesen_20_Modellsaetze_RESTRUCTURED.docx",
    partTypes: ["reading_true_false", "reading_mcq", "situation_ad_match", "opinion_for_against", "reading_mcq"],
    questionCounts: [6, 6, 7, 7, 4],
    optionCounts: [2, 3, 10, 2, 3],
    duration: 65,
  },
];

const forbiddenStudentMarkers = /INSTRUCTION \p{L}*TUDIANT|QUESTIONS ET OPTIONS|AFFIRMATIONS ET CHOIX|CORRECTION|CORRIG\p{L}*|CONSERVER CACH\p{L}*E|BANQUE COMMUNE|BANQUE D['\p{P}]ANNONCES|VISIBLE \p{L}* L['\p{P}]\p{L}*TUDIANT/iu;

const assertSourceContains = (source, value, label) => {
  const normalizedSource = source.replace(/\s+/g, " ");
  const normalizedValue = String(value || "").replace(/\s+/g, " ").trim();
  assert.ok(normalizedValue, `${label}: empty source value`);
  assert.ok(normalizedSource.includes(normalizedValue), `${label}: parsed wording is not present verbatim in the DOCX`);
};

const assertSourceTokenSubsequence = (source, value, label) => {
  const sourceTokens = String(source || "")
    .replace(/([\p{L}])(\d{1,2})(?=\s)/gu, "$1 $2")
    .toLocaleLowerCase("de-DE")
    .match(/[\p{L}\p{N}]+/gu) || [];
  const valueTokens = String(value || "").toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]+/gu) || [];
  const firstToken = valueTokens[0];
  const candidateStarts = sourceTokens.flatMap((token, index) => token === firstToken ? [index] : []);
  const matched = candidateStarts.some((candidateStart) => {
    let sourceIndex = candidateStart + 1;
    for (const token of valueTokens.slice(1)) {
      const foundAt = sourceTokens.indexOf(token, sourceIndex);
      if (foundAt === -1) return false;
      sourceIndex = foundAt + 1;
    }
    return true;
  });
  assert.equal(matched, true, `${label}: parsed token sequence was not found in source order`);
};

const validateFixture = async (fixture) => {
  const filePath = path.join(root, fixture.folder || "Lessen Change", fixture.file);
  const buffer = await fs.readFile(filePath);
  const extracted = await mammoth.extractRawText({ buffer });
  const series = parseB1StructuredLesenSeries(extracted.value, {
    provider: fixture.provider,
    level: "B1",
    sectionType: "read",
    sourceFilename: fixture.file,
  });

  assert.equal(series.length, 20, `${fixture.provider}: expected 20 series`);
  series.forEach((item, seriesIndex) => {
    const seriesLabel = `${fixture.provider.toUpperCase()} series ${seriesIndex + 1}`;
    assert.equal(item.seriesNumber, seriesIndex + 1, `${seriesLabel}: numbering`);
    assert.equal(item.sections.length, fixture.partTypes.length, `${seriesLabel}: part count`);
    assert.equal(item.metadata.globalDurationMinutes, fixture.duration, `${seriesLabel}: global duration`);
    assert.equal(item.metadata.structuredB1Lesen, true, `${seriesLabel}: structured marker`);

    item.sections.forEach((section, partIndex) => {
      const partLabel = `${seriesLabel} part ${partIndex + 1}`;
      const meta = section.metadata.structuredB1Lesen;
      assert.equal(section.partNumber, partIndex + 1, `${partLabel}: part numbering`);
      assert.equal(meta.partType, fixture.partTypes[partIndex], `${partLabel}: task type`);
      assert.equal(section.questions.length, fixture.questionCounts[partIndex], `${partLabel}: question count`);
      assert.ok(meta.instruction, `${partLabel}: instruction`);
      assertSourceContains(extracted.value, meta.instruction, `${partLabel} instruction`);
      assert.doesNotMatch(JSON.stringify(meta), forbiddenStudentMarkers, `${partLabel}: helper label leaked`);

      section.questions.forEach((question, questionIndex) => {
        const questionLabel = `${partLabel} question ${questionIndex + 1}`;
        assert.equal(
          question.position,
          (fixture.sourceQuestionStarts?.[partIndex] || 1) + questionIndex,
          `${questionLabel}: position`
        );
        assert.equal(question.options.length, fixture.optionCounts[partIndex], `${questionLabel}: option count`);
        assert.ok(question.correctAnswer.value, `${questionLabel}: missing correct answer`);
        assert.ok(
          question.options.some((option) => option.value === question.correctAnswer.value),
          `${questionLabel}: answer does not reference an option`
        );
        assert.equal(question.metadata.structuredB1Lesen, true, `${questionLabel}: structured marker`);
        if (fixture.provider === "goethe") {
          assertSourceTokenSubsequence(extracted.value, question.prompt, `${questionLabel} prompt`);
        } else {
          assertSourceContains(extracted.value, question.prompt, `${questionLabel} prompt`);
        }
        question.options.forEach((option) => {
          if (fixture.provider === "goethe" && partIndex === 2) {
            if (option.value !== "0") assertSourceTokenSubsequence(extracted.value, option.label, `${questionLabel} option ${option.value}`);
            return;
          }
          if (fixture.provider === "ecl" && partIndex === 0) return;
          if (fixture.provider === "osd" && [0, 3].includes(partIndex)) return;
          assertSourceContains(extracted.value, option.label, `${questionLabel} option ${option.value}`);
        });
      });

      const uniqueMatching = ["heading_text_match", "situation_ad_match"].includes(meta.partType);
      if (uniqueMatching) {
        assert.equal(meta.uniqueAnswers, true, `${partLabel}: unique-use rule`);
        const reusableAnswers = new Set(meta.reusableAnswers || []);
        const uniqueSourceAnswers = section.questions
          .map((question) => question.correctAnswer.value)
          .filter((value) => !reusableAnswers.has(value));
        assert.equal(new Set(uniqueSourceAnswers).size, uniqueSourceAnswers.length, `${partLabel}: duplicated source answer`);
      }

      (meta.sourceMaterials || []).forEach((material) => {
        assertSourceContains(extracted.value, material.text, `${partLabel} ${material.label}`);
      });
      (meta.headings || []).forEach((itemValue) => assertSourceContains(extracted.value, itemValue.label, `${partLabel} heading ${itemValue.value}`));
      (meta.advertisements || []).forEach((itemValue) => {
        if (fixture.provider === "goethe" && itemValue.value === "0") return;
        if (fixture.provider === "goethe") {
          assertSourceTokenSubsequence(extracted.value, itemValue.label, `${partLabel} ad ${itemValue.value}`);
        } else {
          assertSourceContains(extracted.value, itemValue.label, `${partLabel} ad ${itemValue.value}`);
        }
      });
      if (meta.theme) assertSourceContains(extracted.value, meta.theme, `${partLabel} theme`);
    });
  });

  const analyzed = await analyzeExamDocument({
    buffer,
    filename: fixture.file,
    mimetype: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
  assert.equal(analyzed.metadata.provider, fixture.provider, `${fixture.provider}: analyzer provider`);
  assert.equal(analyzed.metadata.level, "B1", `${fixture.provider}: analyzer level`);
  assert.equal(analyzed.metadata.sectionType, "read", `${fixture.provider}: analyzer section`);
  assert.equal(analyzed.series.length, 20, `${fixture.provider}: analyzer series count`);
  assert.equal(
    analyzed.validation.questionCount,
    series.reduce((sum, item) => sum + item.sections.reduce((partSum, section) => partSum + section.questions.length, 0), 0),
    `${fixture.provider}: analyzer question count`
  );
  assert.ok(analyzed.series.every((item) => item.metadata.structuredB1Lesen === true), `${fixture.provider}: analyzer parser selection`);

  return {
    provider: fixture.provider,
    series: series.length,
    sections: series.reduce((sum, item) => sum + item.sections.length, 0),
    questions: series.reduce((sum, item) => sum + item.sections.reduce((partSum, section) => partSum + section.questions.length, 0), 0),
  };
};

Promise.all(fixtures.map(validateFixture))
  .then((results) => {
    results.forEach((result) => {
      console.log(`${result.provider.toUpperCase()}: ${result.series} series, ${result.sections} parts, ${result.questions} questions validated`);
    });
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
