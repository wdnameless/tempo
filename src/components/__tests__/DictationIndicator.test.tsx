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

  it('renders live level, mode, and timer when recording', async () => {
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

    // Volume level bar is rendered with 65% width
    const levelBar = screen.getByTestId('dictation-level-bar');
    expect(levelBar).toBeDefined();
    expect(levelBar.style.width).toBe('65%');

    // Mode and timer are displayed
    expect(screen.getByTestId('dictation-mode').textContent).toBe('insert');
    expect(screen.getByTestId('dictation-timer')).toBeDefined();
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

    const levelBar = screen.getByTestId('dictation-level-bar');
    expect(levelBar.style.width).toBe('80%');

    // Fire dictation-stopped event
    act(() => {
      eventHandler?.({
        type: 'dictation-stopped',
        result: { text: 'ok', duration_ms: 100, engine: 'local' },
      });
    });

    expect(screen.queryByTestId('dictation-indicator')).toBeNull();
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
});
