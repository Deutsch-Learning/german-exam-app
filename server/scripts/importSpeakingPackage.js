const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const { ensureDocumentImportSchema } = require("../services/documentImport");
const { ensureSpeakingCorrectionSchema } = require("../services/speakingCorrection");

const PACKAGE_DIR = path.resolve(__dirname, "..", "..", "Sprechen_B1_B2_Project_Package");
const PUBLIC_ASSET_PREFIX = "/speaking-assets";
const PACKAGE_VERSION = "2.0.0";
const PROFILE_VERSION = "2026-07-source-faithful-v2";

const CONTENT_FILES = [
  "goethe_b1.json",
  "goethe_b2_combined.json",
  "telc_b1.json",
  "telc_b2.json",
  "osd_b1.json",
  "osd_b2.json",
  "ecl_b1.json",
  "ecl_b2.json",
];

const PROFILE_DEFINITIONS = {
  goethe_B1: {
    provider: "goethe",
    level: "B1",
    preparationSeconds: 900,
    sessionSeconds: 900,
    rawMax: 100,
    variant: "source_faithful_practice",
    parts: [
      { partNumber: 1, title: "TEIL 1 – Gemeinsam planen", durationMinutes: 3, points: 28, prepSeconds: 900, responseSeconds: 180 },
      { partNumber: 2, title: "TEIL 2 – Ein Thema präsentieren", durationMinutes: 3, points: 40, prepSeconds: 900, responseSeconds: 180 },
      { partNumber: 3, title: "TEIL 3 – Reagieren und Diskutieren", durationMinutes: 2, points: 16, prepSeconds: 900, responseSeconds: 120 },
    ],
  },
  goethe_B2: {
    provider: "goethe",
    level: "B2",
    preparationSeconds: 900,
    sessionSeconds: 900,
    rawMax: 100,
    variant: "source_faithful_practice",
    parts: [
      { partNumber: 1, title: "TEIL 1 — VORTRAG", durationMinutes: 4, points: 50, prepSeconds: 900, responseSeconds: 240 },
      { partNumber: 2, title: "TEIL 2 — DISKUSSION", durationMinutes: 5, points: 50, prepSeconds: 900, responseSeconds: 300 },
    ],
  },
  telc_B1: {
    provider: "telc",
    level: "B1",
    preparationSeconds: 1200,
    sessionSeconds: 900,
    rawMax: 75,
    variant: "source_faithful_practice",
    parts: [
      { partNumber: 1, title: "TEIL 1 – Einander kennenlernen", durationMinutes: 4, points: 15, prepSeconds: 1200, responseSeconds: 240 },
      { partNumber: 2, title: "TEIL 2 – Ueber ein Thema sprechen", durationMinutes: 5, points: 30, prepSeconds: 1200, responseSeconds: 300 },
      { partNumber: 3, title: "TEIL 3 – Gemeinsam etwas planen", durationMinutes: 6, points: 30, prepSeconds: 1200, responseSeconds: 360 },
    ],
  },
  telc_B2: {
    provider: "telc",
    level: "B2",
    preparationSeconds: 1200,
    sessionSeconds: 900,
    rawMax: 75,
    variant: "source_faithful_practice",
    parts: [
      { partNumber: 1, title: "TEIL 1 — Über Erfahrungen sprechen", durationMinutes: 5, points: 25, prepSeconds: 1200, responseSeconds: 300 },
      { partNumber: 2, title: "TEIL 2 — Diskussion", durationMinutes: 5, points: 25, prepSeconds: 1200, responseSeconds: 300 },
      { partNumber: 3, title: "TEIL 3 — Gemeinsam etwas planen", durationMinutes: 5, points: 25, prepSeconds: 1200, responseSeconds: 300 },
    ],
  },
  osd_B1: {
    provider: "osd",
    level: "B1",
    preparationSeconds: 900,
    sessionSeconds: 900,
    rawMax: 100,
    variant: "source_faithful_practice",
    parts: [
      { partNumber: 1, title: "TEIL 1 – Gemeinsam etwas planen", durationMinutes: 3, points: 28, prepSeconds: 900, responseSeconds: 180 },
      { partNumber: 2, title: "TEIL 2 – Ein Thema präsentieren", durationMinutes: 3, points: 40, prepSeconds: 900, responseSeconds: 180 },
      { partNumber: 3, title: "TEIL 3 – Reagieren und Fragen beantworten", durationMinutes: 2, points: 16, prepSeconds: 900, responseSeconds: 120 },
    ],
  },
  osd_B2: {
    provider: "osd",
    level: "B2",
    preparationSeconds: 900,
    sessionSeconds: 1500,
    rawMax: 30,
    variant: "source_faithful_practice_with_reviewed_images",
    parts: [
      { partNumber: 1, title: "Aufgabe 1 – Gespräch/Meinungsaustausch", durationMinutes: 6, points: 10, prepSeconds: 900, responseSeconds: 360 },
      { partNumber: 2, title: "Aufgabe 2 – Freies monologisches Sprechen", durationMinutes: 6, points: 10, prepSeconds: 900, responseSeconds: 360 },
      { partNumber: 3, title: "Aufgabe 3 – Streitgespräch", durationMinutes: 8, points: 10, prepSeconds: 900, responseSeconds: 480 },
    ],
  },
  ecl_B1: {
    provider: "ecl",
    level: "B1",
    preparationSeconds: 0,
    sessionSeconds: 1200,
    rawMax: 25,
    variant: "source_faithful_practice_with_reviewed_images",
    parts: [
      { partNumber: 1, title: "TEIL 1 — Vorstellung", durationMinutes: 2, points: 0, prepSeconds: 0, responseSeconds: 120 },
      { partNumber: 2, title: "TEIL 2 — Gelenktes Gespräch", durationMinutes: 8, points: 12.5, prepSeconds: 0, responseSeconds: 480 },
      { partNumber: 3, title: "TEIL 3 — Selbständige Äußerung", durationMinutes: 8, points: 12.5, prepSeconds: 0, responseSeconds: 480 },
    ],
  },
  ecl_B2: {
    provider: "ecl",
    level: "B2",
    preparationSeconds: 0,
    sessionSeconds: 1200,
    rawMax: 25,
    variant: "source_faithful_practice_with_reviewed_images",
    parts: [
      { partNumber: 1, title: "Teil 1 — Warm-up", durationMinutes: 2, points: 0, prepSeconds: 0, responseSeconds: 120 },
      { partNumber: 2, title: "Teil 2 — Gelenktes Gespräch", durationMinutes: 8, points: 12.5, prepSeconds: 0, responseSeconds: 480 },
      { partNumber: 3, title: "Teil 3 — Selbstständige Äußerung", durationMinutes: 8, points: 12.5, prepSeconds: 0, responseSeconds: 480 },
    ],
  },
};

