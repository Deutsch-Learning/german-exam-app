# Sprechen B1/B2 Package Implementation

The `Sprechen_B1_B2_Project_Package` was imported into the existing Supabase-backed exam schema on 2026-07-16.

## Scope

- 8 speaking packs imported: Goethe, TELC, OSD, and ECL for B1 and B2.
- 160 speaking series total.
- Candidate-visible source text is imported as-is from the package JSON files.
- Private correction/model text is stored only inside `exam_questions.correct_answer.privateCorrectionText`.
- Student API responses strip private correction text, generation prompts, local source paths, and other admin metadata.
- Visual stimuli are served from `client/gem-app/public/speaking-assets`.

## Counts

- Goethe B1: 20 series, 60 speaking tasks.
- Goethe B2: 20 series, 40 speaking tasks.
- TELC B1: 20 series, 60 speaking tasks.
- TELC B2: 20 series, 60 speaking tasks.
- OSD B1: 20 series, 60 speaking tasks.
- OSD B2: 20 series, 60 speaking tasks.
- ECL B1: 20 series, 60 speaking tasks.
- ECL B2: 20 series, 40 speaking tasks.

Goethe B2 and ECL B2 are two-part imports because the package source exposes two candidate-visible speaking parts for those packs. No missing source text was invented.

## AI Correction Readiness

The backend now stores speaking recordings and creates speaking correction records. The correction workflow is intentionally budget-safe until OpenAI credits are available:

- `OPENAI_API_KEY` must remain server-side only.
- Optional models:
  - `OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe`
  - `OPENAI_DIARIZE_MODEL=gpt-4o-transcribe-diarize`
  - `OPENAI_EVAL_MODEL=gpt-4.1-mini`
- Without credits/configuration, speaking correction records stay deferred instead of making paid calls.

## Reimport Command

Run from the repository root:

```bash
node server/scripts/importSpeakingPackage.js
```

The importer is idempotent for the package exams. It deletes and rebuilds only package-owned speaking sections/questions for those imported speaking exams.
