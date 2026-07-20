const crypto = require("crypto");

const DEFAULT_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe";
const DEFAULT_EVAL_MODEL = process.env.OPENAI_EVAL_MODEL || "gpt-4.1-mini";
const SPEAKING_PROMPT_VERSION = "speaking-evaluation-v1";

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};

const isSpeakingSimulation = (simulation = {}) => {
  const details = asObject(simulation.result_details);
  return details.moduleId === "speak" || /\bsprechen|expression orale|speak/i.test(String(simulation.exam_name || ""));
};

const normalizeStatus = (value) =>
  ["completed", "processing", "failed", "unconfigured", "audio_required", "manual_review"].includes(value)
    ? value
    : "processing";

const safeJsonParse = (value, fallback = null) => {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
};

const clampNumber = (value, min, max, fallback = min) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};

const getErrorMessage = (err) => {
  const message = String(err?.message || err || "Unknown error");
  if (/insufficient_quota|quota|billing|credit/i.test(message)) {
    return "KI-Sprechkorrektur wartet: Das OpenAI-Konto hat nicht genug Guthaben, um die Analyse abzuschliessen.";
  }
  if (/401|invalid.*api.*key|unauthorized/i.test(message)) {
    return "KI-Sprechkorrektur wartet: Der serverseitige OpenAI-Schluessel ist ungueltig oder nicht autorisiert.";
  }
  return message.slice(0, 500);
};

const buildSpeakingEvaluationSchema = () => ({
  name: "speaking_practice_evaluation",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["providerResult", "diagnostics", "tasks", "feedback", "quality"],
    properties: {
      providerResult: {
        type: "object",
        additionalProperties: false,
        required: ["rawScore", "rawMax", "percentage", "estimatedLevel", "practiceEstimateOnly"],
        properties: {
          rawScore: { type: "number" },
          rawMax: { type: "number" },
          percentage: { type: "number" },
          estimatedLevel: { type: "string" },
          practiceEstimateOnly: { type: "boolean" },
        },
      },
      diagnostics: {
        type: "object",
        additionalProperties: false,
        required: [
          "taskCompletion",
          "coherence",
          "grammar",
          "vocabulary",
          "fluency",
          "pronunciationEstimate",
          "interaction",
        ],
        properties: {
          taskCompletion: { type: "number" },
          coherence: { type: "number" },
          grammar: { type: "number" },
          vocabulary: { type: "number" },
          fluency: { type: "number" },
          pronunciationEstimate: { type: "number" },
          interaction: { type: "number" },
        },
      },
      tasks: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["taskId", "score", "maxScore", "feedback", "strengths", "weaknesses"],
          properties: {
            taskId: { type: "string" },
            score: { type: "number" },
            maxScore: { type: "number" },
            feedback: { type: "string" },
            strengths: { type: "array", items: { type: "string" } },
            weaknesses: { type: "array", items: { type: "string" } },
          },
        },
      },
      feedback: {
        type: "object",
        additionalProperties: false,
        required: ["summary", "strengths", "weaknesses", "nextSteps"],
        properties: {
          summary: { type: "string" },
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          nextSteps: { type: "array", items: { type: "string" } },
        },
      },
      quality: {
        type: "object",
        additionalProperties: false,
        required: ["audioBand", "notes"],
        properties: {
          audioBand: { type: "string" },
          notes: { type: "array", items: { type: "string" } },
        },
      },
    },
  },
});

