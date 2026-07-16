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
      "Enregistrez chaque partie avec un micro clair.",
      "Relancez la correction quand les credits OpenAI et les modeles serveur sont configures.",
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
      "Aucune piste audio serveur n'est disponible pour cette tentative. Reprenez l'enregistrement ou verifiez l'autorisation micro."
    );
  }

  if (!process.env.OPENAI_API_KEY) {
    return storePendingEvaluation(
      pool,
      simulation,
      "unconfigured",
      "Correction orale IA en attente: OPENAI_API_KEY n'est pas configure ou le compte n'a pas encore de credits.",
      { quality: { audioBand: "uploaded", notes: [`${recordingIds.length} enregistrement(s) serveur disponible(s).`] } }
    );
  }

  return storePendingEvaluation(
    pool,
    simulation,
    "manual_review",
    "Les enregistrements sont stockes. La file d'analyse OpenAI sera activee avec les credits et la calibration finale.",
    {
      quality: { audioBand: "uploaded", notes: [`${recordingIds.length} enregistrement(s) pret(s) pour analyse.`] },
    }
  );
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
