const fs = require("fs");
const path = require("path");
const {
  CONTENT_FILES,
  PROFILE_DEFINITIONS,
  assetLookup,
  buildPairedPresentation,
  prepareCandidateText,
  preparePartPresentation,
  separatePartHeading,
  shouldAttachAssetToPart,
  splitCandidateAndPrivateText,
  splitParts,
} = require("./importSpeakingPackage");

const PACKAGE_DIR = path.resolve(__dirname, "..", "..", "Sprechen_B1_B2_Project_Package");
const PUBLIC_DIR = path.resolve(__dirname, "..", "..", "client", "gem-app", "public", "speaking-assets");

const ARTIFACT_PATTERNS = [
  { name: "form feed", pattern: /\f/ },
  { name: "ASCII border", pattern: /\+[-+]{5,}/ },
  { name: "ASCII pipe row", pattern: /^\s*\|.*\|\s*$/m },
  { name: "page marker", pattern: /(?:Seite|Page)\s+\d+/i },
  { name: "document footer", pattern: /(?:Inoffizielle Modellprüfung|©\s*Matériau)/i },
  { name: "picture placeholder", pattern: /■{2,}/ },
];

const PRIVATE_PATTERNS = [
  { name: "correction", pattern: /(?:^|\n)\s*(?:KORREKTUR|CORRIGÉE?|✔\s*Corrig)/i },
  { name: "model answer", pattern: /(?:^|\n)\s*(?:MUSTERLÖSUNG|Musterlösung)/i },
  { name: "assessment rubric", pattern: /(?:^|\n)\s*Bewertungsraster\b/i },
  { name: "examiner guide", pattern: /(?:^|\n)\s*Prüferleitfaden\b/i },
];

const EXPECTED_PARTS = {
  ecl_B2: [2, 3],
};

const wordCounts = (value) => {
  const counts = new Map();
  const words = String(value || "").normalize("NFKC").toLocaleLowerCase("de-DE").match(/[\p{L}\p{N}]+/gu) || [];
  for (const word of words) counts.set(word, (counts.get(word) || 0) + 1);
  return counts;
};

const containsOnlySourceWords = (presentation, source) => {
  const available = wordCounts(source);
  for (const [word, count] of wordCounts(presentation)) {
    if ((available.get(word) || 0) < count) return false;
  }
  return true;
};

