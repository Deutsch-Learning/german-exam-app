const WORDS_PER_MINUTE = 132;

const normalizeText = (value) =>
  String(value ?? "")
    .replace(/\r/g, "")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const estimateDuration = (segments, rate = 0.92) => {
  const words = segments.reduce((sum, segment) => sum + segment.text.split(/\s+/).filter(Boolean).length, 0);
  return Math.max(8, Math.round((words / WORDS_PER_MINUTE) * 60 / Math.max(0.65, Number(rate) || 0.92)));
};

const parseSpeechSegments = (audio = {}) => {
  const tracks = Array.isArray(audio.tracks) ? audio.tracks : [];
  const segments = [];
  tracks.forEach((track) => {
    const text = normalizeText(track.transcript || track.audio?.transcript || "");
    text.split("\n").map((line) => line.trim()).filter(Boolean).forEach((line) => {
      const match = line.match(/^([^:\n]{2,48})\s*:\s*(.+)$/);
      if (match) {
        segments.push({ speaker: match[1].trim(), text: normalizeText(match[2]) });
      } else if (segments.length && !/[.!?]$/.test(segments[segments.length - 1].text)) {
        segments[segments.length - 1].text = normalizeText(`${segments[segments.length - 1].text} ${line}`);
      } else {
        segments.push({ speaker: "Sprecher", text: line });
      }
    });
  });

  if (segments.length) return segments.filter((segment) => segment.text);

  return normalizeText(audio.transcript || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^([^:\n]{2,48})\s*:\s*(.+)$/);
      return {
        speaker: match ? match[1].trim() : index % 2 ? "Sprecher B" : "Sprecher A",
        text: normalizeText(match ? match[2] : line),
      };
    })
    .filter((segment) => segment.text);
};

const speakerLooksFemale = (speaker = "") => /frau|mutter|anna|moderatorin|sprecherin|sarah|laura|alice|lena|maria|eva/i.test(speaker);
const speakerLooksMale = (speaker = "") => /herr|vater|mann|moderator|sprecher|roger|charlie|george|liam|paul|klaus/i.test(speaker);

const pickVoice = (voices, speaker, index) => {
  const germanVoices = voices.filter((voice) => /^de\b/i.test(voice.lang || "") || /german|deutsch/i.test(voice.name || ""));
  const pool = germanVoices.length ? germanVoices : voices;
  if (!pool.length) return null;
  if (speakerLooksFemale(speaker)) {
    return pool.find((voice) => /female|frau|anna|sarah|laura|alice|lena|maria|katja|vicki/i.test(voice.name || "")) || pool[index % pool.length];
  }
  if (speakerLooksMale(speaker)) {
    return pool.find((voice) => /male|herr|paul|markus|klaus|liam|roger|george|hans/i.test(voice.name || "")) || pool[index % pool.length];
  }
  return pool[index % pool.length];
};

const loadVoices = () =>
  new Promise((resolve) => {
    const synth = window.speechSynthesis;
    const current = synth.getVoices();
    if (current.length) {
      resolve(current);
      return;
    }
    const timer = window.setTimeout(() => resolve(synth.getVoices()), 600);
    synth.onvoiceschanged = () => {
      window.clearTimeout(timer);
      resolve(synth.getVoices());
    };
  });

export const createListeningSpeechFallback = ({ audio, onTime, onEnd, onError }) => {
  if (typeof window === "undefined" || !window.speechSynthesis || !window.SpeechSynthesisUtterance) return null;

  const synth = window.speechSynthesis;
  const segments = parseSpeechSegments(audio);
  if (!segments.length) return null;

  const duration = estimateDuration(segments, audio.rate);
  let voices = [];
  let index = 0;
  let active = false;
  let paused = false;
  let startedAt = 0;
  let elapsedBefore = 0;
  let timer = null;

  const clearTimer = () => {
    if (timer) window.clearInterval(timer);
    timer = null;
  };

  const currentElapsed = () => {
    if (!active || paused) return elapsedBefore;
    return Math.min(duration, elapsedBefore + (Date.now() - startedAt) / 1000);
  };

  const startTimer = () => {
    clearTimer();
    timer = window.setInterval(() => onTime?.(Math.round(currentElapsed())), 250);
  };

  const speakNext = () => {
    if (!active || index >= segments.length) {
      active = false;
      paused = false;
      clearTimer();
      onTime?.(duration);
      onEnd?.();
      return;
    }

    const segment = segments[index];
    const utterance = new SpeechSynthesisUtterance(segment.text);
    utterance.lang = "de-DE";
    utterance.rate = Math.max(0.72, Math.min(1.05, Number(audio.rate) || 0.9));
    utterance.pitch = speakerLooksMale(segment.speaker) ? 0.92 : 1.04;
    const voice = pickVoice(voices, segment.speaker, index);
    if (voice) utterance.voice = voice;
    utterance.onend = () => {
      index += 1;
      elapsedBefore = Math.min(duration, elapsedBefore + estimateDuration([segment], audio.rate));
      startedAt = Date.now();
      speakNext();
    };
    utterance.onerror = (event) => {
      active = false;
      paused = false;
      clearTimer();
      onError?.(event?.error || "speech-failed");
    };
    synth.speak(utterance);
  };

  return {
    play: async () => {
      if (paused) {
        paused = false;
        startedAt = Date.now();
        synth.resume();
        startTimer();
        return;
      }
      if (active) return;
      voices = await loadVoices();
      synth.cancel();
      active = true;
      paused = false;
      index = 0;
      elapsedBefore = 0;
      startedAt = Date.now();
      onTime?.(0);
      startTimer();
      speakNext();
    },
    pause: () => {
      if (!active || paused) return;
      elapsedBefore = currentElapsed();
      paused = true;
      clearTimer();
      synth.pause();
      onTime?.(Math.round(elapsedBefore));
    },
    reset: () => {
      active = false;
      paused = false;
      index = 0;
      elapsedBefore = 0;
      clearTimer();
      synth.cancel();
      onTime?.(0);
    },
    dispose: () => {
      active = false;
      paused = false;
      clearTimer();
      synth.cancel();
    },
    duration,
  };
};
