const crypto = require("crypto");

const DEFAULT_PROVIDER = "elevenlabs";
const DEFAULT_MIME_TYPE = "audio/mpeg";
const MAX_TTS_CHARS = 3800;
const TTS_MAX_ATTEMPTS = Math.max(1, Number(process.env.TTS_MAX_ATTEMPTS) || 3);

class TtsConfigurationError extends Error {
  constructor(message, provider) {
    super(message);
    this.name = "TtsConfigurationError";
    this.provider = provider;
    this.publicMessage = message;
  }
}

class TtsProviderError extends Error {
  constructor(message, provider, status = 0) {
    super(message);
    this.name = "TtsProviderError";
    this.provider = provider;
    this.status = status;
    this.publicMessage = "Audio generation failed. Keep the previous audio and try again later.";
  }
}

const asObject = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};

const normalizeProvider = (value) =>
  String(value || process.env.TTS_PROVIDER || DEFAULT_PROVIDER)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-");

const hashObject = (value) =>
  crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

const stripProductionMarkers = (value) =>
  normalizeText(value)
    .replace(/^\s*(?:teil\s*\d+\s*[—-]\s*)?(?:script\s*)?\((?:dialog|dialogue|gespr[aä]ch|gespraech|monolog|monologue|interview|radio)\)\s*/i, " ")
    .replace(/\[(?:pause|stille|silence)\s*[0-9.,]*\s*(?:s|sec|secondes|sekunden)?\]/gi, " ")
    .replace(/\((?:pause|stille|silence)\s*[0-9.,]*\s*(?:s|sec|secondes|sekunden)?\)/gi, " ")
    .replace(/\b(?:pause|stille|silence)\s*[0-9.,]+\s*(?:s|sec|secondes|sekunden)\b/gi, " ")
    .replace(/\b(?:wiederholung|repeat|repetition)\s*:?.*$/gim, " ")
    .replace(/[•*#_`~|<>]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();

const normalizeKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const parseTextNumbers = (value) =>
  Array.from(String(value ?? "").matchAll(/\btexts?\s*([0-9,\s-]+)/gi))
    .flatMap((match) => String(match[1]).split(/[^0-9]+/).filter(Boolean).map(Number));

const normalizeSpeakerLabel = (value) => {
  const label = normalizeText(value)
    .replace(/^\s*(?:teil\s*\d+\s*[—-]\s*)?(?:script\s*)?\((?:dialog|dialogue|gespr[aä]ch|gespraech|monolog|monologue|interview|radio)\)\s*/i, "")
    .replace(/^\s*(?:text|track|audio|teil)\s*\d+\s*[—:.-]\s*/i, "")
    .trim();
  return label || "Narrator";
};

const isProductionOnlyLabel = (value) =>
  /^(?:text|track|audio|teil)\s*\d*$/i.test(normalizeText(value)) ||
  /^(?:(?:der|die|das)\s+.+|sie|script|dialog|dialogue|gespr[aä]ch|gespraech|monolog|monologue|interview|radio|thema|das thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|geh[oö]rt|format|transkription|transcription|type de t[aâ]che|heute|und|dann|erstens|zweitens|drittens|au[ßs]erdem|überraschungen|ueberraschungen|kluft|weltbild|sprache|achtsamkeit|pakete|qualit[aä]tsfinanzierung|qualitaetsfinanzierung|vorteile|nachteile|optionen|zum abschluss)$/i.test(normalizeText(value));

const cleanMatchedSpeakerLabel = (label) => {
  const normalized = normalizeSpeakerLabel(label);
  const protectedText = normalized.replace(/\bDr\.\s+/g, "Dr__DOT__ ");
  const parts = protectedText.split(/[.!?]\s+/).map((part) => part.replace(/Dr__DOT__/g, "Dr.").trim()).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : normalized.replace(/Dr__DOT__/g, "Dr.");
};

const splitSpeakerTurns = (text, trackIndex = 0) => {
  let normalized = stripProductionMarkers(text);
  if (!normalized) return [];
  normalized = normalized.replace(/^\s*(?:format|transkription|transcription)\s*:\s*/i, "").trim();
  if (/^\s*(?:(?:der|die|das)\s+[^:]+|sie|thema|das thema|aufgabe|aufgaben|frage|fragen|multiple-choice|richtig\/falsch|richtig falsch|loesung|lösung|antwort|skript|format|transkription|transcription|type de t[aâ]che|heute|und|dann|erstens|zweitens|drittens|au[ßs]erdem|überraschungen|ueberraschungen|kluft|weltbild|sprache|achtsamkeit|pakete|qualit[aä]tsfinanzierung|qualitaetsfinanzierung|vorteile|nachteile|optionen|zum abschluss)\s*:/i.test(normalized)) {
    return [];
  }
  const matches = Array.from(normalized.matchAll(/(^|[\s.!?\n])((?:Herr|Frau|Dr\.?|Moderator|Moderatorin|Reporter|Reporterin|Sprecher|Sprecherin|Person|Mann|Frau|[A-ZÄÖÜ][\p{Ll}.'-]+)(?:\s+(?:[A-ZÄÖÜ][\p{Ll}.'-]+|[A-Z]|\d+)){0,4})\s*:\s*/gu))
    .map((match) => {
      const label = cleanMatchedSpeakerLabel(match[2]);
      const labelOffset = match[0].lastIndexOf(label);
      return {
        index: match.index + (labelOffset >= 0 ? labelOffset : match[1].length),
        end: match.index + match[0].length,
        label,
      };
    })
    .filter((match) => !isProductionOnlyLabel(match.label));
  if (!matches.length) {
    return [{ trackIndex, speaker: "Narrator", text: stripProductionMarkers(normalized) }].filter((segment) => segment.text);
  }
  return matches.map((match, index) => {
    const start = match.end;
    const end = index + 1 < matches.length ? matches[index + 1].index : normalized.length;
    return {
      trackIndex,
      speaker: normalizeSpeakerLabel(match.label),
      text: stripProductionMarkers(normalized.slice(start, end)),
    };
  }).filter((segment) => segment.text);
};

const parseSpeed = (value, fallback = 1) => {
  const match = String(value ?? "").match(/([0-9.]+)\s*x/i);
  const number = match ? Number(match[1]) : Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(0.7, Math.min(1.25, number));
};

const clampNumber = (value, fallback, min, max) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
};

