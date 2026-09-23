import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AudioPlayer, formatPlayerTime } from '../AudioPlayer';
import { I18nService } from '../../services/i18n';

describe('formatPlayerTime', () => {
  it('formats seconds into mm:ss or hh:mm:ss without leading zeroes on single digit minutes', () => {
    expect(formatPlayerTime(0)).toBe('0:00');
    expect(formatPlayerTime(-5)).toBe('0:00');
    expect(formatPlayerTime(7)).toBe('0:07');
    expect(formatPlayerTime(92)).toBe('1:32');
    expect(formatPlayerTime(3600)).toBe('1:00:00');
    expect(formatPlayerTime(3665)).toBe('1:01:05');
  });
});

describe('AudioPlayer Component', () => {
  const t = I18nService.t();

  beforeEach(() => {
    vi.clearAllMocks();
    // HTMLMediaElement methods in JSDOM
    window.HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
    window.HTMLMediaElement.prototype.pause = vi.fn();
  });

  it('renders headless audio element without controls attribute', () => {
    const { container } = render(<AudioPlayer src="tempo-media://test.wav" title="Test Audio" />);

    const audio = container.querySelector('audio');
    expect(audio).toBeDefined();
    expect(audio?.hasAttribute('controls')).toBe(false);
    expect(audio?.src).toContain('tempo-media://test.wav');

    // Controls must not exist as native attribute
    expect(container.querySelectorAll('audio[controls]').length).toBe(0);
  });

  it('toggles play and pause on button click and fires callbacks', () => {
    const onPlay = vi.fn();
    const onPause = vi.fn();

    const { container } = render(
      <AudioPlayer src="tempo-media://test.wav" onPlay={onPlay} onPause={onPause} />,
    );

    const playBtn = screen.getByRole('button', { name: t.playerPlay });
    const audio = container.querySelector('audio')!;

    // Click play
    fireEvent.click(playBtn);
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();

    // Simulate audio onPlay event
    act(() => {
      fireEvent.play(audio);
    });

    expect(onPlay).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t.playerPause })).toBeDefined();

    // Click pause
    const pauseBtn = screen.getByRole('button', { name: t.playerPause });
    fireEvent.click(pauseBtn);
    expect(window.HTMLMediaElement.prototype.pause).toHaveBeenCalled();

    // Simulate audio onPause event
    act(() => {
      fireEvent.pause(audio);
    });

    expect(onPause).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: t.playerPlay })).toBeDefined();
  });

  it('displays elapsed and total time and updates on timeupdate / durationchange', () => {
    const { container } = render(<AudioPlayer src="tempo-media://test.wav" />);
    const audio = container.querySelector('audio')!;

    // Initial time display
    expect(screen.getByText('0:00 / 0:00')).toBeDefined();

    // Simulate duration change to 92s (1:32)
    Object.defineProperty(audio, 'duration', { value: 92, writable: true, configurable: true });
    act(() => {
      fireEvent.durationChange(audio);
    });

    expect(screen.getByText('0:00 / 1:32')).toBeDefined();

    // Simulate timeupdate to 7s (0:07)
    Object.defineProperty(audio, 'currentTime', { value: 7, writable: true, configurable: true });
    act(() => {
      fireEvent.timeUpdate(audio);
    });

    expect(screen.getByText('0:07 / 1:32')).toBeDefined();
  });

  it('seeking sets the position on the audio element', () => {
    const { container } = render(<AudioPlayer src="tempo-media://test.wav" />);
    const audio = container.querySelector('audio')!;

    Object.defineProperty(audio, 'duration', { value: 100, writable: true, configurable: true });
    act(() => {
      fireEvent.durationChange(audio);
    });

    const seekSlider = screen.getByLabelText(t.playerSeek);
    fireEvent.change(seekSlider, { target: { value: '45' } });

    expect(audio.currentTime).toBe(45);
    expect(seekSlider.getAttribute('value')).toBe('45');
  });

  it('volume control sets the volume and mute state', () => {
    const { container } = render(<AudioPlayer src="tempo-media://test.wav" />);
    const audio = container.querySelector('audio')!;

    const volumeSlider = screen.getByLabelText(t.playerVolume);
    fireEvent.change(volumeSlider, { target: { value: '0.6' } });

    expect(audio.volume).toBe(0.6);
    expect(audio.muted).toBe(false);

    // Mute button
    const muteBtn = screen.getByRole('button', { name: t.playerMute });
    fireEvent.click(muteBtn);

    expect(audio.muted).toBe(true);
    expect(screen.getByRole('button', { name: t.playerUnmute })).toBeDefined();

    // Unmute
    const unmuteBtn = screen.getByRole('button', { name: t.playerUnmute });
    fireEvent.click(unmuteBtn);

    expect(audio.muted).toBe(false);
    expect(audio.volume).toBe(0.6);
  });

  it('supports keyboard navigation for space (play/pause), arrow keys (seek/volume), and m (mute)', () => {
    const { container } = render(<AudioPlayer src="tempo-media://test.wav" />);
    const playerRegion = screen.getByRole('region');
    const audio = container.querySelector('audio')!;

    Object.defineProperty(audio, 'duration', { value: 60, writable: true, configurable: true });
    act(() => {
      fireEvent.durationChange(audio);
    });

    // Space key toggles play
    fireEvent.keyDown(playerRegion, { key: ' ' });
    expect(window.HTMLMediaElement.prototype.play).toHaveBeenCalled();

    // ArrowRight seeks forward 5 seconds
    audio.currentTime = 10;
    fireEvent.keyDown(playerRegion, { key: 'ArrowRight' });
    expect(audio.currentTime).toBe(15);

    // ArrowLeft seeks backward 5 seconds
    fireEvent.keyDown(playerRegion, { key: 'ArrowLeft' });
    expect(audio.currentTime).toBe(10);

    // ArrowDown lowers volume
    audio.volume = 0.5;
    fireEvent.keyDown(playerRegion, { key: 'ArrowDown' });
    expect(audio.volume).toBeCloseTo(0.45);

    // ArrowUp raises volume
    fireEvent.keyDown(playerRegion, { key: 'ArrowUp' });
    expect(audio.volume).toBeCloseTo(0.5);

    // 'm' toggles mute
    fireEvent.keyDown(playerRegion, { key: 'm' });
    expect(audio.muted).toBe(true);

    fireEvent.keyDown(playerRegion, { key: 'm' });
    expect(audio.muted).toBe(false);
  });
});
