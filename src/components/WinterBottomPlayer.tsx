import React, { useEffect, useState, useRef } from 'react';
import {
  Menu,
  Play,
  Pause,
  RotateCcw,
  FastForward,
  Timer as TimerIcon,
  Watch,
  Volume2,
  VolumeX,
  Circle,
  CloudRain,
  Waves,
  Wind,
  Coffee,
  Check,
} from 'lucide-react';
import { TimerService, type TimerSnapshot, type TimerMode } from '../services/timer';
import {
  startFocusAudio,
  stopFocusAudio,
  currentFocusSound,
  setFocusAudioVolume,
  getFocusAudioVolume,
  type FocusSoundId,
} from '../services/focusAudio';

interface WinterBottomPlayerProps {
  onToggleSidebar?: () => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

const PRESETS = [15, 25, 45, 60] as const;

interface SoundscapeOption {
  id: FocusSoundId;
  label: string;
  icon: React.ReactNode;
}

const SOUNDSCAPES: SoundscapeOption[] = [
  { id: 'none', label: 'Выкл', icon: <VolumeX className="w-3.5 h-3.5" /> },
  { id: 'rain', label: 'Дождь', icon: <CloudRain className="w-3.5 h-3.5" /> },
  { id: 'brown', label: 'Глубокий шум', icon: <Waves className="w-3.5 h-3.5" /> },
  { id: 'white', label: 'Белый шум', icon: <Wind className="w-3.5 h-3.5" /> },
  { id: 'cafe', label: 'Кафе', icon: <Coffee className="w-3.5 h-3.5" /> },
];

export function WinterBottomPlayer({
  onToggleSidebar,
  soundEnabled = true,
  onToggleSound,
}: WinterBottomPlayerProps): React.ReactElement {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);

  // Popover states
  const [showPresets, setShowPresets] = useState(false);
  const [showPhases, setShowPhases] = useState(false);
  const [showSoundscapes, setShowSoundscapes] = useState(false);

  // Active soundscape & volume
  const [activeSound, setActiveSound] = useState<FocusSoundId>(() => currentFocusSound());
  const [soundVolume, setSoundVolume] = useState<number>(() => Math.round(getFocusAudioVolume() * 100));