const getConfiguredProvider = () => {
  const preferred = normalizeProvider(process.env.TTS_PROVIDER);
  if (preferred && preferred !== DEFAULT_PROVIDER) return preferred;
  if (process.env.OPENAI_API_KEY) return "openai";
  if (process.env.ELEVENLABS_API_KEY) return "elevenlabs";
  if (process.env.GOOGLE_TTS_API_KEY) return "google";
  if (process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION) return "azure";
  if (process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) return "polly";
  return preferred || DEFAULT_PROVIDER;
};

const splitLongText = (text, maxChars = MAX_TTS_CHARS) => {
  const normalized = normalizeText(text);
  if (normalized.length <= maxChars) return [normalized].filter(Boolean);
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  sentences.forEach((sentence) => {
    if ((current + " " + sentence).trim().length <= maxChars) {
      current = `${current} ${sentence}`.trim();
      return;
    }
    if (current) chunks.push(current);
    if (sentence.length <= maxChars) {
      current = sentence;
      return;
    }
    for (let index = 0; index < sentence.length; index += maxChars) {
      chunks.push(sentence.slice(index, index + maxChars));
    }
    current = "";
  });
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
};

const parseSpeakerSegments = (audio = {}) => {
  const tracks = Array.isArray(audio.tracks) ? audio.tracks : [];
  const trackSegments = [];
  tracks.forEach((track, trackIndex) => {
    const trackAudio = asObject(track.audio);
    const text = normalizeText(track.transcript || trackAudio.transcript || "");
    if (!text) return;
    const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
    lines.forEach((line) => {
      const segments = splitSpeakerTurns(line, trackIndex);
      if (segments.length > 1 || segments[0]?.speaker !== "Narrator") {
        trackSegments.push(...segments);
      } else if (trackSegments.length) {
        trackSegments[trackSegments.length - 1].text = stripProductionMarkers(`${trackSegments[trackSegments.length - 1].text} ${line}`);
      } else {
        trackSegments.push(...segments);
      }
    });
  });

  if (trackSegments.length) return trackSegments.filter((segment) => segment.text);

  const transcript = normalizeText(audio.transcript || "");
  if (!transcript) return [];
  const lines = transcript.split("\n").map((line) => line.trim()).filter(Boolean);
  const segments = [];
  lines.forEach((line, index) => {
    const turns = splitSpeakerTurns(line, 0);
    if (turns.length > 1 || turns[0]?.speaker !== "Narrator") {
      segments.push(...turns);
    } else if (segments.length) {
      segments[segments.length - 1].text = stripProductionMarkers(`${segments[segments.length - 1].text} ${line}`);
    } else {
      segments.push(...turns);
    }
  });
  return segments.filter((segment) => segment.text);
};