const readJson = (relativePath) => JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, relativePath), "utf8"));

const cleanDbText = (value) =>
  String(value || "")
    .replace(/\u0000/g, "")
    .replace(/\r\n/g, "\n")
    .trim();

const PAGE_FURNITURE_PATTERNS = [
  /^\s*(?:Seite|Page)\s+\d+(?:\s*\/\s*\d+)?(?:\s*\|.*)?\s*$/i,
  /^\s*.*(?:Seite|Page)\s+\d+(?:\s*\/\s*\d+)?\s*$/i,
  /^\s*©\s*Matériau\b.*$/i,
  /^\s*(?:ECL|telc|ÖSD|OSD)\b.*(?:Original|Simulationsaufgaben|Sprechen|Mündliche Kommunikation).*$/i,
  /^\s*Inoffizielle\s+Modellprüfung\b.*$/i,
];

const isPageFurniture = (line) => {
  const trimmed = String(line || "").trim();
  if (!trimmed) return false;
  return PAGE_FURNITURE_PATTERNS.some((pattern) => pattern.test(trimmed));
};

const isRuleLine = (line) => {
  const trimmed = String(line || "").trim();
  return /^(?:\+[-+]{5,}\+?|[-_─—]{8,})$/.test(trimmed);
};

const normalizeBullet = (line) => String(line || "")
  .replace(/^\s*(?:■+|◆+|→|✓|✅)\s*/, "• ")
  .replace(/[ \t]{2,}/g, " ")
  .trim();

const isStructuralLine = (line) => {
  const text = String(line || "").trim();
  return /^(?:TEIL|Teil|Aufgabe)\s+\d+\b/.test(text) ||
    /^(?:Kandidat(?:in)?\s+[AB]|Position\s+[AB]|Situation|Thema|Kontext|Aufgabe|Optionen|Hilfen|Hilfestellungen|Leitfragen|Redemittel|Diskussionsfrage|Fragen|Questions|Anschlussfragen|Bildmontage-Thema|Dauer|Ziel|Punkte)\b\s*:?/i.test(text) ||
    /^(?:•|\d+[.)])\s+/.test(text);
};

