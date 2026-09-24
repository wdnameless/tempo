import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import App from '../../App';
import { SettingsView } from '../SettingsView';
import { SpeechPanel } from '../speech/SpeechPanel';
import { StoreService } from '../../services/store';
import { I18nService } from '../../services/i18n';
import { DEFAULT_SPEECH_CONFIG, type SpeechConfig } from '../../services/speechSettings';
import type * as SttService from '../../services/stt';

vi.mock('../../services/sound', () => ({
  soundService: {
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    playBeep: vi.fn(),
  },
}));
vi.mock('../../services/shortcuts', () => ({
  installShortcutLayer: vi.fn(() => () => {}),
  registerShortcut: vi.fn(),
  listShortcuts: vi.fn(() => []),
  formatKeyToken: vi.fn((k: string) => k),
}));

vi.mock('../../services/update', () => ({
  currentVersion: vi.fn(() => Promise.resolve('0.18.2')),
  detectPortable: vi.fn(() => Promise.resolve(false)),
  checkForUpdate: vi.fn(() => Promise.resolve(null)),
  installUpdate: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) =>
    Promise.resolve(
      cmd === 'asset_usage'
        ? { total: 0, by_kind: {} }
        : cmd === 'stt_list_models'
        ? []
        : undefined,
    ),
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setSize: vi.fn(),
  }),
}));

vi.mock('../../services/stt', async (importOriginal) => {
  const actual = await importOriginal<typeof SttService>();
  return {
    ...actual,
    listModels: vi.fn().mockResolvedValue([]),
    downloadModel: vi.fn(),
    cancelDownload: vi.fn(),
    downloadProgress: vi.fn().mockResolvedValue([]),
    modelsDir: vi.fn().mockResolvedValue('/path/to/models'),
    openModelsDir: vi.fn(),
    inputDevices: vi.fn().mockResolvedValue([{ name: 'Default Mic', isDefault: true, channels: 2 }]),
    inputChannels: vi.fn().mockResolvedValue(2),
    micLevel: vi.fn().mockResolvedValue(0),
    // The indicator polls this every 100 ms; a mock that returns undefined makes
    // the component crash rather than render, which is what the first version did.
    dictationState: vi.fn().mockResolvedValue({ recording: false, level: 0, since: null }),
    freeDiskSpace: vi.fn().mockResolvedValue(1000000000),
    deleteModel: vi.fn(),
    loadModel: vi.fn(),
    importCustomModel: vi.fn(),
    setEngine: vi.fn().mockResolvedValue(undefined),
    rescanModels: vi.fn().mockResolvedValue([]),
    historyList: vi.fn().mockResolvedValue([]),
    historyDelete: vi.fn(),
    historySetSaved: vi.fn(),
    historyRetry: vi.fn(),
    historyClear: vi.fn(),
    postprocessText: vi.fn(),
    transcribeAudioFile: vi.fn(),
    validateHotkey: vi.fn().mockResolvedValue({ valid: true }),
    suspendShortcuts: vi.fn(),
    resumeShortcuts: vi.fn(),
  };
});

vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(() => () => {}),
}));

