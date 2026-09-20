import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DictationIndicator } from '../DictationIndicator';
import * as stt from '../../services/stt';
import { I18nService } from '../../services/i18n';

vi.mock('../../services/stt', () => ({
  dictationState: vi.fn(),
  stopDictation: vi.fn(),
}));

describe('DictationIndicator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when not recording (idle)', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: false,
      level: 0,
      since: null,
    });

    const { container } = render(<DictationIndicator pollIntervalMs={100} />);

    // Wait for poll
    await waitFor(() => {
      expect(stt.dictationState).toHaveBeenCalled();
    });

    expect(container.firstChild).toBeNull();
  });

  it('renders live level and mode when recording', async () => {
    vi.mocked(stt.dictationState).mockResolvedValue({
      recording: true,
      level: 0.65,
      since: Date.now() - 3000,
    });

    render(<DictationIndicator pollIntervalMs={100} defaultMode="insert" />);

    await waitFor(() => {
      expect(screen.getByTestId('dictation-indicator')).toBeDefined();
    });
    // Shows dictation shortcut title from i18n
    expect(screen.getAllByText(I18nService.t().settingsSpeechHotkey).length).toBeGreaterThan(0);
    // Volume level is rendered in the DOM
    const levelBar = screen.getByTestId('dictation-level-bar');
    expect(levelBar).toBeDefined();
    expect(levelBar.style.width).toBe('65%');

    // Mode is displayed
    expect(screen.getByText('insert')).toBeDefined();
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

    render(<DictationIndicator pollIntervalMs={100} />);

    await waitFor(() => {
      expect(screen.getByRole('button')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button'));

    expect(stt.stopDictation).toHaveBeenCalledTimes(1);
  });
});