const reflowLines = (lines) => {
  const paragraphs = [];
  for (const originalLine of lines) {
    const line = normalizeBullet(originalLine);
    if (!line) continue;
    const previous = paragraphs.at(-1);
    const previousIsListItem = /^(?:•|\d+[.)])\s+/.test(previous || "");
    const previousHasInlineLabel = /^[^:]{1,60}:\s+\S/.test(previous || "");
    const shouldAppend = previous &&
      !isStructuralLine(line) &&
      (previousIsListItem || previousHasInlineLabel || (
        !isStructuralLine(previous) &&
        !/:$/.test(previous) &&
        !/[.!?…]$/.test(previous)
      ));
    if (shouldAppend) paragraphs[paragraphs.length - 1] = `${previous} ${line}`;
    else paragraphs.push(line);
  }
  return paragraphs.join("\n");
};

const convertAsciiTables = (text) => {
  const lines = String(text || "").split("\n");
  const output = [];
  for (let index = 0; index < lines.length;) {
    if (!/^\s*[+|]/.test(lines[index])) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const block = [];
    while (index < lines.length && /^\s*[+|]/.test(lines[index])) {
      if (/^\s*\|/.test(lines[index])) block.push(lines[index]);
      index += 1;
    }
    if (!block.length) continue;

    const rows = block.map((line) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()));
    const columnCount = Math.max(...rows.map((row) => row.length));
    const columns = Array.from({ length: columnCount }, () => []);
    for (const row of rows) {
      row.forEach((cell, columnIndex) => {
        if (cell) columns[columnIndex].push(cell);
      });
    }
    output.push(columns.map((column) => reflowLines(column)).filter(Boolean).join("\n\n"));
  }
  return output.join("\n");
};

const sequentializeGoetheB2Columns = (text) => {
  const lines = String(text || "").split("\n");
  const headingIndex = lines.findIndex((line) => /TEIL\s*1\b/i.test(line) && /TEIL\s*2\b/i.test(line));
  if (headingIndex < 0) return text;
  const boundaryCounts = new Map();
  for (const line of lines.slice(headingIndex)) {
    for (const match of line.matchAll(/ {5,}/g)) {
      const boundary = match.index + match[0].length;
      if (boundary >= 45 && boundary <= 65) boundaryCounts.set(boundary, (boundaryCounts.get(boundary) || 0) + 1);
    }
  }
  const inferredBoundary = [...boundaryCounts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])[0]?.[0];
  const splitAt = inferredBoundary || lines[headingIndex].search(/TEIL\s*2\b/i);
  if (splitAt < 1) return text;

  const prefix = lines.slice(0, headingIndex).filter((line) => !/\bPunkte\s*$/i.test(line));
  const body = lines.slice(headingIndex).filter((line) => !/^\s*\d+\s*Min\.\s*[·|]\s*\d+\s*$/i.test(line.trim()));
  const left = body.map((line) => line.slice(0, splitAt).trimEnd());
  const right = body.map((line) => line.slice(splitAt).trim());
  return [...prefix, reflowLines(left), "", reflowLines(right)].filter((line, index, values) => line || values[index - 1]).join("\n");
};

const sequentializeOsdPositions = (text) => {
  const lines = String(text || "").split("\n");
  const headingIndex = lines.findIndex((line) => /Position\s+A\s*:/i.test(line) && /Position\s+B\s*:/i.test(line));
  if (headingIndex < 0) return text;
  const headerSplit = lines[headingIndex].search(/Position\s+B\s*:/i);
  const bulletSplits = lines.slice(headingIndex + 1)
    .map((line) => [...line.matchAll(/•/g)].map((match) => match.index).filter((index) => index > 20)[0])
    .filter(Number.isFinite);
  const splitAt = Math.min(headerSplit, ...bulletSplits);
  if (splitAt < 1) return text;
  let endIndex = headingIndex + 1;
  while (endIndex < lines.length && !/^\s*Redemittel\b/i.test(lines[endIndex])) endIndex += 1;
  const columnRows = lines.slice(headingIndex, endIndex);
  const left = columnRows.map((line) => line.slice(0, splitAt).trimEnd());
  const right = columnRows.map((line) => line.slice(splitAt).trim());
  return [
    ...lines.slice(0, headingIndex),
    reflowLines(left),
    "",
    reflowLines(right),
    ...lines.slice(endIndex),
  ].join("\n");
};

