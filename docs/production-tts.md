# Production Hoeren TTS

The learner Hoeren player uses cached production audio only. It no longer creates audio with browser `SpeechSynthesis`.

## Backend Flow

1. Admin opens a Hoeren exam in the CMS.
2. The CMS calls `GET /api/admin/exams/:examId/audio` to check the cached audio status.
3. Admin clicks `Generate audio`.
4. The backend builds listening audio context from the existing exam, section, question, transcript, speaker, and ambience metadata.
5. `server/services/ttsService.js` sends each speaker segment to the configured provider.
6. The generated MP3 is stored in `exam_audio_assets`.
7. Learners receive `content.audio.audioUrl` only when the matching cached asset is ready.
8. The learner player streams `/api/audio/generated/:assetId`.

## Providers

Set `TTS_PROVIDER` to one of:

- `elevenlabs`
- `openai`
- `google`
- `azure`
- `polly`

The server keeps all API keys backend-only. Never add TTS keys to the React frontend.

For ElevenLabs, set:

```env
TTS_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=...
```

`ELEVENLABS_DEFAULT_VOICE_ID` is optional. If it is not set, the backend asks ElevenLabs for available voices and chooses the best German or multilingual voice it can find.

## Admin Preview

For Hoeren exams, the CMS shows a `Production listening audio` panel. It displays:

- provider status
- cached file status
- generate/regenerate action
- exact audio preview used by learners

Admins should generate and preview audio before publishing a Hoeren exam.

## Reliability

The content hash includes transcript, tracks, speakers, ambience, provider, and rate. Audio is reused while that context stays the same. If generation fails, the backend records a failed asset status and keeps any older ready asset untouched.

The `exam_audio_assets` table is created by `ensureSchema()`, has RLS enabled, and revokes direct `anon`/`authenticated` table access when those Supabase roles exist. Public playback goes through `/api/audio/generated/:assetId`.

## Deployment

Vercel must have the chosen provider key set as an environment variable. For production with the ElevenLabs key:

```bash
vercel env add TTS_PROVIDER production
vercel env add ELEVENLABS_API_KEY production --sensitive
```

The API function is configured for a longer duration in `vercel.json` because audio generation can take more than a short request timeout.
