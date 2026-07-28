require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const mammoth = require("mammoth");
const pool = require("../db");
const { analyzeExamDocument } = require("../services/documentImport");

const SOURCE_DIR = path.resolve(__dirname, "..", "..", "OSD B2 HOREN");
const COMPLETE_SOURCE = path.join(SOURCE_DIR, "OSD_B2_Hoeren_20_Modellpruefungen_COMPLETE_RESTRUCTURED_Admin_Codex.docx");
const CONTINUATION_SOURCE = path.join(SOURCE_DIR, "OSD_B2_Hoeren_Series_08_to_20_RESTRUCTURED_Admin_Codex.docx");
const MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

const fail = (message) => {
  throw new Error(message);
};

const normalizedBlock = (value) => String(value || "")
  .replace(/\r/g, "")
  .replace(/[ \t]+$/gm, "")
  .trim();

const extractSeriesBlocks = (text) => {
  const matches = [...String(text || "").matchAll(
    /(?:^|\n)PR(?:\u00dc|UE)FUNG\s+(\d{2})\s*\/\s*(?:\u00d6SD|OESD|OSD)\s+B2\s*[-\u2010-\u2015]\s*([^\n]+)/gu
  )];
  return new Map(matches.map((match, index) => [
    Number(match[1]),
    normalizedBlock(String(text).slice(match.index + (match[0].startsWith("\n") ? 1 : 0), matches[index + 1]?.index ?? text.length)),
  ]));
};

const validateAuthoritativeSources = async () => {
  const [complete, continuation] = await Promise.all([
    mammoth.extractRawText({ path: COMPLETE_SOURCE }),
    mammoth.extractRawText({ path: CONTINUATION_SOURCE }),
  ]);
  const completeBlocks = extractSeriesBlocks(complete.value);
  const continuationBlocks = extractSeriesBlocks(continuation.value);
  if (completeBlocks.size !== 20) fail(`Complete source contains ${completeBlocks.size} series instead of 20.`);
  if (continuationBlocks.size !== 13) fail(`Continuation source contains ${continuationBlocks.size} series instead of 13.`);

  for (let seriesNumber = 8; seriesNumber <= 20; seriesNumber += 1) {
    const completeBlock = completeBlocks.get(seriesNumber);
    const continuationBlock = continuationBlocks.get(seriesNumber);
    if (!completeBlock || !continuationBlock) fail(`Series ${seriesNumber} is missing from an authoritative source.`);
    const completeHash = crypto.createHash("sha256").update(completeBlock).digest("hex");
    const continuationHash = crypto.createHash("sha256").update(continuationBlock).digest("hex");
    if (completeHash !== continuationHash) fail(`Series ${seriesNumber} differs between the two source documents.`);
  }
};

const parseContinuation = async () => {
  const buffer = fs.readFileSync(CONTINUATION_SOURCE);
  return analyzeExamDocument({
    buffer,
    filename: path.basename(CONTINUATION_SOURCE),
    mimetype: MIME,
  });
};

