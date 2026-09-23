import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Play, Pause, RotateCcw, FastForward, Timer as TimerIcon, Watch } from 'lucide-react';
import confetti from 'canvas-confetti';
import { DEFAULT_ACCENT, PHASE_COLORS, type PhaseColorKey } from '../constants/design';
import { TimerService, type TimerSnapshot, MIN_MINUTES, MAX_MINUTES } from '../services/timer';
import { soundService } from '../services/sound';
import { themeFromTokens } from '../constants/themes';
import { I18nService } from '../services/i18n';
import { RadialDial } from './RadialDial';
import type { ThemeColors } from '../types';

export interface TimerProps {
  /** Arms the focus length on mount, e.g. from "timer for 10 minutes" in chat. */
  initialMinutes?: number;
  /** Called when a focus phase reaches zero, so the shell can react. */
  onSessionComplete?: () => void;
}

export const Timer: React.FC<TimerProps> = ({
  initialMinutes = 25,
  onSessionComplete,
}) => {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const [dragProgress, setDragProgress] = useState<number | null>(null);

  const prevPhaseRef = useRef<string | null>(null);
  const prevRunningRef = useRef<boolean>(false);
  const prevModeRef = useRef<string | null>(null);

  const themeTokens = themeFromTokens(DEFAULT_ACCENT);
  const t = I18nService.t();

  // Load initial backend state on mount
  useEffect(() => {
    let mounted = true;
    void TimerService.getState().then((st) => {
      if (mounted) {
        setSnapshot(st);
        prevPhaseRef.current = st.phase;
        prevRunningRef.current = st.running;
        prevModeRef.current = st.mode;
      }
    });

    return () => {
      mounted = false;
    };
  }, []);

  // Listen to backend timer ticks and changes
  useEffect(() => {
    const unsubscribe = TimerService.subscribe((next) => {
      // Phase transition sound detection:
      // Play finish alarm when a phase ends and transitions to another phase while running
      // Do NOT ring on pause or mode switch.
      const oldPhase = prevPhaseRef.current;
      const oldMode = prevModeRef.current;

      if (
        oldPhase &&
        oldPhase !== next.phase &&
        oldMode === next.mode &&
        next.mode === 'pomodoro'
      ) {
        soundService.playFinishAlarm();
        if (oldPhase === 'focus') {
          onSessionComplete?.();
          try {
            void confetti({
              particleCount: 50,
              spread: 60,
              origin: { y: 0.8 },
            });
          } catch {
            // Ignore confetti errors
          }
        }
      }

      prevPhaseRef.current = next.phase;
      prevRunningRef.current = next.running;
      prevModeRef.current = next.mode;

      setSnapshot(next);
    });

    return () => {
      unsubscribe();
    };
  }, [onSessionComplete]);

  // Sync initialMinutes if timer is idle and not running
  useEffect(() => {
    if (!snapshot || snapshot.running) return;
    if (initialMinutes > 0 && Math.round(snapshot.total_secs / 60) !== initialMinutes) {
      void TimerService.setDuration(initialMinutes);
    }
  }, [initialMinutes, snapshot]);

  const handleToggle = useCallback(async () => {
    await TimerService.toggle();
  }, []);

  const handleReset = useCallback(async () => {
    await TimerService.reset();
  }, []);

  const handleSkip = useCallback(async () => {
    await TimerService.skipPhase();
  }, []);

  const handleModeToggle = useCallback(async () => {
    const nextMode = snapshot?.mode === 'pomodoro' ? 'stopwatch' : 'pomodoro';
    await TimerService.setMode(nextMode);
  }, [snapshot?.mode]);

  const handleProgressChange = useCallback((newProgress: number) => {
    setDragProgress(newProgress);
  }, []);

  const handleProgressCommit = useCallback(async (finalProgress: number) => {
    setDragProgress(null);
    const targetMins = Math.round(MIN_MINUTES + finalProgress * (MAX_MINUTES - MIN_MINUTES));
    const clampedMins = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, targetMins));
    await TimerService.setDuration(clampedMins);
  }, []);

  // Time & phase calculations
  const isStopwatch = snapshot?.mode === 'stopwatch';
  const isRunning = snapshot?.running ?? false;

  const currentPhaseKey: PhaseColorKey = isStopwatch
    ? 'focus'
    : (snapshot?.phase ?? 'focus');

  const phaseColor = isRunning || dragProgress !== null
    ? PHASE_COLORS[currentPhaseKey]
    : (snapshot ? PHASE_COLORS[currentPhaseKey] : PHASE_COLORS.idle);

  const phaseLabel = isStopwatch
    ? t.pomodoroStopwatch
    : snapshot?.phase === 'short_rest'
      ? t.pomodoroShortRest
      : snapshot?.phase === 'long_rest'
        ? t.pomodoroLongRest
        : !snapshot || (!isRunning && snapshot.remaining_secs === snapshot.total_secs)
          ? t.pomodoroIdle
          : t.pomodoroFocus;

  // Display time
  let displayMinutes = 25;
  let displaySeconds = 0;

  if (dragProgress !== null) {
    const mins = Math.round(MIN_MINUTES + dragProgress * (MAX_MINUTES - MIN_MINUTES));
    displayMinutes = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, mins));
    displaySeconds = 0;
  } else if (snapshot) {
    if (isStopwatch) {
      displayMinutes = Math.floor(snapshot.elapsed_secs / 60);
      displaySeconds = snapshot.elapsed_secs % 60;
    } else {
      displayMinutes = Math.floor(snapshot.remaining_secs / 60);
      displaySeconds = snapshot.remaining_secs % 60;
    }
  }

  const formattedTime = `${String(displayMinutes).padStart(2, '0')}:${String(displaySeconds).padStart(2, '0')}`;

  // Progress for RadialDial (0 to 1)
  let dialProgress = 0;
  if (dragProgress !== null) {
    dialProgress = dragProgress;
  } else if (isStopwatch) {
    // In stopwatch, progress around a 60-minute dial
    dialProgress = snapshot ? ((snapshot.elapsed_secs % 3600) / 3600) : 0;
  } else if (snapshot && snapshot.total_secs > 0) {
    dialProgress = (snapshot.total_secs - snapshot.remaining_secs) / snapshot.total_secs;
  }

  // Theme for RadialDial
  const dialTheme: ThemeColors = {
    ...themeTokens,
    text: phaseColor,
    subtext: themeTokens.subtext,
    accent: phaseColor,
    ringProgress: phaseColor,
    ringTrack: `${phaseColor}26`, // 15% opacity track
  };
  return (
    <div
      data-testid="timer-view"
      className="flex flex-col items-center justify-center p-6 select-none"
    >
      {/* Mode Switcher */}
      <div className="flex items-center gap-2 mb-6 p-1 rounded-xl bg-neutral-900/60 border border-neutral-800">
        <button
          type="button"
          onClick={handleModeToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            !isStopwatch
              ? 'bg-neutral-800 text-neutral-100 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
          data-testid="mode-pomodoro-btn"
          aria-label="Pomodoro mode"
        >
          <TimerIcon className="w-3.5 h-3.5" />
          <span>{t.pomodoroSettings}</span>
        </button>
        <button
          type="button"
          onClick={handleModeToggle}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
            isStopwatch
              ? 'bg-neutral-800 text-neutral-100 shadow-sm'
              : 'text-neutral-400 hover:text-neutral-200'
          }`}
          data-testid="mode-stopwatch-btn"
          aria-label="Stopwatch mode"
        >
          <Watch className="w-3.5 h-3.5" />
          <span>{t.pomodoroStopwatch}</span>
        </button>
      </div>

      {/* Phase Indicator & Pomodoro Cycle Info */}
      <div className="flex flex-col items-center mb-4 text-center">
        <div className="flex items-center gap-2">
          <span
            className="w-2.5 h-2.5 rounded-full transition-colors duration-300"
            style={{ backgroundColor: phaseColor }}
            data-testid="phase-dot"
          />
          <span
            data-testid="phase-label"
            className="text-sm font-semibold uppercase tracking-wider transition-colors duration-300"
            style={{ color: phaseColor }}
          >
            {phaseLabel}
          </span>
        </div>

        {/* Pomodoro Cycle & Daily Counter (only in pomodoro mode) */}
        {!isStopwatch && snapshot && (
          <div
            data-testid="pomodoro-cycle-info"
            className="flex items-center gap-4 mt-2 text-xs text-neutral-400"
          >
            <span data-testid="pomodoro-cycle-index">
              {snapshot.pomodoro_index} {t.pomodoroOf} 4
            </span>
            <span className="text-neutral-600">•</span>
            <span data-testid="pomodoro-completed-today">
              {snapshot.completed_today} {t.pomodoroToday}
            </span>
          </div>
        )}
      </div>

      {/* Big Radial Dial with Time Centered */}
      <div className="relative my-2">
        <RadialDial
          theme={dialTheme}
          progress={dialProgress}
          primaryText={formattedTime}
          isInteractive={!isRunning && !isStopwatch}
          onProgressChange={handleProgressChange}
          onProgressCommit={handleProgressCommit}
          size={240}
        />
        {/* Mirror timer-display test id on the text for test compatibility */}
        <span data-testid="timer-display" className="sr-only">
          {formattedTime}
        </span>
      </div>

      {/* Controls: Start/Pause, Reset, Skip */}
      <div className="flex items-center gap-4 mt-6">
        <button
          type="button"
          onClick={handleReset}
          className="p-3 rounded-2xl bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-all cursor-pointer"
          data-testid="reset-btn"
          aria-label={t.pomodoroReset}
          title={t.pomodoroReset}
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <button
          type="button"
          onClick={handleToggle}
          className="px-8 py-3 rounded-2xl font-medium flex items-center gap-2 shadow-lg transition-all cursor-pointer hover:opacity-90 active:scale-95"
          style={{
            backgroundColor: phaseColor,
            color: '#18181B', // dark text on vibrant phase color
          }}
          data-testid="toggle-btn"
          aria-label={isRunning ? t.pomodoroPause : t.pomodoroStart}
        >
          {isRunning ? (
            <>
              <Pause className="w-5 h-5 fill-current" />
              <span className="font-semibold">{t.pomodoroPause}</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              <span className="font-semibold">{t.pomodoroStart}</span>
            </>
          )}
        </button>

        {!isStopwatch && (
          <button
            type="button"
            onClick={handleSkip}
            className="p-3 rounded-2xl bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 text-neutral-400 hover:text-neutral-200 transition-all cursor-pointer"
            data-testid="skip-btn"
            aria-label={t.pomodoroSkip}
            title={t.pomodoroSkip}
          >
            <FastForward className="w-5 h-5" />
          </button>
        )}
      </div>
    </div>
  );
};
