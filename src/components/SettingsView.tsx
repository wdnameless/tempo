import React, { useState, useEffect, useTransition } from 'react';
import {
  Sparkles,
  Check,
  Play,
  RefreshCw,
  Loader2,
  Sliders,
  HardDrive,
  Calendar,
  Mic,
  Keyboard,
  Info,
  ShieldAlert,
} from 'lucide-react';
import { ThemeColors, AISettings, DynamicUIConfig } from '../types';

/** The assistant's settings with the defaults filled in. */
const DEFAULT_AI_SETTINGS: AISettings = {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-2.0-flash-001',
};
import { type BlockSettings } from '../types/focus';
import { ACCENTS, DEFAULT_ACCENT, applyAccent, type AccentId } from '../constants/design';
import { EdgeTtsService } from '../services/edgeTts';
import { I18nService, type Translations } from '../services/i18n';
import { getPref } from '../services/settings';
import { AIGateway } from '../services/aiGateway';
import { checkForUpdate, currentVersion, detectPortable, installUpdate, type UpdateInfo } from '../services/update';
import {
  loadGeneralSettings,
  saveGeneralSettings,
  migrateLegacyPreferences,
  type GeneralSettings,
} from '../services/generalSettings';
import {
  loadSpeechSettings,
  saveSpeechSettings,
  type SpeechSettings,
} from '../services/speechSettings';
import { googleCalendarStatus, type IntegrationStatus } from '../services/integrations';
import { listShortcuts, type ShortcutDef } from '../services/shortcuts';
import { assetUsage, assetPrune, DEFAULT_MEDIA_LIMIT_BYTES, type AssetUsage } from '../services/assets';
// Settings services

export interface SettingsViewProps {
  theme?: ThemeColors;
  accentKey?: AccentId;
  onSelectAccent?: (accent: AccentId) => void;
  aiSettings?: AISettings;
  onUpdateAISettings?: (settings: AISettings) => void;
  onUpdateUI?: (ui: DynamicUIConfig) => void;
  blockSettings?: BlockSettings;
  onBlockSettingsChange?: (next: BlockSettings) => void;
  alarmVolume?: number;
  alarmEnabled?: boolean;
  onAlarmAudioChange?: (vol: number, en: boolean) => void;
  [key: string]: unknown;
}

export type SettingsSection = 'general' | 'integrations' | 'speech' | 'shortcuts' | 'about';


/**
 * The five sections of R20. The labels are resolved at render time: this array
 * lives outside the component, where there is no translation in scope.
 */
const SECTION_DEFS: Array<{ id: SettingsSection; labelKey: keyof Translations; icon: React.ReactNode }> = [
  { id: 'general', labelKey: 'settingsGeneral', icon: <Sliders className="w-4 h-4" /> },
  { id: 'integrations', labelKey: 'settingsIntegrationsTab', icon: <Calendar className="w-4 h-4" /> },
  { id: 'speech', labelKey: 'settingsSpeechToText', icon: <Mic className="w-4 h-4" /> },
  { id: 'shortcuts', labelKey: 'settingsShortcutsTab', icon: <Keyboard className="w-4 h-4" /> },
  { id: 'about', labelKey: 'settingsAboutTab', icon: <Info className="w-4 h-4" /> },
];

