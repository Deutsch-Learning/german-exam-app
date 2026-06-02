import { useCallback, useRef, useState } from "react";
import { Pause, Play, RotateCcw } from "lucide-react";
import { PLAYBACK_FADE_MS, fadeAudioVolume } from "../utils/audio";
import styles from "./SmoothedAudioPlayer.module.css";

const formatTime = (seconds) => {
  const safeSeconds = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(safeSeconds / 60);
  const secs = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
};

export default function SmoothedAudioPlayer({ src, label = "Lecture de votre reponse" }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [ready, setReady] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [error, setError] = useState("");

  const play = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    try {
      setError("");
      audio.volume = 0;
      await audio.play();
      setPlaying(true);
      await fadeAudioVolume(audio, 0.92, PLAYBACK_FADE_MS);
    } catch {
      setPlaying(false);
      setError("Lecture indisponible pour le moment. Reessayez dans quelques secondes.");
    }
  }, []);

  const pause = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    await fadeAudioVolume(audio, 0, PLAYBACK_FADE_MS);
    audio.pause();
    audio.volume = 0.92;
    setPlaying(false);
  }, []);

  const toggle = useCallback(() => {
    if (playing) {
      pause();
      return;
    }
    play();
  }, [pause, play, playing]);

  const reset = useCallback(async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) await pause();
    audio.currentTime = 0;
    setCurrentTime(0);
  }, [pause, playing]);

  if (!src) return null;

  const progress = duration ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div className={styles.player}>
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onCanPlay={() => setReady(true)}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime || 0)}
        onEnded={() => {
          setPlaying(false);
          setCurrentTime(duration);
        }}
        onError={() => {
          setPlaying(false);
          setError("Impossible de charger cet audio.");
        }}
      />
      <div className={styles.controls}>
        <button type="button" onClick={toggle} disabled={!ready} aria-label={playing ? "Pause" : "Lecture"}>
          {playing ? <Pause size={20} /> : <Play size={20} />}
        </button>
        <div className={styles.timeline} aria-label={label}>
          <div className={styles.meta}>
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div className={styles.track}>
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
        <button type="button" onClick={reset} disabled={!ready} aria-label="Revenir au debut">
          <RotateCcw size={18} />
        </button>
      </div>
      {error ? <p className={styles.error}>{error}</p> : null}
    </div>
  );
}
