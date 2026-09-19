import React, { useEffect, useState, useMemo } from 'react';
import { TimerService, type TimerSnapshot } from '../services/timer';
import { getPref, subscribePrefs } from '../services/settings';
import { PHASE_COLORS, type PhaseColorKey } from '../constants/design';

/**
 * Maps a timer snapshot to the canonical PhaseColorKey.
 *
 * Handles:
 * - running = false -> 'idle'
 * - mode = 'stopwatch' -> 'focus'
 * - phase = 'focus' | 'short_rest' | 'long_rest' -> corresponding key
 * - legacy phase = 'rest' -> 'short_rest'
 * - any unknown / missing phase -> 'idle'
 */
export function getPhaseColorKey(snapshot: TimerSnapshot | null): PhaseColorKey {
  if (!snapshot || !snapshot.running) {
    return 'idle';
  }

  // A stopwatch session is focused effort without pomodoro breaks.
  if ((snapshot.mode as string) === 'stopwatch') {
    return 'focus';
  }

  const phase = snapshot.phase as string;
  if (phase === 'focus') {
    return 'focus';
  }
  if (phase === 'short_rest') {
    return 'short_rest';
  }
  if (phase === 'long_rest') {
    return 'long_rest';
  }
  // Fallback for legacy timer phase during migration
  if (phase === 'rest') {
    return 'short_rest';
  }

  return 'idle';
}

/**
 * Calculates a subtle warm or cool RGB bias based on the hour of the day.
 * - Morning (5:00 - 10:59): warm bias (slight boost to red, gentle touch of amber)
 * - Midday (11:00 - 16:59): neutral bias (no tint shift)
 * - Evening / Night (17:00 - 4:59): cooler bias (slight boost to blue/indigo)
 */
export function getHourBias(hour: number): { r: number; g: number; b: number } {
  if (hour >= 5 && hour < 11) {
    // Warm morning glow
    return { r: 18, g: 6, b: -10 };
  }
  if (hour >= 11 && hour < 17) {
    // Midday neutral
    return { r: 0, g: 0, b: 0 };
  }
  // Evening and night cooler tone
  return { r: -8, g: -4, b: 18 };
}

/**
 * Converts a hex string and hour bias into an rgba string.
 */
export function modulateColor(hex: string, alpha: number, hour: number): string {
  const clean = hex.replace('#', '');
  const baseR = parseInt(clean.substring(0, 2), 16);
  const baseG = parseInt(clean.substring(2, 4), 16);
  const baseB = parseInt(clean.substring(4, 6), 16);

  const bias = getHourBias(hour);
  const r = Math.min(255, Math.max(0, baseR + bias.r));
  const g = Math.min(255, Math.max(0, baseG + bias.g));
  const b = Math.min(255, Math.max(0, baseB + bias.b));

  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * DynamicBackground component (Task 1.6, R05).
 *
 * Renders two soft radial gradients in fixed positions behind the app shell.
 * Colors adapt to the current timer phase and the time of day.
 *
 * Performance and motion constraints:
 * - Animates strictly via CSS transition (2s).
 * - Painted with pure CSS custom properties and 2s transition to guarantee <=2% idle CPU (R46).
 * - When prefers-reduced-motion is active, transitions are disabled via global CSS.
 * - Sits behind app content with z-index: 0, pointer-events: none.
 * - Returns null when tempo_dynamic_background preference is false.
 */
export function DynamicBackground(): React.ReactElement | null {
  const [enabled, setEnabled] = useState<boolean>(() =>
    getPref<boolean>('tempo_dynamic_background', true),
  );
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);

  // Subscribe to settings changes
  useEffect(() => {
    return subscribePrefs((key, value) => {
      if (key === 'tempo_dynamic_background') {
        setEnabled(Boolean(value));
      }
    });
  }, []);

  // Subscribe to timer state
  useEffect(() => {
    return TimerService.subscribe((state) => {
      setSnapshot(state);
    });
  }, []);

  const phaseKey = getPhaseColorKey(snapshot);
  const baseHex = PHASE_COLORS[phaseKey] ?? PHASE_COLORS.idle;

  // We evaluate the hour at render time without an active timer loop,
  // matching the requirement that transitions only trigger on phase changes.
  const currentHour = new Date().getHours();

  // Precompute the gradient color stops with low opacity for subtle ambiance
  const { color1, color2 } = useMemo(() => {
    const c1 = modulateColor(baseHex, 0.18, currentHour);
    const c2 = modulateColor(baseHex, 0.10, currentHour);
    return { color1: c1, color2: c2 };
  }, [baseHex, currentHour]);

  if (!enabled) {
    return null;
  }

  return (
    <div
      data-testid="dynamic-background"
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 overflow-hidden select-none z-0"
      style={
        {
          '--dyn-bg-color-1': color1,
          '--dyn-bg-color-2': color2,
          '--dyn-bg-base-hex': baseHex,
          transition: 'background 2s ease, opacity 2s ease',
          background: `
            radial-gradient(ellipse 65% 55% at 15% 15%, var(--dyn-bg-color-1) 0%, transparent 70%),
            radial-gradient(ellipse 60% 50% at 85% 85%, var(--dyn-bg-color-2) 0%, transparent 70%)
          `,
        } as React.CSSProperties
      }
    />
  );
}