const validateParsedContent = (parsed) => {
  if (parsed.metadata.provider !== "osd" || parsed.metadata.level !== "B2" || parsed.metadata.sectionType !== "listen") {
    fail("Continuation metadata was not detected as OSD B2 listening.");
  }
  if (parsed.series.length !== 13) fail(`Parsed ${parsed.series.length} continuation series instead of 13.`);
  if (parsed.validation.questionCount !== 520) fail(`Parsed ${parsed.validation.questionCount} questions instead of 520.`);
  if (parsed.validation.warnings.length) fail(`Parser warnings: ${parsed.validation.warnings.join(" | ")}`);

  parsed.series.forEach((series, index) => {
    const expectedNumber = index + 8;
    if (series.seriesNumber !== expectedNumber) fail(`Expected Series ${expectedNumber}, found ${series.seriesNumber}.`);
    if (series.sections.length !== 2) fail(`Series ${expectedNumber} has ${series.sections.length} sections.`);
    const part1 = series.sections.find((section) => section.partNumber === 1);
    const part2 = series.sections.find((section) => section.partNumber === 2);
    if (!part1 || !part2) fail(`Series ${expectedNumber} is missing Teil 1 or Teil 2.`);
    if (part1.questions.length !== 10 || part1.questions.some((question) => question.questionType !== "true_false")) {
      fail(`Series ${expectedNumber} Teil 1 is not exactly 10 Richtig/Falsch items.`);
    }
    if (part2.questions.length !== 30 || part2.questions.some((question) => question.questionType !== "blank")) {
      fail(`Series ${expectedNumber} Teil 2 is not exactly 30 note-completion items.`);
    }
    if ([...part1.questions, ...part2.questions].some((question) => !String(question.correctAnswer?.value ?? "").trim())) {
      fail(`Series ${expectedNumber} contains an item without a correction.`);
    }
    if (Number(part1.points) !== 10 || Number(part2.points) !== 10 || Number(series.scoring.totalPoints) !== 20) {
      fail(`Series ${expectedNumber} does not use the 10 + 10 = 20 scoring model.`);
    }
    if (!part2.metadata?.osdB2HoerenTeil2 || part2.metadata.osdB2HoerenTeil2.itemCount !== 30) {
      fail(`Series ${expectedNumber} Teil 2 is missing the information-sheet UI metadata.`);
    }

    [part1, part2].forEach((section) => {
      if (section.audioItems.length !== 1) fail(`Series ${expectedNumber} Teil ${section.partNumber} has the wrong audio-item count.`);
      const item = section.audioItems[0];
      const expectedVoices = section.partNumber === 1 ? 2 : 1;
      if (!item.adminTranscript || /STUDENT_VISIBLE|CORRECTION_VISIBLE|AUDIO_ENGINE_SETTINGS|SPEAKER_PROFILES_SOURCE|SOUND_EFFECTS_SOURCE/i.test(item.adminTranscript)) {
        fail(`Series ${expectedNumber} Teil ${section.partNumber} transcript is missing or leaks another marker block.`);
      }
      if (/(?:\u00d6SD|OESD|OSD)\s+B2\s*[-\u2010-\u2015]\s*Modul\s+H(?:\u00d6|OE|O)REN\s+\d{1,3}/iu.test(item.adminTranscript)) {
        fail(`Series ${expectedNumber} Teil ${section.partNumber} transcript contains a PDF page header.`);
      }
      if (item.audioEngineSettings.speakerCount !== expectedVoices || item.audioEngineSettings.speakers.length !== expectedVoices) {
        fail(`Series ${expectedNumber} Teil ${section.partNumber} has ${item.audioEngineSettings.speakerCount} voices instead of ${expectedVoices}.`);
      }
      if (item.audioEngineSettings.speakers.some((speaker) => !speaker.speaker || !speaker.sourceName || !speaker.suggestedGender || !speaker.style)) {
        fail(`Series ${expectedNumber} Teil ${section.partNumber} has incomplete speaker metadata.`);
      }
      if (!item.audioEngineSettings.soundEffects || item.audioEngineSettings.generationProvider !== "elevenlabs" || item.audioEngineSettings.fallbackEngine) {
        fail(`Series ${expectedNumber} Teil ${section.partNumber} is missing sound directions or its ElevenLabs generation plan.`);
      }
      if (item.audioEngineSettings.generatedAudioUrl) fail(`Series ${expectedNumber} unexpectedly contains generated audio.`);
    });

    const visibleText = [...part1.questions, ...part2.questions].map((question) => question.prompt).join("\n");
    if (/(?:\u00d6SD|OESD|OSD)\s+B2\s*[-\u2010-\u2015]\s*Modul\s+H(?:\u00d6|OE|O)REN\s+\d+/iu.test(visibleText)) {
      fail(`Series ${expectedNumber} still contains a PDF page header.`);
    }
    if (series.metadata.publicationStatus !== "published") {
      fail(`Series ${expectedNumber} should be publishable.`);
    }
    if (expectedNumber === 20 && (!series.metadata.sourceValidationWarning || series.metadata.correctionPublicationOverride !== "approved-by-project-owner")) {
      fail("Series 20 must retain its source warning and explicit publication approval.");
    }
  });
};

