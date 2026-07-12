const pool = require("../db");

const main = async () => {
  const result = await pool.query(`
    UPDATE exam_listening_audio_items
       SET audio_generation_status = 'published',
           generated_audio_url = '',
           admin_notes = 'Browser TTS (no MP3)',
           source_metadata = COALESCE(source_metadata, '{}'::jsonb) || jsonb_build_object(
             'browserTtsFallback', true,
             'fallbackEngine', 'browser-speech',
             'fallbackReason', 'ElevenLabs MP3 not generated yet',
             'fallbackMarkedAt', NOW()
           ),
           generation_log = COALESCE(generation_log, '[]'::jsonb) || jsonb_build_array(jsonb_build_object(
             'at', NOW(),
             'action', 'mark_browser_tts_fallback',
             'note', 'Browser TTS (no MP3)'
           )),
           updated_at = NOW()
     WHERE admin_transcript IS NOT NULL
       AND LENGTH(TRIM(admin_transcript)) >= 20
       AND generated_audio_asset_id IS NULL
       AND audio_generation_status IN ('draft', 'failed', 'queued', 'generating')
     RETURNING id, exam_id, provider, level, series_number, part_number, item_number;
  `);

  const summary = await pool.query(`
    SELECT provider, level,
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE generated_audio_asset_id IS NOT NULL)::int AS mp3,
           COUNT(*) FILTER (WHERE COALESCE(source_metadata->>'browserTtsFallback', 'false') = 'true')::int AS browser_tts
      FROM exam_listening_audio_items
     GROUP BY provider, level
     ORDER BY provider, level;
  `);

  console.log(JSON.stringify({
    ok: true,
    marked: result.rowCount,
    items: result.rows.slice(0, 20),
    summary: summary.rows,
  }, null, 2));
  await pool.end();
};

main().catch(async (error) => {
  console.error(error);
  await pool.end().catch(() => {});
  process.exit(1);
});