const findSpeakerSettings = (audio, speakerName) => {
  const speakers = Array.isArray(audio.speakers) ? audio.speakers : [];
  const folded = normalizeKey(speakerName);
  const textNumber = Number((folded.match(/\btext\s*(\d+)\b/) || [])[1]);
  return speakers.find((speaker) => {
    const labels = [speaker.speaker, speaker.voiceName, speaker.id, speaker.role]
      .map(normalizeKey)
      .filter(Boolean);
    if (labels.some((label) => folded && (label === folded || folded.includes(label)))) return true;
    if (textNumber && labels.some((label) => parseTextNumbers(label).includes(textNumber))) return true;
    return false;
  }) || speakers[0] || {};
};

let voiceProfileSchemaPromise = null;

const ensureVoiceProfileSchema = async (pool) => {
  if (voiceProfileSchemaPromise) return voiceProfileSchemaPromise;
  voiceProfileSchemaPromise = (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS tts_voice_profiles (
        id SERIAL PRIMARY KEY,
        profile_key TEXT NOT NULL UNIQUE,
        label TEXT NOT NULL,
        provider TEXT NOT NULL DEFAULT 'elevenlabs',
        voice_id TEXT,
        gender TEXT NOT NULL CHECK (gender IN ('female', 'male', 'neutral')),
        role TEXT NOT NULL DEFAULT 'speaker',
        style TEXT,
        settings JSONB NOT NULL DEFAULT '{}'::jsonb,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE tts_voice_profiles ENABLE ROW LEVEL SECURITY;`);
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          REVOKE ALL ON TABLE tts_voice_profiles FROM anon;
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          REVOKE ALL ON TABLE tts_voice_profiles FROM authenticated;
        END IF;
      END $$;
    `);
    await pool.query(`
      INSERT INTO tts_voice_profiles (profile_key, label, provider, voice_id, gender, role, style, settings)
      VALUES
        ('de_female_1', 'Deutsch weiblich 1', 'elevenlabs', 'Xb7hH8MSUJpSbSDYk0k2', 'female', 'speaker', 'klar, freundlich', '{"stability":0.62,"similarity":0.78}'::jsonb),
        ('de_female_2', 'Deutsch weiblich 2', 'elevenlabs', 'XrExE9yKIg1WjnnlVkGX', 'female', 'speaker', 'natuerlich, ruhig', '{"stability":0.58,"similarity":0.76}'::jsonb),
        ('de_female_3', 'Deutsch weiblich 3', 'elevenlabs', 'pFZP5JQG7iQjIQuC4Bku', 'female', 'speaker', 'warm, professionell', '{"stability":0.60,"similarity":0.77}'::jsonb),
        ('de_male_1', 'Deutsch maennlich 1', 'elevenlabs', 'onwK4e9ZLuTAKqWW03F9', 'male', 'speaker', 'klar, neutral', '{"stability":0.62,"similarity":0.78}'::jsonb),
        ('de_male_2', 'Deutsch maennlich 2', 'elevenlabs', 'iP95p4xoKVk53GoZ742B', 'male', 'speaker', 'natuerlich, warm', '{"stability":0.58,"similarity":0.76}'::jsonb),
        ('de_male_3', 'Deutsch maennlich 3', 'elevenlabs', 'cjVigY5qzO86Huf0OWal', 'male', 'speaker', 'ruhig, vertrauenswuerdig', '{"stability":0.60,"similarity":0.77}'::jsonb)
      ON CONFLICT (profile_key) DO UPDATE SET
        label = EXCLUDED.label,
        provider = EXCLUDED.provider,
        voice_id = EXCLUDED.voice_id,
        gender = EXCLUDED.gender,
        role = EXCLUDED.role,
        style = EXCLUDED.style,
        settings = tts_voice_profiles.settings || EXCLUDED.settings,
        updated_at = NOW();
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS tts_voice_profiles_active_idx ON tts_voice_profiles(provider, gender, is_active);`);
  })().catch((err) => {
    voiceProfileSchemaPromise = null;
    throw err;
  });
  return voiceProfileSchemaPromise;
};