  const playerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    // Initial timer state
    void TimerService.getState().then(setSnapshot);
    // Subscription to timer ticks
    return TimerService.subscribe(setSnapshot);
  }, []);

  // Close popovers on click outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (playerRef.current && !playerRef.current.contains(e.target as Node)) {
        setShowPresets(false);
        setShowPhases(false);
        setShowSoundscapes(false);
      }
    };
    window.addEventListener('pointerdown', handleClickOutside);
    return () => window.removeEventListener('pointerdown', handleClickOutside);
  }, []);

  const running = snapshot?.running ?? false;
  const remainingSec = snapshot?.remaining_secs ?? 1500;
  const currentPhase = snapshot?.phase ?? 'focus';
  const isStopwatch = snapshot?.mode === 'stopwatch';
  const displaySec = isStopwatch ? (snapshot?.elapsed_secs ?? 0) : remainingSec;

  const mins = Math.floor(displaySec / 60);
  const secs = displaySec % 60;
  // Format as "MM : SS" with spaces matching trywinter reference
  const timeFormatted = `${String(mins).padStart(2, '0')} : ${String(secs).padStart(2, '0')}`;

  const handleToggleMode = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const currentMode = snapshot?.mode ?? 'pomodoro';
    const nextMode: TimerMode = currentMode === 'pomodoro' ? 'stopwatch' : 'pomodoro';
    await TimerService.setMode(nextMode);
    const updated = await TimerService.getState();
    setSnapshot(updated);
  };

  const handleReset = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await TimerService.reset();
    const updated = await TimerService.getState();
    setSnapshot(updated);
  };

  const handleSkipPhase = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await TimerService.skipPhase();
    const updated = await TimerService.getState();
    setSnapshot(updated);
  };
  const handleToggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (running) {
      void TimerService.pause();
    } else {
      void TimerService.start();
    }
  };

  const handleSelectPreset = async (m: number) => {
    await TimerService.setDuration(m);
    await TimerService.reset();
    const updated = await TimerService.getState();
    setSnapshot(updated);
    setShowPresets(false);
  };

  const handleShiftMinutes = async (delta: number) => {
    await TimerService.shiftMinutes(delta);
    const updated = await TimerService.getState();
    setSnapshot(updated);
  };

  const handleSelectPhase = async (phase: 'focus' | 'short_rest' | 'long_rest') => {
    // Arm duration based on target phase
    if (phase === 'focus') {
      await TimerService.setDuration(25);
    } else if (phase === 'short_rest') {
      await TimerService.setDuration(5);
    } else {
      await TimerService.setDuration(15);
    }
    await TimerService.reset();
    const updated = await TimerService.getState();
    setSnapshot(updated);
    setShowPhases(false);
  };

  const handleSelectSoundscape = (id: FocusSoundId) => {
    setActiveSound(id);
    onToggleSound?.();
    if (id === 'none') {
      stopFocusAudio();
    } else {
      startFocusAudio(id);
      setFocusAudioVolume(soundVolume / 100);
    }
  };

  const handleVolumeChange = (volPercent: number) => {
    setSoundVolume(volPercent);
    setFocusAudioVolume(volPercent / 100);
  };

  const phaseLabel =
    currentPhase === 'focus'
      ? 'Фокус'
      : currentPhase === 'short_rest'
      ? 'Перерыв'
      : 'Отдых';

  return (
    <div
      ref={playerRef}
      data-testid="winter-bottom-player"
      className="fixed bottom-7 left-1/2 -translate-x-1/2 z-40 flex items-center px-4 py-2 rounded-2xl border border-white/10 bg-[#0a0a0c]/90 backdrop-blur-xl shadow-2xl text-xs gap-3 select-none transition-all duration-200 hover:border-white/20"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* 1. Menu hamburger button */}
      <button
        type="button"
        aria-label="Toggle navigation menu"
        data-testid="bottom-player-menu"
        onClick={() => {
          if (onToggleSidebar) {
            onToggleSidebar();
          } else if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('tempo:toggle-sidebar'));
          }
        }}
        className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Vertical separator */}
      <div className="h-3.5 w-[1px] bg-white/15" />

      {/* Mode toggle (Pomodoro / Stopwatch) */}
      <button
        type="button"
        aria-label={isStopwatch ? 'Режим: секундомер' : 'Режим: помодоро'}
        title={isStopwatch ? 'Переключить в помодоро' : 'Переключить в секундомер'}
        data-testid="bottom-player-mode"
        onClick={handleToggleMode}
        className={`p-1 rounded-md transition-colors ${
          isStopwatch ? 'text-white bg-white/15' : 'text-white/70 hover:text-white hover:bg-white/10'
        }`}
      >
        {isStopwatch ? <Watch className="w-4 h-4" /> : <TimerIcon className="w-4 h-4" />}
      </button>

      {/* Vertical separator */}
      <div className="h-3.5 w-[1px] bg-white/15" />

      {/* 2. Phase indicator & selector */}
      <div className="relative">
        <button
          type="button"
          aria-label="Phase selector"
          data-testid="bottom-player-phase"
          onClick={() => {
            setShowPhases(!showPhases);
            setShowPresets(false);
            setShowSoundscapes(false);
          }}
          className="flex items-center gap-1.5 p-1 rounded hover:bg-white/10 text-white/80 hover:text-white transition-colors"
        >
          <Circle
            className={`w-2 h-2 text-white fill-white transition-opacity ${
              running ? 'animate-pulse opacity-100' : 'opacity-40'
            }`}
          />
          <span className="text-[10px] uppercase font-mono tracking-wider opacity-60">
            {phaseLabel}
          </span>
        </button>

        {/* Phase Popover */}
        {showPhases && (
          <div
            className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 p-1.5 rounded-xl border border-white/10 bg-[#0c0c0e]/95 backdrop-blur-xl shadow-2xl flex flex-col gap-1 min-w-[140px] animate-in fade-in zoom-in-95 duration-150"
          >
            {[
              { id: 'focus' as const, label: 'Фокус (25м)' },
              { id: 'short_rest' as const, label: 'Перерыв (5м)' },
              { id: 'long_rest' as const, label: 'Отдых (15м)' },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelectPhase(p.id)}
                className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                  currentPhase === p.id
                    ? 'bg-white/15 text-white font-semibold'
                    : 'text-white/60 hover:text-white hover:bg-white/5'
                }`}
              >
                <span>{p.label}</span>
                {currentPhase === p.id && <Check className="w-3.5 h-3.5 text-white" />}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 3. Timer readout with Presets popover */}
      <div className="relative">
        <button
          type="button"
          aria-label="Timer presets"
          data-testid="bottom-player-time"
          onClick={() => {
            setShowPresets(!showPresets);
            setShowPhases(false);
            setShowSoundscapes(false);
          }}
          className="flex items-center font-mono text-sm tracking-widest text-white/95 font-medium px-1.5 py-0.5 rounded hover:bg-white/10 transition-colors"
        >
          <span className="tabular">{timeFormatted}</span>
        </button>

        {/* Presets Popover */}
        {showPresets && (
          <div
            className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 p-2 rounded-xl border border-white/10 bg-[#0c0c0e]/95 backdrop-blur-xl shadow-2xl flex items-center gap-1.5 animate-in fade-in zoom-in-95 duration-150"
          >
            {/* -5 min */}
            <button
              type="button"
              onClick={() => handleShiftMinutes(-5)}
              className="px-2 py-1 rounded-lg text-xs font-mono text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              -5
            </button>

            <div className="h-3.5 w-[1px] bg-white/15" />

            {/* Presets 15m, 25m, 45m, 60m */}
            {PRESETS.map((m) => (
              <button
                key={m}
                type="button"
                data-testid={`preset-${m}`}
                onClick={() => handleSelectPreset(m)}
                className="px-2.5 py-1 rounded-lg text-xs font-mono font-medium text-white/80 hover:text-white hover:bg-white/15 transition-colors"
              >
                {m}m
              </button>
            ))}

            <div className="h-3.5 w-[1px] bg-white/15" />

            {/* +5 min */}
            <button
              type="button"
              onClick={() => handleShiftMinutes(5)}
              className="px-2 py-1 rounded-lg text-xs font-mono text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            >
              +5
            </button>
          </div>
        )}
      </div>

      {/* Vertical separator */}
      <div className="h-3.5 w-[1px] bg-white/15" />

      {/* 4. Play / Pause */}
      <button
        type="button"
        aria-label={running ? 'Pause timer' : 'Start timer'}
        data-testid="bottom-player-toggle"
        onClick={handleToggleTimer}
        className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>

      {/* 5. Reset timer */}
      <button
        type="button"
        aria-label="Reset timer"
        data-testid="bottom-player-reset"
        onClick={handleReset}
        className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <RotateCcw className="w-4 h-4" />
      </button>

      {/* 6. Skip phase (in pomodoro mode) */}
      {!isStopwatch && (
        <button
          type="button"
          aria-label="Skip phase"
          data-testid="bottom-player-skip"
          onClick={handleSkipPhase}
          className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
        >
          <FastForward className="w-4 h-4" />
        </button>
      )}
      {/* 5. Sound / Focus Audio */}
      <div className="relative">
        <button
          type="button"
          aria-label={activeSound !== 'none' ? 'Focus audio active' : 'Focus audio'}
          data-testid="bottom-player-sound"
          onClick={() => {
            setShowSoundscapes(!showSoundscapes);
            setShowPresets(false);
            setShowPhases(false);
          }}
          className={`p-1 rounded-md transition-colors ${
            activeSound !== 'none'
              ? 'text-white bg-white/15'
              : 'text-white/70 hover:text-white hover:bg-white/10'
          }`}
        >
          {activeSound !== 'none' || soundEnabled ? (
            <Volume2 className="w-4 h-4 text-white" />
          ) : (
            <VolumeX className="w-4 h-4" />
          )}
        </button>

        {/* Focus Audio Soundscapes Popover */}
        {showSoundscapes && (
          <div
            className="absolute bottom-full mb-3 right-0 p-3 rounded-xl border border-white/10 bg-[#0c0c0e]/95 backdrop-blur-xl shadow-2xl flex flex-col gap-2.5 min-w-[170px] animate-in fade-in zoom-in-95 duration-150"
          >
            <div className="text-[11px] font-semibold text-white/60 uppercase tracking-wider">
              Focus Audio
            </div>

            {/* Soundscapes list */}
            <div className="flex flex-col gap-1">
              {SOUNDSCAPES.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  data-testid={`soundscape-${s.id}`}
                  onClick={() => handleSelectSoundscape(s.id)}
                  className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    activeSound === s.id
                      ? 'bg-white/15 text-white font-semibold'
                      : 'text-white/60 hover:text-white hover:bg-white/5'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    {s.icon}
                    <span>{s.label}</span>
                  </div>
                  {activeSound === s.id && <Check className="w-3.5 h-3.5 text-white" />}
                </button>
              ))}
            </div>

            {/* Volume slider */}
            {activeSound !== 'none' && (
              <div className="pt-2 border-t border-white/10 space-y-1">
                <div className="flex items-center justify-between text-[10px] text-white/50">
                  <span>Громкость</span>
                  <span className="font-mono">{soundVolume}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={soundVolume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  className="w-full h-1 accent-white cursor-pointer bg-white/20 rounded"
                />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
