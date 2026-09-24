import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { DictationIndicator } from '../DictationIndicator';
import * as stt from '../../services/stt';
import * as sttEvents from '../../services/sttEvents';
import * as speechSettings from '../../services/speechSettings';
import { I18nService } from '../../services/i18n';

vi.mock('../../services/stt', () => ({
  dictationState: vi.fn(),
  stopDictation: vi.fn(),
  cancelDictation: vi.fn(),
}));

vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(() => () => {}),
}));

vi.mock('../../services/speechSettings', async (importOriginal) => {
  const actual = await importOriginal<typeof speechSettings>();
  return {
    ...actual,
    loadSpeechConfig: vi.fn(() => ({
      ...actual.DEFAULT_SPEECH_CONFIG,
      overlayEnabled: true,
    })),
    subscribeSpeechConfig: vi.fn(() => () => {}),
  };
});

describe('DictationIndicator', () => {
  let eventHandler: ((e: sttEvents.SttEvent) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
    vi.mocked(sttEvents.onSttEvent).mockImplementation((handler) => {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    });
    vi.mocked(speechSettings.loadSpeechConfig).mockReturnValue({
      ...speechSettings.DEFAULT_SPEECH_CONFIG,
      overlayEnabled: true,
      dictationWave: true,
      dictationWaveBars: 24,
    });
  });

  it('renders nothing when not recording (idle)', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: null,
    });

    const { container } = render(<DictationIndicator pollIntervalMs={100} />);

    await waitFor(() => {
      expect(stt.dictationState).toHaveBeenCalled();
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders wave columns when dictationWave is true (default)', async () => {
    const startTime = Date.now() - 5000;
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.65,
      since: startTime,
    });

    render(<DictationIndicator pollIntervalMs={100} defaultMode="insert" />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    // Shows dictation shortcut title from i18n
    expect(screen.getAllByText(I18nService.t().settingsSpeechHotkey).length).toBeGreaterThan(0);

    // Wave is rendered with configured 24 bars
    const wave = screen.getByTestId('dictation-wave');
    expect(wave).toBeDefined();
    const bars = screen.getAllByTestId('dictation-wave-bar');
    expect(bars.length).toBe(24);

    // Mode and timer are displayed
    expect(screen.getByTestId('dictation-mode').textContent).toBe('insert');
    expect(screen.getByTestId('dictation-timer')).toBeDefined();
  });

  it('renders old level bar when dictationWave is false', async () => {
    vi.mocked(speechSettings.loadSpeechConfig).mockReturnValue({
      ...speechSettings.DEFAULT_SPEECH_CONFIG,
      overlayEnabled: true,
      dictationWave: false,
    });

    const startTime = Date.now() - 5000;
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.65,
      since: startTime,
    });

    render(<DictationIndicator pollIntervalMs={100} defaultMode="insert" />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    // Volume level bar is rendered with 65% width
    const levelBar = screen.getByTestId('dictation-level-bar');
    expect(levelBar).toBeDefined();
    expect(levelBar.style.width).toBe('65%');
    expect(screen.queryByTestId('dictation-wave')).toBeNull();
  });

  it('calls stopDictation when Stop button is clicked', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.3,
      since: Date.now(),
    });
    vi.mocked(stt.stopDictation).mockResolvedValue({
      text: 'hello world',
      duration_ms: 1200,
      engine: 'local',
    });

    const onStop = vi.fn();
    render(<DictationIndicator pollIntervalMs={100} onStop={onStop} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-stop-button')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('dictation-stop-button'));

    await waitFor(() => {
      expect(stt.stopDictation).toHaveBeenCalledTimes(1);
      expect(onStop).toHaveBeenCalledTimes(1);
    });
  });

  it('calls cancelDictation when Cancel button is clicked', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.3,
      since: Date.now(),
    });
    vi.mocked(stt.cancelDictation).mockResolvedValue(undefined);

    render(<DictationIndicator pollIntervalMs={100} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-cancel-button')).toBeDefined();
    });

    fireEvent.click(screen.getByTestId('dictation-cancel-button'));

    await waitFor(() => {
      expect(stt.cancelDictation).toHaveBeenCalledTimes(1);
    });
  });

  it('updates state reactively via onSttEvent', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: null,
    });

    render(<DictationIndicator pollIntervalMs={500} />);

    expect(eventHandler).toBeDefined();

    // Fire dictation-started event
    act(() => {
      eventHandler?.({ type: 'dictation-started', mode: 'copy' });
    });

    expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    expect(screen.getByTestId('dictation-mode').textContent).toBe('copy');

    // Fire dictation-level event
    act(() => {
      eventHandler?.({ type: 'dictation-level', level: 0.8 });
    });

    const bars = screen.getAllByTestId('dictation-wave-bar');
    expect(bars.length).toBe(24);
    // Peak center bar height increases with level
    const centerBar = bars[12];
    const heightPct = parseInt(centerBar.style.height, 10);
    expect(heightPct).toBeGreaterThan(50);
    // Fire dictation-stopped event
    act(() => {
      eventHandler?.({
        type: 'dictation-stopped',
        result: { text: 'ok', duration_ms: 100, engine: 'local' },
      });
    });
    await waitFor(() => {
      expect(screen.queryByTestId('dictation-indicator')).toBeNull();
    });
  });

  it('renders overlay variant correctly', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: Date.now(),
    });

    render(<DictationIndicator variant="overlay" pollIntervalMs={100} />);

    await waitFor(() => {
      const indicator = screen.getByTestId('dictation-indicator');
      expect(indicator.getAttribute('data-variant')).toBe('overlay');
    });

    expect(screen.getByTestId('dictation-stop-button')).toBeDefined();
    expect(screen.getByTestId('dictation-cancel-button')).toBeDefined();
  });

  it('returns null for overlay variant when overlayEnabled is false', async () => {
    vi.mocked(speechSettings.loadSpeechConfig).mockReturnValue({
      ...speechSettings.DEFAULT_SPEECH_CONFIG,
      overlayEnabled: false,
    });

    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: Date.now(),
    });

    const { container } = render(<DictationIndicator variant="overlay" pollIntervalMs={100} />);

    expect(container.firstChild).toBeNull();
  });

  it('returns null for pill variant when overlayEnabled is false', async () => {
    vi.mocked(speechSettings.loadSpeechConfig).mockReturnValue({
      ...speechSettings.DEFAULT_SPEECH_CONFIG,
      overlayEnabled: false,
    });

    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: Date.now(),
    });

    const { container } = render(<DictationIndicator variant="pill" pollIntervalMs={100} />);

    expect(container.firstChild).toBeNull();
  });

  it('renders custom number of wave bars when configured', async () => {
    vi.mocked(speechSettings.loadSpeechConfig).mockReturnValue({
      ...speechSettings.DEFAULT_SPEECH_CONFIG,
      overlayEnabled: true,
      dictationWave: true,
      dictationWaveBars: 16,
    });

    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: Date.now(),
    });

    render(<DictationIndicator pollIntervalMs={100} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    const bars = screen.getAllByTestId('dictation-wave-bar');
    expect(bars.length).toBe(16);
  });

  it('respects prefers-reduced-motion without dynamic animation', async () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));

    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.7,
      since: Date.now(),
    });

    render(<DictationIndicator pollIntervalMs={100} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    const bars = screen.getAllByTestId('dictation-wave-bar');
    expect(bars.length).toBe(24);
    expect(bars[12].style.height).toBeDefined();

    window.matchMedia = originalMatchMedia;
  });
  it('after release the indicator stays visible and shows the processing text', async () => {
    const startTime = Date.now() - 3000;
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: startTime,
    });

    render(<DictationIndicator pollIntervalMs={50} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    // Simulate key release: microphone stops recording, so dictationState returns recording: false
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: startTime,
    });

    // Indicator stays visible and enters processing phase
    await waitFor(() => {
      expect(screen.getByTestId('dictation-processing-spinner')).toBeDefined();
    });

    expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    const expectedProcessingText = I18nService.t().dictationIndicatorTranscribing || 'Распознаём…';
    expect(screen.getByText(expectedProcessingText)).toBeDefined();

    // Wave visualizer remains rendered
    expect(screen.getByTestId('dictation-wave')).toBeDefined();

    // Stop button is disabled during processing
    const stopBtn = screen.getByTestId('dictation-stop-button') as HTMLButtonElement;
    expect(stopBtn.disabled).toBe(true);
  });

  it('disappears once the result arrives', async () => {
    const startTime = Date.now() - 2000;
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: startTime,
    });

    render(<DictationIndicator pollIntervalMs={50} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    // Key release -> transitions to processing
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: startTime,
    });

    await waitFor(() => {
      expect(screen.getByTestId('dictation-processing-spinner')).toBeDefined();
    });
    expect(screen.getByTestId('dictation-indicator')).toBeDefined();

    // Backend finishes transcribing and emits dictation-stopped
    act(() => {
      eventHandler?.({
        type: 'dictation-stopped',
        result: { text: 'Transcribed sentence', duration_ms: 2000, engine: 'local' },
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('dictation-indicator')).toBeNull();
    });
  });

  it('also disappears on an error', async () => {
    const startTime = Date.now() - 2000;
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.5,
      since: startTime,
    });

    render(<DictationIndicator pollIntervalMs={50} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    // Key release -> transitions to processing
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: startTime,
    });

    await waitFor(() => {
      expect(screen.getByTestId('dictation-processing-spinner')).toBeDefined();
    });
    expect(screen.getByTestId('dictation-indicator')).toBeDefined();

    // Backend encounters an error and emits speech-error
    act(() => {
      eventHandler?.({
        type: 'speech-error',
        code: 'no_speech',
        message: 'No speech detected',
      });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('dictation-indicator')).toBeNull();
    });
  });

  it('renders wave and follows the level while recording', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: null,
    });

    render(<DictationIndicator pollIntervalMs={500} />);

    // Recording starts
    act(() => {
      eventHandler?.({ type: 'dictation-started', mode: 'insert' });
    });

    expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    expect(screen.getByTestId('dictation-wave')).toBeDefined();

    // Low level
    act(() => {
      eventHandler?.({ type: 'dictation-level', level: 0.05 });
    });
    const barsLow = screen.getAllByTestId('dictation-wave-bar');
    const heightLow = parseInt(barsLow[12].style.height, 10);

    // High level
    act(() => {
      eventHandler?.({ type: 'dictation-level', level: 0.95 });
    });
    const barsHigh = screen.getAllByTestId('dictation-wave-bar');
    const heightHigh = parseInt(barsHigh[12].style.height, 10);

    expect(heightHigh).toBeGreaterThan(heightLow);
  });

  it('shows processing state in overlay variant as well', async () => {
    const startTime = Date.now() - 2000;
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.4,
      since: startTime,
    });

    render(<DictationIndicator variant="overlay" pollIntervalMs={50} />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });

    // Key released -> processing
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: startTime,
    });

    await waitFor(() => {
      expect(screen.getByTestId('dictation-processing-spinner')).toBeDefined();
    });

    expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    const expectedProcessingText = I18nService.t().dictationIndicatorTranscribing || 'Распознаём…';
    expect(screen.getByText(expectedProcessingText)).toBeDefined();
  });
});