const stripPageFurniture = (text) => String(text || "")
  .replace(/\f/g, "\n")
  .split("\n")
  .filter((line) => !isPageFurniture(line) && !isRuleLine(line))
  .join("\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const splitAtFirstMarker = (text, markers) => {
  const indexes = markers
    .map((marker) => {
      const match = text.match(marker);
      return match ? match.index : -1;
    })
    .filter((index) => index > 0);
  if (!indexes.length) return { candidateText: text, privateText: "" };
  const index = Math.min(...indexes);
  return {
    candidateText: text.slice(0, index).trim(),
    privateText: text.slice(index).trim(),
  };
};

const removePrivateBlocks = (text, blockMatchers) => {
  let candidateText = text;
  const privateBlocks = [];
  for (const { start, end } of blockMatchers) {
    const match = candidateText.match(start);
    if (!match) continue;
    const from = match.index;
    const tail = candidateText.slice(from + match[0].length);
    const endMatch = tail.match(end);
    const to = endMatch ? from + match[0].length + endMatch.index : candidateText.length;
    privateBlocks.push(candidateText.slice(from, to).trim());
    candidateText = `${candidateText.slice(0, from).trimEnd()}\n\n${candidateText.slice(to).trimStart()}`.trim();
  }
  return {
    candidateText: candidateText.trim(),
    privateText: privateBlocks.filter(Boolean).join("\n\n"),
  };
};

const splitCandidateAndPrivateText = (pack, series) => {
  if (pack.provider === "goethe" && pack.level === "B2") {
    return {
      candidateText: cleanDbText(series.question_text_verbatim),
      privateText: cleanDbText(series.correction_text_verbatim),
      sourceText: cleanDbText(`${series.question_text_verbatim || ""}\n\n${series.correction_text_verbatim || ""}`),
    };
  }

  const sourceText = cleanDbText(series.source_text_verbatim);
  if (pack.provider === "osd" && pack.level === "B1") {
    const split = removePrivateBlocks(sourceText, [
      {
        start: /(?:^|\n)\s*✔\s*Corrig[ée]\s*\/\s*Bewertungshinweise\s*:/i,
        end: /(?:^|\n)\s*TEIL\s+3\b/i,
      },
      {
        start: /(?:^|\n)\s*✔\s*Corrig[ée]\s*\/\s*Bewertungshinweise\s*:/i,
        end: /$/i,
      },
    ]);
    return { ...split, sourceText };
  }
  if (pack.provider === "osd" && pack.level === "B2") {
    const split = removePrivateBlocks(sourceText, [
      {
        start: /(?:^|\n)\s*Prüferleitfaden\s*\([^)]*\)\s*:/i,
        end: /(?:^|\n)\s*Aufgabe\s+2\b/i,
      },
      {
        start: /(?:^|\n)\s*Musterlösung\s*\([^)]*\)\s*:/i,
        end: /(?:^|\n)\s*Aufgabe\s+3\b/i,
      },
      {
        start: /(?:^|\n)\s*Bewertungsraster\s*\(/i,
        end: /$/i,
      },
    ]);
    return { ...split, sourceText };
  }
  const markers = [
    /(?:^|\n)\s*✏️?\s*MUSTERLÖSUNG\b/i,
    /(?:^|\n)\s*(?:KORREKTUR|KORREKTUR\s*\/|CORRIG[ÉE]|✔\s*Corrig)/i,
    /(?:^|\n)\s*Musterlösung\s*\(/i,
    /(?:^|\n)\s*Bewertungsraster\b/i,
  ];
  const split = splitAtFirstMarker(sourceText, markers);
  return { ...split, sourceText };
};

const splitParts = (candidateText, profile) => {
  const markers = profile.parts
    .map((part) => {
      const label = part.title.split(/[|·]/)[0].trim();
      const token = label
        .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        .replace(/\s+/g, "\\s+")
        .replace(/[—–-]/g, "[—–-]");
      return { part, regex: new RegExp(`(?:^|\\n|\\s{2,})\\s*${token}`, "i") };
    })
    .map(({ part, regex }) => {
      const match = candidateText.match(regex);
      return match ? { part, index: match.index + (match[0].startsWith("\n") ? 1 : 0) } : null;
    })
    .filter(Boolean)
    .sort((a, b) => a.index - b.index);

  if (!markers.length) {
    return [{ ...profile.parts[0], text: candidateText }];
  }

  return markers.map((marker, index) => {
    const next = markers[index + 1];
    return {
      ...marker.part,
      text: candidateText.slice(marker.index, next ? next.index : candidateText.length).trim(),
    };
  }).filter((part) => part.text);
};

