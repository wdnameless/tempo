import React, { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { themeFromTokens } from '../constants/themes';
import { DEFAULT_ACCENT, PHASE_COLORS } from '../constants/design';
import { I18nService } from '../services/i18n';
import { TimerService, type TimerSnapshot } from '../services/timer';

/**
 * Compact always-on-top overlay showing the timer state.
 *
 * The overlay is opened from the main window and lives in its own Tauri window
 * ('mini-overlay'). It mirrors backend timer state via TimerService.subscribe,
 * so time stays in sync without passing messages through the frontend.
 *
 * Dragging anywhere on the overlay moves the window. A close button returns
 * the user to the main window.
 */
export const MiniOverlay: React.FC = () => {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);
  const theme = themeFromTokens(DEFAULT_ACCENT);
  const t = I18nService.t();

  useEffect(() => {
    void TimerService.getState().then(setSnapshot);
    const unsubscribe = TimerService.subscribe(setSnapshot);
    return () => unsubscribe();
  }, []);

  const formatTime = (totalSeconds: number): string => {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button')) return;
    try {
      void getCurrentWindow().startDragging();
    } catch {
      // Ignored outside Tauri
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().hide();
    } catch {
      // Ignored outside Tauri
    }
  };

  const isStopwatch = snapshot?.mode === 'stopwatch';
  const displaySeconds = snapshot
    ? isStopwatch
      ? snapshot.elapsed_secs
      : snapshot.remaining_secs
    : 0;

  const phaseColor = snapshot
    ? isStopwatch
      ? PHASE_COLORS.focus
      : PHASE_COLORS[snapshot.phase] ?? PHASE_COLORS.focus
    : PHASE_COLORS.idle;

  const phaseLabel = snapshot
    ? isStopwatch
      ? t.pomodoroStopwatch
      : snapshot.phase === 'short_rest'
        ? t.pomodoroShortRest
        : snapshot.phase === 'long_rest'
          ? t.pomodoroLongRest
          : t.pomodoroFocus
    : t.pomodoroIdle;

  // Progress bar calculation for pomodoro mode
  const progressPercent = snapshot && !isStopwatch && snapshot.total_secs > 0
    ? Math.min(100, Math.max(0, ((snapshot.total_secs - snapshot.remaining_secs) / snapshot.total_secs) * 100))
    : 0;

  return (
    <div
      data-testid="mini-overlay"
      onMouseDown={handleMouseDown}
      className="w-full h-full select-none cursor-move flex flex-col justify-between p-3 rounded-2xl border backdrop-blur-md transition-colors duration-300"
      style={{
        backgroundColor: `${theme.surface}E6`,
        borderColor: `${phaseColor}40`,
        color: theme.text,
      }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span
            data-testid="mini-phase-dot"
            className="w-2 h-2 rounded-full transition-colors"
            style={{ backgroundColor: phaseColor }}
          />
          <span className="text-xs font-medium uppercase tracking-wider text-neutral-400">
            {phaseLabel}
          </span>
        </div>
        <button
          type="button"
          onClick={handleClose}
          aria-label="Close overlay"
          className="w-5 h-5 flex items-center justify-center rounded-full hover:bg-white/10 text-neutral-400 hover:text-white transition-colors cursor-pointer"
        >
          &times;
        </button>
      </div>

      <div className="text-center my-auto">
        <div
          data-testid="mini-time"
          className="text-2xl font-mono font-bold tracking-tight"
          style={{ color: phaseColor }}
        >
          {formatTime(displaySeconds)}
        </div>
      </div>

      <div className="w-full bg-neutral-800 rounded-full h-1 overflow-hidden">
        <div
          className="h-full transition-all duration-300 rounded-full"
          style={{
            backgroundColor: phaseColor,
            width: isStopwatch ? '100%' : `${progressPercent}%`,
          }}
        />
      </div>
    </div>
  );
};

/** Closes the overlay window when the user double-clicks it. */
export function useOverlayDismiss(): void {
  useEffect(() => {
    const handler = () => {
      try {
        void getCurrentWindow().close();
      } catch {
        // Ignored outside Tauri
      }
    };
    window.addEventListener('dblclick', handler);
    return () => window.removeEventListener('dblclick', handler);
  }, []);
}
