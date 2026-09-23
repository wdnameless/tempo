import { SyncError } from '../../services/sync';
import type * as SyncServiceModule from '../../services/sync';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsView } from '../SettingsView';
import { I18nService } from '../../services/i18n';
import * as rolloverModule from '../../services/rollover';

const mockLoadGeneralSettings = vi.fn().mockReturnValue({
  timerMode: 'pomodoro',
  focusMinutes: 25,
  shortBreakMinutes: 5,
  longBreakMinutes: 15,
  longBreakEvery: 4,
  endSound: 'chime',
  background: 'default',
  accent: 'amber',
  timezone: 'UTC',
  rolloverHour: 3,
  mediaLimitBytes: 1024 * 1024 * 1024,
  soundProfile: 'neon',
  uiClicks: true,
  countdownTicks: true,
  clickVolume: 0.5,
  dashboardWidgets: true,
  alarmVolume: 0.8,
  alarmEnabled: true,
});

const mockSaveGeneralSettings = vi.fn().mockResolvedValue(undefined);
const mockMigrateLegacyPreferences = vi.fn().mockResolvedValue([]);

vi.mock('../../services/generalSettings', () => ({
  loadGeneralSettings: () => mockLoadGeneralSettings(),
  saveGeneralSettings: (patch: Record<string, unknown>) => mockSaveGeneralSettings(patch),
  migrateLegacyPreferences: () => mockMigrateLegacyPreferences(),
}));

const { mockSpeechConfig, mockLoadSpeechSettings, mockSaveSpeechSettings } = vi.hoisted(() => {
  const cfg = {
    enabled: false,
    activation: 'hold_or_toggle',
    hotkey: 'CommandOrControl+Shift+Space',
    cancelHotkey: 'Escape',
    holdThresholdMs: 300,
    engine: 'local',
    modelId: 'whisper-tiny',
    device: null,
    channel: null,
    vadBackend: 'earshot',
    vadEnergyThreshold: 0.015,
    language: null,
    translateToEnglish: false,
    customWords: [],
    removeFillerWords: false,
    pasteMethod: 'ctrl_v',
    clipboardBehavior: 'restore',
    pasteDelayMs: 60,
    pasteDelayAfterMs: 60,
    appendSpace: false,
    autoSubmit: false,
    feedbackEnabled: false,
    feedbackVolume: 0.5,
    soundTheme: 'default',
    historyEnabled: true,
    historyLimit: 100,
    retentionDays: 30,
    postprocessEnabled: false,
    postprocessPrompt: '',
    overlayEnabled: true,
    onboarded: true,
  };
  return {
    mockSpeechConfig: cfg,
    mockLoadSpeechSettings: vi.fn().mockReturnValue({ ...cfg }),
    mockSaveSpeechSettings: vi.fn().mockResolvedValue(cfg),
  };
});

vi.mock('../../services/speechSettings', () => ({
  loadSpeechConfig: () => mockLoadSpeechSettings(),
  loadSpeechSettings: () => mockLoadSpeechSettings(),
  saveSpeechConfig: (patch: Record<string, unknown>) => mockSaveSpeechSettings(patch),
  saveSpeechSettings: (patch: Record<string, unknown>) => mockSaveSpeechSettings(patch),
  subscribeSpeechConfig: vi.fn().mockReturnValue(() => {}),
  subscribeSpeechSettings: vi.fn().mockReturnValue(() => {}),
  DEFAULT_SPEECH_CONFIG: mockSpeechConfig,
}));