const run = () => {
  const assets = assetLookup();
  const failures = [];
  const reports = [];
  const stableIds = new Set();
  let totalSeries = 0;
  let totalParts = 0;
  let totalImageTasks = 0;
  let totalPairedTasks = 0;

  for (const file of CONTENT_FILES) {
    const pack = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "content", file), "utf8"));
    const profile = PROFILE_DEFINITIONS[`${pack.provider}_${pack.level}`];
    let packParts = 0;
    let packImageTasks = 0;

    if (!profile) failures.push(`${file}: provider profile is missing`);
    if (pack.series?.length !== 20) failures.push(`${file}: expected 20 series, found ${pack.series?.length || 0}`);

    for (const series of pack.series || []) {
      totalSeries += 1;
      if (!series.id || stableIds.has(series.id)) failures.push(`${file} series ${series.number}: missing or duplicate stable id`);
      stableIds.add(series.id);

      const source = series.source_text_verbatim || series.question_text_verbatim;
      if (!String(source || "").trim()) failures.push(`${file} series ${series.number}: source-locked text is empty`);

      const split = splitCandidateAndPrivateText(pack, series);
      const candidateText = prepareCandidateText(split.candidateText, pack.provider, pack.level);
      const requestedVisualIds = series.visual_asset_ids || [];
      const visualAssets = requestedVisualIds.map((id) => assets.map.get(id)).filter(Boolean);

      if (visualAssets.length !== requestedVisualIds.length) {
        failures.push(`${file} series ${series.number}: visual manifest reference is missing`);
      }
      for (const asset of visualAssets) {
        const packagePath = path.join(PACKAGE_DIR, asset.path);
        const publicPath = path.join(PUBLIC_DIR, asset.path.replace(/^assets[\\/]/, ""));
        if (!fs.existsSync(packagePath)) failures.push(`${file} series ${series.number}: package asset missing ${asset.path}`);
        if (!fs.existsSync(publicPath)) failures.push(`${file} series ${series.number}: public asset missing ${publicPath}`);
      }

      const parts = splitParts(candidateText, profile).map((part) => {
        const formattedText = preparePartPresentation({
          text: part.text,
          provider: pack.provider,
          level: pack.level,
          partNumber: part.partNumber,
          hasVisual: visualAssets.length > 0,
        });
        const separated = separatePartHeading(formattedText, part.title);
        return { ...part, title: separated.title, text: separated.text };
      });
      const expectedParts = EXPECTED_PARTS[`${pack.provider}_${pack.level}`] || profile.parts.map((part) => part.partNumber);
      const actualParts = parts.map((part) => part.partNumber);
      if (JSON.stringify(actualParts) !== JSON.stringify(expectedParts)) {
        failures.push(`${file} series ${series.number}: expected parts ${expectedParts.join(",")}, found ${actualParts.join(",")}`);
      }

      for (const part of parts) {
        packParts += 1;
        totalParts += 1;
        if (part.text.trim().length < 30) failures.push(`${file} series ${series.number} part ${part.partNumber}: presentation is unexpectedly short`);
        if (!containsOnlySourceWords(part.text, split.candidateText)) {
          failures.push(`${file} series ${series.number} part ${part.partNumber}: presentation contains words absent from source-locked text`);
        }
        for (const artifact of ARTIFACT_PATTERNS) {
          if (artifact.pattern.test(part.text)) failures.push(`${file} series ${series.number} part ${part.partNumber}: contains ${artifact.name}`);
        }
        for (const privateMarker of PRIVATE_PATTERNS) {
          if (privateMarker.pattern.test(part.text)) failures.push(`${file} series ${series.number} part ${part.partNumber}: leaks ${privateMarker.name}`);
        }

        const hasAttachedVisual = shouldAttachAssetToPart(pack.provider, pack.level, part.partNumber, visualAssets);
        if (hasAttachedVisual) {
          packImageTasks += 1;
          totalImageTasks += 1;
        }
        const pairedPresentation = buildPairedPresentation(part.text);
        if (pairedPresentation) {
          totalPairedTasks += 1;
          if (pairedPresentation.cards.some((card) => !card.label || !card.text)) {
            failures.push(`${file} series ${series.number} part ${part.partNumber}: paired role layout is incomplete`);
          }
        }
      }
    }

    reports.push({ file, series: pack.series?.length || 0, parts: packParts, imageTasks: packImageTasks });
  }

  const expectedTotals = { series: 160, parts: 440, imageTasks: 60, pairedTasks: 40 };
  if (totalSeries !== expectedTotals.series) failures.push(`expected ${expectedTotals.series} total series, found ${totalSeries}`);
  if (totalParts !== expectedTotals.parts) failures.push(`expected ${expectedTotals.parts} total parts, found ${totalParts}`);
  if (totalImageTasks !== expectedTotals.imageTasks) failures.push(`expected ${expectedTotals.imageTasks} image tasks, found ${totalImageTasks}`);
  if (totalPairedTasks !== expectedTotals.pairedTasks) failures.push(`expected ${expectedTotals.pairedTasks} paired role tasks, found ${totalPairedTasks}`);

  const result = {
    ok: failures.length === 0,
    totals: { series: totalSeries, parts: totalParts, imageTasks: totalImageTasks, pairedTasks: totalPairedTasks },
    reports,
    failures,
  };
  console.log(JSON.stringify(result, null, 2));
  if (failures.length) process.exitCode = 1;
};

run();
