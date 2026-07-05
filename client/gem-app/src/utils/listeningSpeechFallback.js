const WORDS_PER_MINUTE = 132;
const MAX_UTTERANCE_CHARS = 220;

const NAME_GENDER_HINTS = {
  female: [
    "anna", "anne", "eva", "julia", "julie", "maria", "sarah", "laura", "lena", "clara",
    "gabi", "sabine", "monika", "petra", "susanne", "katrin", "katja", "miriam", "frau",
    "mutter", "tochter", "moderatorin", "sprecherin", "lehrerin", "kundin",
  ],
  male: [
    "mike", "michael", "ben", "daniel", "frank", "paul", "peter", "thomas", "klaus",
    "markus", "herr", "vater", "sohn", "moderator", "sprecher", "lehrer", "kunde",
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

const splitIntoSpeakableChunks = (text) => {
  const normalized = normalizeText(text);
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
  const words = segments.reduce((sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(8, Math.round((words / WORDS_PER_MINUTE) * 60 / Math.max(0.65, Number(rate) || 0.92)));
};

const parseSegmentLine = (line, fallbackSpeaker) => {
  const match = line.match(/^([^:\n]{2,56})\s*:\s*(.+)$/);
  if (!match) return { speaker: fallbackSpeaker, text: line };
  return {
    speaker: match[1].trim(),
    text: normalizeText(match[2]),
  };
};

export const parseListeningSpeechSegments = (audio = {}) => {
  const tracks = Array.isArray(audio.tracks) ? audio.tracks : [];
  const segments = [];
  tracks.forEach((track, trackIndex) => {
    const text = normalizeText(track.transcript || track.audio?.transcript || "");
    const fallbackSpeaker = track.title || `Narrator ${trackIndex + 1}`;
    text.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const parsed = parseSegmentLine(line, fallbackSpeaker);
      if (parsed.speaker === fallbackSpeaker && segments.length && !/[.!?]$/.test(segments[segments.length - 1].text)) {
        segments[segments.length - 1].text = normalizeText(`${segments[segments.length - 1].text} ${parsed.text}`);
        return;
      }
      segments.push(parsed);
    });
  });

  if (segments.length) return segments.filter((segment) => segment.text);

  return normalizeText(audio.transcript || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => parseSegmentLine(line, "Narrator"))
    .filter((segment) => segment.text);
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
  if (voice.localService) score += 5;
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

const buildSpeakerKey = (speakerName) => normalizeKey(speakerName) || "narrator";

const isStructuralSpeakerLabel = (speakerName) => {
  const key = buildSpeakerKey(speakerName);
  return /^(text|teil|part|section|transkription|transcript|narrator)\b/.test(key) || key.includes(" kurztexte text ");
};

const hasSpeakerSetting = (setting = {}) => Object.keys(setting).length > 0;

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
      .filter(({ segment, setting }) => !isStructuralSpeakerLabel(segment.speaker) || hasSpeakerSetting(setting))
      .map(({ segment }) => buildSpeakerKey(segment.speaker))
  );
  const hasDialogue = dialogueKeys.size > 1;

  segmentSettings.forEach(({ segment, setting }) => {
    const speakerKey = hasDialogue ? buildSpeakerKey(segment.speaker) : "narrator";
    if (assignments.has(speakerKey)) return;
    const gender = hasDialogue ? inferGender(segment.speaker, setting) : "neutral";
    const pool = pools[gender]?.length ? pools[gender] : pools.neutral;
    const voice = pool.length ? pool[usage[gender] % pool.length] : null;
    usage[gender] += 1;
    assignments.set(speakerKey, {
      speakerKey,
      speaker: hasDialogue ? segment.speaker : "Narrator",
      gender,
      voice,
      voiceName: voice?.name || "Browser default German voice",
      lang: voice?.lang || "de-DE",
      rate: Math.max(0.72, Math.min(1.02, Number(setting.speed || audio.rate) || 0.9)),
      pitch: gender === "male" ? 0.76 : gender === "female" ? 1.14 : 0.98,
    });
  });

  const fallback = assignments.get("narrator") || Array.from(assignments.values())[0] || {
    speakerKey: "narrator",
    speaker: "Narrator",
    gender: "neutral",
    voice: null,
    voiceName: "Browser default German voice",
    lang: "de-DE",
    rate: Math.max(0.72, Math.min(1.02, Number(audio.rate) || 0.9)),
    pitch: 0.98,
  };

  return {
    isDialogue: hasDialogue,
    segments,
    duration: estimateDuration(segments, audio.rate),
    assignments: Object.fromEntries(assignments),
    fallback,
  };
};

const loadVoices = () =>
  new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const current = synth.getVoices();
    if (current.length) {
      resolve(current);
      return;
    }
    const previousHandler = synth.onvoiceschanged;
    const timer = window.setTimeout(() => {
      synth.onvoiceschanged = previousHandler;
      resolve(synth.getVoices());
    }, 900);
    synth.onvoiceschanged = () => {
      window.clearTimeout(timer);
      synth.onvoiceschanged = previousHandler;
      resolve(synth.getVoices());
    };
  });

export const createListeningSpeechFallback = ({ audio, onTime, onEnd, onError }) => {
  if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return null;

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
    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.assignment.lang || "de-DE";
    utterance.rate = item.assignment.rate;
    utterance.pitch = item.assignment.pitch;
    if (item.assignment.voice) utterance.voice = item.assignment.voice;
    utterance.onend = () => {
      index += 1;
      elapsedBefore = Math.min(plan.duration, elapsedBefore + estimateDuration([item], audio.rate));
      startedAt = Date.now();
      speakNext();
    };
    utterance.onerror = (event) => {
      if (!active) return;
      active = false;
      paused = false;
      clearTimer();
      stopKeepAlive();
      onError?.(event?.error || "speech-failed");
    };
    synth.speak(utterance);
  };

  const rebuildQueue = (voices) => {
    plan = buildListeningVoicePlan({ audio, voices });
    queue = plan.segments.flatMap((segment) => {
      const key = plan.isDialogue ? buildSpeakerKey(segment.speaker) : "narrator";
      const assignment = plan.assignments[key] || plan.fallback;
      return splitIntoSpeakableChunks(segment.text).map((text) => ({
        ...segment,
        text,
        assignment,
      }));
    });
  };

  return {
    play: async () => {
      if (paused) {
        paused = false;
        startedAt = Date.now();
        synth.resume();
        startTimer();
        startKeepAlive();
        return;
      }
      if (active) return;
      const voices = await loadVoices();
      rebuildQueue(voices);
      synth.cancel();
      active = true;
      paused = false;
      index = 0;
      elapsedBefore = 0;
      startedAt = Date.now();
      onTime?.(0);
      startTimer();
      startKeepAlive();
      speakNext();
    },
    pause: () => {
      if (!active || paused) return;
      elapsedBefore = currentElapsed();
      paused = true;
      clearTimer();
      stopKeepAlive();
      synth.pause();
      onTime?.(Math.round(elapsedBefore));
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
    },
    dispose: () => {
      active = false;
      paused = false;
      clearTimer();
      stopKeepAlive();
      synth.cancel();
    },
    getVoicePlan: () => plan,
    duration: plan.duration,
  };
};
