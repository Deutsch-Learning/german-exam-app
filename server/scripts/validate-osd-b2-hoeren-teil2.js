const data = require("../data/osdB2HoerenTeil2Fixes.json");

const fail = (message) => {
  throw new Error(message);
};

const validateSourceData = () => {
  const seriesEntries = Object.entries(data.series || {});
  if (seriesEntries.length !== 7) fail(`Expected 7 complete source series, found ${seriesEntries.length}.`);

  for (const [seriesNumber, series] of seriesEntries) {
    if (!series.title || !series.instructions) fail(`Serie ${seriesNumber} is missing its title or instructions.`);
    if (series.points !== 10) fail(`Serie ${seriesNumber} Aufgabe 2 must be worth 10 points.`);
    if (series.layout !== "information-sheet") fail(`Serie ${seriesNumber} has the wrong layout.`);
    if (!Array.isArray(series.items) || series.items.length !== 30) {
      fail(`Serie ${seriesNumber} must contain exactly 30 detail items.`);
    }
    series.items.forEach((item, index) => {
      const expectedNumber = index + 1;
      if (item.number !== expectedNumber) fail(`Serie ${seriesNumber} item ${expectedNumber} is out of order.`);
      if (!item.prompt || !item.answer) fail(`Serie ${seriesNumber} item ${expectedNumber} is incomplete.`);
    });
  }

  return seriesEntries.length;
};

const validateApi = async (baseUrl) => {
  for (let seriesNumber = 1; seriesNumber <= 7; seriesNumber += 1) {
    const code = String(seriesNumber).padStart(2, "0");
    const response = await fetch(`${baseUrl}/api/exams/osd-b2/series/imported-osd-b2-series-${code}/listen`);
    if (!response.ok) fail(`Serie ${seriesNumber} API returned HTTP ${response.status}.`);
    const payload = await response.json();
    const module = payload.content || payload.module || payload;
    const part1 = module.tasks.filter((task) => Number(task.partNumber) === 1);
    const part2 = module.tasks.filter((task) => Number(task.partNumber) === 2);
    const source = data.series[String(seriesNumber)];

    if (part1.length !== 10) fail(`Serie ${seriesNumber} Aufgabe 1 contains ${part1.length} items.`);
    if (part2.length !== 30) fail(`Serie ${seriesNumber} Aufgabe 2 contains ${part2.length} items.`);
    part2.forEach((task, index) => {
      if (task.type !== "blank") fail(`Serie ${seriesNumber} Aufgabe 2 item ${index + 1} is ${task.type}.`);
      if (task.question !== source.items[index].prompt) fail(`Serie ${seriesNumber} item ${index + 1} prompt mismatch.`);
      if (task.correct !== source.items[index].answer) fail(`Serie ${seriesNumber} item ${index + 1} answer mismatch.`);
    });

    const totalPoints = module.tasks.reduce((sum, task) => sum + (Number(task.points) || 0), 0);
    if (Math.abs(totalPoints - 20) > 0.0001) fail(`Serie ${seriesNumber} has ${totalPoints} total points.`);
  }
};

const main = async () => {
  const sourceSeriesCount = validateSourceData();
  const apiArgIndex = process.argv.indexOf("--api");
  if (apiArgIndex >= 0) {
    const baseUrl = String(process.argv[apiArgIndex + 1] || "http://127.0.0.1:3000").replace(/\/$/, "");
    await validateApi(baseUrl);
    console.log(`Validated ${sourceSeriesCount} source series and all local API mappings.`);
    return;
  }
  console.log(`Validated ${sourceSeriesCount} source series and 210 Teil 2 detail items.`);
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