const removeDelimitedBlock = (text, startPattern, endPattern) => {
  const source = String(text || "");
  const start = source.match(startPattern);
  if (!start) return source;
  const tailStart = start.index + start[0].length;
  const end = source.slice(tailStart).match(endPattern);
  if (!end) return source;
  const endIndex = tailStart + end.index;
  return `${source.slice(0, start.index).trimEnd()}\n\n${source.slice(endIndex).trimStart()}`.trim();
};

const getRequiredVisualPart = (provider, level) => {
  if (provider === "ecl") return 3;
  if (provider === "osd" && level === "B2") return 2;
  return null;
};

const removeVisualDescription = (text, provider, level, partNumber, hasVisual) => {
  if (!hasVisual || partNumber !== getRequiredVisualPart(provider, level)) return text;
  if (provider === "ecl" && level === "B1") {
    return removeDelimitedBlock(text, /(?:^|\n)\s*Bildmontage\s*\([^)]*\)\s*:\s*/i, /(?:^|\n)\s*Aufgabe\s*:/i);
  }
  if (provider === "ecl" && level === "B2") {
    return removeDelimitedBlock(text, /(?:^|\n)\s*Bildmaterial\s*\([^)]*\)\s*:\s*/i, /(?:^|\n)\s*Zusatzfrage\b/i);
  }
  if (provider === "osd" && level === "B2") {
    return removeDelimitedBlock(text, /(?:^|\n)\s*Bildbeschreibung\s*\([^)]*\)\s*:\s*/i, /(?:^|\n)\s*Redemittel\s*:/i);
  }
  return text;
};

const formatCandidateText = (text) => stripPageFurniture(convertAsciiTables(text))
  .split(/\n{2,}/)
  .map((block) => reflowLines(block.split("\n")))
  .filter(Boolean)
  .join("\n\n")
  .replace(/\n{3,}/g, "\n\n")
  .trim();

const prepareCandidateText = (candidateText, provider, level) => {
  let prepared = String(candidateText || "");
  if (provider === "goethe" && level === "B2") prepared = sequentializeGoetheB2Columns(prepared);
  if (provider === "osd" && level === "B2") prepared = sequentializeOsdPositions(prepared);
  return stripPageFurniture(convertAsciiTables(prepared));
};

const preparePartPresentation = ({ text, provider, level, partNumber, hasVisual }) => {
  const withoutDescription = removeVisualDescription(text, provider, level, partNumber, hasVisual);
  return formatCandidateText(withoutDescription);
};

const separatePartHeading = (text, fallbackTitle) => {
  const lines = String(text || "").split("\n");
  const firstLine = lines[0]?.trim() || "";
  if (!/^(?:TEIL|Teil|Aufgabe)\s+\d+\b/.test(firstLine)) {
    return { title: fallbackTitle, text: String(text || "").trim() };
  }
  return { title: firstLine, text: lines.slice(1).join("\n").trim() };
};

const buildVisualPresentation = (text) => {
  const lines = String(text || "").trim().split("\n");
  const taskIndex = lines.findIndex((line) => /^(?:Aufgabe|Zusatzfrage|Redemittel)\b\s*:?/i.test(line.trim()));
  const splitAt = taskIndex >= 0 ? taskIndex : lines.length;
  return {
    kind: "visual_stimulus",
    intro: lines.slice(0, splitAt).join("\n").trim(),
    outro: lines.slice(splitAt).join("\n").trim(),
  };
};

const buildPairedPresentation = (text) => {
  const source = String(text || "").trim();
  const lines = source.split("\n");
  const roleIndexes = lines
    .map((line, index) => (/^(?:Kandidat(?:in)?\s+[AB]|Position\s+[AB])\s*:/i.test(line.trim()) ? index : -1))
    .filter((index) => index >= 0);
  if (roleIndexes.length !== 2) return null;

  const firstIndex = roleIndexes[0];
  const secondIndex = roleIndexes[1];
  let outroIndex = lines.findIndex((line, index) => index > secondIndex && /^Redemittel\s+für\s+die\s+Diskussion\s*:/i.test(line.trim()));
  if (outroIndex < 0) outroIndex = lines.length;
  const splitCard = (from, to) => {
    const label = lines[from].trim().replace(/\s*:\s*$/, "");
    return { label, text: lines.slice(from + 1, to).join("\n").trim() };
  };

  return {
    kind: "paired_roles",
    intro: lines.slice(0, firstIndex).join("\n").trim(),
    cards: [splitCard(firstIndex, secondIndex), splitCard(secondIndex, outroIndex)],
    outro: lines.slice(outroIndex).join("\n").trim(),
  };
};

