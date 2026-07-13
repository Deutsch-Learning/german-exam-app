const WORDS_PER_MINUTE = 132;
const MAX_UTTERANCE_CHARS = 240;
const VOICE_LOAD_TIMEOUT_MS = 2600;
const VOICE_LOAD_RETRY_MS = 180;
const DEFAULT_TURN_PAUSE_MS = 420;
const DEFAULT_SEGMENT_PAUSE_MS = 140;

const NAME_GENDER_HINTS = {
  female: [
    "anna", "anne", "eva", "julia", "julie", "maria", "sarah", "laura", "lena", "clara",
    "gabi", "sabine", "monika", "petra", "susanne", "katrin", "katja", "miriam", "frau",
    "mutter", "tochter", "moderatorin", "sprecherin", "lehrerin", "kundin", "karin",
    "nadine", "nicole", "stefanie", "verena", "hanna", "sophie", "frau dr",
  ],
  male: [
    "mike", "michael", "ben", "daniel", "frank", "paul", "peter", "thomas", "klaus",
    "markus", "herr", "vater", "sohn", "moderator", "sprecher", "lehrer", "kunde",
    "stefan", "hans", "max", "tim", "jan", "andreas", "martin", "herr dr",
  ],
};

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const normalizeKey = (value) =>
  normalizeText(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const isSpeechMetadataLine = (line = "") => {
  const key = normalizeKey(line);
  return (
    /^(type|type de document|voix|voice|sprecher|sprecherin|rolle|role|debit|tempo|style|registre|bruitages|sfx|transcription audio|transkription|transcript|script audio|skript|fiche de production|plan de production|profils? de voix)\b/.test(key) ||
    /^(femme|homme|female|male|frau|mann)\s+\d/.test(key) ||
    /^(debut|milieu|fin)\b/.test(key)
  );
};

const cleanSpeakableText = (value) =>
  normalizeText(value)
    .replace(/\[[^\]]*(?:geräusch|gerausch|musik|jingle|pause|hintergrund|background|sfx|lachen|applaus|signal|radio|cafe|café)[^\]]*\]/gi, " ")
    .replace(/[■•◆●]/g, " ")
    .replace(/\[\s*_{2,}\s*\]/g, " ")
    .replace(/\[\s*(?:\+|–|-|richtig|falsch)?\s*\]/gi, " ")
    .replace(/_{2,}/g, " ")
    .replace(/[|<>()[\]{}]/g, " ")
    .replace(/[“”"„]/g, "")
    .replace(/[+*=#\\/^`~@$%€£§©®™]/g, " ")
    .replace(/\b([a-d])\s*[.)]\s*/gi, "$1 ")
    .replace(/\b(?:text|track|audio|teil|part)\s*\d+\s*[:.-]\s*/gi, "")
    .replace(/\s*[-–—]\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const sanitizeTranscriptForSpeech = (value) => {
  const lines = normalizeText(value)
    .replace(/\[(?:pause|stille|silence)\s*([0-9]+(?:[.,][0-9]+)?)\s*(?:s|sec|sekunden?)?\]/gi, "\n[[pause:$1]]\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const cleanLines = [];

  for (const line of lines) {
    const key = normalizeKey(line);
    if (/^(aufgaben|aufgabe\s+\d|questions?|corrig|correction|loesung|losung|answer key)\b/.test(key)) break;
    if (isSpeechMetadataLine(line)) continue;
    if (/^\[\[\s*pause\s*:\s*[0-9.,]+\s*\]\]$/i.test(line)) {
      cleanLines.push(line.replace(",", "."));
      continue;
    }
    const cleanLine = cleanSpeakableText(line);
    if (cleanLine) cleanLines.push(cleanLine);
  }

  return cleanLines.join("\n").trim();
};

const splitIntoSpeakableChunks = (text) => {
  const normalized = cleanSpeakableText(text);
  if (normalized.length <= MAX_UTTERANCE_CHARS) return [normalized].filter(Boolean);
  const sentences = normalized.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let current = "";
  sentences.forEach((sentence) => {
    const next = `${current} ${sentence}`.trim();
    if (next.length <= MAX_UTTERANCE_CHARS) {
      current = next;
      return;
    }
    if (current) chunks.push(current);
    if (sentence.length <= MAX_UTTERANCE_CHARS) {
      current = sentence;
      return;
    }
    for (let index = 0; index < sentence.length; index += MAX_UTTERANCE_CHARS) {
      chunks.push(sentence.slice(index, index + MAX_UTTERANCE_CHARS));
    }
    current = "";
  });
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
};

const estimateDuration = (segments, rate = 0.92) => {
  const words = segments.reduce((sum, segment) => sum + String(segment.text || "").split(/\s+/).filter(Boolean).length, 0);
  const pauses = segments.reduce((sum, segment) => sum + Number(segment.pauseMs || 0) / 1000, 0);
  return Math.max(8, Math.round((words / WORDS_PER_MINUTE) * 60 / Math.max(0.65, Number(rate) || 0.92) + pauses));
};

const parseSegmentLine = (line, fallbackSpeaker) => {
  const pause = line.match(/^\[\[\s*pause\s*:\s*([0-9.]+)\s*\]\]$/i);
  if (pause) {
    return {
      speaker: fallbackSpeaker,
      text: "",
      pauseMs: Math.max(250, Math.min(5000, Math.round(Number(pause[1] || 1) * 1000))),
      type: "pause",
    };
  }
  const match = line.match(/^([^:\n]{2,56})\s*:\s*(.+)$/);
  if (!match) return { speaker: fallbackSpeaker, text: cleanSpeakableText(line) };
  return {
    speaker: cleanSpeakableText(match[1]),
    text: cleanSpeakableText(match[2]),
  };
};

export const parseListeningSpeechSegments = (audio = {}) => {
  const tracks = Array.isArray(audio.tracks) ? audio.tracks : [];
  const segments = [];
  tracks.forEach((track, trackIndex) => {
    const text = sanitizeTranscriptForSpeech(track.transcript || track.audio?.transcript || "");
    const fallbackSpeaker = track.title || `Narrator ${trackIndex + 1}`;
    text.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const parsed = parseSegmentLine(line, fallbackSpeaker);
      if (parsed.speaker === fallbackSpeaker && segments.length && !segments[segments.length - 1].pauseMs && !/[.!?]$/.test(segments[segments.length - 1].text)) {
        segments[segments.length - 1].text = normalizeText(`${segments[segments.length - 1].text} ${parsed.text}`);
        return;
      }
      segments.push(parsed);
    });
  });

  if (segments.length) return segments.filter((segment) => segment.text || segment.pauseMs);

  return sanitizeTranscriptForSpeech(audio.transcript || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSegmentLine(line, "Narrator"))
    .filter((segment) => segment.text || segment.pauseMs);
};

const parseTextNumbers = (value) =>
  Array.from(String(value ?? "").matchAll(/\btexts?\s*([0-9,\s-]+)/gi))
    .flatMap((match) => String(match[1]).split(/[^0-9]+/).filter(Boolean).map(Number));

const findSpeakerSetting = (audio, speakerName) => {
  const speakers = Array.isArray(audio?.speakers) ? audio.speakers : [];
  if (!speakers.length) return {};
  const key = normalizeKey(speakerName);
  const textNumber = Number((key.match(/\btext\s*(\d+)\b/) || [])[1]);

  return speakers.find((speaker) => {
    const labels = [speaker.speaker, speaker.voiceName, speaker.id, speaker.role]
      .map(normalizeKey)
      .filter(Boolean);
    if (labels.some((label) => label === key || label.includes(key) || key.includes(label))) return true;
    if (textNumber && labels.some((label) => parseTextNumbers(label).includes(textNumber))) return true;
    return false;
  }) || {};
};

const inferGender = (speakerName, setting = {}) => {
  const direct = normalizeKey(setting.suggestedGender || setting.gender);
  if (direct.includes("female") || direct.includes("femme") || direct.includes("frau")) return "female";
  if (direct.includes("male") || direct.includes("homme") || direct.includes("herr")) return "male";

  const haystack = normalizeKey([
    speakerName,
    setting.speaker,
    setting.voiceName,
    setting.role,
    setting.style,
    setting.emotion,
  ].filter(Boolean).join(" "));

  if (NAME_GENDER_HINTS.female.some((token) => haystack.includes(token))) return "female";
  if (NAME_GENDER_HINTS.male.some((token) => haystack.includes(token))) return "male";
  return "neutral";
};

const scoreVoice = (voice, gender) => {
  const text = normalizeKey([voice.name, voice.lang, voice.voiceURI, voice.localService ? "local" : ""].join(" "));
  let score = 0;
  if (/^de\b/i.test(voice.lang || "") || text.includes("german") || text.includes("deutsch")) score += 30;
  if (/google|microsoft|apple|siri|neural|natural|online/.test(text)) score += 10;
  if (voice.localService) score += 2;
  if (gender === "female" && /\bfemale\b|frau|anna|sarah|laura|alice|lena|maria|katja|vicki|helena|google deutsch/.test(text)) score += 16;
  if (gender === "male" && /\bmale\b|herr|paul|markus|klaus|liam|roger|george|hans|stefan/.test(text)) score += 16;
  if (gender === "neutral" && /deutsch|german|google/.test(text)) score += 8;
  return score;
};

const voiceLooksFemale = (voice) => /\bfemale\b|frau|anna|sarah|laura|alice|lena|maria|katja|vicki|helena/.test(normalizeKey([voice.name, voice.voiceURI].join(" ")));
const voiceLooksMale = (voice) => /\bmale\b|herr|paul|markus|klaus|liam|roger|george|hans|stefan/.test(normalizeKey([voice.name, voice.voiceURI].join(" ")));

const getVoicePools = (voices = []) => {
  const german = voices.filter((voice) => /^de\b/i.test(voice.lang || "") || /german|deutsch/i.test(voice.name || ""));
  const base = german.length ? german : voices;
  const sorted = [...base].sort((a, b) => scoreVoice(b, "neutral") - scoreVoice(a, "neutral") || String(a.name).localeCompare(String(b.name)));
  const female = base.filter(voiceLooksFemale);
  const male = base.filter(voiceLooksMale);
  return {
    female: (female.length ? female : base).sort((a, b) => scoreVoice(b, "female") - scoreVoice(a, "female") || String(a.name).localeCompare(String(b.name))),
    male: (male.length ? male : base).sort((a, b) => scoreVoice(b, "male") - scoreVoice(a, "male") || String(a.name).localeCompare(String(b.name))),
    neutral: sorted,
  };
};

const getVoiceSignature = (voice) => normalizeKey([voice?.name, voice?.lang, voice?.voiceURI].filter(Boolean).join(" "));

const buildSpeakerKey = (speakerName) => normalizeKey(speakerName) || "narrator";

const isStructuralSpeakerLabel = (speakerName) => {
  const key = buildSpeakerKey(speakerName);
  return /^(text|teil|part|section|transkription|transcript|narrator|narration|dialog|dialogue|gespraech|gesprach|monolog|monologue|ansage)\b/.test(key) || key.includes(" kurztexte text ");
};

const hasSpeakerSetting = (setting = {}) => Object.keys(setting).length > 0;

const normalizeSpeechRate = (...values) => {
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return Math.max(0.82, Math.min(0.98, numeric));
    const key = normalizeKey(value);
    if (!key) continue;
    if (/(langsam|slow|ruhig|calm|lent)/.test(key)) return 0.86;
    if (/(schnell|fast|rapid|vite)/.test(key)) return 0.96;
    if (/(moderat|normal|standard|mittel|moyen)/.test(key)) return 0.9;
  }
  return 0.9;
};

const getGenderPitch = (gender) => {
  // Browser TTS voices crack easily when pitch is forced. Keep the native voice natural.
  if (gender === "male") return 1;
  if (gender === "female") return 1;
  return 1;
};

const getGenderRateOffset = (gender) => {
  if (gender === "male") return -0.015;
  if (gender === "female") return 0.01;
  return 0;
};

const isProbablyMobile = () => {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile|samsungbrowser|wv\)/i.test(navigator.userAgent || "");
};

const getUserActivationState = () => {
  if (typeof navigator === "undefined" || !navigator.userActivation) return "unknown";
  if (navigator.userActivation.isActive) return "active";
  if (navigator.userActivation.hasBeenActive) return "previously-active";
  return "inactive";
};

export const getBrowserSpeechSupport = () => {
  if (typeof window === "undefined") {
    return {
      supported: false,
      hasSpeechSynthesis: false,
      hasUtterance: false,
      isMobile: false,
      userAgent: "",
      reason: "not-in-browser",
    };
  }
  const hasSpeechSynthesis = Boolean(window.speechSynthesis);
  const hasUtterance = Boolean(window.SpeechSynthesisUtterance);
  return {
    supported: hasSpeechSynthesis && hasUtterance,
    hasSpeechSynthesis,
    hasUtterance,
    isMobile: isProbablyMobile(),
    userAgent: navigator.userAgent || "",
    reason: hasSpeechSynthesis && hasUtterance ? "" : "speech-api-missing",
  };
};

export const buildListeningVoicePlan = ({ audio = {}, voices = [] } = {}) => {
  const segments = parseListeningSpeechSegments(audio);
  const pools = getVoicePools(voices);
  const assignments = new Map();
  const usage = { female: 0, male: 0, neutral: 0 };
  const segmentSettings = segments.map((segment) => ({
    segment,
    setting: findSpeakerSetting(audio, segment.speaker),
  }));
  const dialogueKeys = new Set(
    segmentSettings
      .filter(({ segment }) => !segment.pauseMs)
      .filter(({ segment, setting }) => !isStructuralSpeakerLabel(segment.speaker) || hasSpeakerSetting(setting))
      .map(({ segment }) => buildSpeakerKey(segment.speaker))
  );
  const hasDialogue = dialogueKeys.size > 1;
  let dialogueVoiceIndex = 0;

  segmentSettings.forEach(({ segment, setting }) => {
    if (segment.pauseMs) return;
    const speakerKey = hasDialogue ? buildSpeakerKey(segment.speaker) : "narrator";
    if (assignments.has(speakerKey)) return;
    const gender = hasDialogue ? inferGender(segment.speaker, setting) : "neutral";
    const pool = pools[gender]?.length ? pools[gender] : pools.neutral;
    let voice = pool.length ? pool[usage[gender] % pool.length] : null;
    if (hasDialogue && pool.length > 1 && !voiceLooksFemale(voice) && !voiceLooksMale(voice)) {
      voice = pool[dialogueVoiceIndex % pool.length];
      dialogueVoiceIndex += 1;
    }
    usage[gender] += 1;
    const sameVoiceUsedForMultipleSpeakers = Array.from(assignments.values()).some(
      (assignment) => getVoiceSignature(assignment.voice) && getVoiceSignature(assignment.voice) === getVoiceSignature(voice)
    );
    assignments.set(speakerKey, {
      speakerKey,
      speaker: hasDialogue ? segment.speaker : "Narrator",
      gender,
      voice,
      voiceName: voice?.name || "Browser default German voice",
      lang: voice?.lang || "de-DE",
      rate: Math.max(0.84, Math.min(0.96, normalizeSpeechRate(setting.speed, setting.rate, audio.rate) + getGenderRateOffset(gender))),
      pitch: sameVoiceUsedForMultipleSpeakers ? 1 : getGenderPitch(gender),
    });
  });

  const fallback = assignments.get("narrator") || Array.from(assignments.values())[0] || {
    speakerKey: "narrator",
    speaker: "Narrator",
    gender: "neutral",
    voice: null,
    voiceName: "Browser default German voice",
    lang: "de-DE",
    rate: normalizeSpeechRate(audio.rate),
    pitch: 1,
  };

  return {
    isDialogue: hasDialogue,
    segments,
    duration: estimateDuration(segments, audio.rate),
    assignments: Object.fromEntries(assignments),
    fallback,
  };
};

export const loadListeningBrowserVoices = ({ timeoutMs = VOICE_LOAD_TIMEOUT_MS, retryMs = VOICE_LOAD_RETRY_MS, onDebug } = {}) =>
  new Promise((resolve) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      resolve([]);
      return;
    }
    const synth = window.speechSynthesis;
    const current = synth.getVoices();
    if (current.length) {
      onDebug?.({ type: "voices-ready", count: current.length, source: "initial" });
      resolve(current);
      return;
    }

    const startedAt = Date.now();
    const previousHandler = synth.onvoiceschanged;
    let interval = null;
    let settled = false;

    const done = (source) => {
      if (settled) return;
      const voices = synth.getVoices();
      if (!voices.length && source !== "timeout") return;
      settled = true;
      if (interval) window.clearInterval(interval);
      window.clearTimeout(timer);
      synth.onvoiceschanged = previousHandler;
      onDebug?.({
        type: voices.length ? "voices-ready" : "voices-empty",
        count: voices.length,
        elapsedMs: Date.now() - startedAt,
        source,
      });
      resolve(voices);
    };

    const timer = window.setTimeout(() => {
      done("timeout");
    }, timeoutMs);

    interval = window.setInterval(() => done("retry"), retryMs);
    synth.onvoiceschanged = () => {
      done("voiceschanged");
    };
  });

