import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SettingsView } from '../SettingsView';
import { I18nService } from '../../services/i18n';

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

const mockLoadSpeechSettings = vi.fn().mockReturnValue({
  enabled: false,
  hotkey: 'CommandOrControl+Shift+Space',
  modelId: 'whisper-tiny',
});
const mockSaveSpeechSettings = vi.fn().mockResolvedValue(undefined);

vi.mock('../../services/speechSettings', () => ({
  loadSpeechSettings: () => mockLoadSpeechSettings(),
  saveSpeechSettings: (patch: Record<string, unknown>) => mockSaveSpeechSettings(patch),
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

vi.mock('../../services/aiGateway', () => ({
  AIGateway: {
    hasKey: vi.fn().mockResolvedValue(true),
    setKey: vi.fn().mockResolvedValue(undefined),
  },
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
      expect(screen.getByText(t.settingsSpeech)).toBeDefined();
      expect(screen.getByText(t.settingsWhisperHint)).toBeDefined();
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
});
