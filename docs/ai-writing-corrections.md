# AI Writing Corrections

This app stores submitted exam modules in `simulations`. Expression Ecrite correction now builds on that existing submission row instead of creating a second submission system.

## Workflow

1. The frontend submits a completed writing module to `POST /simulations`.
2. `result_details` includes the writing task context:
   - title
   - instructions
   - optional subtitles
   - exam type and module type
   - duration
   - configured max score / weight
   - candidate response
3. The backend stores the simulation, then detects writing modules.
4. Each writing task is corrected independently by `server/services/writingCorrection.js`.
5. Gemini receives the full task context and candidate answer and must return strict JSON.
6. The backend clamps every score to the configured task maximum.
7. Task scores are summed into the total writing score and percentage.
8. Results are stored in Supabase/Postgres and returned to the result screen.

## Storage

The server bootstraps these tables on startup:

- `writing_corrections`: one overall correction per simulation. `simulation_id` is unique to prevent duplicate corrections.
- `writing_correction_tasks`: one row per writing task with score, criterion scores, strengths, weaknesses, feedback, model, and timestamp.
- `ai_correction_logs`: request audit log with provider, model, request hash, status, attempts, errors, and metadata.

All three tables are created in `public` with Row Level Security enabled. The app reads/writes them through the authenticated backend using the server database connection; API keys are never exposed to the browser.

## API

- `GET /api/simulations/:simulationId/writing-correction`
  - Returns the saved correction for the authenticated owner or admin.
- `POST /api/simulations/:simulationId/writing-correction`
  - Runs or retries correction for a writing simulation.
  - Use `{ "force": true }` or `?force=true` to retry a failed or stale correction.

## AI Output

Each task correction is normalized to:

```json
{
  "score": 32,
  "maxScore": 40,
  "criterionScores": {
    "instructions": 8,
    "taskCompletion": 8,
    "coherence": 9,
    "grammar": 7,
    "spelling": 8,
    "vocabulary": 8,
    "register": 8
  },
  "strengths": ["..."],
  "weaknesses": ["..."],
  "feedback": "...",
  "estimatedLevel": "B2"
}
```

## Configuration

Set this on the Node/Express server environment:

```bash
GEMINI_API_KEY=...
```

Optional:

```bash
GEMINI_MODEL=gemini-2.5-flash
GEMINI_MAX_ATTEMPTS=3
GEMINI_TIMEOUT_MS=45000
WRITING_CORRECTION_DEADLINE_MS=60000
```

Supabase Edge Function secrets are separate from this Express server environment. If the backend is not running inside an Edge Function, add the same Gemini key to the backend host as a server-only environment variable.

On Vercel, `api/index.js` has a 30-second function limit. The correction service uses a shorter default deadline there so failed or slow AI calls are stored as partial/failed corrections instead of timing out the whole request. On Railway, the default deadline is longer.
