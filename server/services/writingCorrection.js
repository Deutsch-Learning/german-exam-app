const crypto = require("crypto");

const PROVIDER = "gemini";
const DEFAULT_MODEL = process.env.GEMINI_MODEL || "gemini-2.5-flash";
const FALLBACK_MODELS = (process.env.GEMINI_FALLBACK_MODELS || "gemini-2.5-flash-lite,gemini-2.0-flash-lite,gemini-2.0-flash")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_TIMEOUT_MS = Number(process.env.GEMINI_TIMEOUT_MS || 45000);
const GEMINI_MAX_ATTEMPTS = Math.max(1, Number(process.env.GEMINI_MAX_ATTEMPTS || 3));
const WRITING_CORRECTION_DEADLINE_MS = Number(
  process.env.WRITING_CORRECTION_DEADLINE_MS || (process.env.VERCEL ? 25000 : 60000)
);
const CRITERION_KEYS = [
  "instructions",
  "taskCompletion",
  "coherence",
  "grammar",
  "spelling",
  "vocabulary",
  "register",
];

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    score: { type: "number" },
    maxScore: { type: "number" },
    criterionScores: {
      type: "object",
      properties: {
        instructions: { type: "number" },
        taskCompletion: { type: "number" },
        coherence: { type: "number" },
        grammar: { type: "number" },
        spelling: { type: "number" },
        vocabulary: { type: "number" },
        register: { type: "number" },
      },
      required: CRITERION_KEYS,
    },
    strengths: {
      type: "array",
      items: { type: "string" },
    },
    weaknesses: {
      type: "array",
      items: { type: "string" },
    },
    feedback: { type: "string" },
    estimatedLevel: { type: "string" },
  },
  required: [
    "score",
    "maxScore",
    "criterionScores",
    "strengths",
    "weaknesses",
    "feedback",
    "estimatedLevel",
  ],
};

const BATCH_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    tasks: {
      type: "array",
      items: {
        type: "object",
        properties: {
          taskIndex: { type: "number" },
          score: { type: "number" },
          maxScore: { type: "number" },
          criterionScores: {
            type: "object",
            properties: {
              instructions: { type: "number" },
              taskCompletion: { type: "number" },
              coherence: { type: "number" },
              grammar: { type: "number" },
              spelling: { type: "number" },
              vocabulary: { type: "number" },
              register: { type: "number" },
            },
            required: CRITERION_KEYS,
          },
          strengths: {
            type: "array",
            items: { type: "string" },
          },
          weaknesses: {
            type: "array",
            items: { type: "string" },
          },
          feedback: { type: "string" },
          estimatedLevel: { type: "string" },
        },
        required: [
          "taskIndex",
          "score",
          "maxScore",
          "criterionScores",
          "strengths",
          "weaknesses",
          "feedback",
          "estimatedLevel",
        ],
      },
    },
  },
  required: ["tasks"],
};

class AiCorrectionError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "AiCorrectionError";
    this.status = options.status || null;
    this.transient = Boolean(options.transient);
    this.body = options.body || null;
    this.retryAfterMs = Number.isFinite(Number(options.retryAfterMs)) ? Number(options.retryAfterMs) : null;
  }
}

const asObject = (value) => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

