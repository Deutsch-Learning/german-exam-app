const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const path = require("node:path");
const mammoth = require("mammoth");
const { parseB2StructuredLesenSeries } = require("../services/b2StructuredLesenParser");

const root = path.resolve(__dirname, "../..");
const fixtures = [
  {
    provider: "ecl",
    file: "ECL_B2_LESEVERSTEHEN_20_Sujets_RESTRUCTURED_Admin_Codex.docx",
    partTypes: ["inline_letter_gap", "short_answer"],
    questionCounts: [10, 10],
    duration: 45,
  },
  {
    provider: "telc",
    file: "TELC_B2_LESEN_20_Uebungshefte_RESTRUCTURED_Admin_Codex.docx",
    partTypes: ["three_way_choice", "advertisement_matching", "inline_sentence_gap"],
    questionCounts: [10, 5, 5],
    duration: 65,
  },
  {
    provider: "osd",
    file: "OeSD_B2_LESEN_20_Modellpruefungen_RESTRUCTURED_Admin_Codex.docx",
    partTypes: ["single_choice", "heading_matching", "missing_letters", "missing_word"],
    questionCounts: [5, 5, 20, 10],
    duration: 90,
  },
];

const getCorrectValue = (question) => String(question.correctAnswer?.value ?? "").trim();

const validateFixture = async (fixture) => {
  const filePath = path.join(root, "B2_lessen modifications", fixture.file);
  const buffer = await fs.readFile(filePath);
  const extracted = await mammoth.extractRawText({ buffer });
  const series = parseB2StructuredLesenSeries(extracted.value, {
    provider: fixture.provider,
    level: "B2",
    sectionType: "read",
    sourceFilename: fixture.file,
  });

  assert.equal(series.length, 20, `${fixture.provider}: expected 20 series`);
  series.forEach((item, seriesIndex) => {
    assert.equal(item.seriesNumber, seriesIndex + 1, `${fixture.provider}: series numbering`);
    assert.equal(item.sections.length, fixture.partTypes.length, `${fixture.provider} ${item.seriesNumber}: part count`);
    assert.equal(item.metadata.globalDurationMinutes, fixture.duration, `${fixture.provider}: duration`);
    item.sections.forEach((section, sectionIndex) => {
      const partMeta = section.metadata.structuredB2Lesen;
      assert.equal(partMeta.partType, fixture.partTypes[sectionIndex], `${fixture.provider} ${item.seriesNumber}: part type`);
      const expectedCount = fixture.questionCounts[sectionIndex];
      const allowedSourceException = fixture.provider === "osd" && item.seriesNumber === 19 && sectionIndex === 2;
      assert.equal(
        section.questions.length,
        allowedSourceException ? 19 : expectedCount,
        `${fixture.provider} ${item.seriesNumber} part ${sectionIndex + 1}: question count`
      );
      section.questions.forEach((question) => {
        assert.ok(getCorrectValue(question), `${fixture.provider} ${item.seriesNumber}: missing answer ${question.position}`);
        assert.ok(question.metadata.structuredB2Lesen, `${fixture.provider}: missing structured marker`);
      });
      assert.deepEqual(
        section.questions.map((question) => question.position),
        section.questions.map((_, index) => {
          if (fixture.provider === "telc" && sectionIndex === 1) return index + 11;
          if (fixture.provider === "telc" && sectionIndex === 2) return index + 16;
          return index + 1;
        }),
        `${fixture.provider} ${item.seriesNumber} part ${sectionIndex + 1}: numbering`
      );
      const studentMetadata = JSON.stringify(partMeta);
      assert.doesNotMatch(studentMetadata, /CORRECTION_VISIBLE_AFTER_SUBMIT|ANSWER_KEY|L[OÖ]SUNGSSCHL[UÜ]SSEL/i);
    });

    if (fixture.provider === "ecl") {
      const bank = item.sections[0].metadata.structuredB2Lesen.bank;
      assert.equal(bank.length, 13, `ecl ${item.seriesNumber}: bank size`);
      assert.equal(new Set(bank.map((option) => option.value)).size, 13, `ecl ${item.seriesNumber}: unique bank`);
      item.sections[0].questions.forEach((question) => assert.equal(question.options.length, 13));
    }
    if (fixture.provider === "telc") {
      item.sections[0].questions.forEach((question) => assert.equal(question.options.length, 3));
      assert.equal(item.sections[1].metadata.structuredB2Lesen.advertisements.length, 6, `telc ${item.seriesNumber}: ads`);
      assert.equal(item.sections[2].metadata.structuredB2Lesen.bank.length, 8, `telc ${item.seriesNumber}: sentence bank`);
    }
    if (fixture.provider === "osd") {
      item.sections[0].questions.forEach((question) => assert.equal(question.options.length, 3));
      assert.equal(item.sections[1].metadata.structuredB2Lesen.headings.length, 6, `osd ${item.seriesNumber}: headings`);
    }
    if (fixture.provider === "osd" && item.seriesNumber === 19) {
      assert.ok(item.metadata.sourceWarnings?.length, "osd 19: source exception must be visible to admin");
    }
  });

  const questionCount = series.reduce(
    (sum, item) => sum + item.sections.reduce((sectionSum, section) => sectionSum + section.questions.length, 0),
    0
  );
  return { provider: fixture.provider, series: series.length, questions: questionCount };
};

Promise.all(fixtures.map(validateFixture))
  .then((results) => {
    results.forEach((result) => {
      console.log(`${result.provider.toUpperCase()}: ${result.series} series, ${result.questions} questions validated`);
    });
  })
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
