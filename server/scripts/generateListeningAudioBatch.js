const pool = require("../db");
const {
  generateAndStoreExamAudio,
  getVoiceProfiles,
  parseSpeakerSegments,
  stripProductionMarkers,
} = require("../services/ttsService");

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const foldPlain = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const parseArgs = () => {
  const positional = [];
  const flags = {};
  process.argv.slice(2).forEach((arg) => {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      return;
    }
    const [rawKey, ...rawValue] = arg.slice(2).split("=");
    const key = rawKey.trim();
    flags[key] = rawValue.length ? rawValue.join("=") : true;
  });
  return { positional, flags };
};

const parseList = (value, fallback = []) => {
  if (value === true || value === undefined || value === null || value === "") return fallback;
  return String(value)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
};

const normalizeKind = (value) => {
  const normalized = foldPlain(value).replace(/[^a-z0-9]+/g, "-");
  if (["dialog", "dialogue", "discussion", "interview", "radio", "conversation"].includes(normalized)) return "dialogue";
  if (["mono", "monolog", "monologue", "narration"].includes(normalized)) return "monologue";
  return normalized || "";
};

const isIgnoredSpeakerLabel = (label) =>
  /^(?:text|track|audio|teil|thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|geh[oö]rt|format|transkription|transcription|type de t[aâ]che|heute|dann|erstens|zweitens|drittens|au[ßs]erdem|vorteile|nachteile|optionen|zum abschluss)\s*\d*$/i.test(String(label || "").trim());

const isTemplateTranscript = (transcript) =>
  /\bsprecher(?:in)?\s*:\s*_+/i.test(transcript) ||
  /\(not found in source|manual review required\)/i.test(transcript) ||
  /_{3,}/.test(transcript);

const isProductionLine = (line) =>
  /^(?:thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|format|transkription|transcription|type de t[aâ]che|heute|dann|erstens|zweitens|drittens|au[ßs]erdem|vorteile|nachteile|optionen|zum abschluss)\s*:/i.test(line) ||
  /^\s*(?:n|■|-)?\s*\[?(?:anfang|ende|pause|sfx|audio script|zweite wiedergabe|wiederholung)\]?/i.test(line);

const extractDialogueSpeakerLabels = (item, transcript) => {
  const settings = asObject(item.audio_engine_settings);
  const labels = [];
  const add = (value) => {
    const normalized = String(value || "")
      .replace(/^\s*(?:n|■|-)\s*/i, "")
      .replace(/\s*\([^)]*\)\s*$/g, "")
      .trim();
    if (!normalized || isIgnoredSpeakerLabel(normalized)) return;
    const folded = foldPlain(normalized);
    if (!folded || labels.some((label) => foldPlain(label) === folded)) return;
    labels.push(normalized);
  };
  if (Array.isArray(settings.speakers)) {
    settings.speakers.forEach((speaker) => add(speaker.speaker || speaker.voiceName || speaker.id));
  }
  Array.from(String(transcript || "").matchAll(/(?:^|\n)\s*(?:n|■|-)?\s*((?:Moderator|Moderatorin|Gast|Reporter|Reporterin|Sprecher|Sprecherin)(?:\s+[A-ZÄÖÜ][^:\n]{0,36})?)\s*:/g))
    .forEach((match) => add(match[1]));
  const preferred = labels.filter((label) => /^(?:Moderator|Moderatorin|Gast|Reporter|Reporterin|Sprecher|Sprecherin)\b/i.test(label));
  return preferred.length >= 2 ? preferred.slice(0, 4) : labels.slice(0, 4);
};