vi.mock('../../services/stt', () => ({
  listModels: vi.fn().mockResolvedValue([
    { id: 'whisper-tiny', name: 'Whisper Tiny', bytes: 75000000, installed: true, wer: 12 },
  ]),
  downloadModel: vi.fn().mockResolvedValue(undefined),
  cancelDownload: vi.fn().mockResolvedValue(undefined),
  downloadProgress: vi.fn().mockResolvedValue([]),
  deleteModel: vi.fn().mockResolvedValue(undefined),
  rescanModels: vi.fn().mockResolvedValue([]),
  importModel: vi.fn().mockResolvedValue({ id: 'custom', name: 'Custom', bytes: 1000, installed: true }),
  modelsDir: vi.fn().mockResolvedValue('C:\\models'),
  openModelsDir: vi.fn().mockResolvedValue(undefined),
  freeDiskSpace: vi.fn().mockResolvedValue(1000000000),
  setEngine: vi.fn().mockResolvedValue(undefined),
  getEngine: vi.fn().mockResolvedValue({ engine: 'local', model_id: 'whisper-tiny', available: true }),
  sttErrorKey: (code: string) => `sttError${code}`,
  inputDevices: vi.fn().mockResolvedValue([
    { name: 'Default Microphone', isDefault: true, channels: 2 },
  ]),
  inputChannels: vi.fn().mockResolvedValue(2),
  outputDevices: vi.fn().mockResolvedValue(['Default Speakers']),
  playTestSound: vi.fn().mockResolvedValue(undefined),
  micLevel: vi.fn().mockResolvedValue(0.42),
  historyList: vi.fn().mockResolvedValue([]),
  historyDelete: vi.fn().mockResolvedValue(undefined),
  historySetSaved: vi.fn().mockResolvedValue(undefined),
  historyRetry: vi.fn().mockResolvedValue({ text: 'test' }),
  historyClear: vi.fn().mockResolvedValue(undefined),
  postprocessText: vi.fn().mockResolvedValue('polished text'),
  validateHotkey: vi.fn().mockResolvedValue(undefined),
  suspendShortcuts: vi.fn().mockResolvedValue(undefined),
  resumeShortcuts: vi.fn().mockResolvedValue(undefined),
  startDictation: vi.fn().mockResolvedValue(undefined),
  stopDictation: vi.fn().mockResolvedValue({ text: '', duration_ms: 0, engine: 'local' }),
  cancelDictation: vi.fn().mockResolvedValue(undefined),
  dictationState: vi.fn().mockResolvedValue({ recording: false, level: 0, since: null }),
  transcribeFile: vi.fn().mockResolvedValue({ text: '' }),
}));

const mockGoogleCalendarStatus = vi.fn().mockResolvedValue({
  connected: false,
  detail: 'Google OAuth configuration is missing.',
});

vi.mock('../../services/integrations', () => ({
  googleCalendarStatus: () => mockGoogleCalendarStatus(),
}));

const mockListShortcuts = vi.fn().mockReturnValue([
  {
    id: 'toggle-sidebar',
    name: 'Toggle Sidebar',
    defaultKey: 'Mod+B',
    currentKey: 'Mod+B',
    description: 'Show or hide sidebar',
    scope: 'global',
    action: () => {},
  },
  {
    id: 'quick-capture',
    name: 'Quick Capture',
    defaultKey: 'Mod+N',
    currentKey: 'Mod+N',
    description: 'Quick task entry',
    scope: 'global',
    action: () => {},
  },
  {
    id: 'start-timer',
    name: 'Start/Pause Timer',
    defaultKey: 'Space',
    currentKey: 'Space',
    description: 'Control current timer',
    scope: 'timer',
    action: () => {},
  },
]);

vi.mock('../../services/shortcuts', () => ({
  listShortcuts: () => mockListShortcuts(),
  formatShortcutKeys: (keys?: string[]) => (Array.isArray(keys) ? keys.join(' + ') : ''),
  updateShortcutKeys: vi.fn(),
  resetShortcutKeys: vi.fn(),
  isCustomShortcut: vi.fn(() => false),
  isMacPlatform: vi.fn(() => false),
}));

// AssetUsage and AssetPruneResult, exactly as interfaces §9 defines them: a mock
// with invented field names tests a screen that does not exist.
const mockAssetUsage = vi.fn().mockResolvedValue({
  total: 6291456, // 6 MB
  by_kind: { audio: 4194304, screen: 2097152 },
});
const mockAssetPrune = vi.fn().mockResolvedValue({ removed: 2, freed: 1048576 });

vi.mock('../../services/assets', () => ({
  assetUsage: () => mockAssetUsage(),
  assetPrune: (limit: number) => mockAssetPrune(limit),
  DEFAULT_MEDIA_LIMIT_BYTES: 1024 * 1024 * 1024,
}));

vi.mock('../../services/rollover', () => ({
  rolloverSettings: () => ({ rolloverHour: 3, timezone: 'UTC' }),
  setRolloverSettings: vi.fn().mockResolvedValue(undefined),
  localTimeZone: () => 'UTC',
}));

vi.mock('../../services/update', () => ({
  currentVersion: vi.fn().mockResolvedValue('0.13.0-custom-build'),
  checkForUpdate: vi.fn().mockResolvedValue({ available: false, version: '0.13.0-custom-build' }),
  detectPortable: vi.fn().mockResolvedValue(true),
  installUpdate: vi.fn().mockResolvedValue(undefined),
}));

