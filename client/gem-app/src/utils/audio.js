export const PLAYBACK_FADE_MS = 180;

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
