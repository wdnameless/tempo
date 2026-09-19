import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, act } from '@testing-library/react';
import { DynamicBackground, getPhaseColorKey } from '../DynamicBackground';
import { setPref, resetSettingsCacheForTesting } from '../../services/settings';
import { PHASE_COLORS } from '../../constants/design';
import type { TimerSnapshot } from '../../services/timer';
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

// Mock backend listeners and invoke
const listeners = new Map<string, (e: { payload: unknown }) => void>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([])),
  isTauri: () => true,
}));

function emitTimerTick(snapshot: Partial<TimerSnapshot>) {
  const fullSnapshot: TimerSnapshot = {
    mode: 'pomodoro',
    phase: 'focus',
    remaining_secs: 1500,
    total_secs: 1500,
    elapsed_secs: 0,
    running: true,
    pomodoro_index: 1,
    completed_today: 0,
    focus_min: 25,
    short_rest_min: 5,
    long_rest_min: 15,
    auto_start: false,
    ...snapshot,
  };
  const handler = listeners.get('timer://tick');
  if (handler) {
    handler({ payload: fullSnapshot });
  }
}

describe('DynamicBackground', () => {
  beforeEach(() => {
    listeners.clear();
    resetSettingsCacheForTesting();
    vi.clearAllMocks();
  });

  it('renders the layer when enabled by default', () => {
    const { container } = render(<DynamicBackground />);
    const el = container.querySelector('[data-testid="dynamic-background"]');
    expect(el).not.toBeNull();
  });

  it('renders nothing when the preference is off', async () => {
    await setPref('tempo_dynamic_background', false);
    const { container } = render(<DynamicBackground />);
    const el = container.querySelector('[data-testid="dynamic-background"]');
    expect(el).toBeNull();
  });

  it('toggles visibility when preference changes', async () => {
    const { container } = render(<DynamicBackground />);
    expect(container.querySelector('[data-testid="dynamic-background"]')).not.toBeNull();

    await act(async () => {
      await setPref('tempo_dynamic_background', false);
    });
    expect(container.querySelector('[data-testid="dynamic-background"]')).toBeNull();

    await act(async () => {
      await setPref('tempo_dynamic_background', true);
    });
    expect(container.querySelector('[data-testid="dynamic-background"]')).not.toBeNull();
  });

  it('changes the hue variable when the reported phase changes', () => {
    const { container } = render(<DynamicBackground />);
    const el = container.querySelector('[data-testid="dynamic-background"]') as HTMLElement;
    expect(el).not.toBeNull();

    // Initially, timer snapshot is null -> idle
    expect(el.style.getPropertyValue('--dyn-bg-base-hex')).toBe(PHASE_COLORS.idle);

    // Switch to focus phase
    act(() => {
      emitTimerTick({ phase: 'focus', running: true });
    });
    expect(el.style.getPropertyValue('--dyn-bg-base-hex')).toBe(PHASE_COLORS.focus);

    // Switch to short_rest phase
    act(() => {
      emitTimerTick({ phase: 'short_rest', running: true });
    });
    expect(el.style.getPropertyValue('--dyn-bg-base-hex')).toBe(PHASE_COLORS.short_rest);

    // Switch to long_rest phase
    act(() => {
      emitTimerTick({ phase: 'long_rest', running: true });
    });
    expect(el.style.getPropertyValue('--dyn-bg-base-hex')).toBe(PHASE_COLORS.long_rest);

    // Timer stopped / not running -> idle
    act(() => {
      emitTimerTick({ phase: 'focus', running: false });
    });
    expect(el.style.getPropertyValue('--dyn-bg-base-hex')).toBe(PHASE_COLORS.idle);
  });

  it('maps a stopwatch phase to focus', () => {
    const { container } = render(<DynamicBackground />);
    const el = container.querySelector('[data-testid="dynamic-background"]') as HTMLElement;

    act(() => {
      emitTimerTick({ mode: 'stopwatch' as TimerSnapshot['mode'], running: true });
    });
    expect(el.style.getPropertyValue('--dyn-bg-base-hex')).toBe(PHASE_COLORS.focus);
  });

  it('falls back to idle for unknown phase or null state', () => {
    expect(getPhaseColorKey(null)).toBe('idle');
    const unknownPhaseSnapshot: TimerSnapshot = {
      mode: 'pomodoro',
      phase: 'unknown_phase' as unknown as TimerSnapshot['phase'],
      remaining_secs: 0,
      total_secs: 0,
      elapsed_secs: 0,
      running: true,
      pomodoro_index: 1,
      completed_today: 0,
      focus_min: 25,
      short_rest_min: 5,
      long_rest_min: 15,
      auto_start: false,
    };
    expect(getPhaseColorKey(unknownPhaseSnapshot)).toBe('idle');
    const idleSnapshot: TimerSnapshot = {
      mode: 'pomodoro',
      phase: 'focus',
      remaining_secs: 0,
      total_secs: 0,
      elapsed_secs: 0,
      running: false,
      pomodoro_index: 1,
      completed_today: 0,
      focus_min: 25,
      short_rest_min: 5,
      long_rest_min: 15,
      auto_start: false,
    };
    expect(getPhaseColorKey(idleSnapshot)).toBe('idle');
  });

  it('sits behind content and does not capture pointer events', () => {
    const { container } = render(<DynamicBackground />);
    const el = container.querySelector('[data-testid="dynamic-background"]') as HTMLElement;
    expect(el.className).toContain('pointer-events-none');
    expect(el.className).toContain('z-0');
    expect(el.getAttribute('aria-hidden')).toBe('true');
  });
});
