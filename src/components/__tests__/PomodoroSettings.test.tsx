import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PomodoroSettings } from '../PomodoroSettings';
import { TimerService, MIN_MINUTES, MAX_MINUTES, TimerSnapshot } from '../../services/timer';
import { currentFocusSound, _resetAudioContextForTesting } from '../../services/focusAudio';
import { StoreService } from '../../services/store';

vi.mock('../../services/timer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/timer')>();
  return {
    ...actual,
    MIN_MINUTES: 10,
    MAX_MINUTES: 120,
    TimerService: {
      ...actual.TimerService,
      getState: vi.fn(),
      setPomodoroSettings: vi.fn(),
    },
  };
});

describe('PomodoroSettings', () => {
  const mockSnapshot: TimerSnapshot = {
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

  beforeEach(() => {
    vi.clearAllMocks();
    _resetAudioContextForTesting();
    StoreService.resetCache();
    StoreService.setPreference('tempo_focus_sound', 'none');
    vi.mocked(TimerService.getState).mockResolvedValue(mockSnapshot);
    vi.mocked(TimerService.setPomodoroSettings).mockResolvedValue(undefined);
  });

  it('renders the four rows plus focus audio picker', async () => {
    render(<PomodoroSettings />);

    await waitFor(() => {
      expect(TimerService.getState).toHaveBeenCalled();
    });

    // Check titles for focus, short rest, long rest, auto-start, and focus audio
    expect(screen.getByText(/^Длительность фокуса$|^Focus length$/i)).toBeDefined();
    expect(screen.getByText(/^Короткий перерыв$|^Short break$/i)).toBeDefined();
    expect(screen.getAllByText(/Длинный перерыв|Long break/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/^Автостарт фокуса$|^Auto-start focus$/i)).toBeDefined();
    expect(screen.getByText(/^Звук фокуса$|^Focus audio$/i)).toBeDefined();
  });

  it('moving the focus slider calls setPomodoroSettings with clamped value', async () => {
    render(<PomodoroSettings />);

    await waitFor(() => {
      expect(TimerService.getState).toHaveBeenCalled();
    });

    const sliders = screen.getAllByRole('slider');
    const focusSlider = sliders[0];

    // Change to 50
    fireEvent.change(focusSlider, { target: { value: '50' } });

    expect(TimerService.setPomodoroSettings).toHaveBeenCalledWith(50, 5, 15, false);

    // Change beyond max (150) -> should be clamped to MAX_MINUTES (120)
    fireEvent.change(focusSlider, { target: { value: '150' } });
    expect(TimerService.setPomodoroSettings).toHaveBeenCalledWith(MAX_MINUTES, 5, 15, false);

    // Change below min (5) -> should be clamped to MIN_MINUTES (10)
    fireEvent.change(focusSlider, { target: { value: '5' } });
    expect(TimerService.setPomodoroSettings).toHaveBeenCalledWith(MIN_MINUTES, 5, 15, false);
  });

  it('the audio picker persists the choice', async () => {
    render(<PomodoroSettings />);

    await waitFor(() => {
      expect(TimerService.getState).toHaveBeenCalled();
    });

    expect(currentFocusSound()).toBe('none');

    // Select White noise / Белый шум
    const whiteBtn = screen.getByRole('radio', { name: /Белый шум|White noise/i });
    fireEvent.click(whiteBtn);

    expect(currentFocusSound()).toBe('white');
  });

  it('a snapshot from the backend is reflected in the controls', async () => {
    const customSnapshot: TimerSnapshot = {
      ...mockSnapshot,
      focus_min: 45,
      short_rest_min: 10,
      long_rest_min: 25,
      auto_start: true,
    };
    vi.mocked(TimerService.getState).mockResolvedValue(customSnapshot);

    render(<PomodoroSettings />);

    await waitFor(() => {
      const toggle = screen.getByRole('switch');
      expect(toggle.getAttribute('aria-checked')).toBe('true');
    });

    const sliders = screen.getAllByRole('slider') as HTMLInputElement[];
    expect(sliders[0].value).toBe('45');
    expect(sliders[1].value).toBe('10');
    expect(sliders[2].value).toBe('25');
  });
});