const isTransientSpeechError = (error) =>
  /interrupted|canceled|cancelled|network|synthesis|audio-busy|not-allowed/i.test(String(error || ""));

export const createListeningSpeechFallback = ({ audio, onTime, onEnd, onError, onDebug }) => {
  const support = getBrowserSpeechSupport();
  if (!support.supported) {
    onDebug?.({ type: "unsupported", support });
    return null;
  }

  const synth = window.speechSynthesis;
  const initialPlan = buildListeningVoicePlan({ audio, voices: [] });
  if (!initialPlan.segments.length) return null;

  let plan = initialPlan;
  let queue = [];
  let index = 0;
  let active = false;
  let paused = false;
  let startedAt = 0;
  let elapsedBefore = 0;
  let timer = null;
  let keepAliveTimer = null;
  let voicesReady = false;
  let lastError = "";
  let fallbackTriggered = false;
  let userActivationAtPlay = "unknown";

  const emitDebug = (event) => {
    onDebug?.({
      support,
      isMobile: support.isMobile,
      voiceCount: synth.getVoices().length,
      voicesReady,
      active,
      paused,
      index,
      userActivationAtPlay,
      fallbackTriggered,
      lastError,
      ...event,
    });
  };

  const clearTimer = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  };

  const stopKeepAlive = () => {
    if (keepAliveTimer) window.clearInterval(keepAliveTimer);
    keepAliveTimer = null;
  };

  const currentElapsed = () => {
    if (!active || paused) return elapsedBefore;
    return Math.min(plan.duration, elapsedBefore + (Date.now() - startedAt) / 1000);
  };

  const startTimer = () => {
    clearTimer();
    timer = window.setInterval(() => onTime?.(Math.round(currentElapsed())), 250);
  };

  const startKeepAlive = () => {
    stopKeepAlive();
    keepAliveTimer = window.setInterval(() => {
      if (active && !paused && synth.speaking && !synth.paused) {
        synth.resume();
      }
    }, 9000);
  };

  const finish = () => {
    active = false;
    paused = false;
    clearTimer();
    stopKeepAlive();
    onTime?.(plan.duration);
    onEnd?.();
  };

  const speakNext = () => {
    if (!active || index >= queue.length) {
      finish();
      return;
    }

    const item = queue[index];
    if (item.type === "pause") {
      const pauseMs = Math.max(120, Number(item.pauseMs || DEFAULT_SEGMENT_PAUSE_MS));
      window.setTimeout(() => {
        if (!active || paused) return;
        index += 1;
        elapsedBefore = Math.min(plan.duration, elapsedBefore + pauseMs / 1000);
        startedAt = Date.now();
        speakNext();
      }, pauseMs);
      return;
    }

    const utterance = new window.SpeechSynthesisUtterance(item.text);
    utterance.lang = item.assignment.lang || "de-DE";
    utterance.rate = item.assignment.rate;
    utterance.pitch = item.assignment.pitch;
    utterance.volume = 1;
    if (item.assignment.voice) utterance.voice = item.assignment.voice;
    utterance.onend = () => {
      index += 1;
      elapsedBefore = Math.min(plan.duration, elapsedBefore + estimateDuration([item], audio.rate));
      startedAt = Date.now();
      const next = queue[index];
      const speakerChanged = next?.assignment?.speakerKey && next.assignment.speakerKey !== item.assignment.speakerKey;
      window.setTimeout(() => {
        if (!active || paused) return;
        speakNext();
      }, speakerChanged ? DEFAULT_TURN_PAUSE_MS : DEFAULT_SEGMENT_PAUSE_MS);
    };
    utterance.onerror = (event) => {
      if (!active) return;
      const error = event?.error || "speech-failed";
      item.retries = Number(item.retries || 0);
      if (item.retries < 2 && isTransientSpeechError(error)) {
        item.retries += 1;
        emitDebug({ type: "speech-retry", error, retries: item.retries, textPreview: item.text.slice(0, 60) });
        window.setTimeout(() => {
          if (!active || paused) return;
          synth.resume();
          speakNext();
        }, 160);
        return;
      }
      lastError = error;
      fallbackTriggered = true;
      active = false;
      paused = false;
      clearTimer();
      stopKeepAlive();
      emitDebug({ type: "speech-error", error });
      onError?.(error);
    };
    try {
      synth.resume();
      synth.speak(utterance);
    } catch (error) {
      if (!active) return;
      lastError = error?.message || "speech-failed";
      fallbackTriggered = true;
      active = false;
      paused = false;
      clearTimer();
      stopKeepAlive();
      emitDebug({ type: "speech-throw", error: lastError });
      onError?.(error?.message || "speech-failed");
    }
  };

  const rebuildQueue = (voices) => {
    plan = buildListeningVoicePlan({ audio, voices });
    queue = plan.segments.flatMap((segment) => {
      if (segment.pauseMs) {
        return [{ ...segment, type: "pause", durationSeconds: segment.pauseMs / 1000 }];
      }
      const key = plan.isDialogue ? buildSpeakerKey(segment.speaker) : "narrator";
      const assignment = plan.assignments[key] || plan.fallback;
      return splitIntoSpeakableChunks(segment.text).map((text) => ({
        ...segment,
        text,
        assignment,
      }));
    });
  };

  rebuildQueue(synth.getVoices());

  const warmVoices = () => {
    if (voicesReady) return;
    voicesReady = true;
    void loadListeningBrowserVoices({ onDebug: emitDebug }).then((voices) => {
      if (voices.length && !active && !paused) rebuildQueue(voices);
    });
  };

  warmVoices();

  return {
    play: () => {
      userActivationAtPlay = getUserActivationState();
      emitDebug({ type: "play-requested" });
      if (paused) {
        paused = false;
        startedAt = Date.now();
        synth.resume();
        startTimer();
        startKeepAlive();
        emitDebug({ type: "resumed" });
        return Promise.resolve();
      }
      if (active) return Promise.resolve();
      rebuildQueue(synth.getVoices());
      warmVoices();
      if (!queue.length) return Promise.reject(new Error("no-speech-segments"));
      synth.cancel();
      synth.resume();
      active = true;
      paused = false;
      index = 0;
      elapsedBefore = 0;
      startedAt = Date.now();
      lastError = "";
      fallbackTriggered = false;
      onTime?.(0);
      startTimer();
      startKeepAlive();
      speakNext();
      emitDebug({ type: "started", queueLength: queue.length });
      return Promise.resolve();
    },
    pause: () => {
      if (!active || paused) return;
      elapsedBefore = currentElapsed();
      paused = true;
      clearTimer();
      stopKeepAlive();
      synth.pause();
      onTime?.(Math.round(elapsedBefore));
      emitDebug({ type: "paused" });
    },
    reset: () => {
      active = false;
      paused = false;
      index = 0;
      elapsedBefore = 0;
      clearTimer();
      stopKeepAlive();
      synth.cancel();
      onTime?.(0);
      emitDebug({ type: "reset" });
    },
    dispose: () => {
      active = false;
      paused = false;
      clearTimer();
      stopKeepAlive();
      synth.cancel();
      emitDebug({ type: "disposed" });
    },
    getVoicePlan: () => plan,
    getDebugInfo: () => ({
      support,
      isMobile: support.isMobile,
      voiceCount: synth.getVoices().length,
      voicesReady,
      active,
      paused,
      userActivationAtPlay,
      fallbackTriggered,
      lastError,
      selectedVoices: Object.values(plan.assignments || {}).map((assignment) => ({
        speaker: assignment.speaker,
        gender: assignment.gender,
        voiceName: assignment.voiceName,
        lang: assignment.lang,
      })),
    }),
    duration: plan.duration,
  };
};