const { mockAIGateway } = vi.hoisted(() => ({
  mockAIGateway: {
    hasKey: vi.fn().mockResolvedValue(true),
    setKey: vi.fn().mockResolvedValue(undefined),
    listModels: vi.fn().mockResolvedValue(['gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat']),
  },
}));
vi.mock('../../services/aiGateway', () => ({
  AIGateway: mockAIGateway,
}));

vi.mock('../../services/sound', () => ({
  soundService: {
    playCountdownTick: vi.fn(),
    playAlarm: vi.fn(),
    playBeep: vi.fn(),
  },
}));

vi.mock('../../services/edgeTts', () => ({
  EdgeTtsService: {
    speakText: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn(),
    isPlaying: false,
  },
  CLOUD_VOICES: [{ id: 'ru-RU-SvetlanaNeural', name: 'Svetlana', lang: 'ru-RU' }],
}));
const mockGetSyncStatus = vi.fn().mockResolvedValue({
  device_id: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  transport: 'folder',
  folder: '/shared/tempo-sync',
  last_sync: '2026-09-20T12:00:00Z',
  pending: 3,
  media: false,
});
const mockSetSyncTransport = vi.fn().mockResolvedValue(undefined);
const mockSetSyncMedia = vi.fn().mockResolvedValue(undefined);
const mockSyncNow = vi.fn().mockResolvedValue({
  sent: 2,
  received: 4,
  applied: 4,
  conflicts: 1,
  media_copied: 0,
});
const mockSyncPending = vi.fn().mockResolvedValue(3);

vi.mock('../../services/sync', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncServiceModule>();
  return {
    ...actual,
    getSyncStatus: () => mockGetSyncStatus(),
    setSyncTransport: (kind: 'none' | 'folder', folder?: string | null) => mockSetSyncTransport(kind, folder),
    setSyncMedia: (enabled: boolean) => mockSetSyncMedia(enabled),
    syncNow: () => mockSyncNow(),
    syncPending: () => mockSyncPending(),
  };
});