describe('STT Sidebar & Sub-sections Navigation', () => {
  beforeEach(() => {
    cleanup();
    StoreService.resetCache();
    StoreService.setPreference('tempo_speech_onboarded', true);
    I18nService.setLang('ru');
  });

  it('sidebar offers STT next to the other sections', () => {
    render(<App />);
    const t = I18nService.t();
    const sttButton = screen.getByRole('button', { name: t.navStt });
    expect(sttButton).toBeDefined();
  });
  it('opening STT from sidebar shows SpeechPanel with all sub-sections', async () => {
    const errSpy = vi.spyOn(console, 'error');
    render(<App />);
    const t = I18nService.t();
    const sttButton = screen.getByRole('button', { name: t.navStt });
    fireEvent.click(sttButton);

    if (errSpy.mock.calls.length > 0) {
      expect(errSpy.mock.calls[0][1]).toBeUndefined();
    }

    await waitFor(() => {
      expect(screen.getByTestId('speech-panel')).toBeDefined();
    });

    // Verify all requested sub-sections are present:
    // Модели, Клавиши, Анимация, Звук, Текст, История (+ Расширенные)
    expect(screen.getByTestId('speech-tab-models')).toBeDefined();
    expect(screen.getByTestId('speech-tab-keys')).toBeDefined();
    expect(screen.getByTestId('speech-tab-animation')).toBeDefined();
    expect(screen.getByTestId('speech-tab-sound')).toBeDefined();
    expect(screen.getByTestId('speech-tab-text')).toBeDefined();
    expect(screen.getByTestId('speech-tab-history')).toBeDefined();
    expect(screen.getByTestId('speech-tab-advanced')).toBeDefined();
  });

  it('navigating between SpeechPanel sub-sections displays appropriate panels', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      onboarded: true,
      dictationWave: true,
      dictationWaveBars: 24,
    };
    const onChange = vi.fn();
    render(<SpeechPanel config={config} onChange={onChange} />);

    // Default is models
    expect(screen.getByTestId('speech-panel-models')).toBeDefined();

    // Switch to Keys
    fireEvent.click(screen.getByTestId('speech-tab-keys'));
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-keys')).toBeDefined();
      expect(screen.getByTestId('speech-panel-ptt')).toBeDefined();
    });

    // Switch to Animation
    fireEvent.click(screen.getByTestId('speech-tab-animation'));
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-animation')).toBeDefined();
      expect(screen.getByText('Волна вместо полоски')).toBeDefined();
      expect(screen.getByText('Количество столбиков волны')).toBeDefined();
    });

    // Switch to Sound
    fireEvent.click(screen.getByTestId('speech-tab-sound'));
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-sound')).toBeDefined();
      expect(screen.getByTestId('speech-panel-feedback')).toBeDefined();
      expect(screen.getByTestId('speech-panel-audio')).toBeDefined();
    });

    // Switch to Text
    fireEvent.click(screen.getByTestId('speech-tab-text'));
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-text')).toBeDefined();
      expect(screen.getByTestId('speech-panel-delivery')).toBeDefined();
      expect(screen.getByTestId('speech-panel-language')).toBeDefined();
    });

    // Switch to History
    fireEvent.click(screen.getByTestId('speech-tab-history'));
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-history')).toBeDefined();
    });
  });

  it('allows configuring dictation wave and wave bars in Animation sub-section', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      onboarded: true,
      dictationWave: true,
      dictationWaveBars: 24,
    };
    const onChange = vi.fn();
    render(<SpeechPanel config={config} onChange={onChange} />);

    fireEvent.click(screen.getByTestId('speech-tab-animation'));
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-animation')).toBeDefined();
    });

    // Toggle wave off
    const waveToggle = screen.getByTestId('speech-panel-animation').querySelectorAll('button')[0];
    fireEvent.click(waveToggle);
    expect(onChange).toHaveBeenCalledWith({ dictationWave: false });
  });

  it('Settings screen no longer renders moved controls and has a pointer that navigates to STT', async () => {
    const onNavigate = vi.fn();
    const onOpenStt = vi.fn();
    render(<SettingsView onNavigate={onNavigate} onOpenStt={onOpenStt} />);

    const t = I18nService.t();
    const speechTab = screen.getByRole('tab', { name: t.settingsSpeechToText });
    fireEvent.click(speechTab);

    // Verify moved controls are NOT rendered
    expect(screen.queryByTestId('speech-panel')).toBeNull();
    expect(screen.queryByTestId('speech-panel-models')).toBeNull();
    expect(screen.queryByTestId('model-library')).toBeNull();

    // Verify pointer line is rendered
    const pointer = screen.getByTestId('settings-speech-pointer');
    expect(pointer).toBeDefined();
    expect(pointer.textContent).toContain(t.settingsSpeechMovedTitle);

    // Click pointer button to navigate to STT
    const gotoBtn = screen.getByTestId('settings-goto-stt-btn');
    fireEvent.click(gotoBtn);
    expect(onOpenStt).toHaveBeenCalledTimes(1);
  });
});