const getVoiceProfiles = async (pool) => {
  await ensureVoiceProfileSchema(pool);
  const result = await pool.query(
    `SELECT profile_key, label, provider, voice_id, gender, role, style, settings, is_active
       FROM tts_voice_profiles
      WHERE is_active = TRUE
      ORDER BY CASE gender WHEN 'female' THEN 1 WHEN 'male' THEN 2 ELSE 3 END, profile_key`
  );
  return result.rows;
};

const buildPromptedText = (segment, audio, speaker) => {
  const pauses = /interview|dialog|conversation|gespraech|telefon|radio/i.test(`${audio.scene} ${audio.documentType} ${audio.situation}`)
    ? "Use natural conversational pauses, turn-taking, and German exam clarity."
    : "Use clear standard German pronunciation for a listening exam.";
  const context = [
    audio.scene ? `Scene: ${audio.scene}.` : "",
    audio.situation ? `Situation: ${audio.situation}.` : "",
    speaker.emotion || speaker.style ? `Tone: ${speaker.emotion || speaker.style}.` : "",
    pauses,
  ].filter(Boolean).join(" ");
  return { text: segment.text, instructions: context };
};

const assertResponseOk = async (response, provider) => {
  if (response.ok) return;
  const body = await response.text().catch(() => "");
  const details = body.slice(0, 500);
  throw new TtsProviderError(`${provider} TTS request failed with HTTP ${response.status}. ${details}`, provider, response.status);
};

const synthesizeOpenAi = async ({ text, instructions, speaker }) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new TtsConfigurationError("OPENAI_API_KEY is not configured.", "openai");
  const voice =
    speaker.voiceId ||
    speaker.voice_id ||
    process.env.OPENAI_TTS_VOICE ||
    (speaker.suggestedGender === "male" ? "onyx" : "nova");
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      voice,
      input: text,
      instructions,
      response_format: "mp3",
      speed: parseSpeed(speaker.speed, 1),
    }),
  });
  await assertResponseOk(response, "openai");
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: DEFAULT_MIME_TYPE,
    model,
    voice,
  };
};

const synthesizeElevenLabs = async ({ text, speaker }) => {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new TtsConfigurationError("ELEVENLABS_API_KEY is not configured.", "elevenlabs");
  const voice = await findElevenLabsVoice(apiKey, speaker);
  const model = process.env.ELEVENLABS_MODEL_ID || "eleven_multilingual_v2";
  const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voice)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: DEFAULT_MIME_TYPE,
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: {
        stability: clampNumber(speaker.stability, 0.55, 0, 1),
        similarity_boost: clampNumber(speaker.similarity, 0.75, 0, 1),
        style: clampNumber(speaker.styleStrength, 0.15, 0, 1),
        use_speaker_boost: true,
      },
    }),
  });
  await assertResponseOk(response, "elevenlabs");
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: DEFAULT_MIME_TYPE,
    model,
    voice,
  };
};

const synthesizeGoogle = async ({ text, speaker }) => {
  const apiKey = process.env.GOOGLE_TTS_API_KEY;
  if (!apiKey) throw new TtsConfigurationError("GOOGLE_TTS_API_KEY is not configured.", "google");
  const voice = speaker.voiceId || speaker.voice_id || process.env.GOOGLE_TTS_VOICE || "de-DE-Neural2-B";
  const response = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      input: { text },
      voice: {
        languageCode: "de-DE",
        name: voice,
      },
      audioConfig: {
        audioEncoding: "MP3",
        speakingRate: parseSpeed(speaker.speed, 1),
        pitch: clampNumber(speaker.pitch, 0, -10, 10),
      },
    }),
  });
  await assertResponseOk(response, "google");
  const json = await response.json();
  if (!json.audioContent) throw new TtsProviderError("Google TTS returned no audio content.", "google");
  return {
    buffer: Buffer.from(json.audioContent, "base64"),
    mimeType: DEFAULT_MIME_TYPE,
    model: "google-cloud-text-to-speech",
    voice,
  };
};