const assetLookup = () => {
  const manifest = readJson("assets/assets_manifest.json");
  const map = new Map();
  for (const asset of manifest.assets || []) {
    map.set(asset.id, {
      ...asset,
      publicUrl: `${PUBLIC_ASSET_PREFIX}/${asset.path.replace(/^assets[\\/]/, "").replace(/\\/g, "/")}`,
    });
  }
  return { manifest, map };
};

const shouldAttachAssetToPart = (provider, level, partNumber, visualAssets) =>
  visualAssets.length > 0 && partNumber === getRequiredVisualPart(provider, level);

async function upsertProfile(client, profile) {
  const profileKey = `${profile.provider}_${profile.level}`.toLowerCase();
  await client.query(
    `INSERT INTO speaking_provider_profiles (profile_key, provider, level, version, profile, is_active, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, TRUE, NOW())
     ON CONFLICT (profile_key) DO UPDATE SET
       provider = EXCLUDED.provider,
       level = EXCLUDED.level,
       version = EXCLUDED.version,
       profile = EXCLUDED.profile,
       is_active = TRUE,
       updated_at = NOW()`,
    [profileKey, profile.provider, profile.level, PROFILE_VERSION, JSON.stringify(profile)]
  );
}

async function upsertImportRecord(client, pack, report) {
  const packKey = `speaking_${pack.provider}_${pack.level}`.toLowerCase();
  const documentHash = crypto
    .createHash("sha256")
    .update(`Sprechen_B1_B2_Project_Package:${PACKAGE_VERSION}:${pack.provider}:${pack.level}`)
    .digest("hex");
  const inserted = await client.query(
    `INSERT INTO exam_document_imports (
       document_hash, filename, mime_type, exam_type, level, provider, section_type,
       total_series, total_sections, total_questions, parse_status, validation_warnings,
       draft_content, confidence, published_at, updated_at
     )
     VALUES ($1, $2, 'application/json', $3, $4, $5, 'speak', 20, $6, $7, 'published', '[]'::jsonb,
             $8::jsonb, $9::jsonb, NOW(), NOW())
     ON CONFLICT (document_hash) DO UPDATE SET
       filename = EXCLUDED.filename,
       total_series = EXCLUDED.total_series,
       total_sections = EXCLUDED.total_sections,
       total_questions = EXCLUDED.total_questions,
       parse_status = 'published',
       validation_warnings = '[]'::jsonb,
       draft_content = EXCLUDED.draft_content,
       confidence = EXCLUDED.confidence,
       published_at = NOW(),
       updated_at = NOW()
     RETURNING id`,
    [
      documentHash,
      `${packKey}.json`,
      `${pack.provider.toUpperCase()} ${pack.level}`,
      pack.level,
      pack.provider,
      report.sections,
      report.questions,
      JSON.stringify({ packageVersion: PACKAGE_VERSION, report }),
      JSON.stringify({ sourceLocked: true, importedSeries: 20 }),
    ]
  );
  return inserted.rows[0].id;
}

