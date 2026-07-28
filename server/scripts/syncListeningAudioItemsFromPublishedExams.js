const pool = require("../db");

const asObject = (value) => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value;
};

const compactText = (value = "") => String(value || "").replace(/\s+/g, " ").trim();

const main = async () => {
  const level = (process.argv.find((arg) => arg.startsWith("--level=")) || "--level=B2").split("=")[1].toUpperCase();
  const providerArg = (process.argv.find((arg) => arg.startsWith("--provider=")) || "").split("=")[1] || "";
  const providers = providerArg
    ? providerArg.split(",").map((provider) => provider.trim().toLowerCase()).filter(Boolean)
    : ["goethe", "telc", "ecl", "osd"];
  const includeInactive = process.argv.includes("--include-inactive");
  const queueForGeneration = process.argv.includes("--queue-for-generation");
  const seriesArg = (process.argv.find((arg) => arg.startsWith("--series=")) || "").split("=")[1] || "";
  const seriesMatch = seriesArg.match(/^(\d+)(?:-(\d+))?$/);
  const seriesFrom = seriesMatch ? Number(seriesMatch[1]) : null;
  const seriesTo = seriesMatch ? Number(seriesMatch[2] || seriesMatch[1]) : null;

  const exams = await pool.query(
    `SELECT *
       FROM exams
      WHERE ($3::boolean = TRUE OR is_active = TRUE)
        AND level = $1
        AND section_type = 'listen'
        AND provider = ANY($2::text[])
        AND ($4::int IS NULL OR series_number BETWEEN $4 AND $5)
      ORDER BY provider, series_number, id`,
    [level, providers, includeInactive, seriesFrom, seriesTo]
  );

  const synced = [];
  for (const exam of exams.rows) {
    const sections = await pool.query(
      `SELECT *
         FROM exam_sections
        WHERE exam_id = $1
        ORDER BY position, id`,
      [exam.id]
    );
    const questions = await pool.query(
      `SELECT id, section_id, position, transcript, audio, source_metadata
         FROM exam_questions
        WHERE exam_id = $1
        ORDER BY position, id`,
      [exam.id]
    );
    const questionsBySection = new Map();
    questions.rows.forEach((question) => {
      if (!questionsBySection.has(question.section_id)) questionsBySection.set(question.section_id, []);
      questionsBySection.get(question.section_id).push(question);
    });

    for (const section of sections.rows) {
      const partNumber = Number(section.part_number) || Number(section.position) || 1;
      const grouped = new Map();
      (questionsBySection.get(section.id) || []).forEach((question) => {
        const source = asObject(question.source_metadata);
        const itemNumber = Number(source.audioItemNumber || source.itemNumber || source.textNumber || 1) || 1;
        if (!grouped.has(itemNumber)) grouped.set(itemNumber, []);
        grouped.get(itemNumber).push(question);
      });

      for (const [itemNumber, itemQuestions] of grouped.entries()) {
        const firstQuestion = itemQuestions.find((question) => compactText(question.transcript) || compactText(asObject(question.audio).transcript)) || itemQuestions[0];
        const audio = asObject(firstQuestion?.audio);
        const transcript = compactText(firstQuestion?.transcript || audio.transcript);
        if (transcript.length < 20) continue;
        const audioSettings = {
          ...asObject(audio.audioEngineSettings),
          browserTtsFallback: !queueForGeneration,
          fallbackEngine: queueForGeneration ? "" : "browser-speech",
          generationProvider: queueForGeneration ? "elevenlabs" : "",
          generationStatus: queueForGeneration ? "queued" : "published",
          productionLabel: queueForGeneration ? "ElevenLabs MP3 queued" : "Browser TTS (no MP3)",
        };
        const title = itemQuestions.length > 1
          ? `${section.title || `Teil ${partNumber}`} - Audio ${itemNumber}`
          : (section.title || `Teil ${partNumber}`);
        const publicationStatus = queueForGeneration ? "queued" : (exam.is_active ? "published" : "draft");
        const adminNotes = queueForGeneration ? "ElevenLabs MP3 generation queued" : "Browser TTS (no MP3)";
        const validationWarnings = queueForGeneration
          ? []
          : ["Browser TTS fallback is active until ElevenLabs MP3 generation is available."];
        const speakerProfiles = Array.isArray(audioSettings.speakers) ? audioSettings.speakers : [];
        const result = await pool.query(
          `INSERT INTO exam_listening_audio_items (
             exam_id, section_id, source_import_id, provider, level, series_number,
             part_number, item_number, title, instructions, admin_transcript,
             audio_engine_settings, listening_count, audio_generation_status,
             generated_audio_url, generated_audio_asset_id, admin_notes,
             validation_warnings, source_metadata, voice_profile_map, position, updated_at
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13,
                   $14, '', NULL, $15, $16::jsonb, $17::jsonb, $18::jsonb, $19, NOW())
           ON CONFLICT (exam_id, part_number, item_number)
           DO UPDATE SET
             section_id = EXCLUDED.section_id,
             source_import_id = EXCLUDED.source_import_id,
             provider = EXCLUDED.provider,
             level = EXCLUDED.level,
             series_number = EXCLUDED.series_number,
             title = EXCLUDED.title,
             instructions = EXCLUDED.instructions,
             admin_transcript = EXCLUDED.admin_transcript,
             audio_engine_settings = EXCLUDED.audio_engine_settings,
             listening_count = EXCLUDED.listening_count,
             audio_generation_status = EXCLUDED.audio_generation_status,
             generated_audio_url = '',
             generated_audio_asset_id = NULL,
             admin_notes = EXCLUDED.admin_notes,
             validation_warnings = EXCLUDED.validation_warnings,
             source_metadata = EXCLUDED.source_metadata,
             voice_profile_map = EXCLUDED.voice_profile_map,
             position = EXCLUDED.position,
             updated_at = NOW()
           RETURNING id`,
          [
            exam.id,
            section.id,
            exam.source_import_id || null,
            exam.provider || null,
            exam.level || null,
            Number(exam.series_number) || null,
            partNumber,
            itemNumber,
            title,
            "Hören Sie den Audiotext und beantworten Sie die Aufgaben zu diesem Teil.",
            transcript,
            JSON.stringify(audioSettings),
            Number(audio.listeningCount || asObject(section.metadata).listeningCount || 2),
            publicationStatus,
            adminNotes,
            JSON.stringify(validationWarnings),
            JSON.stringify({
              source: "published-exam-content",
              sourceImportId: exam.source_import_id || null,
              browserTtsFallback: !queueForGeneration,
              fallbackEngine: queueForGeneration ? "" : "browser-speech",
              generationProvider: queueForGeneration ? "elevenlabs" : "",
              productionLabel: queueForGeneration ? "ElevenLabs MP3 queued" : "Browser TTS (no MP3)",
              publicationStatus,
            }),
            JSON.stringify(speakerProfiles),
            (partNumber * 100) + itemNumber,
          ]
        );
        synced.push(result.rows[0].id);
      }
    }
  }

  const summary = await pool.query(
    `SELECT provider, level,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE audio_generation_status = 'published')::int AS published,
            COUNT(*) FILTER (WHERE COALESCE(source_metadata->>'browserTtsFallback', 'false') = 'true')::int AS browser_tts
       FROM exam_listening_audio_items
      WHERE level = $1
        AND provider = ANY($2::text[])
      GROUP BY provider, level
      ORDER BY provider`,
    [level, providers]
  );

  console.log(JSON.stringify({
    ok: true,
    level,
    providers,
    includeInactive,
    queueForGeneration,
    series: seriesArg || "all",
    synced: synced.length,
    summary: summary.rows,
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
