import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Headphones, Loader2, Play, RotateCcw, Square } from "lucide-react";
import API from "../services/api";
import {
  buildListeningVoicePlan,
  createListeningSpeechFallback,
} from "../utils/listeningSpeechFallback";
import { createListeningAmbienceMixer } from "../utils/listeningAmbience";
import styles from "./AudioDiagnosticsPage.module.css";

const PROVIDERS = ["goethe", "osd", "telc", "ecl"];

const loadBrowserVoices = () =>
  new Promise((resolve) => {
    if (!window.speechSynthesis) {
      resolve([]);
      return;
    }
    const current = window.speechSynthesis.getVoices();
    if (current.length) {
      resolve(current);
      return;
    }
    const timer = window.setTimeout(() => resolve(window.speechSynthesis.getVoices()), 900);
    window.speechSynthesis.onvoiceschanged = () => {
      window.clearTimeout(timer);
      resolve(window.speechSynthesis.getVoices());
    };
  });

export default function AudioDiagnosticsPage() {
  const [provider, setProvider] = useState("goethe");
  const [series, setSeries] = useState(1);
  const [content, setContent] = useState(null);
  const [voices, setVoices] = useState([]);
  const [status, setStatus] = useState("Load a listening test to inspect the browser voice plan.");
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState("");
  const speechRef = useRef(null);
  const ambienceRef = useRef(null);

  const audio = content?.content?.audio;
  const voicePlan = useMemo(() => buildListeningVoicePlan({ audio: audio || {}, voices }), [audio, voices]);
  const assignments = Object.values(voicePlan.assignments || {});

  const stopPlayback = useCallback(() => {
    speechRef.current?.reset();
    speechRef.current = null;
    ambienceRef.current?.dispose();
    ambienceRef.current = null;
    setPlaying(false);
    setProgress(0);
  }, []);

  useEffect(() => () => stopPlayback(), [stopPlayback]);

  const loadContent = useCallback(async () => {
    stopPlayback();
    setError("");
    setStatus("Loading listening content...");
    try {
      const safeSeries = String(Math.max(1, Math.min(20, Number(series) || 1))).padStart(2, "0");
      const response = await API.get(`/api/exams/${provider}/series/imported-${provider}-b1-series-${safeSeries}/listen`);
      setContent(response.data);
      setVoices(await loadBrowserVoices());
      setStatus("Content loaded. Review the assignments, then play the local browser voice test.");
    } catch {
      setError("Could not load this listening test.");
      setStatus("");
      setContent(null);
    }
  }, [provider, series, stopPlayback]);

  const playContent = useCallback(async () => {
    if (!audio) return;
    if (playing) {
      speechRef.current?.pause();
      ambienceRef.current?.stop();
      setPlaying(false);
      return;
    }
    setError("");
    if (!speechRef.current) {
      speechRef.current = createListeningSpeechFallback({
        audio,
        onTime: (seconds) => setProgress(seconds),
        onEnd: () => {
          setPlaying(false);
          ambienceRef.current?.stop();
        },
        onError: () => {
          setPlaying(false);
          ambienceRef.current?.stop(true);
          setError("Browser speech failed in this environment.");
        },
      });
    }
    if (!speechRef.current) {
      setError("This browser does not expose a speech synthesis engine.");
      return;
    }
    if (!ambienceRef.current) ambienceRef.current = createListeningAmbienceMixer(audio);
    await ambienceRef.current?.start();
    await speechRef.current.play();
    setPlaying(true);
  }, [audio, playing]);

  return (
    <div className={styles.page}>
      <div className={styles.shell}>
        <header className={styles.header}>
          <div>
            <h1>Audio Diagnostics</h1>
            <p>Local browser voice playback for German listening tests. Use this before pushing audio changes.</p>
          </div>
          <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={stopPlayback}>
            <Square size={18} />
            Stop
          </button>
        </header>

        <section className={styles.controls} aria-label="Audio test controls">
          <div className={styles.field}>
            <label htmlFor="audio-provider">Provider</label>
            <select id="audio-provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
              {PROVIDERS.map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}
            </select>
          </div>
          <div className={styles.field}>
            <label htmlFor="audio-series">Series</label>
            <input id="audio-series" type="number" min="1" max="20" value={series} onChange={(event) => setSeries(event.target.value)} />
          </div>
          <div className={styles.buttonRow}>
            <button type="button" className={styles.button} onClick={loadContent}>
              <Headphones size={18} />
              Load
            </button>
            <button type="button" className={styles.button} onClick={playContent} disabled={!audio}>
              {playing ? <Loader2 size={18} /> : <Play size={18} />}
              {playing ? "Pause" : "Play local"}
            </button>
            <button type="button" className={`${styles.button} ${styles.buttonSecondary}`} onClick={stopPlayback} disabled={!audio}>
              <RotateCcw size={18} />
              Reset
            </button>
          </div>
          <p className={styles.status}>{error || status}</p>
        </section>

        <div className={styles.grid}>
          <section className={styles.panel}>
            <h2>Voice Plan</h2>
            <div className={styles.meta}>
              <span>Mode: {voicePlan.isDialogue ? "Dialogue" : "Narration"}</span>
              <span>Segments: {voicePlan.segments.length}</span>
              <span>Estimated duration: {progress}s / {voicePlan.duration}s</span>
              <span>Browser voices found: {voices.length}</span>
            </div>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Speaker</th>
                  <th>Gender</th>
                  <th>Voice</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr key={assignment.speakerKey}>
                    <td>{assignment.speaker}</td>
                    <td>{assignment.gender}</td>
                    <td>{assignment.voiceName}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section className={styles.panel}>
            <h2>Transcript Preview</h2>
            {audio?.transcript ? (
              <div className={styles.transcript}>{audio.transcript.slice(0, 6000)}</div>
            ) : (
              <p className={styles.status}>No listening content loaded.</p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