const prepareTranscriptForTts = (item) => {
  const rawTranscript = item.admin_transcript || "";
  if (isTemplateTranscript(rawTranscript)) return "";
  const transcript = stripProductionMarkers(rawTranscript);
  if (!transcript || isTemplateTranscript(transcript)) return "";
  if (!/\b(?:radiointerview|radiogespr[aä]ch|radiogespraech|dialog|dialogue|interview|diskussion|discussion)\b/i.test(`${item.title || ""} ${JSON.stringify(item.audio_engine_settings || {})}`)) {
    return transcript;
  }
  const lines = transcript.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const speakerLabels = extractDialogueSpeakerLabels(item, transcript);
  if (speakerLabels.length < 2) return transcript;
  let turnIndex = 0;
  const prepared = [];
  lines.forEach((rawLine) => {
    const line = rawLine.replace(/^\s*(?:format|transkription|transcription)\s*:\s*/i, "").trim();
    if (isProductionLine(line)) return;
    if (/^\s*(?:n|■|-)?\s*(?:Moderator|Moderatorin|Gast|Reporter|Reporterin|Sprecher|Sprecherin)\b[^:\n]*:/i.test(line)) {
      return;
    }
    if (/^\s*[A-ZÄÖÜ][^:\n]{1,48}\s*:/u.test(line)) {
      prepared.push(line.replace(/^\s*(?:n|■|-)\s*/i, ""));
      return;
    }
    prepared.push(`${speakerLabels[turnIndex % speakerLabels.length]}: ${line}`);
    turnIndex += 1;
  });
  return prepared.join("\n").trim() || transcript;
};

const classifyItem = (item) => {
  const rawTranscript = item.admin_transcript || "";
  const transcript = stripProductionMarkers(rawTranscript);
  const settings = asObject(item.audio_engine_settings);
  const metadata = asObject(item.source_metadata);
  const primaryText = [
    item.title,
    settings.documentType,
    settings.listeningType,
    metadata.documentType,
    metadata.listeningType,
  ].filter(Boolean).join(" ");
  const text = [
    item.title,
    item.instructions,
    item.admin_notes,
    transcript,
    JSON.stringify(settings),
    JSON.stringify(metadata),
  ].join(" ");
  if (isTemplateTranscript(rawTranscript) || isTemplateTranscript(transcript)) {
    return "unknown";
  }
  const labels = Array.from(transcript.matchAll(/^\s*([^:\n]{2,48})\s*:/gm))
    .map((match) => match[1].trim())
    .filter((label) => !isIgnoredSpeakerLabel(label));
  const uniqueLabels = Array.from(new Set(labels.map(foldPlain).filter(Boolean)));
  if (/\b(?:kurztexte?|vortrag|monolog|monologue)\b/i.test(primaryText) && !/\b(?:radiointerview|radiogespr[aä]ch|radiogespraech|dialog|dialogue|interview|diskussion|discussion)\b/i.test(primaryText)) {
    return "monologue";
  }
  if (/\b(?:radiointerview|radiogespr[aä]ch|radiogespraech|dialog|dialogue|interview|diskussion|discussion)\b/i.test(primaryText)) {
    return "dialogue";
  }
  const dialogueHint =
    uniqueLabels.length >= 2 ||
    /\b(dialog|dialogue|gespr[aä]ch|gespraech|interview|radio|diskussion|discussion|moderator|moderatorin|reporter|reporterin|sprecher\s*[ab]|sprecherin\s*[ab])\b/i.test(text);
  const monologueHint =
    /\b(monolog|monologue|vortrag|ansage|bericht|reportage|narration)\b/i.test(text) &&
    !/\b(interview|dialog|dialogue|diskussion|discussion|conversation)\b/i.test(text);
  if (dialogueHint && !monologueHint) return "dialogue";
  if (monologueHint) return "monologue";
  return "unknown";
};

const isQuotaOrCreditError = (error) => {
  const status = Number(error.status) || 0;
  const message = `${error.message || ""} ${error.publicMessage || ""}`.toLowerCase();
  return [402, 429].includes(status) || /quota|credit|billing|character|insufficient|limit exceeded|too many requests/.test(message);
};

