import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WinterBottomPlayer } from '../WinterBottomPlayer';
import { TimerService } from '../../services/timer';
import * as focusAudioModule from '../../services/focusAudio';

const mockTimerState = {
  running: false,
  remaining_secs: 1500,
  total_secs: 1500,
  elapsed_secs: 0,
  pomodoro_index: 0,
  phase: 'focus' as const,
  mode: 'pomodoro' as const,
  focus_min: 25,
  short_rest_min: 5,
  long_rest_min: 15,
  auto_start: false,
  completed_today: 0,
};

vi.mock('../../services/timer', () => ({
  TimerService: {
    getState: vi.fn(),
    subscribe: vi.fn(() => () => {}),
    start: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    setDuration: vi.fn(),
    shiftMinutes: vi.fn(),
    skipPhase: vi.fn(),
  },
}));

vi.mock('../../services/focusAudio', () => ({
  startFocusAudio: vi.fn(),
  stopFocusAudio: vi.fn(),
  currentFocusSound: vi.fn(() => 'none'),
  setFocusAudioVolume: vi.fn(),
  getFocusAudioVolume: vi.fn(() => 0.25),
}));

describe('WinterBottomPlayer Component (R101, R102)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(TimerService.getState).mockResolvedValue(mockTimerState);
  });

  it('renders formatted timer readout with spaces around colon', async () => {
    render(<WinterBottomPlayer />);
    await waitFor(() => {
      expect(screen.getByText('25 : 00')).toBeDefined();
    });
  });

  it('clicking time opens presets popover with 15m, 25m, 45m, 60m', async () => {
    render(<WinterBottomPlayer />);

    await waitFor(() => {
      expect(screen.getByText('25 : 00')).toBeDefined();
    });

    // Click time to open presets
    fireEvent.click(screen.getByTestId('bottom-player-time'));

    expect(screen.getByTestId('preset-15')).toBeDefined();
    expect(screen.getByTestId('preset-25')).toBeDefined();
    expect(screen.getByTestId('preset-45')).toBeDefined();
    expect(screen.getByTestId('preset-60')).toBeDefined();

    // Click 45m preset
    fireEvent.click(screen.getByTestId('preset-45'));

    await waitFor(() => {
      expect(TimerService.setDuration).toHaveBeenCalledWith(45);
      expect(TimerService.reset).toHaveBeenCalled();
    });
  });

  it('clicking phase indicator opens phase popover and switches phase', async () => {
    render(<WinterBottomPlayer />);

    await waitFor(() => {
      expect(screen.getByTestId('bottom-player-phase')).toBeDefined();
    });

    // Click phase button
    fireEvent.click(screen.getByTestId('bottom-player-phase'));

    expect(screen.getByText(/Перерыв/)).toBeDefined();
    expect(screen.getByText(/Отдых/)).toBeDefined();

    // Click short break
    fireEvent.click(screen.getByText(/Перерыв/));

    await waitFor(() => {
      expect(TimerService.setDuration).toHaveBeenCalledWith(5);
      expect(TimerService.reset).toHaveBeenCalled();
    });
  });

  it('clicking sound button opens soundscapes popover and activates audio', async () => {
    render(<WinterBottomPlayer />);

    // Click sound button
    fireEvent.click(screen.getByTestId('bottom-player-sound'));

    expect(screen.getByText('Focus Audio')).toBeDefined();
    expect(screen.getByTestId('soundscape-rain')).toBeDefined();
    expect(screen.getByTestId('soundscape-brown')).toBeDefined();

    // Click Rain
    fireEvent.click(screen.getByTestId('soundscape-rain'));

    expect(focusAudioModule.startFocusAudio).toHaveBeenCalledWith('rain');
  });

  it('toggles start and pause', async () => {
    render(<WinterBottomPlayer />);

    // Start
    fireEvent.click(screen.getByTestId('bottom-player-toggle'));
    expect(TimerService.start).toHaveBeenCalled();
  });
});
