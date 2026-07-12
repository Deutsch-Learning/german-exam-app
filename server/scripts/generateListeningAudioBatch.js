const pool = require("../db");
const {
  generateAndStoreExamAudio,
  getVoiceProfiles,
  stripProductionMarkers,
} = require("../services/ttsService");

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const foldPlain = (value) =>
  String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

const inferSpeakers = (item, profiles) => {
  const transcript = stripProductionMarkers(item.admin_transcript || "");
  const labels = Array.from(transcript.matchAll(/^\s*([^:\n]{2,48})\s*:/gm))
    .map((match) => match[1].trim())
    .filter((label) => !/^(?:text|track|audio|teil)\s*\d+$/i.test(label));
  const femaleProfiles = profiles.filter((profile) => profile.gender === "female");
  const maleProfiles = profiles.filter((profile) => profile.gender === "male");
  const pick = (list, index = 0) => list[index % Math.max(1, list.length)] || {};

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
    const isMale = /herr|vater|sohn|freund|ben|daniel|frank|mike|moderator|sprecher|thomas|klaus/i.test(name);
    const gender = isMale ? "male" : "female";
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
  const transcript = stripProductionMarkers(item.admin_transcript || "");
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
    return {
      id: item.id,
      ok: false,
      status: Number(error.status) || 0,
      setupRequired: error.name === "TtsConfigurationError",
      stop:
        error.name === "TtsConfigurationError" ||
        [401, 402, 429].includes(Number(error.status) || 0),
      error: error.publicMessage || error.message || "Audio generation failed.",
    };
  }
};

const main = async () => {
  const limit = Math.max(1, Math.min(200, Number(process.argv[2]) || 20));
  const concurrency = Math.max(1, Math.min(8, Number(process.argv[3]) || 2));
  const provider = process.argv[4] || "elevenlabs";
  const items = (await pool.query(
    `SELECT *
       FROM exam_listening_audio_items
      WHERE admin_transcript IS NOT NULL
        AND LENGTH(TRIM(admin_transcript)) >= 20
        AND (generated_audio_asset_id IS NULL OR audio_generation_status IN ('draft', 'failed', 'queued', 'generating'))
      ORDER BY provider, level, series_number, part_number, item_number, id
      LIMIT $1`,
    [limit]
  )).rows;
  const profiles = await getVoiceProfiles(pool);
  let index = 0;
  let stop = false;
  const results = [];

  const worker = async () => {
    while (!stop && index < items.length) {
      const item = items[index];
      index += 1;
      const result = await handleItem(item, profiles, { provider });
      results.push(result);
      console.log(JSON.stringify(result));
      if (result.stop) stop = true;
    }
  };

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
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
