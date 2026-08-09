const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const {
  examSectionDurations,
  getExamSectionDurationMinutes,
  harmonizeDurationText,
} = require("../config/examDurations");

const expectedDurations = {
  "goethe-b1": { read: 65, listen: 40, write: 60, speak: 15 },
  "goethe-b2": { read: 65, listen: 40, write: 75, speak: 15 },
  "osd-b1": { read: 65, listen: 40, write: 60, speak: 15 },
  "osd-b2": { read: 90, listen: 30, write: 90, speak: 20 },
  "ecl-b1": { read: 35, listen: 20, write: 35, speak: 10 },
  "ecl-b2": { read: 45, listen: 30, write: 60, speak: 15 },
  "telc-b1": { read: 65, sprach: 25, listen: 30, write: 30, speak: 35 },
  "telc-b2": { read: 70, sprach: 20, listen: 20, write: 30, speak: 35 },
};

test("all configured exam section durations match the approved timing matrix", () => {
  assert.deepEqual(examSectionDurations, expectedDurations);
  for (const [examId, modules] of Object.entries(expectedDurations)) {
    for (const [moduleId, duration] of Object.entries(modules)) {
      assert.equal(getExamSectionDurationMinutes({ examId, moduleId }), duration, `${examId}/${moduleId}`);
    }
  }
});

test("exam aliases resolve to the same authoritative durations", () => {
  assert.equal(getExamSectionDurationMinutes({ provider: "ÖSD", level: "B2", moduleId: "listen" }), 30);
  assert.equal(getExamSectionDurationMinutes({ provider: "oesd", level: "B1", moduleId: "write" }), 60);
  assert.equal(getExamSectionDurationMinutes({ provider: "TELC Deutsch", level: "B2", moduleId: "sprach" }), 20);
});

test("instruction duration mentions are harmonized without changing unrelated numbers", () => {
  assert.equal(
    harmonizeDurationText("Sie haben 60 Minuten. Beantworten Sie 30 Aufgaben.", 65),
    "Sie haben 65 Minuten. Beantworten Sie 30 Aufgaben."
  );
  assert.equal(
    harmonizeDurationText("eine 60-minuetige Pruefung", 65),
    "eine 65-minuetige Pruefung"
  );
  assert.equal(harmonizeDurationText("Durée : 35 minutes", 45), "Durée : 45 Minuten");
});

test("the client timer and overview consume the shared duration resolver", () => {
  const projectRoot = path.resolve(__dirname, "..", "..");
  const simulationSource = fs.readFileSync(
    path.join(projectRoot, "client", "gem-app", "src", "pages", "SimulationModulePage.jsx"),
    "utf8"
  );
  const overviewSource = fs.readFileSync(
    path.join(projectRoot, "client", "gem-app", "src", "pages", "SeriesSimulationPage.jsx"),
    "utf8"
  );

  assert.match(simulationSource, /getExamSectionDurationMinutes/);
  assert.match(simulationSource, /totalExamDurationMinutes \* 60/);
  assert.match(overviewSource, /getModuleDurationMinutes/);
  assert.doesNotMatch(simulationSource, /ECL_B1_GLOBAL_DURATION_MINUTES|GLOBAL_TEST_DURATION_MINUTES/);
});