const escapeSsml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const synthesizeAzure = async ({ text, speaker }) => {
  const key = process.env.AZURE_SPEECH_KEY;
  const region = process.env.AZURE_SPEECH_REGION;
  if (!key || !region) throw new TtsConfigurationError("AZURE_SPEECH_KEY and AZURE_SPEECH_REGION are not configured.", "azure");
  const voice = speaker.voiceId || speaker.voice_id || process.env.AZURE_TTS_VOICE || "de-DE-KatjaNeural";
  const ratePercent = Math.round((parseSpeed(speaker.speed, 1) - 1) * 100);
  const pitchPercent = Math.round(clampNumber(speaker.pitch, 0, -10, 10));
  const ssml = [
    `<speak version="1.0" xml:lang="de-DE">`,
    `<voice xml:lang="de-DE" name="${voice}">`,
    `<prosody rate="${ratePercent >= 0 ? "+" : ""}${ratePercent}%" pitch="${pitchPercent >= 0 ? "+" : ""}${pitchPercent}%">`,
    escapeSsml(text),
    `</prosody></voice></speak>`,
  ].join("");
  const response = await fetch(`https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: "POST",
    headers: {
      "Ocp-Apim-Subscription-Key": key,
      "Content-Type": "application/ssml+xml",
      "X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
      "User-Agent": "german-exam-app",
    },
    body: ssml,
  });
  await assertResponseOk(response, "azure");
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: DEFAULT_MIME_TYPE,
    model: "azure-ai-speech",
    voice,
  };
};

const hmac = (key, value, encoding) => crypto.createHmac("sha256", key).update(value).digest(encoding);
const sha256 = (value, encoding = "hex") => crypto.createHash("sha256").update(value).digest(encoding);

const signAwsRequest = ({ method, host, path, region, service, body, accessKeyId, secretAccessKey }) => {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const canonicalHeaders = `content-type:application/json\nhost:${host}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-date";
  const payloadHash = sha256(body);
  const canonicalRequest = [method, path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, credentialScope, sha256(canonicalRequest)].join("\n");
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  const signingKey = hmac(serviceKey, "aws4_request");
  const signature = hmac(signingKey, stringToSign, "hex");
  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "X-Amz-Date": amzDate,
  };
};

const synthesizePolly = async ({ text, speaker }) => {
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const region = process.env.AWS_REGION || "eu-central-1";
  if (!accessKeyId || !secretAccessKey) throw new TtsConfigurationError("AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are not configured.", "polly");
  const voice = speaker.voiceId || speaker.voice_id || process.env.POLLY_TTS_VOICE || (speaker.suggestedGender === "male" ? "Hans" : "Vicki");
  const body = JSON.stringify({
    Engine: process.env.POLLY_ENGINE || "neural",
    LanguageCode: "de-DE",
    OutputFormat: "mp3",
    Text: text,
    TextType: "text",
    VoiceId: voice,
  });
  const host = `polly.${region}.amazonaws.com`;
  const headers = signAwsRequest({
    method: "POST",
    host,
    path: "/v1/speech",
    region,
    service: "polly",
    body,
    accessKeyId,
    secretAccessKey,
  });
  const response = await fetch(`https://${host}/v1/speech`, {
    method: "POST",
    headers: {
      ...headers,
      "Content-Type": "application/json",
    },
    body,
  });
  await assertResponseOk(response, "polly");
  return {
    buffer: Buffer.from(await response.arrayBuffer()),
    mimeType: DEFAULT_MIME_TYPE,
    model: "amazon-polly",
    voice,
  };
};

const adapters = {
  openai: synthesizeOpenAi,
  elevenlabs: synthesizeElevenLabs,
  google: synthesizeGoogle,
  azure: synthesizeAzure,
  polly: synthesizePolly,
};

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const synthesizeWithRetry = async ({ adapter, provider, payload }) => {
  let lastError;
  for (let attempt = 1; attempt <= TTS_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await adapter(payload);
    } catch (error) {
      lastError = error;
      const status = Number(error.status) || 0;
      const retryable =
        !(error instanceof TtsConfigurationError) &&
        (!status || status === 408 || status === 429 || status >= 500);
      if (!retryable || attempt >= TTS_MAX_ATTEMPTS) break;
      await wait(450 * attempt);
    }
  }
  if (lastError instanceof TtsProviderError || lastError instanceof TtsConfigurationError) {
    throw lastError;
  }
  throw new TtsProviderError(`${provider} TTS request failed.`, provider);
};