describe('SettingsView Component', () => {
  const t = I18nService.t();
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders all five sections and each is reachable by its label', async () => {
    render(<SettingsView />);

    const generalTab = screen.getByRole('tab', { name: t.settingsGeneral });
    const integrationsTab = screen.getByRole('tab', { name: t.settingsIntegrationsTab });
    const speechTab = screen.getByRole('tab', { name: t.settingsSpeechToText });
    const shortcutsTab = screen.getByRole('tab', { name: t.settingsShortcutsTab });
    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });

    expect(generalTab).toBeDefined();
    expect(integrationsTab).toBeDefined();
    expect(speechTab).toBeDefined();
    expect(shortcutsTab).toBeDefined();
    expect(aboutTab).toBeDefined();

    // Check General content is shown initially
    expect(screen.getByText(t.settingsTimerFocus)).toBeDefined();

    // Click Integrations tab
    fireEvent.click(integrationsTab);
    await waitFor(() => {
      expect(screen.getByText(t.settingsGoogleCalendar)).toBeDefined();
    });

    // Click Speech to Text tab
    fireEvent.click(speechTab);
    await waitFor(() => {
      expect(screen.getByTestId('speech-panel')).toBeDefined();
      expect(screen.getByText(t.settingsSpeech)).toBeDefined();
    });

    // Click Shortcuts tab. The heading repeats the tab's words on purpose, so it
    // is asserted inside the panel rather than by text alone.
    fireEvent.click(shortcutsTab);
    await waitFor(() => {
      const panel = document.getElementById('section-shortcuts');
      expect(panel?.textContent).toContain(t.settingsShortcuts);
    });

    // Click About & Account tab
    fireEvent.click(aboutTab);
    await waitFor(() => {
      expect(screen.getByText(t.settingsAbout)).toBeDefined();
    });
  });

  it('calls migrateLegacyPreferences on mount', async () => {
    render(<SettingsView />);
    await waitFor(() => {
      expect(mockMigrateLegacyPreferences).toHaveBeenCalled();
    });
  });

  it('changing a toggle or input calls the saver with the new value', async () => {
    render(<SettingsView />);

    // In General section, find timer mode select or countdown ticks toggle
    const selectMode = screen.getByLabelText(t.settingsDefaultMode);
    fireEvent.change(selectMode, { target: { value: 'block' } });

    await waitFor(() => {
      expect(mockSaveGeneralSettings).toHaveBeenCalledWith(
        expect.objectContaining({ timerMode: 'block' })
      );
    });

    // Switch to Speech to Text tab and toggle enable
    const speechTab = screen.getByRole('tab', { name: t.settingsSpeechToText });
    fireEvent.click(speechTab);

    const enableToggle = await screen.findByLabelText(t.settingsSpeechEnable);
    fireEvent.click(enableToggle);

    await waitFor(() => {
      expect(mockSaveSpeechSettings).toHaveBeenCalledWith(
        expect.objectContaining({ enabled: true })
      );
    });
  });

  it('renders the SpeechPanel with all sub-tabs and switches panels correctly', async () => {
    render(<SettingsView />);

    const speechTab = screen.getByRole('tab', { name: t.settingsSpeechToText });
    fireEvent.click(speechTab);

    await waitFor(() => {
      expect(screen.getByTestId('speech-panel')).toBeDefined();
    });

    // Check all 9 sub-tab buttons are present
    const subTabIds = [
      'models',
      'ptt',
      'audio',
      'delivery',
      'feedback',
      'language',
      'history',
      'postprocess',
      'debug',
    ];
    for (const id of subTabIds) {
      expect(screen.getByTestId(`speech-tab-${id}`)).toBeDefined();
    }

    // Switch to Audio tab
    fireEvent.click(screen.getByTestId('speech-tab-audio'));
    await waitFor(() => {
      expect(screen.getByTestId('audio-settings')).toBeDefined();
    });

    // Switch to Feedback tab
    fireEvent.click(screen.getByTestId('speech-tab-feedback'));
    await waitFor(() => {
      expect(screen.getByTestId('feedback-settings')).toBeDefined();
    });
  });

  it('Shortcuts section renders one row per listShortcuts() entry', async () => {
    render(<SettingsView />);

    const shortcutsTab = screen.getByRole('tab', { name: t.settingsShortcutsTab });
    fireEvent.click(shortcutsTab);

    // We mocked 3 shortcuts: toggle-sidebar, quick-capture, start-timer
    expect(screen.getByTestId('shortcut-row-toggle-sidebar')).toBeDefined();
    expect(screen.getByTestId('shortcut-row-quick-capture')).toBeDefined();
    expect(screen.getByTestId('shortcut-row-start-timer')).toBeDefined();

    const rows = screen.getAllByTestId(/^shortcut-row-/);
    expect(rows).toHaveLength(3);
  });

  it('Integrations section renders the not-connected state and contains no button offering to connect', async () => {
    render(<SettingsView />);

    const integrationsTab = screen.getByRole('tab', { name: t.settingsIntegrationsTab });
    fireEvent.click(integrationsTab);
    await waitFor(() => {
      expect(screen.getByText(t.settingsNotConnected)).toBeDefined();
      expect(screen.getByText(t.settingsGoogleMissing)).toBeDefined();
    });
    // MUST NOT render a Connect button that cannot connect
    expect(screen.queryByRole('button', { name: /^Connect$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Connect Google/i })).toBeNull();
  });

  it('About section shows the version it was given rather than a literal', async () => {
    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    const versionElem = await screen.findByTestId('app-version');
    expect(versionElem.textContent).toContain('0.13.0-custom-build');
  });

  it('the media row shows the usage it was given', async () => {
    render(<SettingsView />);

    // 6291456 bytes is 6.0 MB
    await waitFor(() => {
      expect(screen.getByText(/Media Used: 6.0 MB/i)).toBeDefined();
    });
  });

  it('the sync block renders the device id and pending count', async () => {
    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    await waitFor(() => {
      expect(screen.getByText(/Device: a1b2c3d4/i)).toBeDefined();
      expect(screen.getByText(/3 changes pending/i)).toBeDefined();
    });
  });

  it('choosing a folder calls the setter', async () => {
    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    await waitFor(() => {
      expect(screen.getByPlaceholderText(t.syncFolderPlaceholder)).toBeDefined();
    });

    const input = screen.getByPlaceholderText(t.syncFolderPlaceholder);
    fireEvent.change(input, { target: { value: '/custom/sync/path' } });

    const saveBtn = screen.getByRole('button', { name: /Save Path/i });
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockSetSyncTransport).toHaveBeenCalledWith('folder', '/custom/sync/path');
    });
  });

  it('"sync now" renders the outcome numbers and conflict resolution explanation', async () => {
    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    const syncBtn = await screen.findByRole('button', { name: /Sync Now/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(mockSyncNow).toHaveBeenCalled();
      expect(screen.getByText(/Sent: 2/i)).toBeDefined();
      expect(screen.getByText(/Received: 4/i)).toBeDefined();
      expect(screen.getByText(/Applied: 4/i)).toBeDefined();
      expect(screen.getByText(/Media copied: 0/i)).toBeDefined();
      expect(screen.getByText(/1 change was resolved in favour of the later edit/i)).toBeDefined();
    });
  });

  it('a folder error shows its own message', async () => {
    mockSyncNow.mockRejectedValueOnce(
      new SyncError('FolderMissing', 'Sync folder does not exist or has been moved: /shared/tempo-sync')
    );

    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    const syncBtn = await screen.findByRole('button', { name: /Sync Now/i });
    fireEvent.click(syncBtn);

    await waitFor(() => {
      expect(screen.getByText(/Sync folder does not exist or has been moved/i)).toBeDefined();
    });
  });

  it('the Drive row offers no connect button', async () => {
    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    await waitFor(() => {
      expect(screen.getByText('Google Drive')).toBeDefined();
      expect(screen.getByText('Unavailable')).toBeDefined();
    });

    // Verify honest explanation is present
    expect(screen.getByText(t.syncDriveBlocked)).toBeDefined();
    // Must have NO Connect button for Drive
    expect(screen.queryByRole('button', { name: /Connect Google Drive/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /Connect Drive/i })).toBeNull();
  });

  it('the media toggle warns before enabling', async () => {
    render(<SettingsView />);

    const aboutTab = screen.getByRole('tab', { name: t.settingsAboutTab });
    fireEvent.click(aboutTab);

    await waitFor(() => {
      expect(screen.getByText(t.syncMediaFiles)).toBeDefined();
    });

    const checkboxes = screen.getAllByRole('checkbox');
    const mediaCheckbox = checkboxes[checkboxes.length - 1] as HTMLInputElement;
    expect(mediaCheckbox.checked).toBe(false);
    // Toggling ON should show confirmation warning banner first
    fireEvent.click(mediaCheckbox);

    await waitFor(() => {
      expect(screen.getByText(t.syncConfirmMedia)).toBeDefined();
      expect(screen.getAllByText(/Files leave this device/i).length).toBeGreaterThanOrEqual(1);
    });

    // Confirming enables it
    const confirmBtn = screen.getByRole('button', { name: t.syncEnableMedia });
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(mockSetSyncMedia).toHaveBeenCalledWith(true);
    });
  });

  it('toggles task rollover enabled status', async () => {
    render(<SettingsView />);

    const toggle = screen.getByTestId('toggle-rollover-enabled');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(rolloverModule.setRolloverSettings).toHaveBeenCalledWith({ enabled: true });
    });
  });

  it('the timezone, data-storage and accent controls are gone from Settings', () => {
    render(<SettingsView />);

    expect(screen.queryByTestId('accent-picker')).toBeNull();
    expect(screen.queryByTestId('slider-alarm-volume')).toBeNull();
    expect(screen.queryByTestId('toggle-alarm-enabled')).toBeNull();
    expect(screen.queryByLabelText(t.settingsTimeZone)).toBeNull();
  });

  it('the AI tab fetches and lists models and updates selection', async () => {
    const onUpdateAISettings = vi.fn();
    mockAIGateway.listModels.mockResolvedValue([
      'gpt-4o',
      'claude-3-5-sonnet',
      'deepseek-chat',
    ]);

    render(
      <SettingsView
        aiSettings={{
          apiKey: '',
          baseUrl: 'https://api.openai.com/v1',
          model: 'gpt-4o',
        }}
        onUpdateAISettings={onUpdateAISettings}
      />
    );

    // Switch to AI tab
    const aiTabBtn = screen.getByRole('tab', { name: t.settingsAiTab });
    fireEvent.click(aiTabBtn);

    // Fetch models action
    const fetchBtn = screen.getByTestId('fetch-models-button');
    fireEvent.click(fetchBtn);

    await waitFor(() => {
      expect(mockAIGateway.listModels).toHaveBeenCalledWith('https://api.openai.com/v1');
      expect(screen.getByTestId('ai-model-select')).toBeDefined();
    });

    // Select model from dropdown
    const select = screen.getByTestId('ai-model-select');
    fireEvent.change(select, { target: { value: 'claude-3-5-sonnet' } });

    expect(onUpdateAISettings).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'claude-3-5-sonnet',
      })
    );
  });
});
