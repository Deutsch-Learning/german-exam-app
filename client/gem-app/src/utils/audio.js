export const SPEECH_START_DELAY_MS = 120;
export const SPEECH_STOP_FADE_MS = 140;
export const PLAYBACK_FADE_MS = 180;

export const normalizeSpeechText = (text) =>
  String(text ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/([.,;:!?])(?=\S)/g, "$1 ")
    .trim();

export const clampSpeechRate = (value) => Math.max(0.78, Math.min(0.96, Number(value) || 0.88));

const parseSpeechSpeed = (value) => {
  const match = String(value ?? "").match(/([0-9.]+)\s*x/i);
  return match ? Number(match[1]) : Number(value);
};

const getSpeakerSegments = (audio) => {
  const tracks = Array.isArray(audio?.tracks) ? audio.tracks : [];
  const trackText = tracks.map((track) => track?.transcript).filter(Boolean).join("\n\n");
  const transcript = normalizeSpeechText(trackText || audio?.transcript);
  if (!transcript) return [];

  const rawLines = String(trackText || audio?.transcript || "")
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const segments = [];
  rawLines.forEach((line) => {
    if (/^(teil|part|track)\s+\d+/i.test(line)) return;
    const match = line.match(/^([^:\n]{2,42})\s*:\s*(.+)$/);
    if (match) {
      segments.push({
        speaker: match[1].trim(),
        text: normalizeSpeechText(match[2]),
      });
      return;
    }
    if (segments.length) {
      segments[segments.length - 1].text = normalizeSpeechText(`${segments[segments.length - 1].text} ${line}`);
    } else {
      segments.push({ speaker: "", text: normalizeSpeechText(line) });
    }
  });

  const text = segments.length
    ? segments.map((segment) => segment.speaker ? `${segment.speaker}: ${segment.text}` : segment.text).join(". ")
    : transcript;
  return [{ speaker: segments[0]?.speaker || "", text: normalizeSpeechText(text) }];
};

const getSpeakerMeta = (audio, speakerName = "") => {
  const speakers = Array.isArray(audio?.speakers) ? audio.speakers : [];
  const foldedName = String(speakerName).trim().toLowerCase();
  return speakers.find((speaker) => {
    const label = String(speaker?.speaker || speaker?.voiceName || "").trim().toLowerCase();
    return label && foldedName && (label === foldedName || foldedName.includes(label) || label.includes(foldedName));
  }) || speakers[0] || {};
};

export const pickGermanVoice = ({ speaker = {}, index = 0 } = {}) => {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const germanVoices = voices.filter((voice) => /de[-_]/i.test(voice.lang) || /german|deutsch/i.test(voice.name));
  const preferredName = String(speaker.voiceName || speaker.speaker || "").trim();
  const preferredGender = String(speaker.suggestedGender || "").trim().toLowerCase();
  const matchingName = preferredName
    ? germanVoices.find((voice) => voice.name.toLowerCase().includes(preferredName.toLowerCase()))
    : null;
  const genderHint = preferredGender === "female"
    ? /anna|katja|helena|marlene|female|frau|woman|google deutsch/i
    : preferredGender === "male"
      ? /markus|stefan|male|mann|man/i
      : null;
  const matchingGender = genderHint ? germanVoices.find((voice) => genderHint.test(voice.name)) : null;
  return (
    matchingName ??
    matchingGender ??
    germanVoices.find((voice) => /de[-_]DE/i.test(voice.lang) && /natural|premium|enhanced|neural|google|anna|katja/i.test(voice.name)) ??
    germanVoices.find((voice) => /de[-_]DE/i.test(voice.lang) && voice.localService) ??
    germanVoices.find((voice) => /de[-_]DE/i.test(voice.lang)) ??
    germanVoices.find((voice) => voice.localService) ??
    germanVoices[index % germanVoices.length] ??
    null
  );
};

export const createListeningUtterances = (audio) => {
  if (!("SpeechSynthesisUtterance" in window)) return [];
  return getSpeakerSegments(audio).map((segment, index) => {
    const speaker = getSpeakerMeta(audio, segment.speaker);
    const utterance = new window.SpeechSynthesisUtterance(segment.text);
    const selectedVoice = pickGermanVoice({ speaker, index });
    if (selectedVoice) utterance.voice = selectedVoice;
    const rate = parseSpeechSpeed(speaker.speed) || audio?.rate;
    utterance.lang = selectedVoice?.lang || "de-DE";
    utterance.rate = clampSpeechRate(rate);
    utterance.volume = 0.92;
    utterance.pitch = speaker.suggestedGender === "male" ? 0.9 : 1;
    return utterance;
  });
};