const markBrowserTtsFallback = async (item, reason) => {
  await pool.query(
    `UPDATE exam_listening_audio_items
        SET audio_generation_status = 'published',
            generated_audio_url = '',
            generated_audio_asset_id = NULL,
            admin_notes = 'Browser TTS (no MP3)',
            source_metadata = COALESCE(source_metadata, '{}'::jsonb) || jsonb_build_object(
              'browserTtsFallback', true,
              'fallbackEngine', 'browser-speech',
              'fallbackReason', $2::text,
              'fallbackMarkedAt', NOW(),
              'productionLabel', 'Browser TTS (no MP3)'
            ),
            generation_log = COALESCE(generation_log, '[]'::jsonb) || $3::jsonb,
            updated_at = NOW()
      WHERE id = $1`,
    [
      item.id,
      reason || "ElevenLabs MP3 generation stopped before this item.",
      JSON.stringify([{
        at: new Date().toISOString(),
        action: "mark_browser_tts_fallback",
        note: "Browser TTS (no MP3)",
        reason: reason || "ElevenLabs MP3 generation stopped before this item.",
      }]),
    ]
  );
};

const inferSpeakers = (item, profiles) => {
  const transcript = prepareTranscriptForTts(item);
  const audioSettings = asObject(item.audio_engine_settings);
  const configuredSpeakers = Array.isArray(audioSettings.speakers) ? audioSettings.speakers : [];
  const parsedSegments = parseSpeakerSegments({
    transcript,
    tracks: [{
      id: `listening-item-${item.id}`,
      transcript,
      audio: { transcript },
    }],
  });
  const labels = parsedSegments
    .map((segment) => String(segment.speaker || "").trim())
    .filter((label) => label && label !== "Narrator" && !isIgnoredSpeakerLabel(label));
  const femaleProfiles = profiles.filter((profile) => profile.gender === "female");
  const maleProfiles = profiles.filter((profile) => profile.gender === "male");
  const pick = (list, index = 0) => list[index % Math.max(1, list.length)] || {};
  const configuredGenderFor = (name) => {
    const folded = foldPlain(name);
    const match = configuredSpeakers.find((speaker) => {
      const labels = [speaker.speaker, speaker.voiceName, speaker.id].map(foldPlain).filter(Boolean);
      return labels.some((label) => folded && (folded === label || folded.includes(label) || label.includes(folded)));
    });
    return String(match?.suggestedGender || match?.gender || "").toLowerCase();
  };

  if (!labels.length) {
    const rawSettings = JSON.stringify(item.audio_engine_settings || {});
    const prefersMale =
      /homme|male|mann|maennlich|sprecher\s*b|speaker\s*b/i.test(rawSettings) &&
      Number(item.item_number) % 2 === 0;
    const profile = pick(prefersMale ? maleProfiles : femaleProfiles);
    return [{
      speaker: "Narrator",
      gender: profile.gender || (prefersMale ? "male" : "female"),
      suggestedGender: profile.gender || (prefersMale ? "male" : "female"),
      voiceId: profile.voice_id || undefined,
      voiceName: profile.label || undefined,
      style: profile.style || "klar, pruefungsgerecht",
      ...asObject(profile.settings),
    }];
  }

  const seen = new Set();
  const speakers = [];
  labels.forEach((name) => {
    const key = foldPlain(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    const configuredGender = configuredGenderFor(name);
    const looksFemale = /\b(?:frau|mutter|tochter|freundin|anna|julia|julie|maria|sara|clara|eva|gabi|moderatorin|sprecherin|reporterin|katrin|monika|lena|hannah|nadja|klara|nina|mira|petra|sabine|lara|greta|sophie)\b/i.test(name);
    const looksMale = /\b(?:herr|vater|sohn|freund|ben|daniel|frank|mike|moderator|sprecher|reporter|thomas|klaus|marco|tobias|lukas|pawel|bernd|otto|markus|stefan|robert)\b/i.test(name);
    const gender = configuredGender === "male" || configuredGender === "female"
      ? configuredGender
      : looksMale && !looksFemale ? "male" : "female";
    const sameGenderCount = speakers.filter((speaker) => speaker.gender === gender).length;
    const profile = pick(gender === "male" ? maleProfiles : femaleProfiles, sameGenderCount);
    speakers.push({
      speaker: name,
      gender,
      suggestedGender: gender,
      voiceId: profile.voice_id || undefined,
      voiceName: profile.label || undefined,
      style: profile.style || "natuerlich, klar",
      ...asObject(profile.settings),
    });
  });
  return speakers;
};

const buildAudio = (item, profiles) => {
  const transcript = prepareTranscriptForTts(item);
  const speakers = inferSpeakers(item, profiles);
  return {
    title: item.title || `Hoeren Teil ${item.part_number || 1}`,
    speaker: speakers.map((speaker) => speaker.speaker).join(" / ") || "Standarddeutsch",
    scene: "German listening exam",
    situation: item.title || "",
    transcript,
    speakers,
    tracks: [{
      id: `listening-item-${item.id}`,
      partNumber: Number(item.part_number) || 1,
      title: item.title || `Text ${item.item_number || 1}`,
      transcript,
      audio: { transcript, speakers },
    }],
    ambience: [],
    sfx: "",
    rate: 0.92,
  };
};

const handleItem = async (item, profiles, { force = false, provider = "elevenlabs" } = {}) => {
  try {
    await pool.query(
      `UPDATE exam_listening_audio_items
          SET audio_generation_status = 'generating',
              admin_notes = NULL,
              updated_at = NOW()
        WHERE id = $1`,
      [item.id]
    );
    const audio = buildAudio(item, profiles);
    const generated = await generateAndStoreExamAudio({
      pool,
      examId: item.exam_id,
      audio,
      adminId: null,
      provider,
      force,
    });
    await pool.query(
      `UPDATE exam_listening_audio_items
          SET generated_audio_asset_id = $2,
              generated_audio_url = $3,
              audio_generation_status = 'published',
              voice_profile_map = $4::jsonb,
              source_metadata = (COALESCE(source_metadata, '{}'::jsonb)
                - 'browserTtsFallback'
                - 'fallbackEngine'
                - 'fallbackReason'
                - 'fallbackMarkedAt') || jsonb_build_object('mp3GeneratedAt', NOW()),
              approved_at = COALESCE(approved_at, NOW()),
              published_at = NOW(),
              generation_log = COALESCE(generation_log, '[]'::jsonb) || $5::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [
        item.id,
        generated.asset.id,
        `/api/audio/generated/${generated.asset.id}`,
        JSON.stringify(audio.speakers),
        JSON.stringify([{
          at: new Date().toISOString(),
          action: "script_batch_publish",
          assetId: generated.asset.id,
          cached: Boolean(generated.cached),
        }]),
      ]
    );
    return { id: item.id, ok: true, assetId: generated.asset.id, cached: Boolean(generated.cached) };
  } catch (error) {
    const isMissingTranscript = /no transcript text is available/i.test(error.message || error.publicMessage || "");
    const shouldStop =
      !isMissingTranscript &&
      (error.name === "TtsConfigurationError" || [401, 402, 429].includes(Number(error.status) || 0) || isQuotaOrCreditError(error));
    if (shouldStop) {
      await markBrowserTtsFallback(item, error.publicMessage || error.message || "ElevenLabs generation stopped; Browser TTS fallback preserved.").catch(() => {});
    } else {
      await pool.query(
        `UPDATE exam_listening_audio_items
            SET audio_generation_status = 'failed',
                admin_notes = $2,
                generation_log = COALESCE(generation_log, '[]'::jsonb) || $3::jsonb,
                updated_at = NOW()
          WHERE id = $1`,
        [
          item.id,
          error.publicMessage || error.message || "Audio generation failed.",
          JSON.stringify([{ at: new Date().toISOString(), action: "script_batch_failed", error: error.publicMessage || error.message }]),
        ]
      ).catch(() => {});
    }
    return {
      id: item.id,
      ok: false,
      status: Number(error.status) || 0,
      setupRequired: error.name === "TtsConfigurationError",
      stop: shouldStop,
      error: error.publicMessage || error.message || "Audio generation failed.",
    };
  }
};

const main = async () => {
  const { positional, flags } = parseArgs();
  const limit = Math.max(1, Math.min(2000, Number(flags.limit || positional[0]) || 20));
  const concurrency = Math.max(1, Math.min(8, Number(flags.concurrency || positional[1]) || 2));
  const provider = String(flags.provider || positional[2] || "elevenlabs");
  const force = flags.force === true || flags.force === "true";
  const kinds = parseList(flags.kind || flags.kinds, ["dialogue"]).map(normalizeKind).filter(Boolean);
  const levels = parseList(flags.levels || flags.level, ["B1", "B2"]).map((level) => level.toUpperCase());
  const providers = parseList(flags.examProviders || flags.examProvider || flags.providers, [])
    .map((value) => value.toLowerCase());
  const dryRun = flags["dry-run"] === true || flags.dryRun === true;
  const candidates = (await pool.query(
    `SELECT *
       FROM exam_listening_audio_items
      WHERE admin_transcript IS NOT NULL
        AND LENGTH(TRIM(admin_transcript)) >= 20
        AND (
          generated_audio_asset_id IS NULL
          OR audio_generation_status IN ('draft', 'failed', 'queued', 'generating')
          OR $1::boolean = TRUE
        )
      ORDER BY provider, level, series_number, part_number, item_number, id
      LIMIT 5000`,
    [force]
  )).rows;
  const items = candidates
    .map((item) => ({ ...item, target_kind: classifyItem(item) }))
    .filter((item) => !levels.length || levels.includes(String(item.level || "").toUpperCase()))
    .filter((item) => !providers.length || providers.includes(String(item.provider || "").toLowerCase()))
    .filter((item) => !kinds.length || kinds.includes(item.target_kind))
    .slice(0, limit);

  console.log(`TARGET ${JSON.stringify({
    limit,
    concurrency,
    provider,
    force,
    kinds,
    levels,
    providers,
    dryRun,
    candidates: candidates.length,
    selected: items.length,
  })}`);

  if (dryRun) {
    console.log(JSON.stringify(items.slice(0, 100).map((item) => ({
      id: item.id,
      provider: item.provider,
      level: item.level,
      series: item.series_number,
      part: item.part_number,
      item: item.item_number,
      kind: item.target_kind,
      title: item.title,
      status: item.audio_generation_status,
      hasMp3: Boolean(item.generated_audio_asset_id),
    })), null, 2));
    await pool.end();
    return;
  }

  const profiles = await getVoiceProfiles(pool);
  let index = 0;
  let stop = false;
  let stopReason = "";
  const results = [];

  const worker = async () => {
    while (!stop && index < items.length) {
      const item = items[index];
      index += 1;
      const result = await handleItem(item, profiles, { provider });
      results.push(result);
      console.log(JSON.stringify(result));
      if (result.stop) {
        stop = true;
        stopReason = result.error || "ElevenLabs generation stopped.";
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  if (stop) {
    const remaining = items.slice(index);
    for (const item of remaining) {
      await markBrowserTtsFallback(item, stopReason);
    }
    console.log(`FALLBACK_MARKED ${remaining.length}`);
  }
  const summary = (await pool.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE audio_generation_status = 'published')::int AS published,
            COUNT(*) FILTER (WHERE audio_generation_status = 'failed')::int AS failed,
            COUNT(*) FILTER (WHERE audio_generation_status = 'generating')::int AS generating
       FROM exam_listening_audio_items`
  )).rows[0];
  console.log(`SUMMARY ${JSON.stringify({
    requested: limit,
    concurrency,
    processed: results.length,
    ok: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok).length,
    stopped: stop,
    stopReason,
    summary,
  })}`);
  await pool.end();
  if (results.some((result) => result.stop)) process.exitCode = 2;
};

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