const cleanText = (value, max = 6000) => {
  const text = String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n")
    .trim();
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 3)).trim()}...`;
};

const toNumber = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};

const roundScore = (value) => Math.round(toNumber(value, 0) * 100) / 100;

const clamp = (value, min, max) => Math.min(max, Math.max(min, toNumber(value, min)));

const hashValue = (value) =>
  crypto.createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

const uniqueStrings = (items, limit = 8) => {
  const seen = new Set();
  const output = [];
  for (const item of items || []) {
    const text = cleanText(item, 420);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
    if (output.length >= limit) break;
  }
  return output;
};

const normalizeArray = (value, limit = 8) => (Array.isArray(value) ? uniqueStrings(value, limit) : []);

const getCandidateModels = (primaryModel) => uniqueStrings([primaryModel, ...FALLBACK_MODELS], 5);

const getFirstPositiveNumber = (...values) => {
  for (const value of values) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
  }
  return null;
};

const getTaskMaxScore = (task, details, totalTasks) => {
  const scoring = asObject(task.scoring);
  const explicit = getFirstPositiveNumber(
    task.maxScore,
    task.taskMaxScore,
    task.points,
    task.partPoints,
    scoring.points,
    asObject(task.sectionScoring).points
  );
  if (explicit) return roundScore(explicit);

  const total = getFirstPositiveNumber(details.writingMaxScore, details.maxWritingScore, details.totalWritingScore);
  if (total) return roundScore(total / Math.max(1, totalTasks));

  return roundScore(100 / Math.max(1, totalTasks));
};

const answerForIndex = (answers, index) => {
  if (!answers || typeof answers !== "object") return "";
  return answers[index] ?? answers[String(index)] ?? "";
};

const isWritingSimulation = (simulation) => {
  const details = asObject(simulation?.result_details);
  const aiCorrections = asObject(simulation?.ai_corrections);
  const marker = [
    details.moduleId,
    details.module,
    aiCorrections.module,
    details.moduleTitle,
    details.moduleType,
    simulation?.exam_name,
  ]
    .filter(Boolean)
    .join(" ");
  const normalized = marker.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return /\bwrite\b|expression\s+ecrite|schreiben|written expression/i.test(normalized);
};

const buildTaskContexts = (simulation) => {
  const details = asObject(simulation.result_details);
  if (!isWritingSimulation(simulation)) return [];

  const answers = asObject(details.answers);
  const summaryRows = Array.isArray(asObject(details.summary).rows) ? asObject(details.summary).rows : [];
  const sourceTasks = Array.isArray(details.writingTasks) && details.writingTasks.length
    ? details.writingTasks
    : summaryRows.map((row, index) => ({
        taskId: row.id,
        title: row.title,
        typeLabel: row.typeLabel,
        instructions: row.correctAnswer,
        candidateResponse: answerForIndex(answers, index),
      }));

  if (!sourceTasks.length && Object.keys(answers).length) {
    return Object.keys(answers)
      .sort((a, b) => Number(a) - Number(b))
      .map((key, index, list) => {
        const task = { taskId: `answer-${key}`, title: `Writing task ${index + 1}` };
        const maxScore = getTaskMaxScore(task, details, list.length);
        return {
          index,
          taskId: task.taskId,
          title: task.title,
          instructions: "",
          subtitles: [],
          examType: details.examName || simulation.exam_name,
          moduleType: details.moduleTitle || details.moduleType || "Expression Ecrite",
          durationMinutes: null,
          maxScore,
          taskWeight: maxScore,
          level: details.level || simulation.level_current || "",
          minWords: null,
          targetWords: null,
          register: "",
          criteria: [],
          candidateResponse: cleanText(answers[key], 12000),
        };
      });
  }

  return sourceTasks.map((task, index) => {
    const subtitles = uniqueStrings([
      ...(Array.isArray(task.subtitles) ? task.subtitles : []),
      task.typeLabel,
      task.partTitle,
      task.sectionTitle,
    ]);
    const maxScore = getTaskMaxScore(task, details, sourceTasks.length);
    return {
      index,
      taskId: cleanText(task.taskId || task.id || task.sourceQuestionId || `task-${index + 1}`, 160),
      title: cleanText(task.title || task.question || `Writing task ${index + 1}`, 500),
      instructions: cleanText(task.instructions || task.prompt || task.partInstructions || task.question || "", 9000),
      subtitles,
      examType: cleanText(task.examType || details.examName || details.examCode || simulation.exam_name, 500),
      moduleType: cleanText(task.moduleType || details.moduleTitle || details.moduleType || "Expression Ecrite", 500),
      durationMinutes: getFirstPositiveNumber(task.durationMinutes, task.partDurationMinutes) || null,
      maxScore,
      taskWeight: roundScore(getFirstPositiveNumber(task.taskWeight, task.weight, maxScore) || maxScore),
      level: cleanText(task.level || details.level || simulation.level_current || "", 30),
      minWords: getFirstPositiveNumber(task.minWords),
      targetWords: getFirstPositiveNumber(task.targetWords),
      register: cleanText(task.register || "", 120),
      criteria: normalizeArray(task.criteria, 12),
      candidateResponse: cleanText(task.candidateResponse ?? answerForIndex(answers, index), 12000),
    };
  });
};

const buildPrompt = (task) => {
  const context = {
    examType: task.examType,
    moduleType: task.moduleType,
    title: task.title,
    subtitles: task.subtitles,
    instructions: task.instructions,
    durationMinutes: task.durationMinutes,
    maxScore: task.maxScore,
    taskWeight: task.taskWeight,
    expectedLevel: task.level,
    minimumWords: task.minWords,
    targetWords: task.targetWords,
    register: task.register,
    criteria: task.criteria,
    candidateResponse: task.candidateResponse,
  };

  return [
    "You are a certified examiner for German Expression Ecrite tasks.",
    "Evaluate only the candidate response against the task context. Do not invent missing content.",
    "Feedback must be in French, concise, practical, and examiner-style.",
    `The score must be between 0 and ${task.maxScore} and must never exceed the maximum score.`,
    "Criterion scores are diagnostic values from 0 to 10 for each criterion.",
    "Evaluate respect of instructions, task completion, coherence and organization, grammar and syntax, spelling and punctuation, vocabulary richness, register and tone.",
    "Return strict JSON only, matching the response schema.",
    "Task context:",
    JSON.stringify(context, null, 2),
  ].join("\n\n");
};

const extractJsonText = (value) => {
  const text = cleanText(value, 20000);
  if (!text) return "";
  if (text.startsWith("{")) return text;
  const match = text.match(/\{[\s\S]*\}/);
  return match ? match[0] : text;
};

const normalizeCriterionScores = (value) => {
  const raw = asObject(value);
  return Object.fromEntries(CRITERION_KEYS.map((key) => [key, roundScore(clamp(raw[key], 0, 10))]));
};

const normalizeEvaluation = (raw, task) => {
  const data = asObject(raw);
  const maxScore = roundScore(task.maxScore);
  return {
    score: roundScore(clamp(data.score, 0, maxScore)),
    maxScore,
    criterionScores: normalizeCriterionScores(data.criterionScores),
    strengths: normalizeArray(data.strengths, 6),
    weaknesses: normalizeArray(data.weaknesses, 6),
    feedback: cleanText(data.feedback || "Correction terminee.", 4500),
    estimatedLevel: cleanText(data.estimatedLevel || task.level || "", 20),
  };
};

const buildEmptyEvaluation = (task) => ({
  score: 0,
  maxScore: roundScore(task.maxScore),
  criterionScores: normalizeCriterionScores({}),
  strengths: [],
  weaknesses: ["Aucune reponse exploitable n'a ete fournie pour cette tache."],
  feedback: "Aucune reponse n'a ete fournie. La tache ne peut pas etre validee sans production ecrite.",
  estimatedLevel: task.level || "",
});

const buildUnavailableEvaluation = (task, message) => {
  const feedback = cleanText(
    message || "La correction IA est momentanement indisponible. La reponse est enregistree et pourra etre corrigee a nouveau.",
    1000
  );
  return {
    score: 0,
    maxScore: roundScore(task.maxScore),
    criterionScores: normalizeCriterionScores({}),
    strengths: [],
    weaknesses: [feedback],
    feedback,
    estimatedLevel: task.level || "",
  };
};

const isTransientStatus = (status) => status === 408 || status === 409 || status === 429 || status >= 500;

const callGemini = async ({ apiKey, model, prompt, timeoutMs = GEMINI_TIMEOUT_MS, responseSchema = RESPONSE_SCHEMA }) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));

  try {
    const response = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-goog-api-key": apiKey,
      },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.15,
          responseMimeType: "application/json",
          responseJsonSchema: responseSchema,
        },
      }),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const retryAfter = response.headers.get("retry-after");
      const retryAfterSeconds = Number(retryAfter);
      const retryAfterDate = retryAfter ? Date.parse(retryAfter) : NaN;
      const retryAfterMs = Number.isFinite(retryAfterSeconds)
        ? retryAfterSeconds * 1000
        : Number.isFinite(retryAfterDate)
          ? Math.max(0, retryAfterDate - Date.now())
          : null;
      throw new AiCorrectionError(`Gemini request failed (${response.status})`, {
        status: response.status,
        transient: isTransientStatus(response.status),
        body,
        retryAfterMs,
      });
    }

    const data = await response.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((part) => part?.text || "")
      .join("")
      .trim();

    if (!text) {
      throw new AiCorrectionError("Gemini returned an empty correction response", { transient: true });
    }

    try {
      return JSON.parse(extractJsonText(text));
    } catch (err) {
      throw new AiCorrectionError("Gemini returned invalid JSON", { transient: false, cause: err });
    }
  } catch (err) {
    if (err.name === "AbortError") {
      throw new AiCorrectionError("Gemini request timed out", { transient: true });
    }
    if (err instanceof AiCorrectionError) throw err;
    throw new AiCorrectionError(err.message || "Gemini request failed", { transient: true });
  } finally {
    clearTimeout(timeout);
  }
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const getRetryDelayMs = (err, attempt) => {
  const retryAfterMs = Number(err?.retryAfterMs);
  if (Number.isFinite(retryAfterMs) && retryAfterMs > 0) return Math.min(retryAfterMs, 10000);
  return err?.status === 429 ? 1500 * attempt * attempt : 500 * attempt * attempt;
};

const getCorrectionFailureMessage = (err) => {
  if (err?.status === 429) {
    return "Trop de demandes de correction en meme temps. Attendez environ une minute, puis relancez la correction.";
  }
  if (err?.status >= 500) {
    return "Le service de correction IA est surcharge pour le moment. Les reponses sont enregistrees; relancez la correction dans quelques instants.";
  }
  if (err?.message === "AI correction deadline reached" || err?.message === "Gemini request timed out") {
    return "La correction IA a pris trop de temps. Les reponses sont enregistrees; relancez la correction dans quelques instants.";
  }
  return "La correction IA est momentanement indisponible. Les reponses sont enregistrees; relancez la correction dans quelques instants.";
};

const evaluateTaskWithRetry = async ({ apiKey, model, task, deadlineAt = 0, maxAttempts = GEMINI_MAX_ATTEMPTS }) => {
  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const remainingMs = deadlineAt ? deadlineAt - Date.now() - 750 : GEMINI_TIMEOUT_MS;
      if (deadlineAt && remainingMs < 2500) {
        throw new AiCorrectionError("AI correction deadline reached", { transient: false });
      }
      const raw = await callGemini({
        apiKey,
        model,
        prompt: buildPrompt(task),
        timeoutMs: deadlineAt ? Math.min(GEMINI_TIMEOUT_MS, remainingMs) : GEMINI_TIMEOUT_MS,
      });
      return {
        evaluation: normalizeEvaluation(raw, task),
        attempts: attempt,
        model,
      };
    } catch (err) {
      lastError = err;
      if (!err.transient || attempt >= maxAttempts) break;
      const delayMs = getRetryDelayMs(err, attempt);
      if (deadlineAt && Date.now() + delayMs > deadlineAt - 750) break;
      await wait(delayMs);
    }
  }
  throw lastError;
};

const buildBatchPrompt = (tasks) => {
  const contexts = tasks.map((task) => ({
    taskIndex: task.index,
    examType: task.examType,
    moduleType: task.moduleType,
    title: task.title,
    subtitles: task.subtitles,
    instructions: task.instructions,
    durationMinutes: task.durationMinutes,
    maxScore: task.maxScore,
    taskWeight: task.taskWeight,
    expectedLevel: task.level,
    minimumWords: task.minWords,
    targetWords: task.targetWords,
    register: task.register,
    criteria: task.criteria,
    candidateResponse: task.candidateResponse,
  }));

  return [
    "You are a certified examiner for German Expression Ecrite tasks.",
    "Evaluate every task independently against its own task context. Do not let a good or bad answer affect another task.",
    "Do not invent missing candidate content. Feedback must be in French, concise, practical, and examiner-style.",
    "Each task score must be between 0 and that task's maxScore and must never exceed the maximum score.",
    "Criterion scores are diagnostic values from 0 to 10 for each criterion.",
    "Evaluate respect of instructions, task completion, coherence and organization, grammar and syntax, spelling and punctuation, vocabulary richness, register and tone.",
    "Return strict JSON only, matching the response schema.",
    "Return exactly one correction object for each supplied taskIndex.",
    "Task contexts:",
    JSON.stringify(contexts, null, 2),
  ].join("\n\n");
};

const evaluateTasksWithRetry = async ({ apiKey, model, tasks, deadlineAt = 0, maxAttempts = GEMINI_MAX_ATTEMPTS }) => {
  if (tasks.length === 1) {
    const result = await evaluateTaskWithRetry({ apiKey, model, task: tasks[0], deadlineAt, maxAttempts });
    return {
      attempts: result.attempts,
      model: result.model,
      results: [{ task: tasks[0], evaluation: result.evaluation, aiSucceeded: true, aiFailed: false, model: result.model }],
    };
  }

  let lastError;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const remainingMs = deadlineAt ? deadlineAt - Date.now() - 750 : GEMINI_TIMEOUT_MS;
      if (deadlineAt && remainingMs < 2500) {
        throw new AiCorrectionError("AI correction deadline reached", { transient: false });
      }

      const raw = await callGemini({
        apiKey,
        model,
        prompt: buildBatchPrompt(tasks),
        timeoutMs: deadlineAt ? Math.min(GEMINI_TIMEOUT_MS, remainingMs) : GEMINI_TIMEOUT_MS,
        responseSchema: BATCH_RESPONSE_SCHEMA,
      });
      const returnedTasks = Array.isArray(raw?.tasks) ? raw.tasks : [];
      if (!returnedTasks.length) {
        throw new AiCorrectionError("Gemini returned no task corrections", { transient: false });
      }

      const byIndex = new Map();
      for (const item of returnedTasks) {
        const index = Number(item?.taskIndex);
        if (Number.isInteger(index)) byIndex.set(index, item);
      }

      return {
        attempts: attempt,
        model,
        results: tasks.map((task) => {
          const rawTask = byIndex.get(task.index);
          if (!rawTask) {
            return {
              task,
              evaluation: buildUnavailableEvaluation(task, "La correction IA n'a pas retourne de resultat pour cette tache."),
              aiSucceeded: false,
              aiFailed: true,
              errorMessage: "Missing task correction in AI response.",
              model,
            };
          }
          return {
            task,
            evaluation: normalizeEvaluation(rawTask, task),
            aiSucceeded: true,
            aiFailed: false,
            model,
          };
        }),
      };
    } catch (err) {
      lastError = err;
      if (!err.transient || attempt >= maxAttempts) break;
      const delayMs = getRetryDelayMs(err, attempt);
      if (deadlineAt && Date.now() + delayMs > deadlineAt - 750) break;
      await wait(delayMs);
    }
  }
  throw lastError;
};

const ensureWritingCorrectionSchema = async (pool) => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS writing_corrections (
      id SERIAL PRIMARY KEY,
      simulation_id INTEGER NOT NULL UNIQUE REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'partial', 'failed')),
      provider TEXT NOT NULL DEFAULT 'gemini',
      model TEXT,
      total_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      max_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      percentage INTEGER,
      overall_feedback TEXT,
      overall_strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
      overall_weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
      error_message TEXT,
      request_hash TEXT,
      task_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      corrected_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS writing_corrections_user_created_idx
      ON writing_corrections(user_id, created_at DESC);
  `);
  await pool.query(`ALTER TABLE writing_corrections ENABLE ROW LEVEL SECURITY;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS writing_correction_tasks (
      id SERIAL PRIMARY KEY,
      correction_id INTEGER NOT NULL REFERENCES writing_corrections(id) ON DELETE CASCADE,
      simulation_id INTEGER NOT NULL REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      task_index INTEGER NOT NULL,
      task_id TEXT,
      title TEXT,
      instructions TEXT,
      subtitles JSONB NOT NULL DEFAULT '[]'::jsonb,
      exam_type TEXT,
      module_type TEXT,
      duration_minutes INTEGER,
      task_weight NUMERIC(8,2),
      response_text TEXT,
      score NUMERIC(8,2) NOT NULL DEFAULT 0,
      max_score NUMERIC(8,2) NOT NULL DEFAULT 0,
      criterion_scores JSONB NOT NULL DEFAULT '{}'::jsonb,
      strengths JSONB NOT NULL DEFAULT '[]'::jsonb,
      weaknesses JSONB NOT NULL DEFAULT '[]'::jsonb,
      feedback TEXT,
      estimated_level TEXT,
      model TEXT,
      request_hash TEXT,
      corrected_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (simulation_id, task_index)
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS writing_correction_tasks_correction_idx
      ON writing_correction_tasks(correction_id, task_index);
  `);
  await pool.query(`ALTER TABLE writing_correction_tasks ENABLE ROW LEVEL SECURITY;`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_correction_logs (
      id SERIAL PRIMARY KEY,
      correction_id INTEGER REFERENCES writing_corrections(id) ON DELETE SET NULL,
      simulation_id INTEGER REFERENCES simulations(id) ON DELETE CASCADE,
      user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
      task_index INTEGER,
      provider TEXT NOT NULL DEFAULT 'gemini',
      model TEXT,
      request_hash TEXT,
      status TEXT NOT NULL DEFAULT 'started',
      attempt_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT,
      request_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      response_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
  `);
  await pool.query(`
    CREATE INDEX IF NOT EXISTS ai_correction_logs_simulation_created_idx
      ON ai_correction_logs(simulation_id, created_at DESC);
  `);
  await pool.query(`ALTER TABLE ai_correction_logs ENABLE ROW LEVEL SECURITY;`);
};

const toTaskPayload = (row) => ({
  id: row.id,
  taskIndex: row.task_index,
  taskId: row.task_id,
  title: row.title,
  instructions: row.instructions,
  subtitles: Array.isArray(row.subtitles) ? row.subtitles : [],
  examType: row.exam_type,
  moduleType: row.module_type,
  durationMinutes: row.duration_minutes,
  taskWeight: row.task_weight == null ? null : Number(row.task_weight),
  score: Number(row.score),
  maxScore: Number(row.max_score),
  criterionScores: asObject(row.criterion_scores),
  strengths: Array.isArray(row.strengths) ? row.strengths : [],
  weaknesses: Array.isArray(row.weaknesses) ? row.weaknesses : [],
  feedback: row.feedback,
  estimatedLevel: row.estimated_level,
  model: row.model,
  correctedAt: row.corrected_at,
});

const toCorrectionPayload = (row, taskRows = []) => {
  if (!row) return null;
  return {
    id: row.id,
    simulationId: row.simulation_id,
    status: row.status,
    provider: row.provider,
    model: row.model,
    totalScore: Number(row.total_score),
    maxScore: Number(row.max_score),
    percentage: row.percentage,
    overallFeedback: row.overall_feedback,
    overallStrengths: Array.isArray(row.overall_strengths) ? row.overall_strengths : [],
    overallWeaknesses: Array.isArray(row.overall_weaknesses) ? row.overall_weaknesses : [],
    errorMessage: row.error_message,
    taskCount: row.task_count,
    correctedAt: row.corrected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    tasks: taskRows.map(toTaskPayload),
  };
};

const getWritingCorrectionForSimulation = async (pool, simulationId) => {
  const correction = await pool.query(
    `SELECT * FROM writing_corrections WHERE simulation_id = $1 LIMIT 1`,
    [simulationId]
  );
  const row = correction.rows[0];
  if (!row) return null;
  const tasks = await pool.query(
    `SELECT *
     FROM writing_correction_tasks
     WHERE correction_id = $1
     ORDER BY task_index, id`,
    [row.id]
  );
  return toCorrectionPayload(row, tasks.rows);
};

const insertLog = async (pool, params) => {
  const result = await pool.query(
    `INSERT INTO ai_correction_logs (
       correction_id, simulation_id, user_id, task_index, provider, model,
       request_hash, status, attempt_count, error_message, request_metadata
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING id`,
    [
      params.correctionId,
      params.simulationId,
      params.userId,
      params.taskIndex,
      PROVIDER,
      params.model,
      params.requestHash,
      params.status || "started",
      params.attemptCount || 0,
      params.errorMessage || null,
      JSON.stringify(params.requestMetadata || {}),
    ]
  );
  return result.rows[0].id;
};

const finishLog = async (pool, logId, params) => {
  await pool.query(
    `UPDATE ai_correction_logs
     SET status = $2,
         attempt_count = $3,
         error_message = $4,
         response_metadata = $5,
         completed_at = NOW()
     WHERE id = $1`,
    [
      logId,
      params.status,
      params.attemptCount || 0,
      params.errorMessage || null,
      JSON.stringify(params.responseMetadata || {}),
    ]
  );
};

const upsertTaskCorrection = async (pool, correction, task, evaluation, model, requestHash) => {
  await pool.query(
    `INSERT INTO writing_correction_tasks (
       correction_id, simulation_id, user_id, task_index, task_id, title, instructions,
       subtitles, exam_type, module_type, duration_minutes, task_weight, response_text,
       score, max_score, criterion_scores, strengths, weaknesses, feedback,
       estimated_level, model, request_hash, corrected_at, updated_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6, $7,
       $8, $9, $10, $11, $12, $13,
       $14, $15, $16, $17, $18, $19,
       $20, $21, $22, NOW(), NOW()
     )
     ON CONFLICT (simulation_id, task_index)
     DO UPDATE SET
       correction_id = EXCLUDED.correction_id,
       user_id = EXCLUDED.user_id,
       task_id = EXCLUDED.task_id,
       title = EXCLUDED.title,
       instructions = EXCLUDED.instructions,
       subtitles = EXCLUDED.subtitles,
       exam_type = EXCLUDED.exam_type,
       module_type = EXCLUDED.module_type,
       duration_minutes = EXCLUDED.duration_minutes,
       task_weight = EXCLUDED.task_weight,
       response_text = EXCLUDED.response_text,
       score = EXCLUDED.score,
       max_score = EXCLUDED.max_score,
       criterion_scores = EXCLUDED.criterion_scores,
       strengths = EXCLUDED.strengths,
       weaknesses = EXCLUDED.weaknesses,
       feedback = EXCLUDED.feedback,
       estimated_level = EXCLUDED.estimated_level,
       model = EXCLUDED.model,
       request_hash = EXCLUDED.request_hash,
       corrected_at = NOW(),
       updated_at = NOW()`,
    [
      correction.id,
      correction.simulation_id,
      correction.user_id,
      task.index,
      task.taskId,
      task.title,
      task.instructions,
      JSON.stringify(task.subtitles),
      task.examType,
      task.moduleType,
      task.durationMinutes,
      task.taskWeight,
      task.candidateResponse,
      evaluation.score,
      evaluation.maxScore,
      JSON.stringify(evaluation.criterionScores),
      JSON.stringify(evaluation.strengths),
      JSON.stringify(evaluation.weaknesses),
      evaluation.feedback,
      evaluation.estimatedLevel,
      model,
      requestHash,
    ]
  );
};

const buildOverall = (taskResults, status) => {
  const totalScore = roundScore(taskResults.reduce((sum, item) => sum + item.evaluation.score, 0));
  const maxScore = roundScore(taskResults.reduce((sum, item) => sum + item.evaluation.maxScore, 0));
  const percentage = maxScore > 0 ? Math.max(0, Math.min(100, Math.round((totalScore / maxScore) * 100))) : 0;
  const strengths = uniqueStrings(taskResults.flatMap((item) => item.evaluation.strengths), 6);
  const weaknesses = uniqueStrings(taskResults.flatMap((item) => item.evaluation.weaknesses), 6);

  let overallFeedback = "Correction terminee.";
  if (status === "failed") {
    overallFeedback = "La correction automatique n'a pas pu etre terminee. Les reponses sont enregistrees pour une nouvelle tentative.";
  } else if (status === "partial") {
    overallFeedback = "Correction partielle: certaines taches ont ete evaluees, mais au moins une correction IA a echoue.";
  } else if (percentage >= 85) {
    overallFeedback = "Tres bonne production: les consignes sont globalement respectees et le texte est efficace.";
  } else if (percentage >= 70) {
    overallFeedback = "Production solide: la tache est globalement accomplie, avec des points linguistiques a consolider.";
  } else if (percentage >= 50) {
    overallFeedback = "Production partiellement reussie: il faut renforcer la structure, la precision et la correction grammaticale.";
  } else {
    overallFeedback = "Production insuffisante: reprenez les consignes, structurez la reponse et corrigez les bases grammaticales.";
  }

  return {
    totalScore,
    maxScore,
    percentage,
    strengths,
    weaknesses,
    overallFeedback,
  };
};

const updateSimulationScore = async (pool, simulation, overall, correction) => {
  const summary = {
    status: correction.status,
    correctionId: correction.id,
    provider: correction.provider,
    model: correction.model,
    totalScore: overall.totalScore,
    maxScore: overall.maxScore,
    percentage: overall.percentage,
    correctedAt: new Date().toISOString(),
  };

  await pool.query(
    `UPDATE simulations
     SET score_pct = $2,
         ai_corrections = COALESCE(ai_corrections, '{}'::jsonb) || $3::jsonb
     WHERE id = $1`,
    [simulation.id, overall.percentage, JSON.stringify({ writingCorrection: summary })]
  );

  await pool.query(
    `UPDATE results
     SET score = $1
     WHERE user_id = $2
       AND exam_type = $3
       AND completed_at = $4`,
    [overall.percentage, simulation.user_id, String(simulation.exam_name || "").slice(0, 50), simulation.created_at]
  );
};

const prepareCorrectionRow = async (pool, simulation, requestHash, taskCount, maxScore, model, force) => {
  const existing = await pool.query(
    `SELECT * FROM writing_corrections WHERE simulation_id = $1 LIMIT 1`,
    [simulation.id]
  );
  const row = existing.rows[0];
  if (row && row.status === "completed" && row.request_hash === requestHash && !force) {
    return { correction: row, reusable: true };
  }
  if (row && row.status === "processing" && !force) {
    return { correction: row, reusable: true };
  }

  if (!row) {
    const inserted = await pool.query(
      `INSERT INTO writing_corrections (
         simulation_id, user_id, status, provider, model, request_hash, task_count,
         max_score, updated_at
       )
       VALUES ($1, $2, 'processing', $3, $4, $5, $6, $7, NOW())
       RETURNING *`,
      [simulation.id, simulation.user_id, PROVIDER, model, requestHash, taskCount, maxScore]
    );
    return { correction: inserted.rows[0], reusable: false };
  }

  const updated = await pool.query(
    `UPDATE writing_corrections
     SET status = 'processing',
         provider = $2,
         model = $3,
         request_hash = $4,
         task_count = $5,
         total_score = 0,
         max_score = $6,
         percentage = NULL,
         overall_feedback = NULL,
         overall_strengths = '[]'::jsonb,
         overall_weaknesses = '[]'::jsonb,
         error_message = NULL,
         updated_at = NOW(),
         corrected_at = NULL
     WHERE id = $1
     RETURNING *`,
    [row.id, PROVIDER, model, requestHash, taskCount, maxScore]
  );
  return { correction: updated.rows[0], reusable: false };
};

const correctWritingSimulation = async (pool, simulation, options = {}) => {
  const tasks = buildTaskContexts(simulation);
  if (!tasks.length) return null;

  const model = cleanText(options.model || DEFAULT_MODEL, 120);
  const requestHash = hashValue(tasks.map((task) => ({
    taskId: task.taskId,
    title: task.title,
    instructions: task.instructions,
    maxScore: task.maxScore,
    answer: task.candidateResponse,
  })));
  const expectedMaxScore = roundScore(tasks.reduce((sum, task) => sum + task.maxScore, 0));
  const { correction, reusable } = await prepareCorrectionRow(
    pool,
    simulation,
    requestHash,
    tasks.length,
    expectedMaxScore,
    model,
    Boolean(options.force)
  );
  if (reusable) return getWritingCorrectionForSimulation(pool, simulation.id);

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const deadlineAt = Date.now() + WRITING_CORRECTION_DEADLINE_MS;

  const taskHashFor = (task) => hashValue({ requestHash, taskIndex: task.index });
  const logIds = new Map();
  const taskResultsByIndex = new Map();

  await Promise.all(tasks.map(async (task) => {
    const taskHash = taskHashFor(task);
    const hasResponse = Boolean(task.candidateResponse.trim());
    const responseWords = task.candidateResponse.split(/\s+/).filter(Boolean).length;
    const logId = await insertLog(pool, {
      correctionId: correction.id,
      simulationId: simulation.id,
      userId: simulation.user_id,
      taskIndex: task.index,
      model,
      requestHash: taskHash,
      status: hasResponse && apiKey ? "started" : hasResponse ? "failed" : "skipped",
      requestMetadata: {
        taskId: task.taskId,
        title: task.title,
        maxScore: task.maxScore,
        responseWords,
        batch: true,
      },
    });
    logIds.set(task.index, logId);

    if (!hasResponse) {
      const evaluation = buildEmptyEvaluation(task);
      taskResultsByIndex.set(task.index, {
        task,
        evaluation,
        aiSucceeded: false,
        aiFailed: false,
      });
      await finishLog(pool, logId, {
        status: "skipped",
        responseMetadata: { reason: "empty_response" },
      });
    } else if (!apiKey) {
      const message = "GEMINI_API_KEY is not configured on the server.";
      const evaluation = buildUnavailableEvaluation(task, message);
      taskResultsByIndex.set(task.index, {
        task,
        evaluation,
        aiSucceeded: false,
        aiFailed: true,
        errorMessage: "La correction IA n'est pas configuree sur le serveur.",
      });
      await finishLog(pool, logId, {
        status: "failed",
        errorMessage: message,
      });
    }
  }));

  const aiTasks = tasks.filter((task) => task.candidateResponse.trim() && apiKey);
  if (aiTasks.length) {
    try {
      let batch = null;
      let lastError = null;
      const candidateModels = getCandidateModels(model);
      for (const candidateModel of candidateModels) {
        try {
          batch = await evaluateTasksWithRetry({
            apiKey,
            model: candidateModel,
            tasks: aiTasks,
            deadlineAt,
            maxAttempts: candidateModel === model ? Math.min(GEMINI_MAX_ATTEMPTS, 2) : 1,
          });
          break;
        } catch (err) {
          lastError = err;
          if (!err.transient || (deadlineAt && deadlineAt - Date.now() < 3500)) break;
        }
      }
      if (!batch) throw lastError || new AiCorrectionError("AI correction failed", { transient: true });

      await Promise.all(batch.results.map(async (result) => {
        taskResultsByIndex.set(result.task.index, result);
        await finishLog(pool, logIds.get(result.task.index), {
          status: result.aiSucceeded ? "completed" : "failed",
          attemptCount: batch.attempts,
          errorMessage: result.errorMessage || null,
          responseMetadata: result.aiSucceeded
            ? {
                score: result.evaluation.score,
                maxScore: result.evaluation.maxScore,
                estimatedLevel: result.evaluation.estimatedLevel,
                model: batch.model,
                batch: true,
              }
            : { batch: true },
        });
      }));
    } catch (err) {
      const userMessage = getCorrectionFailureMessage(err);
      await Promise.all(aiTasks.map(async (task) => {
        const evaluation = buildUnavailableEvaluation(task, userMessage);
        taskResultsByIndex.set(task.index, {
          task,
          evaluation,
          aiSucceeded: false,
          aiFailed: true,
          errorMessage: userMessage,
        });
        await finishLog(pool, logIds.get(task.index), {
          status: "failed",
          attemptCount: Math.min(GEMINI_MAX_ATTEMPTS, 2),
          errorMessage: cleanText(err.message || "AI correction failed", 1000),
          responseMetadata: {
            providerStatus: err?.status || null,
            batch: true,
          },
        });
      }));
    }
  }

  const taskResults = tasks.map((task) => taskResultsByIndex.get(task.index) || {
    task,
    evaluation: buildUnavailableEvaluation(task),
    aiSucceeded: false,
    aiFailed: true,
    errorMessage: "La correction IA est momentanement indisponible.",
  });

  await Promise.all(taskResults.map(({ task, evaluation, model: taskModel }) =>
    upsertTaskCorrection(pool, correction, task, evaluation, taskModel || model, taskHashFor(task))
  ));

  const aiSuccessCount = taskResults.filter((item) => item.aiSucceeded).length;
  const aiFailureCount = taskResults.filter((item) => item.aiFailed).length;

  const nonEmptyTasks = tasks.filter((task) => task.candidateResponse.trim()).length;
  const status =
    aiFailureCount && aiSuccessCount
      ? "partial"
      : aiFailureCount && nonEmptyTasks
        ? "failed"
        : "completed";
  const overall = buildOverall(taskResults, status);
  const finalModel = taskResults.find((item) => item.model)?.model || model;
  const failureMessages = uniqueStrings(taskResults.map((item) => item.errorMessage).filter(Boolean), 3);
  const errorMessage =
    status === "failed"
      ? failureMessages[0] || "La correction IA n'a pas pu corriger les taches non vides."
      : status === "partial"
        ? failureMessages[0] || "La correction IA a echoue pour au moins une tache."
        : null;

  const updated = await pool.query(
    `UPDATE writing_corrections
     SET status = $2,
         total_score = $3,
         max_score = $4,
         percentage = $5,
         overall_feedback = $6,
         overall_strengths = $7,
         overall_weaknesses = $8,
         error_message = $9,
         model = $10,
         updated_at = NOW(),
         corrected_at = NOW()
     WHERE id = $1
     RETURNING *`,
    [
      correction.id,
      status,
      overall.totalScore,
      overall.maxScore,
      overall.percentage,
      overall.overallFeedback,
      JSON.stringify(overall.strengths),
      JSON.stringify(overall.weaknesses),
      errorMessage,
      finalModel,
    ]
  );

  if (status === "completed" || status === "partial") {
    await updateSimulationScore(pool, simulation, overall, updated.rows[0]);
  }

  return getWritingCorrectionForSimulation(pool, simulation.id);
};

module.exports = {
  ensureWritingCorrectionSchema,
  correctWritingSimulation,
  getWritingCorrectionForSimulation,
  isWritingSimulation,
};