export const createListeningUtterance = (audio) => {
  const utterances = createListeningUtterances(audio);
  return utterances[0] || null;
};

export const startListeningAmbience = (audio) => {
  const AudioContext = window.AudioContext || window.webkitAudioContext;
  if (!AudioContext) return null;
  const ambience = Array.isArray(audio?.ambience) ? audio.ambience : [];
  const hasAmbience = ambience.length || audio?.sfx;
  if (!hasAmbience) return null;

  const context = new AudioContext();
  const gain = context.createGain();
  const filter = context.createBiquadFilter();
  const source = context.createBufferSource();
  const seconds = 2;
  const buffer = context.createBuffer(1, context.sampleRate * seconds, context.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < data.length; index += 1) {
    data[index] = (Math.random() * 2 - 1) * 0.6;
  }

  const requestedVolume = Number(ambience[0]?.volume);
  const volume = Math.max(0.015, Math.min(0.09, Number.isFinite(requestedVolume) ? requestedVolume * 0.18 : 0.045));
  filter.type = /metro|train|street|traffic|station/i.test(`${audio?.sfx} ${ambience[0]?.name}`)
    ? "bandpass"
    : "lowpass";
  filter.frequency.value = filter.type === "bandpass" ? 420 : 850;
  gain.gain.value = 0;
  source.buffer = buffer;
  source.loop = true;
  source.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  source.start();
  context.resume?.();
  gain.gain.linearRampToValueAtTime(volume, context.currentTime + 0.25);

  return {
    pause: () => context.suspend?.(),
    resume: () => context.resume?.(),
    stop: () => {
      try {
        gain.gain.cancelScheduledValues(context.currentTime);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 0.12);
        window.setTimeout(() => {
          try { source.stop(); } catch {}
          context.close?.();
        }, 140);
      } catch {
        context.close?.();
      }
    },
  };
};

export const gracefulStopSpeech = (delay = SPEECH_STOP_FADE_MS) => {
  if (!("speechSynthesis" in window)) return 0;
  window.speechSynthesis.pause();
  return window.setTimeout(() => {
    window.speechSynthesis.cancel();
  }, delay);
};

export const startSpeechWatchdog = () => {
  if (!("speechSynthesis" in window)) return null;
  return window.setInterval(() => {
    if (window.speechSynthesis.speaking && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
    }
  }, 4500);
};

export const getMicrophoneConstraints = () => ({
  audio: {
    channelCount: { ideal: 1 },
    echoCancellation: { ideal: true },
    noiseSuppression: { ideal: true },
    autoGainControl: { ideal: true },
    sampleRate: { ideal: 48000 },
  },
});

export const getPreferredRecorderOptions = () => {
  if (typeof window === "undefined" || !window.MediaRecorder?.isTypeSupported) return undefined;
  const mimeType = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
  ].find((type) => window.MediaRecorder.isTypeSupported(type));

  return mimeType
    ? {
        mimeType,
        audioBitsPerSecond: 96000,
      }
    : undefined;
};

export const createRecordingBlob = (chunks, fallbackType = "audio/webm") => {
  const type = chunks.find((chunk) => chunk?.type)?.type || fallbackType;
  return new window.Blob(chunks, { type });
};

export const fadeAudioVolume = (audioElement, toVolume, duration = PLAYBACK_FADE_MS) =>
  new Promise((resolve) => {
    if (!audioElement) {
      resolve();
      return;
    }

    const fromVolume = Number.isFinite(audioElement.volume) ? audioElement.volume : 1;
    const target = Math.max(0, Math.min(1, toVolume));
    const start = performance.now();

    const step = (time) => {
      const progress = duration <= 0 ? 1 : Math.min(1, (time - start) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      audioElement.volume = fromVolume + (target - fromVolume) * eased;
      if (progress < 1) {
        window.requestAnimationFrame(step);
      } else {
        audioElement.volume = target;
        resolve();
      }
    };

    window.requestAnimationFrame(step);
  });
