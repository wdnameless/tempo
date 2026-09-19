import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './platform';

/**
 * The pomodoro timer, backed by the Rust `timer` module.
 *
 * The clock itself lives in the backend: a component-owned countdown was lost
 * the moment its sub-tab unmounted, the mini overlay had nothing to display
 * when that component was gone, and the global hotkeys drove a timer that was
 * not running. Here the frontend only issues commands and renders snapshots.
 */

export type TimerPhase = 'focus' | 'short_rest' | 'long_rest';
export type TimerMode = 'pomodoro' | 'stopwatch';

export interface TimerSnapshot {
  total_secs: number;
  remaining_secs: number;
  elapsed_secs: number;
  running: boolean;
  mode: TimerMode;
  phase: TimerPhase;
  /** 1-based index in the current 4-pomodoro cycle (1..=4). */
  pomodoro_index: number;
  /** Completed focus sessions today. */
  completed_today: number;
  focus_min: number;
  short_rest_min: number;
  long_rest_min: number;
  auto_start: boolean;
}

export const IDLE: TimerSnapshot = {
  total_secs: 1500,
  remaining_secs: 1500,
  elapsed_secs: 0,
  running: false,
  mode: 'pomodoro',
  phase: 'focus',
  pomodoro_index: 1,
  completed_today: 0,
  focus_min: 25,
  short_rest_min: 5,
  long_rest_min: 15,
  auto_start: false,
};

/** Mirrors the backend's clamp, so the UI never arms something it cannot set. */
export const MIN_MINUTES = 10;
export const MAX_MINUTES = 120;

export const MIN_SHORT_REST = 1;
export const MAX_SHORT_REST = 30;
export const MIN_LONG_REST = 5;
export const MAX_LONG_REST = 60;

export class TimerService {
  /**
   * Snapshot of the current timer state.
   *
   * Outside Tauri there is no backend to ask, so the idle state is returned and
   * every command below becomes a no-op rather than a rejected promise.
   */
  static async getState(): Promise<TimerSnapshot> {
    if (!isTauri()) return IDLE;
    try {
      return await invoke<TimerSnapshot>('timer_get_state');
    } catch (e) {
      console.warn('timer_get_state failed:', e);
      return IDLE;
    }
  }

  static async setDuration(minutes: number): Promise<void> {
    if (!isTauri()) return;
    const clamped = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(minutes)));
    await invoke('timer_set_duration', { secs: clamped * 60 });
  }

  static async shiftMinutes(delta: number): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_shift_minutes', { delta });
  }

  static async start(): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_start');
  }

  static async pause(): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_pause');
  }

  static async toggle(): Promise<void> {
    const state = await TimerService.getState();
    return state.running ? TimerService.pause() : TimerService.start();
  }

  static async reset(): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_reset');
  }

  static async skipPhase(): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_skip_phase');
  }

  static async setMode(mode: TimerMode): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_set_mode', { mode });
  }

  /** Arms the pomodoro cycle settings: focus duration, short/long rest, auto-start. */
  static async setPomodoroSettings(
    focusMin: number,
    shortRestMin: number,
    longRestMin: number,
    autoStart: boolean,
  ): Promise<void> {
    if (!isTauri()) return;
    await invoke('timer_set_pomodoro_settings', {
      focusMin,
      shortRestMin,
      longRestMin,
      autoStart,
    });
  }

  /**
   * Subscribes to backend timer state.
   *
   * Both the once-a-second tick and the "something else changed it" nudge from
   * the global hotkeys land here, so a shortcut pressed while the window is
   * unfocused still updates the display.
   */
  static subscribe(handler: (state: TimerSnapshot) => void): () => void {
    if (!isTauri()) return () => {};

    const unlisteners: Array<() => void> = [];
    let cancelled = false;

    const bind = (event: string) => {
      void listen<TimerSnapshot>(event, (e) => handler(e.payload)).then((fn) => {
        if (cancelled) fn();
        else unlisteners.push(fn);
      });
    };

    bind('timer://tick');
    bind('timer://changed');

    return () => {
      cancelled = true;
      unlisteners.forEach((fn) => fn());
    };
  }
}
