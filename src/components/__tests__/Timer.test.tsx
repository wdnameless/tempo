import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Define __TAURI_INTERNALS__ so isTauri() returns true in tests
Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true });

import { Timer } from '../Timer';
import type { TimerSnapshot } from '../../services/timer';

// Mock confetti and soundService
vi.mock('canvas-confetti', () => ({
  default: vi.fn(),
}));

vi.mock('../../services/sound', () => ({
  soundService: {
    playUiClick: vi.fn(),
    playFinishAlarm: vi.fn(),
  },
}));

// Tauri invoke & listen mocks
const listeners = new Map<string, (event: { payload: unknown }) => void>();
let backendState: TimerSnapshot;

const defaultSnapshot: TimerSnapshot = {
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

const mockInvoke = vi.fn((cmd: string, args?: Record<string, unknown>) => {
  switch (cmd) {
    case 'timer_get_state':
      return Promise.resolve(backendState);
    case 'timer_start':
      backendState = { ...backendState, running: true };
      listeners.get('timer://tick')?.({ payload: backendState });
      return Promise.resolve();
    case 'timer_pause':
      backendState = { ...backendState, running: false };
      listeners.get('timer://tick')?.({ payload: backendState });
      return Promise.resolve();
    case 'timer_reset':
      backendState = {
        ...backendState,
        running: false,
        remaining_secs: backendState.total_secs,
        elapsed_secs: 0,
      };
      listeners.get('timer://tick')?.({ payload: backendState });
      return Promise.resolve();
    case 'timer_set_mode':
      if (args && args.mode) {
        backendState = { ...backendState, mode: args.mode as 'pomodoro' | 'stopwatch' };
        listeners.get('timer://tick')?.({ payload: backendState });
      }
      return Promise.resolve();
    case 'timer_skip_phase':
      return Promise.resolve();
    default:
      return Promise.resolve();
  }
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => (mockInvoke as unknown as (...a: unknown[]) => unknown)(...args),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (event: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

describe('Timer Component (Pomodoro & Stopwatch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listeners.clear();
    backendState = { ...defaultSnapshot };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders remaining time from backend on dial display', async () => {
    backendState = {
      ...defaultSnapshot,
      remaining_secs: 1500,
      total_secs: 1500,
    };

    render(<Timer />);

    await waitFor(() => {
      const display = screen.getByTestId('timer-display');
      expect(display.textContent).toBe('25:00');
    });
  });

  it('renders pomodoro index in cycle and completed today count', async () => {
    backendState = {
      ...defaultSnapshot,
      pomodoro_index: 3,
      completed_today: 5,
    };

    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('pomodoro-cycle-index').textContent).toBe('3 из 4');
      expect(screen.getByTestId('pomodoro-completed-today').textContent).toContain('5');
    });
  });

  it('calls start/pause/reset backend commands', async () => {
    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-btn')).toBeDefined();
    });

    // When paused, toggle button starts the timer
    fireEvent.click(screen.getByTestId('toggle-btn'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('timer_start');
    });

    // Reset button calls timer_reset
    fireEvent.click(screen.getByTestId('reset-btn'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('timer_reset');
    });

    // When running, toggle button pauses the timer
    backendState = { ...backendState, running: true };
    listeners.get('timer://tick')?.({ payload: backendState });

    await waitFor(() => {
      expect(screen.getByTestId('toggle-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('toggle-btn'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('timer_pause');
    });
  });

  it('calls timer_set_mode when mode switch buttons are clicked', async () => {
    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('mode-stopwatch-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('mode-stopwatch-btn'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('timer_set_mode', { mode: 'stopwatch' });
    });
  });

  it('calls timer_skip_phase when skip button is clicked', async () => {
    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('skip-btn')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('skip-btn'));
    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith('timer_skip_phase');
    });
  });

  it('updates phase label when phase changes', async () => {
    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('phase-label')).toBeDefined();
    });

    // Focus phase (running)
    backendState = { ...defaultSnapshot, running: true, phase: 'focus' };
    listeners.get('timer://tick')?.({ payload: backendState });

    await waitFor(() => {
      expect(screen.getByTestId('phase-label').textContent).toBe('Фокус');
    });

    // Short rest phase
    backendState = { ...defaultSnapshot, running: true, phase: 'short_rest' };
    listeners.get('timer://tick')?.({ payload: backendState });

    await waitFor(() => {
      expect(screen.getByTestId('phase-label').textContent).toBe('Перерыв');
    });

    // Long rest phase
    backendState = { ...defaultSnapshot, running: true, phase: 'long_rest' };
    listeners.get('timer://tick')?.({ payload: backendState });

    await waitFor(() => {
      expect(screen.getByTestId('phase-label').textContent).toBe('Длинный перерыв');
    });
  });

  it('survives unmount and remount with countdown intact', async () => {
    backendState = {
      ...defaultSnapshot,
      running: true,
      remaining_secs: 1234,
      total_secs: 1500,
    };

    const { unmount } = render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('timer-display').textContent).toBe('20:34');
    });

    unmount();

    // Re-mount: backend state must be queried again and restored seamlessly
    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('timer-display').textContent).toBe('20:34');
    });
  });

  it('in stopwatch mode shows elapsed time and hides pomodoro cycle counter', async () => {
    backendState = {
      ...defaultSnapshot,
      mode: 'stopwatch',
      running: true,
      elapsed_secs: 125, // 02:05
    };

    render(<Timer />);

    await waitFor(() => {
      expect(screen.getByTestId('timer-display').textContent).toBe('02:05');
      expect(screen.queryByTestId('pomodoro-cycle-info')).toBeNull();
      expect(screen.queryByTestId('skip-btn')).toBeNull();
    });
  });
});