async function importPack(client, relativeFile, assets) {
  const pack = readJson(`content/${relativeFile}`);
  const profile = PROFILE_DEFINITIONS[`${pack.provider}_${pack.level}`];
  if (!profile) throw new Error(`Missing profile for ${pack.provider}_${pack.level}`);
  await upsertProfile(client, profile);

  const prepared = [];
  for (const series of pack.series || []) {
    const text = splitCandidateAndPrivateText(pack, series);
    const requestedVisualIds = series.visual_asset_ids || [];
    const visualAssets = requestedVisualIds.map((id) => assets.map.get(id)).filter(Boolean);
    if (visualAssets.length !== requestedVisualIds.length) {
      const foundIds = new Set(visualAssets.map((asset) => asset.id));
      const missingIds = requestedVisualIds.filter((id) => !foundIds.has(id));
      throw new Error(`${series.id}: missing required visual assets: ${missingIds.join(", ")}`);
    }
    for (const asset of visualAssets) {
      const assetPath = path.join(PACKAGE_DIR, asset.path);
      if (!fs.existsSync(assetPath)) throw new Error(`${series.id}: required visual file is missing: ${asset.path}`);
    }
    const candidateText = prepareCandidateText(text.candidateText, pack.provider, pack.level);
    const parts = splitParts(candidateText, profile).map((part) => {
      const sourceTextVerbatim = part.text;
      const formattedText = preparePartPresentation({
        text: part.text,
        provider: pack.provider,
        level: pack.level,
        partNumber: part.partNumber,
        hasVisual: visualAssets.length > 0,
      });
      const separated = separatePartHeading(formattedText, part.title);
      const hasPartVisual = shouldAttachAssetToPart(pack.provider, pack.level, part.partNumber, visualAssets);
      return {
        ...part,
        title: separated.title,
        sourceTextVerbatim,
        text: separated.text,
        presentation: hasPartVisual ? buildVisualPresentation(separated.text) : buildPairedPresentation(separated.text),
      };
    });
    prepared.push({ series, text, visualAssets, parts });
  }

  const report = {
    packageVersion: PACKAGE_VERSION,
    provider: pack.provider,
    level: pack.level,
    series: prepared.length,
    sections: prepared.reduce((sum, item) => sum + item.parts.length, 0),
    questions: prepared.reduce((sum, item) => sum + item.parts.length, 0),
    visualAssets: prepared.reduce((sum, item) => sum + item.visualAssets.length, 0),
    sourceLocked: true,
    correctionsVisibility: "after_final_submission_only",
  };
  const importId = await upsertImportRecord(client, pack, report);
  const importedExamIds = [];

  for (const item of prepared) {
    const { series, text, visualAssets, parts } = item;
    const seriesNumber = Number(series.number);
    const code = `speaking_pkg_${pack.provider}_${pack.level.toLowerCase()}_${String(seriesNumber).padStart(2, "0")}`;
    const title = `${pack.provider.toUpperCase()} ${pack.level} Sprechen - ${series.title}`;
    const examMetadata = {
      title: series.title,
      sourceLabel: `${pack.provider.toUpperCase()} ${pack.level} Sprechen ${String(seriesNumber).padStart(2, "0")}`,
      package: "Sprechen_B1_B2_Project_Package",
      packageVersion: PACKAGE_VERSION,
      stableId: series.id,
      sourceLocked: true,
      variant: profile.variant,
      profileVersion: PROFILE_VERSION,
      officialProfileVersion: PROFILE_VERSION,
      correctionHiddenUntilSubmit: true,
      visualAssetIds: series.visual_asset_ids || [],
      visualAssets,
      sourceFiles: pack.source_files || [],
      contentPolicy: pack.content_policy || {},
      globalDurationMinutes: Math.ceil(profile.sessionSeconds / 60),
      speakingProfile: profile,
    };
    const exam = await client.query(
      `INSERT INTO exams (
         code, name, exam_type, level, is_active, provider, section_type,
         series_number, source_import_id, metadata, updated_at
       )
       VALUES ($1, $2, $3, $4, TRUE, $5, 'speak', $6, $7, $8::jsonb, NOW())
       ON CONFLICT (code) DO UPDATE SET
         name = EXCLUDED.name,
         exam_type = EXCLUDED.exam_type,
         level = EXCLUDED.level,
         is_active = TRUE,
         provider = EXCLUDED.provider,
         section_type = 'speak',
         series_number = EXCLUDED.series_number,
         source_import_id = EXCLUDED.source_import_id,
         metadata = EXCLUDED.metadata,
         updated_at = NOW()
       RETURNING id`,
      [
        code,
        title,
        `${pack.provider.toUpperCase()} ${pack.level}`,
        pack.level,
        pack.provider,
        seriesNumber,
        importId,
        JSON.stringify(examMetadata),
      ]
    );
    const examId = exam.rows[0].id;
    importedExamIds.push(examId);
    await client.query(`DELETE FROM exam_questions WHERE exam_id = $1`, [examId]);
    await client.query(`DELETE FROM exam_sections WHERE exam_id = $1`, [examId]);

    for (const [index, part] of parts.entries()) {
      const attachedAssets = shouldAttachAssetToPart(pack.provider, pack.level, part.partNumber, visualAssets) ? visualAssets : [];
      const sectionMetadata = {
        package: "Sprechen_B1_B2_Project_Package",
        sourceLocked: true,
        stableId: `${series.id}_part_${part.partNumber}`,
        profileVersion: PROFILE_VERSION,
        variant: profile.variant,
        prepSeconds: part.prepSeconds,
        responseSeconds: part.responseSeconds,
        visualAssets: attachedAssets,
        presentation: part.presentation,
        presentationVersion: PROFILE_VERSION,
        privateCorrectionAvailable: Boolean(text.privateText),
      };
      const section = await client.query(
        `INSERT INTO exam_sections (
           exam_id, section_type, part_number, title, instructions, duration_minutes,
           points, scoring, metadata, position
         )
         VALUES ($1, 'speak', $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb, $9)
         RETURNING id`,
        [
          examId,
          part.partNumber,
          part.title,
          part.text,
          part.durationMinutes,
          part.points,
          JSON.stringify({ rawMax: profile.rawMax, partPoints: part.points, rubricVersion: PROFILE_VERSION }),
          JSON.stringify(sectionMetadata),
          index + 1,
        ]
      );
      await client.query(
        `INSERT INTO exam_questions (
           exam_id, section_id, module_id, prompt, options, correct_answer,
           explanation, position, question_type, scoring, source_metadata
         )
         VALUES ($1, $2, 'speak', $3, '[]'::jsonb, $4::jsonb, NULL, $5, $6, $7::jsonb, $8::jsonb)`,
        [
          examId,
          section.rows[0].id,
          part.text,
          JSON.stringify({
            privateCorrectionText: text.privateText,
            fullSourceTextVerbatim: text.sourceText,
            partSourceTextVerbatim: part.sourceTextVerbatim,
            visibility: "after_final_submission_only",
          }),
          index + 1,
          part.points > 0 ? "speaking_assessed_part" : "speaking_warmup",
          JSON.stringify({
            points: part.points,
            durationMinutes: part.durationMinutes,
            prepSeconds: part.prepSeconds,
            responseSeconds: part.responseSeconds,
            rubricVersion: PROFILE_VERSION,
          }),
          JSON.stringify({
            package: "Sprechen_B1_B2_Project_Package",
            sourceLocked: true,
            stableId: `${series.id}_part_${part.partNumber}`,
            sourceQuestionNumber: part.partNumber,
            visualAssets: attachedAssets,
            visualAssetIds: attachedAssets.map((asset) => asset.id),
            presentation: part.presentation,
            presentationVersion: PROFILE_VERSION,
            prepSeconds: part.prepSeconds,
            responseSeconds: part.responseSeconds,
            variant: profile.variant,
          }),
        ]
      );
    }
  }

  await client.query(
    `INSERT INTO speaking_content_packs (
       pack_key, provider, level, package_version, manifest, imported_exam_ids,
       import_report, status, updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, 'published', NOW())
     ON CONFLICT (pack_key) DO UPDATE SET
       manifest = EXCLUDED.manifest,
       imported_exam_ids = EXCLUDED.imported_exam_ids,
       import_report = EXCLUDED.import_report,
       status = 'published',
       updated_at = NOW()`,
    [
      `speaking_${pack.provider}_${pack.level}`.toLowerCase(),
      pack.provider,
      pack.level,
      PACKAGE_VERSION,
      JSON.stringify({ sourceFiles: pack.source_files, contentPolicy: pack.content_policy }),
      JSON.stringify(importedExamIds),
      JSON.stringify(report),
    ]
  );

  return { ...report, importedExamIds };
}

async function main() {
  if (!fs.existsSync(PACKAGE_DIR)) throw new Error(`Package not found: ${PACKAGE_DIR}`);
  const assets = assetLookup();
  await ensureDocumentImportSchema(pool);
  await ensureSpeakingCorrectionSchema(pool);
  const reports = [];
  for (const file of CONTENT_FILES) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const report = await importPack(client, file, assets);
      await client.query("COMMIT");
      reports.push(report);
      console.error(`[speaking-import] ${file}: ${report.series} series, ${report.sections} sections, ${report.questions} questions`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ ok: true, packageVersion: PACKAGE_VERSION, reports }, null, 2));
}

if (require.main === module) {
  main()
    .catch((err) => {
      console.error(err);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}

module.exports = {
  CONTENT_FILES,
  PROFILE_DEFINITIONS,
  assetLookup,
  buildPairedPresentation,
  buildVisualPresentation,
  formatCandidateText,
  getRequiredVisualPart,
  prepareCandidateText,
  preparePartPresentation,
  separatePartHeading,
  shouldAttachAssetToPart,
  splitCandidateAndPrivateText,
  splitParts,
};