const validateDatabase = async (expectGenerated = false) => {
  const exams = await pool.query(
    `SELECT e.id, e.series_number, e.is_active, e.metadata,
            COUNT(DISTINCT s.id)::int AS sections,
            COUNT(DISTINCT q.id)::int AS questions
      FROM exams e
      JOIN exam_document_imports i ON i.id = e.source_import_id
       LEFT JOIN exam_sections s ON s.exam_id = e.id
       LEFT JOIN exam_questions q ON q.exam_id = e.id
      WHERE i.id = (SELECT MAX(id) FROM exam_document_imports WHERE filename = $1)
      GROUP BY e.id
      ORDER BY e.series_number`,
    [path.basename(CONTINUATION_SOURCE)]
  );
  if (exams.rows.length !== 13) fail(`Database contains ${exams.rows.length} imported continuation exams instead of 13.`);
  exams.rows.forEach((exam, index) => {
    const expectedNumber = index + 8;
    if (Number(exam.series_number) !== expectedNumber || exam.sections !== 2 || exam.questions !== 40) {
      fail(`Database Series ${expectedNumber} has an invalid structure.`);
    }
    if (!exam.is_active) {
      fail(`Database Series ${expectedNumber} has the wrong publication state.`);
    }
  });

  const audio = await pool.query(
    `SELECT a.series_number, a.part_number, a.audio_generation_status, a.generated_audio_url,
            a.generated_audio_asset_id,
            a.audio_engine_settings, a.voice_profile_map
      FROM exam_listening_audio_items a
      JOIN exam_document_imports i ON i.id = a.source_import_id
      WHERE i.id = (SELECT MAX(id) FROM exam_document_imports WHERE filename = $1)
      ORDER BY a.series_number, a.part_number`,
    [path.basename(CONTINUATION_SOURCE)]
  );
  if (audio.rows.length !== 26) fail(`Database contains ${audio.rows.length} continuation audio items instead of 26.`);
  audio.rows.forEach((item) => {
    const expectedVoices = Number(item.part_number) === 1 ? 2 : 1;
    const expectedStatus = expectGenerated ? "published" : "queued";
    if (item.audio_generation_status !== expectedStatus) {
      fail(`Series ${item.series_number} Teil ${item.part_number} has the wrong audio lifecycle.`);
    }
    if (expectGenerated ? (!item.generated_audio_url || !item.generated_audio_asset_id) : (item.generated_audio_url || item.generated_audio_asset_id)) {
      fail(`Series ${item.series_number} Teil ${item.part_number} has the wrong MP3 asset state.`);
    }
    if (item.audio_engine_settings?.fallbackEngine || item.audio_engine_settings?.generationProvider !== "elevenlabs" || item.voice_profile_map?.length !== expectedVoices) {
      fail(`Series ${item.series_number} Teil ${item.part_number} has incomplete ElevenLabs voice metadata.`);
    }
    const voiceIds = (item.voice_profile_map || []).map((speaker) => speaker.voiceId).filter(Boolean);
    if (expectGenerated && (voiceIds.length !== expectedVoices || new Set(voiceIds).size !== voiceIds.length)) {
      fail(`Series ${item.series_number} Teil ${item.part_number} does not use distinct generated voices.`);
    }
  });
};

