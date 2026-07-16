const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const pool = require("../db");
const { ensureDocumentImportSchema } = require("../services/documentImport");
const { ensureSpeakingCorrectionSchema } = require("../services/speakingCorrection");

const PACKAGE_DIR = path.resolve(__dirname, "..", "..", "Sprechen_B1_B2_Project_Package");
const PUBLIC_ASSET_PREFIX = "/speaking-assets";
const PACKAGE_VERSION = "2.0.0";
const PROFILE_VERSION = "2026-07-source-faithful-v1";

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

const shouldAttachAssetToPart = (partText, partNumber, visualAssets) => {
  if (!visualAssets.length) return false;
  if (/bild|photo|foto|montage|bildimpuls|bildmaterial/i.test(partText)) return true;
  return partNumber === 2 || partNumber === 3;
};

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
    const visualAssets = (series.visual_asset_ids || []).map((id) => assets.map.get(id)).filter(Boolean);
    const parts = splitParts(text.candidateText, profile);
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
      const attachedAssets = shouldAttachAssetToPart(part.text, part.partNumber, visualAssets) ? visualAssets : [];
      const sectionMetadata = {
        package: "Sprechen_B1_B2_Project_Package",
        sourceLocked: true,
        stableId: `${series.id}_part_${part.partNumber}`,
        profileVersion: PROFILE_VERSION,
        variant: profile.variant,
        prepSeconds: part.prepSeconds,
        responseSeconds: part.responseSeconds,
        visualAssets: attachedAssets,
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

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