export const SettingsView: React.FC<SettingsViewProps> = ({
  accentKey = DEFAULT_ACCENT,
  onSelectAccent,
  aiSettings,
  onUpdateAISettings,
}) => {
  const t = I18nService.t();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [, startTransition] = useTransition();

  // General Settings state (loaded synchronously from cache)
  const [general, setGeneral] = useState<GeneralSettings>(() => loadGeneralSettings());
  // Speech Settings state
  const [speech, setSpeech] = useState<SpeechSettings>(() => loadSpeechSettings());
  // Integration status state
  const [calendarStatus, setCalendarStatus] = useState<IntegrationStatus>({
    connected: false,
    detailKey: 'Checking status...',
  });

  // Save feedback state
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [saveErrorMessage, setSaveErrorMessage] = useState<string | null>(null);

  // Asset usage & pruning
  const [mediaStats, setMediaStats] = useState<AssetUsage | null>(null);
  const [isPruning, setIsPruning] = useState<boolean>(false);

  // Assistant key status
  const [keyStored, setKeyStored] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [isKeySaving, setIsKeySaving] = useState<boolean>(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState<boolean>(false);
  /** Spreading a partial prop would drop the fields the caller did not mention. */
  const ai = aiSettings ?? DEFAULT_AI_SETTINGS;

  // About & Version
  const [appVersion, setAppVersion] = useState<string>('0.13.0');
  const [isPortable, setIsPortable] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);

  // Migration & initial loads
  useEffect(() => {
    // Run 0.3 -> 0.13 preferences migration once on mount
    void migrateLegacyPreferences();

    // Key existence check
    void AIGateway.hasKey().then((has) => {
      setKeyStored(has);
    });

    // Version & portable detection
    void currentVersion().then((v) => {
      if (v) setAppVersion(v);
    });
    void detectPortable().then((portable) => {
      setIsPortable(portable);
    });

    // Calendar integration status
    void googleCalendarStatus().then((status) => {
      setCalendarStatus(status);
    });

    // Asset media usage
    void assetUsage()
      .then((usage) => setMediaStats(usage))
      .catch(() => setMediaStats(null));
  }, []);

  const notifySaved = () => {
    setSaveStatus('saved');
    setSaveErrorMessage(null);
    const timer = setTimeout(() => setSaveStatus('idle'), 2200);
    return () => clearTimeout(timer);
  };

  const handleSaveGeneral = async (patch: Partial<GeneralSettings>) => {
    const next = { ...general, ...patch };
    setGeneral(next);
    try {
      await saveGeneralSettings(patch);
      notifySaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleSaveSpeech = async (patch: Partial<SpeechSettings>) => {
    const next = { ...speech, ...patch };
    setSpeech(next);
    try {
      await saveSpeechSettings(patch);
      notifySaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Failed to save speech settings');
    }
  };

  const handlePruneMedia = async () => {
    setIsPruning(true);
    try {
      await assetPrune(general.mediaLimitBytes || DEFAULT_MEDIA_LIMIT_BYTES);
      const updated = await assetUsage();
      setMediaStats(updated);
      notifySaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Pruning failed');
    } finally {
      setIsPruning(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKeyInput.trim()) return;
    setIsKeySaving(true);
    try {
      await AIGateway.setKey(apiKeyInput.trim());
      setKeyStored(true);
      setApiKeyInput('');
      notifySaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Failed to store API key');
    } finally {
      setIsKeySaving(false);
    }
  };

  const handleClearApiKey = async () => {
    setIsKeySaving(true);
    try {
      await AIGateway.setKey('');
      setKeyStored(false);
      notifySaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Failed to clear API key');
    } finally {
      setIsKeySaving(false);
    }
  };

  const handleVoiceTest = async () => {
    setIsPlayingVoice(true);
    try {
      const voice = getPref<string>('alarmer_voice_id', 'en-US-JennyNeural');
      await EdgeTtsService.speak('Tempo voice test', voice);
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Voice test failed');
    } finally {
      setIsPlayingVoice(false);
    }
  };

  const handleCheckUpdate = async () => {
    setIsCheckingUpdate(true);
    try {
      const result = await checkForUpdate();
      if (result.status === 'update') {
        setUpdateInfo(result.info);
      }
    } catch {
      // Ignored: update check error is handled gracefully
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!updateInfo) return;
    setIsInstallingUpdate(true);
    try {
      await installUpdate(updateInfo);
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Failed to install update');
      setIsInstallingUpdate(false);
    }
  };

  const handleSelectAccent = (accent: AccentId) => {
    applyAccent(accent);
    onSelectAccent?.(accent);
    void handleSaveGeneral({ accent });
  };

  // Format bytes for media display
  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i] || 'GB'}`;
  };

  return (
    <div
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Header bar */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t.settingsTitle}</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t.settingsSubtitle}
          </p>
        </div>

        {/* Save indicator */}
        <div className="flex items-center gap-3">
          {saveStatus === 'saved' && (
            <span
              role="status"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md"
              style={{
                backgroundColor: 'rgba(34, 197, 94, 0.15)',
                color: '#22c55e',
              }}
            >
              <Check className="w-3.5 h-3.5" />
              {t.settingsSaved}
            </span>
          )}
          {saveStatus === 'error' && (
            <span
              role="alert"
              className="inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-md"
              style={{
                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                color: '#ef4444',
              }}
            >
              <ShieldAlert className="w-3.5 h-3.5" />
              {saveErrorMessage || 'Save failed'}
            </span>
          )}
        </div>
      </div>

      {/* Navigation tabs */}
      <div
        className="flex border-b px-6 gap-1 shrink-0 overflow-x-auto"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        role="tablist"
      >
        {SECTION_DEFS.map((sec) => {
          const isActive = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              role="tab"
              aria-selected={isActive}
              aria-controls={`section-${sec.id}`}
              onClick={() => startTransition(() => setActiveSection(sec.id))}
              className="flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors -mb-px whitespace-nowrap"
              style={{
                borderColor: isActive ? 'var(--accent)' : 'transparent',
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {sec.icon}
              <span>{t[sec.labelKey]}</span>
            </button>
          );
        })}
      </div>

      {/* Main content scroll container */}
      <div className="flex-1 overflow-y-auto p-6 max-w-4xl w-full mx-auto space-y-6">
        {/* ========================================================================= */}
        {/* 1. GENERAL SECTION                                                        */}
        {/* ========================================================================= */}
        {activeSection === 'general' && (
          <section id="section-general" role="tabpanel" aria-label={t.settingsGeneral} className="space-y-6">
            {/* Timer & Pomodoro Configuration */}
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
                {t.settingsTimerFocus}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsDefaultMode}
                  </label>
                  <select
                    aria-label={t.settingsDefaultMode}
                    value={general.timerMode}
                    onChange={(e) =>
                      handleSaveGeneral({
                        timerMode: e.target.value as GeneralSettings['timerMode'],
                      })
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm focus:outline-none"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="pomodoro">{t.settingsModePomodoro}</option>
                    <option value="block">{t.settingsBlockPreset}</option>
                    <option value="stopwatch">{t.settingsModeStopwatch}</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsEndSound}
                  </label>
                  <select
                    aria-label={t.settingsEndSound}
                    value={general.endSound}
                    onChange={(e) => handleSaveGeneral({ endSound: e.target.value })}
                    className="w-full px-3 py-2 rounded-md border text-sm focus:outline-none"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <option value="chime">{t.settingsSoundChime}</option>
                    <option value="bell">{t.settingsSoundBell}</option>
                    <option value="alarm">{t.settingsSoundAlarm}</option>
                    <option value="digital">{t.settingsSoundDigital}</option>
                  </select>
                </div>
              </div>

              {/* Focus and Break Durations */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsFocusMinutes}
                  </label>
                  <input
                    aria-label={t.settingsFocusDurationAria}
                    type="number"
                    min="1"
                    max="180"
                    value={general.focusMinutes}
                    onChange={(e) =>
                      handleSaveGeneral({ focusMinutes: parseInt(e.target.value, 10) || 25 })
                    }
                    className="w-full px-3 py-1.5 rounded-md border text-sm"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsShortBreak}
                  </label>
                  <input
                    aria-label={t.settingsShortBreakAria}
                    type="number"
                    min="1"
                    max="60"
                    value={general.shortBreakMinutes}
                    onChange={(e) =>
                      handleSaveGeneral({ shortBreakMinutes: parseInt(e.target.value, 10) || 5 })
                    }
                    className="w-full px-3 py-1.5 rounded-md border text-sm"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsLongBreak}
                  </label>
                  <input
                    aria-label={t.settingsLongBreakAria}
                    type="number"
                    min="1"
                    max="90"
                    value={general.longBreakMinutes}
                    onChange={(e) =>
                      handleSaveGeneral({ longBreakMinutes: parseInt(e.target.value, 10) || 15 })
                    }
                    className="w-full px-3 py-1.5 rounded-md border text-sm"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsLongBreakEvery}
                  </label>
                  <input
                    aria-label={t.settingsLongBreakEveryAria}
                    type="number"
                    min="1"
                    max="12"
                    value={general.longBreakEvery}
                    onChange={(e) =>
                      handleSaveGeneral({ longBreakEvery: parseInt(e.target.value, 10) || 4 })
                    }
                    className="w-full px-3 py-1.5 rounded-md border text-sm"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Appearance & Accent Selection */}
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
                {t.settingsAppearance}
              </h2>

              <div>
                <label className="block text-xs font-medium mb-2" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsAccent}
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {(Object.entries(ACCENTS) as [AccentId, string][]).map(([id, color]) => {
                    const isSelected = accentKey === id || general.accent === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        aria-pressed={isSelected}
                        onClick={() => handleSelectAccent(id)}
                        className="flex items-center gap-2 px-3 py-2 rounded-md border text-sm transition-all"
                        style={{
                          backgroundColor: isSelected ? 'var(--elevated)' : 'transparent',
                          borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                        }}
                      >
                        <span
                          className="w-3.5 h-3.5 rounded-full shrink-0 border"
                          style={{
                            backgroundColor: color,
                            borderColor: 'rgba(255, 255, 255, 0.2)',
                          }}
                        />
                        <span className="truncate capitalize">{id}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic background toggle */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  <div className="text-sm font-medium">{t.settingsDynamicBackground}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsDynamicBackgroundHint}
                  </div>
                </div>
                <input
                  aria-label={t.settingsDynamicBackground}
                  type="checkbox"
                  checked={general.background !== 'static'}
                  onChange={(e) =>
                    handleSaveGeneral({ background: e.target.checked ? 'default' : 'static' })
                  }
                  className="w-4 h-4 rounded cursor-pointer"
                />
              </div>
            </div>

            {/* Rollover & Timezone (R40) */}
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
                {t.settingsRollover}
              </h2>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsRolloverHour}
                  </label>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    The hour at which today's tasks roll over to yesterday
                  </p>
                  <select
                    aria-label={t.settingsRolloverHour}
                    value={general.rolloverHour}
                    onChange={(e) =>
                      handleSaveGeneral({ rolloverHour: parseInt(e.target.value, 10) })
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    {Array.from({ length: 24 }).map((_, h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00 {h < 12 ? 'AM' : 'PM'}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsTimeZone}
                  </label>
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsRolloverHint}
                  </p>
                  <input
                    aria-label={t.settingsTimeZone}
                    type="text"
                    value={general.timezone}
                    onChange={(e) => handleSaveGeneral({ timezone: e.target.value })}
                    className="w-full px-3 py-2 rounded-md border text-sm"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Media Usage & Pruning (R43) */}
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsMedia}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsMediaHint}
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handlePruneMedia}
                  disabled={isPruning}
                  className="px-3 py-1.5 rounded-md border text-xs font-medium transition-colors inline-flex items-center gap-1.5"
                  style={{
                    backgroundColor: 'var(--elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {isPruning ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <HardDrive className="w-3.5 h-3.5" />}
                  Prune Media
                </button>
              </div>

              <div
                className="p-3 rounded-md border text-sm flex items-center justify-between"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div>
                  <div className="font-medium">
                    Media Used: {mediaStats ? formatBytes(mediaStats.total) : '0 B'}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Limit: {formatBytes(general.mediaLimitBytes || DEFAULT_MEDIA_LIMIT_BYTES)}
                  </div>
                </div>
                {mediaStats && (
                  <div className="text-xs text-right" style={{ color: 'var(--text-muted)' }}>
                    {Object.keys(mediaStats.by_kind ?? {}).length} categories tracked
                  </div>
                )}
              </div>
            </div>

            {/* AI Assistant Configuration Block */}
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsAssistant}
                </h2>
              </div>

              {/* API Key management */}
              <div className="space-y-2">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsApiKey}
                </label>
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <input
                      aria-label={t.settingsApiKeyAria}
                      type="password"
                      placeholder={keyStored ? '•••••••••••••••• (Stored securely)' : 'Enter API Key...'}
                      value={apiKeyInput}
                      onChange={(e) => setApiKeyInput(e.target.value)}
                      className="w-full px-3 py-2 rounded-md border text-sm font-mono"
                      style={{
                        backgroundColor: 'var(--elevated)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    onClick={handleSaveApiKey}
                    disabled={isKeySaving || !apiKeyInput.trim()}
                    className="px-4 py-2 rounded-md text-xs font-medium transition-colors"
                    style={{
                      backgroundColor: 'var(--accent)',
                      color: 'var(--bg)',
                      opacity: isKeySaving || !apiKeyInput.trim() ? 0.6 : 1,
                    }}
                  >
                    {isKeySaving ? t.settingsSaving : t.settingsSaveKey}
                  </button>

                  {keyStored && (
                    <button
                      type="button"
                      onClick={handleClearApiKey}
                      disabled={isKeySaving}
                      className="px-3 py-2 rounded-md border text-xs font-medium"
                      style={{
                        backgroundColor: 'transparent',
                        borderColor: 'var(--border)',
                        color: '#ef4444',
                      }}
                    >
                      {t.settingsRemove}
                    </button>
                  )}
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {keyStored
                    ? t.settingsKeyHidden
                    : t.settingsKeyStored}
                </p>
              </div>

              {/* Base URL and Model */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsBaseUrl}
                  </label>
                  <input
                    aria-label={t.settingsBaseUrlAria}
                    type="text"
                    value={ai.baseUrl}
                    onChange={(e) =>
                      onUpdateAISettings?.({
                        ...ai,
                        baseUrl: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm font-mono"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsModel}
                  </label>
                  <input
                    aria-label={t.settingsModelAria}
                    type="text"
                    value={ai.model}
                    onChange={(e) =>
                      onUpdateAISettings?.({
                        ...ai,
                        model: e.target.value,
                      })
                    }
                    className="w-full px-3 py-2 rounded-md border text-sm font-mono"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  />
                </div>
              </div>

              {/* Voice Test Preview */}
              <div className="pt-2 flex items-center justify-between border-t" style={{ borderColor: 'var(--border)' }}>
                <div>
                  <div className="text-sm font-medium">{t.settingsVoice}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsVoiceHint}
                  </div>
                </div>

                <button
                  type="button"
                  aria-label={t.settingsTestVoice}
                  onClick={handleVoiceTest}
                  disabled={isPlayingVoice}
                  className="px-3 py-1.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors"
                  style={{
                    backgroundColor: 'var(--elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  {isPlayingVoice ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
                  Test Voice
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 2. INTEGRATIONS SECTION (R21)                                             */}
        {/* ========================================================================= */}
        {activeSection === 'integrations' && (
          <section id="section-integrations" role="tabpanel" aria-label={t.settingsIntegrationsTab} className="space-y-6">
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div>
                <h2 className="text-base font-semibold">{t.settingsIntegrations}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsIntegrationsHint}
                </p>
              </div>

              {/* Google Calendar Honest State */}
              <div
                className="p-4 rounded-lg border flex flex-col md:flex-row md:items-center justify-between gap-4"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span className="font-semibold text-sm">{t.settingsGoogleCalendar}</span>
                    <span
                      className="text-xs px-2 py-0.5 rounded-full font-medium"
                      style={{
                        backgroundColor: calendarStatus.connected
                          ? 'rgba(34, 197, 94, 0.15)'
                          : 'rgba(239, 68, 68, 0.15)',
                        color: calendarStatus.connected ? '#22c55e' : '#ef4444',
                      }}
                    >
                      {calendarStatus.connected ? t.settingsConnected : t.settingsNotConnected}
                    </span>
                  </div>

                  <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {calendarStatus.detailKey ? t[calendarStatus.detailKey as keyof Translations] : (calendarStatus.connected
                        ? t.settingsCalendarActive
                        : t.settingsGoogleMissing)}
                  </p>
                </div>

                {/* Honest state: No Connect button that cannot connect */}
                <div className="text-xs px-3 py-1.5 rounded border self-start md:self-auto" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
                  {t.settingsGoogleAwaiting}
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 3. SPEECH TO TEXT SECTION                                                 */}
        {/* ========================================================================= */}
        {activeSection === 'speech' && (
          <section id="section-speech" role="tabpanel" aria-label={t.settingsSpeechToText} className="space-y-6">
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div>
                <h2 className="text-base font-semibold">{t.settingsSpeech}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsSpeechHint}
                </p>
              </div>

              {/* Enable Toggle */}
              <div className="flex items-center justify-between pt-2">
                <div>
                  <div className="text-sm font-medium">{t.settingsSpeechEnable}</div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsSpeechEnableHint}
                  </div>
                </div>
                <input
                  aria-label={t.settingsSpeechEnable}
                  type="checkbox"
                  checked={speech.enabled}
                  onChange={(e) => handleSaveSpeech({ enabled: e.target.checked })}
                  className="w-4 h-4 rounded cursor-pointer"
                />
              </div>

              {/* Global Hotkey Field */}
              <div className="pt-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsSpeechHotkey}
                </label>
                <input
                  aria-label={t.settingsSpeechHotkey}
                  type="text"
                  value={speech.hotkey}
                  onChange={(e) => handleSaveSpeech({ hotkey: e.target.value })}
                  placeholder={t.settingsSpeechHotkeyPlaceholder}
                  className="w-full px-3 py-2 rounded-md border text-sm font-mono"
                  style={{
                    backgroundColor: 'var(--elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                />
              </div>

              {/* Model choice */}
              <div className="pt-2">
                <label className="block text-xs font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsWhisperModel}
                </label>
                <select
                  aria-label={t.settingsWhisperModel}
                  value={speech.modelId || 'whisper-tiny'}
                  onChange={(e) => handleSaveSpeech({ modelId: e.target.value })}
                  className="w-full px-3 py-2 rounded-md border text-sm focus:outline-none"
                  style={{
                    backgroundColor: 'var(--elevated)',
                    borderColor: 'var(--border)',
                    color: 'var(--text)',
                  }}
                >
                  <option value="whisper-tiny">{t.settingsWhisperTiny}</option>
                  <option value="whisper-base">{t.settingsWhisperBase}</option>
                  <option value="whisper-small">{t.settingsWhisperSmall}</option>
                </select>
                <p className="text-xs mt-1.5" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsWhisperHint}
                </p>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 4. SHORTCUTS SECTION                                                      */}
        {/* ========================================================================= */}
        {activeSection === 'shortcuts' && (
          <section id="section-shortcuts" role="tabpanel" aria-label={t.settingsShortcutsTab} className="space-y-6">
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div>
                <h2 className="text-base font-semibold">{t.settingsShortcuts}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsShortcutsHint}
                </p>
              </div>

              {/* Dynamic list rendered from listShortcuts() */}
              <div className="space-y-4" data-testid="shortcuts-list">
                {(() => {
                  const items = listShortcuts();
                  if (items.length === 0) {
                    return (
                      <div className="text-xs italic py-4" style={{ color: 'var(--text-muted)' }}>
                        {t.settingsShortcutsEmpty}
                      </div>
                    );
                  }

                  // Group by scope
                  const byScope: Record<string, ShortcutDef[]> = {};
                  for (const sc of items) {
                    const group = sc.scope || 'general';
                    if (!byScope[group]) byScope[group] = [];
                    byScope[group].push(sc);
                  }

                  return Object.entries(byScope).map(([group, groupItems]) => (
                    <div key={group} className="space-y-2">
                      <h3
                        className="text-xs font-semibold uppercase tracking-wider px-1"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        {group}
                      </h3>
                      <div
                        className="divide-y rounded-lg border overflow-hidden"
                        style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
                      >
                        {groupItems.map((sc) => (
                          <div
                            key={sc.id}
                            data-testid={`shortcut-row-${sc.id}`}
                            className="flex items-center justify-between p-3 text-sm"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <div>
                              <div className="font-medium">
                                {(sc.description ? ((t as unknown as Record<string, string | undefined>)[sc.description] ?? sc.description) : sc.id)}
                              </div>
                              <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                                {sc.id}
                              </div>
                            </div>
                            <kbd
                              className="px-2.5 py-1 rounded text-xs font-mono border"
                              style={{
                                backgroundColor: 'var(--surface)',
                                borderColor: 'var(--border)',
                                color: 'var(--accent)',
                              }}
                            >
                              {sc.keys}
                            </kbd>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()}
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 5. ABOUT & ACCOUNT SECTION                                                */}
        {/* ========================================================================= */}
        {activeSection === 'about' && (
          <section id="section-about" role="tabpanel" aria-label={t.settingsAboutTab} className="space-y-6">
            <div
              className="p-5 rounded-lg border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div>
                <h2 className="text-base font-semibold">{t.settingsAbout}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsAboutHint}
                </p>
              </div>

              {/* Version & Build */}
              <div
                className="p-4 rounded-lg border space-y-3"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{t.settingsVersion}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.settingsVersionHint}
                    </div>
                  </div>
                  <span
                    data-testid="app-version"
                    className="font-mono text-sm px-2.5 py-1 rounded-md border"
                    style={{
                      backgroundColor: 'var(--surface)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    {appVersion}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">{t.settingsEnvironment}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.settingsEnvironmentHint}
                    </div>
                  </div>
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isPortable ? 'rgba(245, 158, 11, 0.15)' : 'var(--surface)',
                      color: isPortable ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {isPortable ? t.settingsPortable : t.settingsInstalled}
                  </span>
                </div>

                {/* Check for Updates */}
                <div className="pt-2 flex items-center justify-between border-t" style={{ borderColor: 'var(--border)' }}>
                  <div>
                    <div className="text-sm font-medium">{t.settingsUpdate}</div>
                    <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {updateInfo
                        ? `Update ${updateInfo.version} is ready to install`
                        : t.settingsUpdateHint}
                    </div>
                  </div>

                  {updateInfo ? (
                    <button
                      type="button"
                      onClick={handleInstallUpdate}
                      disabled={isInstallingUpdate}
                      className="px-3 py-1.5 rounded-md text-xs font-medium"
                      style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
                    >
                      {isInstallingUpdate ? t.settingsInstalling : t.settingsInstallUpdate}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={handleCheckUpdate}
                      disabled={isCheckingUpdate}
                      className="px-3 py-1.5 rounded-md border text-xs font-medium inline-flex items-center gap-1.5"
                      style={{
                        backgroundColor: 'var(--surface)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      {isCheckingUpdate ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      Check for Updates
                    </button>
                  )}
                </div>
              </div>

              {/* Account / Google state */}
              <div
                className="p-4 rounded-lg border space-y-2"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span className="text-sm font-medium">{t.settingsGoogleAccount}</span>
                  </div>
                  <span
                    className="text-xs font-medium px-2 py-0.5 rounded-full"
                    style={{
                      backgroundColor: calendarStatus.connected
                        ? 'rgba(34, 197, 94, 0.15)'
                        : 'var(--surface)',
                      color: calendarStatus.connected ? '#22c55e' : 'var(--text-muted)',
                    }}
                  >
                    {calendarStatus.connected ? t.settingsActive : t.settingsUnlinked}
                  </span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {calendarStatus.detailKey ? t[calendarStatus.detailKey as keyof Translations] : 'External cloud accounts are unlinked. Wave 8 OAuth pending.'}
                </p>
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
};
