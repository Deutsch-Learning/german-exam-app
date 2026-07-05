const AMBIENCE_GAIN = 0.038;

const normalize = (value) =>
  String(value ?? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

const getAudioContext = () => {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  return AudioContextClass ? new AudioContextClass() : null;
};

const makeNoiseBuffer = (context, durationSeconds = 2, color = "white") => {
  const length = Math.max(1, Math.floor(context.sampleRate * durationSeconds));
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const data = buffer.getChannelData(0);
  let previous = 0;
  for (let index = 0; index < length; index += 1) {
    const white = Math.random() * 2 - 1;
    if (color === "pink") {
      previous = previous * 0.98 + white * 0.02;
      data[index] = previous * 2.4;
    } else if (color === "brown") {
      previous = (previous + 0.02 * white) / 1.02;
      data[index] = previous * 3.5;
    } else {
      data[index] = white;
    }
  }
  return buffer;
};

const connectFilteredNoise = (context, output, { type = "bandpass", frequency = 700, q = 0.8, gain = 0.015, color = "pink" }) => {
  const source = context.createBufferSource();
  source.buffer = makeNoiseBuffer(context, 2.2, color);
  source.loop = true;

  const filter = context.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = q;

  const nodeGain = context.createGain();
  nodeGain.gain.value = gain;

  source.connect(filter);
  filter.connect(nodeGain);
  nodeGain.connect(output);
  source.start();
  return source;
};

const connectOscillator = (context, output, { type = "sine", frequency = 90, gain = 0.012 }) => {
  const oscillator = context.createOscillator();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  const nodeGain = context.createGain();
  nodeGain.gain.value = gain;
  oscillator.connect(nodeGain);
  nodeGain.connect(output);
  oscillator.start();
  return oscillator;
};

const schedulePulse = (context, output, { every = 4, frequency = 1200, duration = 0.08, gain = 0.01 }) => {
  let cancelled = false;
  const timers = [];

  const run = () => {
    if (cancelled) return;
    const oscillator = context.createOscillator();
    const nodeGain = context.createGain();
    const now = context.currentTime;
    oscillator.type = "triangle";
    oscillator.frequency.value = frequency + Math.random() * frequency * 0.18;
    nodeGain.gain.setValueAtTime(0, now);
    nodeGain.gain.linearRampToValueAtTime(gain, now + 0.012);
    nodeGain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(nodeGain);
    nodeGain.connect(output);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
    const timer = window.setTimeout(run, (every + Math.random() * every) * 1000);
    timers.push(timer);
  };

  run();
  return {
    stop: () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
    },
  };
};

const classifyAmbience = (audio = {}) => {
  const labels = [
    audio.scene,
    audio.situation,
    audio.documentType,
    audio.sfx,
    ...(Array.isArray(audio.ambience) ? audio.ambience.map((item) => item?.name || item?.description || item) : []),
  ].map(normalize).join(" ");

  if (/metro|u-bahn|zug|bahn|bahnhof|station|train|platform|gleis/.test(labels)) return "metro";
  if (/radio|studio|broadcast|interview|sendung|moderator/.test(labels)) return "radio";
  if (/cafe|kaffee|restaurant|kantine|bar/.test(labels)) return "cafe";
  if (/telefon|phone|anruf/.test(labels)) return "phone";
  if (/schule|klass|unterricht|office|buero|bibliothek|library/.test(labels)) return "room";
  if (/strasse|street|verkehr|traffic|markt|platz/.test(labels)) return "street";
  return labels ? "room" : "neutral";
};

const buildAmbienceNodes = (context, output, kind) => {
  const nodes = [];
  const pulses = [];

  if (kind === "metro") {
    nodes.push(connectFilteredNoise(context, output, { type: "lowpass", frequency: 520, q: 0.5, gain: 0.018, color: "brown" }));
    nodes.push(connectOscillator(context, output, { type: "sine", frequency: 54, gain: 0.01 }));
    pulses.push(schedulePulse(context, output, { every: 7, frequency: 860, duration: 0.13, gain: 0.006 }));
  } else if (kind === "radio") {
    nodes.push(connectFilteredNoise(context, output, { type: "bandpass", frequency: 1250, q: 0.7, gain: 0.011, color: "white" }));
    nodes.push(connectFilteredNoise(context, output, { type: "highpass", frequency: 2300, q: 0.4, gain: 0.004, color: "white" }));
    pulses.push(schedulePulse(context, output, { every: 9, frequency: 1450, duration: 0.07, gain: 0.004 }));
  } else if (kind === "cafe") {
    nodes.push(connectFilteredNoise(context, output, { type: "bandpass", frequency: 680, q: 0.35, gain: 0.012, color: "pink" }));
    pulses.push(schedulePulse(context, output, { every: 3, frequency: 2100, duration: 0.045, gain: 0.004 }));
  } else if (kind === "phone") {
    nodes.push(connectFilteredNoise(context, output, { type: "bandpass", frequency: 1500, q: 1.4, gain: 0.007, color: "white" }));
  } else if (kind === "street") {
    nodes.push(connectFilteredNoise(context, output, { type: "lowpass", frequency: 900, q: 0.6, gain: 0.014, color: "pink" }));
    nodes.push(connectOscillator(context, output, { type: "sine", frequency: 115, gain: 0.004 }));
  } else if (kind === "room") {
    nodes.push(connectFilteredNoise(context, output, { type: "bandpass", frequency: 520, q: 0.4, gain: 0.006, color: "pink" }));
  } else {
    nodes.push(connectFilteredNoise(context, output, { type: "bandpass", frequency: 620, q: 0.35, gain: 0.003, color: "pink" }));
  }

  return { nodes, pulses };
};

export const createListeningAmbienceMixer = (audio = {}) => {
  if (typeof window === "undefined") return null;
  const context = getAudioContext();
  if (!context) return null;

  const masterGain = context.createGain();
  const intensity = Number(Array.isArray(audio.ambience) ? audio.ambience[0]?.intensity : null);
  masterGain.gain.value = 0;
  masterGain.connect(context.destination);

  let active = null;
  const targetGain = AMBIENCE_GAIN * clamp(Number.isFinite(intensity) ? intensity : 1, 0.35, 1.4);

  return {
    start: async () => {
      if (context.state === "suspended") await context.resume();
      if (active) return;
      active = buildAmbienceNodes(context, masterGain, classifyAmbience(audio));
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(targetGain, now + 0.5);
    },
    stop: (immediate = false) => {
      if (!active) return;
      const current = active;
      active = null;
      const now = context.currentTime;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(0, now + (immediate ? 0.02 : 0.35));
      window.setTimeout(() => {
        current.nodes.forEach((node) => {
          try {
            node.stop();
          } catch {
            // Already stopped.
          }
        });
        current.pulses.forEach((pulse) => pulse.stop());
      }, immediate ? 25 : 380);
    },
    dispose: () => {
      if (active) {
        active.nodes.forEach((node) => {
          try {
            node.stop();
          } catch {
            // Already stopped.
          }
        });
        active.pulses.forEach((pulse) => pulse.stop());
        active = null;
      }
      context.close().catch(() => {});
    },
  };
};
