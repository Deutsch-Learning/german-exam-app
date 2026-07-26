const assert = require("node:assert/strict");

const baseUrl = String(process.argv[2] || "https://gem-app-delta.vercel.app").replace(/\/$/, "");
const expected = {
  "telc-b1": {
    provider: "telc",
    duration: 60,
    partTypes: ["heading_text_match", "reading_mcq", "situation_ad_match"],
    questionCounts: [5, 5, 10],
  },
  "ecl-b1": {
    provider: "ecl",
    duration: 35,
    partTypes: ["reading_true_false_not_in_text", "reading_mcq"],
    questionCounts: [10, 5],
  },
  "osd-b1": {
    provider: "osd",
    duration: 65,
    partTypes: ["reading_true_false", "reading_mcq", "situation_ad_match", "opinion_for_against", "reading_mcq"],
    questionCounts: [6, 6, 7, 7, 4],
  },
};

const readJson = async (pathname) => {
  const response = await fetch(`${baseUrl}${pathname}`, { signal: AbortSignal.timeout(30_000) });
  assert.equal(response.ok, true, `${pathname}: HTTP ${response.status}`);
  return response.json();
};

const verifySeries = async (examId, series, contract) => {
  const payload = await readJson(`/api/exams/${examId}/series/${series.id}/read`);
  const content = payload.content || {};
  assert.equal(content.available, true, `${series.id}: available`);
  assert.equal(content.globalDurationMinutes, contract.duration, `${series.id}: global duration`);
  assert.equal(content.parts?.length, contract.partTypes.length, `${series.id}: part count`);
  assert.equal(content.tasks?.length, contract.questionCounts.reduce((sum, count) => sum + count, 0), `${series.id}: task count`);

  content.parts.forEach((part, partIndex) => {
    const metadata = part.sourceMetadata?.structuredB1Lesen || {};
    assert.equal(part.number, partIndex + 1, `${series.id}: part numbering`);
    assert.equal(metadata.partType, contract.partTypes[partIndex], `${series.id}: part type`);
    assert.ok(metadata.instruction, `${series.id}: part instruction`);
  });

  contract.questionCounts.forEach((expectedCount, partIndex) => {
    const partKey = `part-${partIndex + 1}`;
    const tasks = content.tasks.filter((task) => task.partKey === partKey);
    assert.equal(tasks.length, expectedCount, `${series.id}: ${partKey} task count`);
    tasks.forEach((task) => {
      assert.equal(task.sourceMetadata?.structuredB1Lesen, true, `${series.id}: structured task marker`);
      assert.ok(["multiple", "select"].includes(task.type), `${series.id}: supported interaction type`);
      assert.ok(task.options.some((option) => String(option.value) === String(task.correct)), `${series.id}: answer in options`);
      assert.doesNotMatch(`${task.hint}\n${task.explanation}`, /Relisez|Réponse issue/i, `${series.id}: non-German helper copy`);
    });
    if (tasks[0]?.uniqueAnswers) {
      assert.equal(new Set(tasks.map((task) => String(task.correct))).size, tasks.length, `${series.id}: unique-use answers`);
    }
  });
};

const verifyProvider = async (examId, contract) => {
  const payload = await readJson(`/api/exams/${examId}/series`);
  const series = Array.isArray(payload.series) ? payload.series : [];
  assert.equal(series.length, 20, `${examId}: series count`);
  series.forEach((item, index) => {
    assert.equal(item.seriesNumber, index + 1, `${examId}: series ordering`);
    assert.equal(item.id, `imported-${contract.provider}-b1-series-${String(index + 1).padStart(2, "0")}`, `${examId}: series id`);
  });
  for (const item of series) await verifySeries(examId, item, contract);
  return {
    provider: contract.provider,
    series: series.length,
    parts: series.length * contract.partTypes.length,
    questions: series.length * contract.questionCounts.reduce((sum, count) => sum + count, 0),
  };
};

Promise.all(Object.entries(expected).map(([examId, contract]) => verifyProvider(examId, contract)))
  .then((results) => console.log(JSON.stringify({ baseUrl, results }, null, 2)))
  .catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