const validateApi = async (baseUrl, expectGenerated = false, parsed = null) => {
  for (let seriesNumber = 1; seriesNumber <= 20; seriesNumber += 1) {
    const code = String(seriesNumber).padStart(2, "0");
    const response = await fetch(`${baseUrl}/api/exams/osd-b2/series/imported-osd-b2-series-${code}/listen`);
    if (!response.ok) fail(`Series ${code} API returned HTTP ${response.status}.`);
    const payload = await response.json();
    const content = payload.content;
    const part1 = content.tasks.filter((task) => Number(task.partNumber) === 1);
    const part2 = content.tasks.filter((task) => Number(task.partNumber) === 2);
    if (!content.available || content.parts.length !== 2 || part1.length !== 10 || part2.length !== 30) {
      fail(`Series ${code} API does not expose the expected 10 + 30 structure.`);
    }
    if (part1.some((task) => task.type !== "trueFalse") || part2.some((task) => task.type !== "blank")) {
      fail(`Series ${code} API exposes an incorrect question type.`);
    }
    if (seriesNumber >= 8) {
      const expectedSeries = parsed?.series?.find((series) => series.seriesNumber === seriesNumber);
      const expectedPart1 = expectedSeries?.sections?.find((section) => section.partNumber === 1)?.questions || [];
      const expectedPart2 = expectedSeries?.sections?.find((section) => section.partNumber === 2)?.questions || [];
      if (expectedPart1.length !== 10 || expectedPart2.length !== 30) {
        fail(`Series ${code} has no complete authoritative prompt set for API validation.`);
      }
      [
        [1, part1, expectedPart1],
        [2, part2, expectedPart2],
      ].forEach(([partNumber, actualTasks, expectedQuestions]) => {
        actualTasks.forEach((task, index) => {
          const expectedPrompt = String(expectedQuestions[index]?.prompt || "").trim();
          const actualPrompt = String(task.question || "").trim();
          if (actualPrompt !== expectedPrompt) {
            fail(`Series ${code} Teil ${partNumber} item ${index + 1} does not match the authoritative document.`);
          }
          if (/^H\u00f6ren Sie den Audiotext und beantworten Sie die Aufgaben zu diesem Teil\./i.test(actualPrompt)) {
            fail(`Series ${code} Teil ${partNumber} item ${index + 1} still contains the generic API prefix.`);
          }
          if (/^Aufgabe\s+2:\s*NOTIZEN\s+VERVOLLST\u00c4NDIGEN$/i.test(actualPrompt)) {
            fail(`Series ${code} Teil ${partNumber} item ${index + 1} exposes the section heading instead of its question.`);
          }
        });
      });
      if (part1[0]?.audio?.fallbackEngine || part1[0]?.audio?.speakers?.length !== 2) {
        fail(`Series ${code} Teil 1 ElevenLabs voice plan is incomplete.`);
      }
      if (part2[0]?.audio?.fallbackEngine || part2[0]?.audio?.speakers?.length !== 1) {
        fail(`Series ${code} Teil 2 ElevenLabs voice plan is incomplete.`);
      }
      if (expectGenerated && (!part1[0]?.audio?.audioUrl || !part2[0]?.audio?.audioUrl)) {
        fail(`Series ${code} does not expose both generated MP3 assets.`);
      }
      if (!content.parts[1]?.sourceMetadata?.osdB2HoerenTeil2) {
        fail(`Series ${code} Teil 2 is missing its responsive information-sheet UI contract.`);
      }
    }
  }
};

const main = async () => {
  await validateAuthoritativeSources();
  const parsed = await parseContinuation();
  validateParsedContent(parsed);
  const expectGenerated = process.argv.includes("--expect-generated");
  if (process.argv.includes("--db")) await validateDatabase(expectGenerated);
  const apiArg = process.argv.find((arg) => arg.startsWith("--api="));
  const apiBaseUrl = apiArg ? apiArg.slice("--api=".length).replace(/\/$/, "") : "";
  if (apiBaseUrl) await validateApi(apiBaseUrl, expectGenerated, parsed);
  console.log(JSON.stringify({
    ok: true,
    sourceSeriesMatched: 13,
    series: parsed.series.length,
    sections: parsed.validation.sectionCount,
    questions: parsed.validation.questionCount,
    browserTtsAudioItems: 0,
    generatedMp3: expectGenerated ? 26 : 0,
    databaseChecked: process.argv.includes("--db"),
    apiChecked: Boolean(apiBaseUrl),
  }, null, 2));
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end().catch(() => {});
  });
