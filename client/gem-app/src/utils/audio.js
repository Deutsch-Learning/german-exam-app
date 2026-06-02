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

export const pickGermanVoice = () => {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return null;

  const germanVoices = voices.filter((voice) => /de[-_]/i.test(voice.lang) || /german|deutsch/i.test(voice.name));
  return (
    germanVoices.find((voice) => /de[-_]DE/i.test(voice.lang) && /natural|premium|enhanced|neural|google|anna|katja/i.test(voice.name)) ??
    germanVoices.find((voice) => /de[-_]DE/i.test(voice.lang) && voice.localService) ??
    germanVoices.find((voice) => /de[-_]DE/i.test(voice.lang)) ??
    germanVoices.find((voice) => voice.localService) ??
    germanVoices[0] ??
    null
  );
};

export const createListeningUtterance = (audio) => {
  if (!("SpeechSynthesisUtterance" in window)) return null;

  const utterance = new window.SpeechSynthesisUtterance(normalizeSpeechText(audio?.transcript));
  const selectedVoice = pickGermanVoice();
  if (selectedVoice) utterance.voice = selectedVoice;
  utterance.lang = selectedVoice?.lang || "de-DE";
  utterance.rate = clampSpeechRate(audio?.rate);
  utterance.volume = 0.92;
  utterance.pitch = 0.96;
  return utterance;
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