let elevenLabsVoiceListCache = null;
const elevenLabsVoiceSelectionCache = new Map();

const getElevenLabsVoices = async (apiKey) => {
  if (Array.isArray(elevenLabsVoiceListCache)) return elevenLabsVoiceListCache;
  const response = await fetch("https://api.elevenlabs.io/v1/voices", {
    headers: {
      "xi-api-key": apiKey,
      Accept: "application/json",
    },
  });
  await assertResponseOk(response, "elevenlabs");
  const payload = await response.json();
  elevenLabsVoiceListCache = Array.isArray(payload.voices) ? payload.voices : [];
  return elevenLabsVoiceListCache;
};

const includesAny = (value, tokens = []) => tokens.some((token) => token && value.includes(token));

const findElevenLabsVoice = async (apiKey, speaker = {}) => {
  const configuredVoice =
    speaker.voiceId ||
    speaker.voice_id ||
    speaker.elevenLabsVoiceId;
  if (configuredVoice) return configuredVoice;

  const voiceName = String(speaker.voiceName || speaker.voice || "").trim().toLowerCase();
  const preferredGender = String(speaker.suggestedGender || speaker.gender || "").toLowerCase();
  const role = String(speaker.speaker || speaker.role || "").trim().toLowerCase();
  const style = String(speaker.style || speaker.emotion || "").trim().toLowerCase();
  const cacheKey = [voiceName, preferredGender, role, style].join("|");
  if (elevenLabsVoiceSelectionCache.has(cacheKey)) return elevenLabsVoiceSelectionCache.get(cacheKey);

  const voices = await getElevenLabsVoices(apiKey);
  const scoreVoice = (voice) => {
    const text = [
      voice.name,
      voice.category,
      voice.description,
      ...Object.values(asObject(voice.labels)),
    ].join(" ").toLowerCase();
    let score = 0;
    const name = String(voice.name || "").toLowerCase();
    const labels = asObject(voice.labels);
    const voiceGender = String(labels.gender || "").toLowerCase();
    if (voiceName && (name.includes(voiceName) || voiceName.includes(name.split(/\s+-\s+/)[0]))) score += 40;
    if (/german|deutsch|de[-_ ]?de/.test(text)) score += 12;
    if (/multilingual|european|accent/.test(text)) score += 4;
    if (preferredGender && (voiceGender === preferredGender || text.includes(preferredGender))) score += 10;
    if (!preferredGender && /frau|mutter|moderatorin|sprecherin|sara|anna|lena|miriam|frau/i.test(role) && voiceGender === "female") score += 7;
    if (!preferredGender && /herr|mann|vater|moderator|sprecher|holmar|thomas|klaus|dr\./i.test(role) && voiceGender === "male") score += 7;
    if (includesAny(style, ["radio", "moderator", "reporter"]) && /broadcast|news|informative|professional|educational/.test(text)) score += 5;
    if (includesAny(style, ["freund", "natural", "natürlich", "conversation", "curieux"]) && /conversation|casual|warm/.test(text)) score += 4;
    if (/premade|professional/.test(text)) score += 1;
    return score;
  };
  const selected = voices
    .map((voice) => ({ voice, score: scoreVoice(voice) }))
    .sort((a, b) => b.score - a.score)[0]?.voice;
  const fallback = process.env.ELEVENLABS_DEFAULT_VOICE_ID;
  const voiceId = selected?.voice_id || fallback;
  if (!voiceId) throw new TtsConfigurationError("No ElevenLabs voice is available for this account.", "elevenlabs");
  elevenLabsVoiceSelectionCache.set(cacheKey, voiceId);
  return voiceId;
};

let audioAssetSchemaPromise = null;

