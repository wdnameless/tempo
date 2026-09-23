import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Play, Pause, Volume2, VolumeX } from 'lucide-react';
import { I18nService } from '../services/i18n';

export interface AudioPlayerProps {
  src: string;
  title?: string;
  className?: string;
  onPlay?: () => void;
  onPause?: () => void;
}

/**
 * Format seconds into mm:ss or hh:mm:ss string (e.g. "0:07", "1:32").
 */
export function formatPlayerTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '0:00';
  const total = Math.floor(sec);
  const m = Math.floor(total / 60);
  const s = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const remM = m % 60;
    return `${h}:${remM.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}
export function AudioPlayer({
  src,
  title,
  className = '',
  onPlay,
  onPause,
}: AudioPlayerProps): React.ReactElement {
  const [, setLangTick] = useState(0);
  useEffect(() => I18nService.subscribe(() => setLangTick((t) => t + 1)), []);
  const t = I18nService.t();

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const prevVolumeRef = useRef(1);

  // Sync with audio element duration once ready
  const handleLoadedMetadata = () => {
    if (audioRef.current && Number.isFinite(audioRef.current.duration)) {
      setDuration(audioRef.current.duration);
    }
  };

  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  const togglePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isPlaying) {
      audio.pause();
    } else {
      audio.play().catch((err) => {
        console.warn('Playback failed:', err);
        setIsPlaying(false);
      });
    }
  }, [isPlaying]);

  const handleSeek = (newTime: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(duration, newTime));
    if (audio) {
      audio.currentTime = clamped;
    }
    setCurrentTime(clamped);
  };

  const seekBy = useCallback(
    (delta: number) => {
      const audio = audioRef.current;
      const target = Math.max(0, Math.min(duration || 0, (audio?.currentTime || currentTime) + delta));
      if (audio) {
        audio.currentTime = target;
      }
      setCurrentTime(target);
    },
    [currentTime, duration],
  );

  const handleVolumeChange = (newVolume: number) => {
    const audio = audioRef.current;
    const clamped = Math.max(0, Math.min(1, newVolume));
    if (audio) {
      audio.volume = clamped;
      audio.muted = clamped === 0;
    }
    setVolume(clamped);
    setIsMuted(clamped === 0);
    if (clamped > 0) {
      prevVolumeRef.current = clamped;
    }
  };

  const toggleMute = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMuted || volume === 0) {
      const restored = prevVolumeRef.current > 0 ? prevVolumeRef.current : 1;
      audio.muted = false;
      audio.volume = restored;
      setVolume(restored);
      setIsMuted(false);
    } else {
      prevVolumeRef.current = volume;
      audio.muted = true;
      setIsMuted(true);
    }
  }, [isMuted, volume]);

  const changeVolume = useCallback(
    (delta: number) => {
      const cur = isMuted ? 0 : (audioRef.current ? audioRef.current.volume : volume);
      handleVolumeChange(cur + delta);
    },
    [isMuted, volume],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.target instanceof HTMLInputElement && e.target.type === 'range') {
      if (e.key === ' ') {
        e.preventDefault();
        togglePlay();
      }
      return;
    }

    if (e.key === ' ' || e.key === 'k' || e.key === 'K') {
      e.preventDefault();
      togglePlay();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      seekBy(-5);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      seekBy(5);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      changeVolume(0.05);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      changeVolume(-0.05);
    } else if (e.key === 'm' || e.key === 'M') {
      e.preventDefault();
      toggleMute();
    }
  };

  const seekPercent = duration > 0 ? (currentTime / duration) * 100 : 0;
  const effectiveVolume = isMuted ? 0 : volume;
  const volumePercent = effectiveVolume * 100;

  return (
    <div
      role="region"
      aria-label={title || t.navRecordings}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={`flex items-center gap-3 w-full py-2 px-3 rounded-lg bg-[var(--surface)] border border-[var(--border)] select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${className}`}
    >
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={handleLoadedMetadata}
        onDurationChange={handleLoadedMetadata}
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          setIsPlaying(true);
          onPlay?.();
        }}
        onPause={() => {
          setIsPlaying(false);
          onPause?.();
        }}
        onEnded={() => {
          setIsPlaying(false);
          setCurrentTime(0);
          onPause?.();
        }}
        onVolumeChange={() => {
          if (audioRef.current) {
            setVolume(audioRef.current.volume);
            setIsMuted(audioRef.current.muted || audioRef.current.volume === 0);
          }
        }}
      />

      {/* Play / Pause Button */}
      <button
        type="button"
        onClick={togglePlay}
        aria-label={isPlaying ? t.playerPause : t.playerPlay}
        className="flex items-center justify-center w-8 h-8 rounded-full bg-[var(--accent)] text-[var(--bg)] hover:opacity-90 transition-opacity shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
      >
        {isPlaying ? (
          <Pause size={14} className="fill-current" />
        ) : (
          <Play size={14} className="fill-current translate-x-0.5" />
        )}
      </button>

      {/* Elapsed and Total Time */}
      <span className="text-xs font-mono tabular-nums text-[var(--text-muted)] shrink-0 min-w-[76px] text-center">
        {formatPlayerTime(currentTime)} / {formatPlayerTime(duration)}
      </span>

      {/* Seek bar */}
      <div className="relative flex items-center flex-1 h-5 min-w-[100px]">
        <input
          type="range"
          min={0}
          max={duration > 0 ? duration : 0}
          step={0.1}
          value={currentTime}
          disabled={duration <= 0}
          onChange={(e) => handleSeek(parseFloat(e.target.value))}
          aria-label={t.playerSeek}
          aria-valuemin={0}
          aria-valuemax={duration > 0 ? Math.round(duration) : 0}
          aria-valuenow={Math.round(currentTime)}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus-visible:outline-none disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${seekPercent}%, var(--elevated) ${seekPercent}%, var(--elevated) 100%)`,
            border: '1px solid var(--border)',
          }}
        />
      </div>

      {/* Volume Control */}
      <div className="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          onClick={toggleMute}
          aria-label={isMuted || volume === 0 ? t.playerUnmute : t.playerMute}
          className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-hover)] cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
        >
          {isMuted || volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>

        <div className="relative flex items-center w-16 h-5">
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={effectiveVolume}
            onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
            aria-label={t.playerVolume}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(effectiveVolume * 100)}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus-visible:outline-none"
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${volumePercent}%, var(--elevated) ${volumePercent}%, var(--elevated) 100%)`,
              border: '1px solid var(--border)',
            }}
          />
        </div>
      </div>
    </div>
  );
}