const openAiFetch = async (path, options = {}) => {
  const response = await fetch(`https://api.openai.com${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  if (!response.ok) {
    const parsed = safeJsonParse(text, {});
    throw new Error(parsed?.error?.message || text || `OpenAI request failed (${response.status})`);
  }
  return text ? safeJsonParse(text, text) : {};
};

const transcribeRecording = async (recording) => {
  const form = new FormData();
  const mimeType = recording.mime_type || "audio/webm";
  const extension = mimeType.includes("mp4") ? "mp4" : mimeType.includes("mpeg") ? "mp3" : "webm";
  form.append("file", new Blob([recording.audio_data], { type: mimeType }), `speaking-${recording.id}.${extension}`);
  form.append("model", DEFAULT_TRANSCRIBE_MODEL);
  form.append("language", "de");
  form.append("response_format", "json");
  form.append(
    "prompt",
    "German oral exam response. Preserve German words as spoken. Ignore examiner silence and background noise."
  );

  const result = await openAiFetch("/v1/audio/transcriptions", {
    method: "POST",
    body: form,
  });
  return typeof result === "string" ? result : String(result?.text || "").trim();
};

const evaluateSpeakingAttempt = async ({ simulation, tasks, transcripts, rawMax }) => {
  const prompt = {
    language: "de",
    instruction:
      "Evaluate a German speaking exam practice attempt. It is a practice estimate only, not an official certificate. Use the provider/level/task context and hidden transcripts. Do not reveal model answers. Penalize missing/empty audio gently but clearly. Score cannot exceed max values.",
    simulation: {
      id: simulation.id,
      examName: simulation.exam_name,
      scoreSource: "AI practice estimate only",
      rawMax,
    },
    tasks: tasks.map((task, index) => ({
      taskId: String(task.taskId || `task-${index + 1}`),
      title: task.title || task.typeLabel || `Task ${index + 1}`,
      instructions: String(task.instructions || "").slice(0, 4000),
      maxScore: Number(task.maxScore) || Math.max(1, rawMax / Math.max(1, tasks.length)),
      durationSeconds: Number(task.duration) || 0,
      transcript: transcripts[index]?.text || "",
    })),
    diagnosticScale: "0 to 10",
    requiredOutput:
      "Return strict JSON. All user-facing feedback, warnings, errors, strengths, weaknesses, task feedback, nextSteps, quality notes, and summaries must be concise, useful, and in German. Pronunciation is only an AI pronunciation estimate because no specialist pronunciation engine is configured.",
  };

  const response = await openAiFetch("/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: DEFAULT_EVAL_MODEL,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You are an experienced German speaking-exam examiner for practice platforms. Be fair, strict, and evidence-based. Never claim official certification.",
        },
        { role: "user", content: JSON.stringify(prompt) },
      ],
      response_format: {
        type: "json_schema",
        json_schema: buildSpeakingEvaluationSchema(),
      },
    }),
  });
  const content = response?.choices?.[0]?.message?.content || "";
  const parsed = safeJsonParse(content, null);
  if (!parsed) throw new Error("OpenAI returned invalid structured speaking evaluation JSON.");
  return parsed;
};

async function ensureSpeakingCorrectionSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS speaking_provider_profiles (
      id SERIAL PRIMARY KEY,
      profile_key TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      level TEXT NOT NULL,
      version TEXT NOT NULL,
      profile JSONB NOT NULL DEFAULT '{}'::jsonb,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS speaking_content_packs (
      id SERIAL PRIMARY KEY,
      pack_key TEXT UNIQUE NOT NULL,
      provider TEXT NOT NULL,
      level TEXT NOT NULL,
      package_version TEXT NOT NULL,
      manifest JSONB NOT NULL DEFAULT '{}'::jsonb,
      imported_exam_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
      import_report JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS speaking_recordings (
      id SERIAL PRIMARY KEY,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      simulation_id INTEGER REFERENCES simulations(id) ON DELETE SET NULL,
      source_exam_id INTEGER REFERENCES exams(id) ON DELETE SET NULL,
      source_question_id INTEGER REFERENCES exam_questions(id) ON DELETE SET NULL,
      task_id TEXT,
      mime_type TEXT NOT NULL,
      byte_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      audio_sha256 TEXT NOT NULL,
      audio_data BYTEA NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'uploaded',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS speaking_evaluations (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER UNIQUE REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'processing',
      provider_result JSONB NOT NULL DEFAULT '{}'::jsonb,
      diagnostics JSONB NOT NULL DEFAULT '{}'::jsonb,
      evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
      feedback JSONB NOT NULL DEFAULT '{}'::jsonb,
      quality JSONB NOT NULL DEFAULT '{}'::jsonb,
      provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS speaking_recordings_user_created_idx ON speaking_recordings(user_id, created_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS speaking_recordings_question_idx ON speaking_recordings(source_question_id, user_id);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS speaking_evaluations_user_created_idx ON speaking_evaluations(user_id, created_at DESC);`);
  await pool.query(`ALTER TABLE speaking_provider_profiles ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE speaking_content_packs ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE speaking_recordings ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`ALTER TABLE speaking_evaluations ENABLE ROW LEVEL SECURITY;`);
}

const buildPendingEvaluation = (simulation, status, message, extra = {}) => ({
  schemaVersion: "speaking-evaluation-v1",
  simulationId: simulation.id,
  status,
  percentage: null,
  providerResult: {},
  diagnostics: {},
  evidence: [],
  feedback: {
    summary: message,
    strengths: [],
    weaknesses: [message],
    nextSteps: [
      "Nehmen Sie jeden Teil mit einem klaren Mikrofon auf.",
      "Starten Sie die Korrektur erneut, sobald OpenAI-Guthaben und Servermodelle konfiguriert sind.",
    ],
  },
  quality: extra.quality || { audioBand: "pending", notes: [message] },
  provenance: {
    promptVersion: SPEAKING_PROMPT_VERSION,
    transcriptionModel: process.env.OPENAI_TRANSCRIBE_MODEL || null,
    evaluationModel: process.env.OPENAI_EVAL_MODEL || null,
    createdAt: new Date().toISOString(),
  },
  errorMessage: message,
});

const mapEvaluationRow = (row) => {
  if (!row) return null;
  const providerResult = asObject(row.provider_result);
  const diagnostics = asObject(row.diagnostics);
  const feedback = asObject(row.feedback);
  const rawScore = Number(providerResult.raw_score);
  const rawMax = Number(providerResult.raw_max);
  return {
    id: row.id,
    simulationId: row.simulation_id,
    status: normalizeStatus(row.status),
    percentage: Number.isFinite(rawScore) && Number.isFinite(rawMax) && rawMax > 0
      ? Math.round((rawScore / rawMax) * 100)
      : null,
    providerResult,
    diagnostics,
    evidence: Array.isArray(row.evidence) ? row.evidence : [],
    feedback,
    quality: asObject(row.quality),
    provenance: asObject(row.provenance),
    errorMessage: row.error_message || "",
    updatedAt: row.updated_at,
  };
};

async function getSpeakingCorrectionForSimulation(pool, simulationId) {
  const result = await pool.query(
    `SELECT * FROM speaking_evaluations WHERE simulation_id = $1 LIMIT 1`,
    [simulationId]
  );
  return mapEvaluationRow(result.rows[0]);
}

async function storePendingEvaluation(pool, simulation, status, message, extra = {}) {
  const pending = buildPendingEvaluation(simulation, status, message, extra);
  const inserted = await pool.query(
    `INSERT INTO speaking_evaluations (
       simulation_id, user_id, status, provider_result, diagnostics, evidence,
       feedback, quality, provenance, error_message
     )
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb, $10)
     ON CONFLICT (simulation_id) DO UPDATE SET
       status = EXCLUDED.status,
       provider_result = EXCLUDED.provider_result,
       diagnostics = EXCLUDED.diagnostics,
       evidence = EXCLUDED.evidence,
       feedback = EXCLUDED.feedback,
       quality = EXCLUDED.quality,
       provenance = EXCLUDED.provenance,
       error_message = EXCLUDED.error_message,
       updated_at = NOW()
     RETURNING *`,
    [
      simulation.id,
      simulation.user_id,
      status,
      JSON.stringify(pending.providerResult),
      JSON.stringify(pending.diagnostics),
      JSON.stringify(pending.evidence),
      JSON.stringify(pending.feedback),
      JSON.stringify(pending.quality),
      JSON.stringify(pending.provenance),
      message,
    ]
  );
  return mapEvaluationRow(inserted.rows[0]);
}

async function saveSpeakingRecording(pool, { userId, file, body = {} }) {
  if (!file?.buffer?.length) {
    const err = new Error("Audio file is required");
    err.status = 400;
    throw err;
  }
  const maxBytes = Number(process.env.SPEAKING_RECORDING_MAX_BYTES || 8 * 1024 * 1024);
  if (file.buffer.length > maxBytes) {
    const err = new Error("Recording too large");
    err.status = 413;
    throw err;
  }
  const hash = crypto.createHash("sha256").update(file.buffer).digest("hex");
  const sourceExamId = Number(body.sourceExamId) || null;
  const sourceQuestionId = Number(body.sourceQuestionId) || null;
  const durationSeconds = Number(body.durationSeconds);
  const metadata = {
    package: "Sprechen_B1_B2_Project_Package",
    provider: body.provider || null,
    level: body.level || null,
    taskTitle: body.taskTitle || null,
    taskType: body.taskType || null,
    recordedAt: body.recordedAt || new Date().toISOString(),
  };
  const result = await pool.query(
    `INSERT INTO speaking_recordings (
       user_id, source_exam_id, source_question_id, task_id, mime_type, byte_size,
       duration_seconds, audio_sha256, audio_data, metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb)
     RETURNING id, task_id, mime_type, byte_size, duration_seconds, audio_sha256, status, created_at`,
    [
      userId,
      sourceExamId,
      sourceQuestionId,
      body.taskId ? String(body.taskId).slice(0, 180) : null,
      String(file.mimetype || "audio/webm").slice(0, 80),
      file.buffer.length,
      Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds)) : null,
      hash,
      file.buffer,
      JSON.stringify(metadata),
    ]
  );
  return result.rows[0];
}

async function correctSpeakingSimulation(pool, simulation, { force = false } = {}) {
  if (!isSpeakingSimulation(simulation)) {
    const err = new Error("Simulation is not a speaking module");
    err.status = 400;
    throw err;
  }
  if (!force) {
    const existing = await getSpeakingCorrectionForSimulation(pool, simulation.id);
    if (existing && existing.status !== "failed") return existing;
  }

  const details = asObject(simulation.result_details);
  const speakingTasks = Array.isArray(details.speakingTasks) ? details.speakingTasks : [];
  const recordingIds = speakingTasks.map((task) => Number(task.recordingId)).filter(Number.isInteger);
  if (!recordingIds.length) {
    return storePendingEvaluation(
      pool,
      simulation,
      "audio_required",
      "Fuer diesen Versuch ist keine serverseitige Audiodatei verfuegbar. Nehmen Sie die Antwort erneut auf oder pruefen Sie die Mikrofonberechtigung."
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return storePendingEvaluation(
      pool,
      simulation,
      "unconfigured",
      "KI-Sprechkorrektur wartet: OPENAI_API_KEY ist nicht konfiguriert oder das Konto hat noch kein Guthaben.",
      { quality: { audioBand: "uploaded", notes: [`${recordingIds.length} serverseitige Aufnahme(n) verfuegbar.`] } }
    );
  }

  const recordingResult = await pool.query(
    `SELECT id, user_id, source_exam_id, source_question_id, task_id, mime_type, byte_size,
            duration_seconds, audio_data, metadata, created_at
       FROM speaking_recordings
      WHERE user_id = $1 AND id = ANY($2::int[])
      ORDER BY created_at ASC, id ASC`,
    [simulation.user_id, recordingIds]
  );
  const recordingsById = new Map(recordingResult.rows.map((row) => [Number(row.id), row]));
  const orderedRecordings = recordingIds.map((id) => recordingsById.get(id)).filter(Boolean);
  if (!orderedRecordings.length) {
    return storePendingEvaluation(
      pool,
      simulation,
      "audio_required",
      "Es wurde keine serverseitige Aufnahme gefunden, die zu diesem Versuch gehoert."
    );
  }

  await pool.query(
    `UPDATE speaking_recordings
        SET simulation_id = $1
      WHERE user_id = $2 AND id = ANY($3::int[])`,
    [simulation.id, simulation.user_id, recordingIds]
  );

  try {
    const transcripts = [];
    for (const recording of orderedRecordings) {
      const text = await transcribeRecording(recording);
      transcripts.push({
        recordingId: recording.id,
        taskId: recording.task_id,
        text,
        durationSeconds: recording.duration_seconds,
      });
    }

    const rawMax = Number(details.speakingMaxScore) || speakingTasks.reduce((sum, task) => sum + (Number(task.maxScore) || 0), 0) || 100;
    const evaluation = await evaluateSpeakingAttempt({
      simulation,
      tasks: speakingTasks,
      transcripts,
      rawMax,
    });
    const rawScore = clampNumber(evaluation.providerResult?.rawScore, 0, rawMax, 0);
    const normalizedProviderResult = {
      raw_score: rawScore,
      raw_max: rawMax,
      percentage: clampNumber(evaluation.providerResult?.percentage, 0, 100, Math.round((rawScore / rawMax) * 100)),
      estimated_level: String(evaluation.providerResult?.estimatedLevel || "").slice(0, 30),
      practice_estimate_only: true,
      task_scores: Array.isArray(evaluation.tasks) ? evaluation.tasks : [],
    };
    const diagnostics = asObject(evaluation.diagnostics);
    const feedback = asObject(evaluation.feedback);
    const quality = {
      ...asObject(evaluation.quality),
      notes: [
        ...(Array.isArray(evaluation.quality?.notes) ? evaluation.quality.notes : []),
        "AI pronunciation estimate only; no specialist pronunciation engine configured.",
      ],
    };
    const provenance = {
      promptVersion: SPEAKING_PROMPT_VERSION,
      transcriptionModel: DEFAULT_TRANSCRIBE_MODEL,
      evaluationModel: DEFAULT_EVAL_MODEL,
      evaluatedAt: new Date().toISOString(),
      recordingIds,
    };
    const saved = await pool.query(
      `INSERT INTO speaking_evaluations (
         simulation_id, user_id, status, provider_result, diagnostics, evidence,
         feedback, quality, provenance, error_message
       )
       VALUES ($1, $2, 'completed', $3::jsonb, $4::jsonb, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb, NULL)
       ON CONFLICT (simulation_id) DO UPDATE SET
         status = 'completed',
         provider_result = EXCLUDED.provider_result,
         diagnostics = EXCLUDED.diagnostics,
         evidence = EXCLUDED.evidence,
         feedback = EXCLUDED.feedback,
         quality = EXCLUDED.quality,
         provenance = EXCLUDED.provenance,
         error_message = NULL,
         updated_at = NOW()
       RETURNING *`,
      [
        simulation.id,
        simulation.user_id,
        JSON.stringify(normalizedProviderResult),
        JSON.stringify(diagnostics),
        JSON.stringify(transcripts.map((item) => ({
          recordingId: item.recordingId,
          taskId: item.taskId,
          transcriptPreview: item.text.slice(0, 1200),
          durationSeconds: item.durationSeconds,
        }))),
        JSON.stringify(feedback),
        JSON.stringify(quality),
        JSON.stringify(provenance),
      ]
    );
    return mapEvaluationRow(saved.rows[0]);
  } catch (err) {
    const message = getErrorMessage(err);
    return storePendingEvaluation(
      pool,
      simulation,
      /credit|quota|billing/i.test(message) ? "unconfigured" : "failed",
      message,
      { quality: { audioBand: "uploaded", notes: [`${orderedRecordings.length} serverseitige Aufnahme(n) verfuegbar.`] } }
    );
  }
}

module.exports = {
  DEFAULT_EVAL_MODEL,
  DEFAULT_TRANSCRIBE_MODEL,
  ensureSpeakingCorrectionSchema,
  getSpeakingCorrectionForSimulation,
  correctSpeakingSimulation,
  isSpeakingSimulation,
  saveSpeakingRecording,
};