const ensureAudioAssetSchema = async (pool) => {
  if (audioAssetSchemaPromise) return audioAssetSchemaPromise;

  audioAssetSchemaPromise = (async () => {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS exam_audio_assets (
      id SERIAL PRIMARY KEY,
      source_exam_id INTEGER REFERENCES exams(id) ON DELETE CASCADE,
      content_hash TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL,
      provider_model TEXT,
      voice_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
      audio_config JSONB NOT NULL DEFAULT '{}'::jsonb,
      mime_type TEXT NOT NULL DEFAULT 'audio/mpeg',
      audio_data BYTEA,
      byte_size INTEGER NOT NULL DEFAULT 0,
      duration_seconds INTEGER,
      status TEXT NOT NULL DEFAULT 'ready',
      error_message TEXT,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
  await pool.query(`ALTER TABLE exam_audio_assets ENABLE ROW LEVEL SECURITY;`);
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        REVOKE ALL ON TABLE exam_audio_assets FROM anon;
      END IF;
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        REVOKE ALL ON TABLE exam_audio_assets FROM authenticated;
      END IF;
    END $$;
  `);
  await pool.query(`CREATE INDEX IF NOT EXISTS exam_audio_assets_exam_idx ON exam_audio_assets(source_exam_id, updated_at DESC);`);
  await pool.query(`CREATE INDEX IF NOT EXISTS exam_audio_assets_status_idx ON exam_audio_assets(status, updated_at DESC);`);
  })().catch((err) => {
    audioAssetSchemaPromise = null;
    throw err;
  });

  return audioAssetSchemaPromise;
};

const buildAudioContentHash = (audio, provider = getConfiguredProvider()) =>
  hashObject({
    provider: normalizeProvider(provider),
    transcript: normalizeText(audio?.transcript || ""),
    tracks: (Array.isArray(audio?.tracks) ? audio.tracks : []).map((track) => ({
      title: track.title,
      transcript: normalizeText(track.transcript || track.audio?.transcript || ""),
      audio: asObject(track.audio),
    })),
    speakers: Array.isArray(audio?.speakers) ? audio.speakers : [],
    ambience: Array.isArray(audio?.ambience) ? audio.ambience : [],
    sfx: audio?.sfx || "",
    rate: audio?.rate || "",
  });

const synthesizeAudio = async ({ audio, provider = getConfiguredProvider() }) => {
  const normalizedProvider = normalizeProvider(provider);
  const adapter = adapters[normalizedProvider];
  if (!adapter) throw new TtsConfigurationError(`Unsupported TTS provider: ${normalizedProvider}`, normalizedProvider);
  const segments = parseSpeakerSegments(audio);
  if (!segments.length) throw new TtsConfigurationError("No transcript text is available for audio generation.", normalizedProvider);

  const buffers = [];
  const voices = [];
  let model = "";
  let mimeType = DEFAULT_MIME_TYPE;

  for (const segment of segments) {
    const speaker = findSpeakerSettings(audio, segment.speaker);
    const { text, instructions } = buildPromptedText(segment, audio, speaker);
    const chunks = splitLongText(stripProductionMarkers(text));
    for (const chunk of chunks) {
      const result = await synthesizeWithRetry({
        adapter,
        provider: normalizedProvider,
        payload: { text: chunk, instructions, speaker, audio },
      });
      buffers.push(result.buffer);
      model = result.model || model;
      mimeType = result.mimeType || mimeType;
      voices.push({
        speaker: segment.speaker,
        provider: normalizedProvider,
        voice: result.voice || speaker.voiceName || speaker.voiceId || null,
      });
    }
  }

  return {
    buffer: Buffer.concat(buffers),
    mimeType,
    provider: normalizedProvider,
    model,
    voices,
    segmentCount: segments.length,
  };
};

const getAudioAssetForExam = async ({ pool, examId, audio, provider = getConfiguredProvider() }) => {
  await ensureAudioAssetSchema(pool);
  const contentHash = buildAudioContentHash(audio, provider);
  const result = await pool.query(
    `SELECT id, source_exam_id, content_hash, provider, provider_model, mime_type, byte_size,
            duration_seconds, status, error_message, updated_at
       FROM exam_audio_assets
      WHERE source_exam_id = $1 AND content_hash = $2
      ORDER BY updated_at DESC
      LIMIT 1`,
    [examId, contentHash]
  );
  return {
    contentHash,
    asset: result.rows[0] || null,
  };
};

const storeAudioAsset = async ({ pool, examId, audio, adminId = null, provider, generated }) => {
  await ensureAudioAssetSchema(pool);
  const contentHash = buildAudioContentHash(audio, provider);
  const audioConfig = {
    title: audio.title,
    speaker: audio.speaker,
    scene: audio.scene,
    situation: audio.situation,
    ambience: audio.ambience || [],
    tracks: (audio.tracks || []).map((track) => ({
      id: track.id,
      title: track.title,
      partNumber: track.partNumber,
      transcriptHash: hashObject(normalizeText(track.transcript || "")),
    })),
  };
  const result = await pool.query(
    `INSERT INTO exam_audio_assets (
       source_exam_id, content_hash, provider, provider_model, voice_summary, audio_config,
       mime_type, audio_data, byte_size, duration_seconds, status, error_message, created_by, updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7, $8, $9, $10, 'ready', NULL, $11, NOW())
     ON CONFLICT (content_hash)
     DO UPDATE SET
       provider = EXCLUDED.provider,
       provider_model = EXCLUDED.provider_model,
       voice_summary = EXCLUDED.voice_summary,
       audio_config = EXCLUDED.audio_config,
       mime_type = EXCLUDED.mime_type,
       audio_data = EXCLUDED.audio_data,
       byte_size = EXCLUDED.byte_size,
       duration_seconds = EXCLUDED.duration_seconds,
       status = 'ready',
       error_message = NULL,
       updated_at = NOW()
     RETURNING id, source_exam_id, content_hash, provider, provider_model, mime_type,
               byte_size, duration_seconds, status, updated_at`,
    [
      examId,
      contentHash,
      generated.provider,
      generated.model,
      JSON.stringify(generated.voices || []),
      JSON.stringify(audioConfig),
      generated.mimeType,
      generated.buffer,
      generated.buffer.length,
      null,
      adminId,
    ]
  );
  return result.rows[0];
};

const recordAudioFailure = async ({ pool, examId, audio, adminId = null, provider, error }) => {
  await ensureAudioAssetSchema(pool);
  const contentHash = buildAudioContentHash(audio, provider);
  const publicMessage = error.publicMessage || "Audio generation failed. Keep the previous audio and try again later.";
  await pool.query(
    `INSERT INTO exam_audio_assets (
       source_exam_id, content_hash, provider, audio_config, status, error_message, created_by, updated_at
     )
     VALUES ($1, $2, $3, $4::jsonb, 'failed', $5, $6, NOW())
     ON CONFLICT (content_hash)
     DO UPDATE SET status = 'failed', error_message = EXCLUDED.error_message, updated_at = NOW()`,
    [examId, contentHash, normalizeProvider(provider), JSON.stringify({ title: audio.title, speaker: audio.speaker }), publicMessage, adminId]
  );
};

const generateAndStoreExamAudio = async ({ pool, examId, audio, adminId = null, provider = getConfiguredProvider(), force = false }) => {
  await ensureAudioAssetSchema(pool);
  const { contentHash, asset } = await getAudioAssetForExam({ pool, examId, audio, provider });
  if (!force && asset?.status === "ready") {
    return { asset, cached: true, contentHash };
  }
  try {
    const generated = await synthesizeAudio({ audio, provider });
    const stored = await storeAudioAsset({ pool, examId, audio, adminId, provider, generated });
    return { asset: stored, cached: false, contentHash };
  } catch (error) {
    await recordAudioFailure({ pool, examId, audio, adminId, provider, error }).catch(() => {});
    throw error;
  }
};

const getAudioAssetById = async ({ pool, assetId }) => {
  await ensureAudioAssetSchema(pool);
  const result = await pool.query(
    `SELECT id, source_exam_id, content_hash, provider, provider_model, mime_type,
            audio_data, byte_size, status, updated_at
       FROM exam_audio_assets
      WHERE id = $1 AND status = 'ready' AND audio_data IS NOT NULL`,
    [assetId]
  );
  return result.rows[0] || null;
};

const getProviderStatus = () => {
  const providers = {
    openai: Boolean(process.env.OPENAI_API_KEY),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    google: Boolean(process.env.GOOGLE_TTS_API_KEY),
    azure: Boolean(process.env.AZURE_SPEECH_KEY && process.env.AZURE_SPEECH_REGION),
    polly: Boolean(process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
  };
  return {
    selected: getConfiguredProvider(),
    providers,
    anyConfigured: Object.values(providers).some(Boolean),
  };
};

module.exports = {
  buildAudioContentHash,
  ensureAudioAssetSchema,
  ensureVoiceProfileSchema,
  generateAndStoreExamAudio,
  getAudioAssetById,
  getAudioAssetForExam,
  getConfiguredProvider,
  getProviderStatus,
  getVoiceProfiles,
  normalizeProvider,
  parseSpeakerSegments,
  stripProductionMarkers,
  TtsConfigurationError,
  TtsProviderError,
};
