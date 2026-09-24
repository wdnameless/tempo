import React, { useState, useEffect, useTransition, useRef } from 'react';
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
  Folder,
  FolderOpen,
  Package,
  Zap,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import {
  formatShortcutKeys,
  updateShortcutKeys,
  resetShortcutKeys,
  isCustomShortcut,
  isMacPlatform,
} from '../services/shortcuts';
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from '../services/platform';
import { openPath } from '@tauri-apps/plugin-opener';
import { isEnabled as isAutostartEnabled, enable as enableAutostart, disable as disableAutostart } from '@tauri-apps/plugin-autostart';
import { ThemeColors, AISettings, DynamicUIConfig } from '../types';

/** The assistant's settings with the defaults filled in. */
const DEFAULT_AI_SETTINGS: AISettings = {
  apiKey: '',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'google/gemini-2.0-flash-001',
};
import { type BlockSettings } from '../types/focus';
import { type AccentId } from '../constants/design';
import { rolloverSettings, setRolloverSettings } from '../services/rollover';
import { EdgeTtsService } from '../services/edgeTts';
import { I18nService, type Translations } from '../services/i18n';
import { getPref } from '../services/settings';
import type { ScreenId } from '../App';
import { AIGateway } from '../services/aiGateway';
import { checkForUpdate, currentVersion, detectPortable, installUpdate, type UpdateInfo } from '../services/update';
import {
  loadGeneralSettings,
  saveGeneralSettings,
  migrateLegacyPreferences,
  type GeneralSettings,
} from '../services/generalSettings';
import {
  listModels,
  type ModelInfo,
} from '../services/stt';
import { googleCalendarStatus, type IntegrationStatus } from '../services/integrations';
import { listShortcuts, type ShortcutDef } from '../services/shortcuts';
import { assetUsage, assetPrune, DEFAULT_MEDIA_LIMIT_BYTES, type AssetUsage } from '../services/assets';
// Settings services
import {
  getSyncStatus,
  setSyncTransport,
  setSyncMedia,
  syncNow,
  SyncError,
  type SyncStatus,
  type SyncOutcome,
} from '../services/sync';

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
  onNavigate?: (tab: ScreenId) => void;
  onOpenStt?: () => void;
  [key: string]: unknown;
}

export type SettingsSection = 'general' | 'ai' | 'integrations' | 'speech' | 'shortcuts' | 'about';


/**
 * The five sections of R20. The labels are resolved at render time: this array
 * lives outside the component, where there is no translation in scope.
 */
const SECTION_DEFS: Array<{ id: SettingsSection; labelKey: keyof Translations; icon: React.ReactNode }> = [
  { id: 'general', labelKey: 'settingsGeneral', icon: <Sliders className="w-4 h-4" /> },
  { id: 'ai', labelKey: 'settingsAiTab', icon: <Sparkles className="w-4 h-4" /> },
  { id: 'integrations', labelKey: 'settingsIntegrationsTab', icon: <Calendar className="w-4 h-4" /> },
  { id: 'speech', labelKey: 'settingsSpeechToText', icon: <Mic className="w-4 h-4" /> },
  { id: 'shortcuts', labelKey: 'settingsShortcutsTab', icon: <Keyboard className="w-4 h-4" /> },
  { id: 'about', labelKey: 'settingsAboutTab', icon: <Info className="w-4 h-4" /> },
];

interface SubItemDef {
  id: string;
  labelKey: keyof Translations;
  blockId: string;
}

const SECTION_SUB_ITEMS: Partial<Record<SettingsSection, SubItemDef[]>> = {
  general: [
    { id: 'timer-focus', labelKey: 'settingsTimerFocus', blockId: 'general-timer-focus' },
    { id: 'rollover', labelKey: 'settingsRollover', blockId: 'general-rollover' },
    { id: 'media', labelKey: 'settingsMedia', blockId: 'general-media' },
  ],
};

export const SettingsView: React.FC<SettingsViewProps> = (props) => {
  const {
    aiSettings,
    onUpdateAISettings,
  } = props;
  const t = I18nService.t();
  const [activeSection, setActiveSection] = useState<SettingsSection>('general');
  const [activeSubItem, setActiveSubItem] = useState<string | null>('timer-focus');
  const contentRef = useRef<HTMLDivElement>(null);
  const [, startTransition] = useTransition();

  const handleSelectSection = (secId: SettingsSection) => {
    startTransition(() => {
      setActiveSection(secId);
      const subs = SECTION_SUB_ITEMS[secId];
      if (subs && subs.length > 0) {
        setActiveSubItem(subs[0].id);
      } else {
        setActiveSubItem(null);
      }
    });
  };

  const handleSubItemClick = (sub: SubItemDef) => {
    setActiveSubItem(sub.id);
    const el = document.getElementById(sub.blockId);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  useEffect(() => {
    if (contentRef.current) {
      contentRef.current.scrollTop = 0;
    }
  }, [activeSection]);

  useEffect(() => {
    const container = contentRef.current;
    if (!container) return;

    const handleScroll = () => {
      const subItems = SECTION_SUB_ITEMS[activeSection];
      if (!subItems || subItems.length === 0) return;

      if (container.scrollTop + container.clientHeight >= container.scrollHeight - 10) {
        setActiveSubItem(subItems[subItems.length - 1].id);
        return;
      }

      const containerRect = container.getBoundingClientRect();
      let currentId = subItems[0].id;

      for (const item of subItems) {
        const el = document.getElementById(item.blockId);
        if (el) {
          const elRect = el.getBoundingClientRect();
          if (elRect.top - containerRect.top <= 80) {
            currentId = item.id;
          }
        }
      }
      setActiveSubItem(currentId);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
    };
  }, [activeSection]);

  // General Settings state (loaded synchronously from cache)
  const [general, setGeneral] = useState<GeneralSettings>(() => loadGeneralSettings());
  const [models, setModels] = useState<ModelInfo[]>([]);
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


  // Rollover enabled state
  const [rolloverEnabled, setRolloverEnabled] = useState<boolean>(() => {
    const s = rolloverSettings();
    return Boolean((s as { enabled?: boolean }).enabled);
  });

  const handleToggleRollover = async (enabled: boolean) => {
    setRolloverEnabled(enabled);
    try {
      await setRolloverSettings({ enabled });
      notifySaved();
    } catch {
      setSaveStatus('error');
    }
  };
  // Assistant key status
  const [keyStored, setKeyStored] = useState<boolean>(false);
  const [apiKeyInput, setApiKeyInput] = useState<string>('');
  const [isKeySaving, setIsKeySaving] = useState<boolean>(false);
  const [isPlayingVoice, setIsPlayingVoice] = useState<boolean>(false);
  // AI Model list fetching state
  const [fetchedModels, setFetchedModels] = useState<string[]>([]);
  const [isFetchingModels, setIsFetchingModels] = useState<boolean>(false);
  const [fetchModelsError, setFetchModelsError] = useState<string | null>(null);
  const [fetchModelsSuccess, setFetchModelsSuccess] = useState<boolean>(false);
  /** Spreading a partial prop would drop the fields the caller did not mention. */
  const ai = aiSettings ?? DEFAULT_AI_SETTINGS;

  // About & Version
  const [appVersion, setAppVersion] = useState<string>('0.13.0');
  const [isPortable, setIsPortable] = useState<boolean>(false);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState<boolean>(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState<boolean>(false);
  const [dataDir, setDataDir] = useState<string>('');
  const [autostartActive, setAutostartActive] = useState<boolean>(false);
  const [updateCheckStatus, setUpdateCheckStatus] = useState<'idle' | 'checking' | 'latest' | 'available' | 'error'>('idle');
  const [recordingShortcutId, setRecordingShortcutId] = useState<string | null>(null);
  const [, setShortcutsTick] = useState<number>(0);
  // Sync status & settings
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [syncFolderInput, setSyncFolderInput] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [syncOutcome, setSyncOutcome] = useState<SyncOutcome | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [showMediaConfirm, setShowMediaConfirm] = useState<boolean>(false);
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

    // Sync status load
    void getSyncStatus()
      .then((status) => {
        setSyncStatus(status);
        if (status.folder) setSyncFolderInput(status.folder);
      })
      .catch(() => {});
    if (isTauri()) {
      void invoke<string>('store_dir').then(setDataDir).catch(() => {});
      void isAutostartEnabled().then(setAutostartActive).catch(() => {});
    }
    void listModels().then(setModels).catch(() => {});
  }, []);
  const notifySaved = () => {
    setSaveStatus('saved');
    setSaveErrorMessage(null);
    const timer = setTimeout(() => setSaveStatus('idle'), 2200);
    return () => clearTimeout(timer);
  };
  useEffect(() => {
    if (!recordingShortcutId) return;

    const handleRecordKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.key === 'Escape') {
        setRecordingShortcutId(null);
        return;
      }

      if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) {
        return;
      }

      const keys: string[] = [];
      if (e.ctrlKey || (!isMacPlatform() && e.metaKey)) keys.push('Ctrl');
      if (e.metaKey && isMacPlatform()) keys.push('⌘');
      if (e.altKey) keys.push('Alt');
      if (e.shiftKey) keys.push('Shift');

      let keyName = e.key.toUpperCase();
      if (e.code === 'Space') keyName = 'Space';
      if (!keys.includes(keyName)) {
        keys.push(keyName);
      }

      updateShortcutKeys(recordingShortcutId, keys);
      setRecordingShortcutId(null);
      setShortcutsTick((n) => n + 1);
      notifySaved();
    };

    window.addEventListener('keydown', handleRecordKey, true);
    return () => window.removeEventListener('keydown', handleRecordKey, true);
  }, [recordingShortcutId]);
  const getShortcutLabel = (sc: ShortcutDef): string => {
    if (!sc.description) return sc.id;
    // SAFETY: sc.description is a key of Translations
    const dict = t as unknown as Record<string, string | undefined>;
    return dict[sc.description] ?? sc.description;
  };

  const handleToggleAutostart = async () => {
    if (!isTauri()) return;
    try {
      if (autostartActive) {
        await disableAutostart();
        setAutostartActive(false);
      } else {
        await enableAutostart();
        setAutostartActive(true);
      }
      notifySaved();
    } catch (err) {
      setSaveStatus('error');
      setSaveErrorMessage(err instanceof Error ? err.message : 'Autostart toggle failed');
    }
  };

  const handleOpenFolder = async (folderPath: string) => {
    if (!folderPath) return;
    try {
      if (isTauri()) {
        await openPath(folderPath);
      }
    } catch {
      // ignore
    }
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


  // Sync models list for About tab recognition status
  useEffect(() => {
    if (activeSection === 'about') {
      listModels().then(setModels).catch(() => {});
    }
  }, [activeSection]);

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

  const handleSetSyncTransport = async (kind: 'none' | 'folder', folderPath?: string | null) => {
    setSyncError(null);
    try {
      await setSyncTransport(kind, folderPath);
      const updated = await getSyncStatus();
      setSyncStatus(updated);
      notifySaved();
    } catch (err: unknown) {
      setSyncError(err instanceof SyncError ? err.message : String(err));
    }
  };

  const handleToggleMedia = async (enabled: boolean) => {
    if (enabled && !showMediaConfirm) {
      // Warn before enabling
      setShowMediaConfirm(true);
      return;
    }
    setShowMediaConfirm(false);
    setSyncError(null);
    try {
      await setSyncMedia(enabled);
      const updated = await getSyncStatus();
      setSyncStatus(updated);
      notifySaved();
    } catch (err: unknown) {
      setSyncError(err instanceof SyncError ? err.message : String(err));
    }
  };

  const handleSyncNow = async () => {
    setIsSyncing(true);
    setSyncError(null);
    setSyncOutcome(null);
    try {
      const outcome = await syncNow();
      setSyncOutcome(outcome);
      const updated = await getSyncStatus();
      setSyncStatus(updated);
      notifySaved();
    } catch (err: unknown) {
      if (err instanceof SyncError) {
        setSyncError(err.message);
      } else if (err instanceof Error) {
        setSyncError(err.message);
      } else {
        setSyncError(String(err));
      }
    } finally {
      setIsSyncing(false);
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

  const handleFetchModels = async () => {
    setIsFetchingModels(true);
    setFetchModelsError(null);
    setFetchModelsSuccess(false);
    try {
      const list = await AIGateway.listModels(ai.baseUrl);
      if (list && list.length > 0) {
        setFetchedModels(list);
        setFetchModelsSuccess(true);
      } else {
        setFetchModelsError(t.settingsModelsFailed);
      }
    } catch (err) {
      setFetchModelsError(err instanceof Error ? err.message : t.settingsModelsFailed);
    } finally {
      setIsFetchingModels(false);
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
    setUpdateCheckStatus('checking');
    const startTime = Date.now();
    try {
      const result = await checkForUpdate();
      const elapsed = Date.now() - startTime;
      if (elapsed < 800) {
        await new Promise((resolve) => setTimeout(resolve, 800 - elapsed));
      }
      if (result.status === 'update') {
        setUpdateInfo(result.info);
        setUpdateCheckStatus('available');
      } else {
        setUpdateCheckStatus('latest');
      }
    } catch {
      setUpdateCheckStatus('error');
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

      {/* Body: Left column sidebar + Main content pane */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Navigation sidebar (macOS System Settings style) */}
        <aside
          className="w-48 shrink-0 border-r overflow-y-auto p-3 flex flex-col gap-1 select-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          role="tablist"
          aria-orientation="vertical"
          aria-label={t.settingsTitle}
        >
          {SECTION_DEFS.map((sec) => {
            const isActive = activeSection === sec.id;
            const subItems = SECTION_SUB_ITEMS[sec.id];
            return (
              <div key={sec.id} className="flex flex-col">
                <button
                  role="tab"
                  id={`tab-${sec.id}`}
                  aria-selected={isActive}
                  aria-controls={`section-${sec.id}`}
                  onClick={() => handleSelectSection(sec.id)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left w-full cursor-pointer hover:bg-white/5"
                  style={{
                    backgroundColor: isActive ? 'var(--elevated)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  <span className="shrink-0">{sec.icon}</span>
                  <span className="truncate">{t[sec.labelKey]}</span>
                </button>

                {/* Sub-items for long sections (under active section) */}
                {isActive && subItems && subItems.length > 0 && (
                  <div
                    className="ml-6 pl-3 border-l space-y-0.5 my-1"
                    style={{ borderColor: 'var(--border)' }}
                  >
                    {subItems.map((sub) => {
                      const isSubActive = activeSubItem === sub.id;
                      return (
                        <button
                          key={sub.id}
                          type="button"
                          data-testid={`settings-subitem-${sub.id}`}
                          onClick={() => handleSubItemClick(sub)}
                          className="w-full text-left px-2 py-1.5 rounded text-xs transition-colors block truncate cursor-pointer hover:bg-white/5"
                          style={{
                            color: isSubActive ? 'var(--accent)' : 'var(--text-muted)',
                            fontWeight: isSubActive ? 600 : 400,
                            backgroundColor: isSubActive ? 'rgba(255, 255, 255, 0.05)' : 'transparent',
                          }}
                          aria-current={isSubActive ? 'true' : undefined}
                        >
                          {t[sub.labelKey]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </aside>

        {/* Main content scroll container */}
        <div ref={contentRef} className="flex-1 overflow-y-auto p-7">
          <div className="max-w-4xl w-full mx-auto space-y-7">
            {/* ========================================================================= */}
            {/* 1. GENERAL SECTION                                                        */}
            {/* ========================================================================= */}
            {activeSection === 'general' && (
              <section id="section-general" role="tabpanel" aria-label={t.settingsGeneral} className="space-y-7">
                {/* Timer & Pomodoro Configuration */}
                <div
                  id="general-timer-focus"
                  className="p-5 rounded-xl border space-y-4 scroll-mt-4"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                >
              <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
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

            {/* Day rollover */}
            <div
              id="general-rollover"
              className="p-5 rounded-xl border space-y-4 scroll-mt-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsRollover}
                  </h2>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsRolloverHint}
                  </p>
                </div>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    data-testid="toggle-rollover-enabled"
                    aria-label={t.settingsRollover}
                    checked={rolloverEnabled}
                    onChange={(e) => void handleToggleRollover(e.target.checked)}
                    className="w-4 h-4 rounded cursor-pointer"
                  />
                  <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                    {rolloverEnabled ? t.settingsEnabled : t.settingsDisabled}
                  </span>
                </label>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsRolloverHour}
                </label>
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsRolloverHint}
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
            </div>

            {/* Media Usage & Pruning (R43) */}
            <div
              id="general-media"
              className="p-5 rounded-xl border space-y-4 scroll-mt-4"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
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
                  {t.settingsPruneMedia}
                </button>
              </div>

              <div
                className="p-3 rounded-md border text-sm flex items-center justify-between"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div>
                  <div className="font-medium">
                    {t.settingsMediaUsed.replace('{used}', mediaStats ? formatBytes(mediaStats.total) : '0 B')}
                  </div>
                  <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsMediaLimit.replace('{limit}', formatBytes(general.mediaLimitBytes || DEFAULT_MEDIA_LIMIT_BYTES))}
                  </div>
                </div>
                {mediaStats && (
                  <div className="text-xs text-right" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsCategoriesTracked.replace('{count}', String(Object.keys(mediaStats.by_kind ?? {}).length))}
                  </div>
                )}
              </div>
            </div>

          </section>
        )}
        {/* ========================================================================= */}
        {/* 2. AI SECTION                                                             */}
        {/* ========================================================================= */}
        {activeSection === 'ai' && (
          <section id="section-ai" role="tabpanel" aria-label={t.settingsAiTab} className="space-y-7">
            <div
              className="p-5 rounded-xl border space-y-5"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                <h2 className="text-sm font-semibold tracking-wide" style={{ color: 'var(--text-muted)' }}>
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
                      placeholder={keyStored ? t.syncApiKeyPlaceholderStored : t.syncApiKeyPlaceholderEmpty}
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
                  {keyStored ? t.settingsKeyHidden : t.settingsKeyStored}
                </p>
              </div>

              {/* Base URL and Fetch Models */}
              <div className="space-y-3 pt-2 border-t border-[var(--border)]">
                <div>
                  <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsBaseUrl}
                  </label>
                  <div className="flex items-center gap-2">
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
                      className="flex-1 px-3 py-2 rounded-md border text-sm font-mono"
                      style={{
                        backgroundColor: 'var(--elevated)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    />
                    <button
                      type="button"
                      data-testid="fetch-models-button"
                      onClick={handleFetchModels}
                      disabled={isFetchingModels}
                      className="px-3 py-2 rounded-md border text-xs font-medium inline-flex items-center gap-1.5 transition-colors shrink-0"
                      style={{
                        backgroundColor: 'var(--elevated)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      {isFetchingModels ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      <span>{isFetchingModels ? t.settingsFetchingModels : t.settingsFetchModels}</span>
                    </button>
                  </div>
                </div>

                {/* Status or error of model fetch */}
                {fetchModelsError && (
                  <div className="p-2.5 rounded-md bg-red-500/10 border border-red-500/20 text-xs text-red-400" data-testid="fetch-models-error">
                    {fetchModelsError}
                  </div>
                )}
                {fetchModelsSuccess && (
                  <div className="p-2 rounded-md bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-400 flex items-center gap-1.5">
                    <Check className="w-3.5 h-3.5" />
                    <span>{t.settingsModelsFetched} ({fetchedModels.length})</span>
                  </div>
                )}
              </div>

              {/* Model Picker & Free-text fallback */}
              <div className="space-y-2 pt-2 border-t border-[var(--border)]">
                <label className="block text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsModel}
                </label>

                {fetchedModels.length > 0 && (
                  <div>
                    <select
                      aria-label={t.syncSelectAiModel}
                      data-testid="ai-model-select"
                      value={ai.model}
                      onChange={(e) =>
                        onUpdateAISettings?.({
                          ...ai,
                          model: e.target.value,
                        })
                      }
                      className="w-full px-3 py-2 rounded-md border text-sm font-mono mb-2"
                      style={{
                        backgroundColor: 'var(--elevated)',
                        borderColor: 'var(--border)',
                        color: 'var(--text)',
                      }}
                    >
                      {!fetchedModels.includes(ai.model) && (
                        <option value={ai.model}>{ai.model} (current)</option>
                      )}
                      {fetchedModels.map((m) => (
                        <option key={m} value={m}>
                          {m} {m === ai.model ? '✓' : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                <div>
                  <input
                    aria-label={t.settingsModelAria}
                    data-testid="ai-model-input"
                    type="text"
                    placeholder={t.syncAiModelPlaceholder}
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
                  <p className="text-[11px] mt-1" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsCustomModelHint}
                  </p>
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
                  {t.settingsTestVoice}
                </button>
              </div>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 2. INTEGRATIONS SECTION (R21)                                             */}
        {/* ========================================================================= */}
        {activeSection === 'integrations' && (
          <section id="section-integrations" role="tabpanel" aria-label={t.settingsIntegrationsTab} className="space-y-7">
            <div
              className="p-5 rounded-xl border space-y-4"
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
                className="p-4 rounded-xl border flex flex-col md:flex-row md:items-center justify-between gap-4"
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
          <section id="section-speech" role="tabpanel" aria-label={t.settingsSpeechToText} className="space-y-7">
            <div
              data-testid="settings-speech-pointer"
              className="p-5 rounded-xl border flex items-center justify-between gap-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div className="flex items-center gap-3">
                <div
                  className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                  style={{ backgroundColor: 'var(--elevated)' }}
                >
                  <Mic className="w-5 h-5 text-[var(--accent)]" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                    {t.settingsSpeechMovedTitle}
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsSpeechMovedHint}
                  </p>
                </div>
              </div>
              <button
                type="button"
                data-testid="settings-goto-stt-btn"
                onClick={() => {
                  if (typeof props.onOpenStt === 'function') {
                    props.onOpenStt();
                  } else if (typeof props.onNavigate === 'function') {
                    props.onNavigate('stt');
                  }
                }}
                className="px-4 py-2 text-xs font-medium rounded-lg text-white hover:opacity-90 transition-opacity cursor-pointer shrink-0"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {t.settingsSpeechMovedAction}
              </button>
            </div>
          </section>
        )}

        {/* ========================================================================= */}
        {/* 4. SHORTCUTS SECTION                                                      */}
        {/* ========================================================================= */}
        {activeSection === 'shortcuts' && (
          <section id="section-shortcuts" role="tabpanel" aria-label={t.settingsShortcutsTab} className="space-y-7">
            <div
              className="p-5 rounded-xl border space-y-4"
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
                        className="divide-y rounded-xl border overflow-hidden"
                        style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
                      >
                        {groupItems.map((sc) => (
                          <div
                            key={sc.id}
                            data-testid={`shortcut-row-${sc.id}`}
                            className="flex items-center justify-between p-3 text-sm hover:bg-white/[0.02] transition-colors"
                            style={{ borderColor: 'var(--border)' }}
                          >
                            <div>
                              <div className="font-medium">
                                {getShortcutLabel(sc)}
                              </div>
                              <div className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
                                {sc.id}
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setRecordingShortcutId(sc.id === recordingShortcutId ? null : sc.id)}
                                title="Нажмите, чтобы изменить комбинацию клавиш"
                                className={`px-2.5 py-1 rounded-md text-xs font-mono border transition-all cursor-pointer ${
                                  recordingShortcutId === sc.id
                                    ? 'border-white bg-white/20 text-white animate-pulse'
                                    : 'hover:border-white/30 hover:bg-white/5'
                                }`}
                                style={{
                                  backgroundColor: recordingShortcutId === sc.id ? undefined : 'var(--surface)',
                                  borderColor: recordingShortcutId === sc.id ? undefined : 'var(--border)',
                                  color: 'var(--accent)',
                                }}
                              >
                                {recordingShortcutId === sc.id ? 'Нажмите клавиши...' : formatShortcutKeys(sc.keys)}
                              </button>
                              {isCustomShortcut(sc.id) && (
                                <button
                                  type="button"
                                  title="Сбросить по умолчанию"
                                  onClick={() => {
                                    resetShortcutKeys(sc.id, sc.keys);
                                    setShortcutsTick((n) => n + 1);
                                  }}
                                  className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-white transition-colors"
                                >
                                  <RotateCcw className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
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
          <section id="section-about" role="tabpanel" aria-label={t.settingsAboutTab} className="space-y-7">
            <div
              className="p-5 rounded-xl border space-y-4"
              style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
            >
              <div>
                <h2 className="text-base font-semibold">{t.settingsAbout}</h2>
                <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                  {t.settingsAboutHint}
                </p>
              </div>

              {/* Version & Build */}
            {/* 1. Хранилище и система (Matching User Reference) */}
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-white">{t.settingsStorageAndSystem}</h2>
                <p className="text-xs text-white/50 mt-0.5">
                  {t.settingsStorageAndSystemHint}
                </p>
              </div>

              {/* Портативный режим */}
              <div
                className="p-4 rounded-xl border flex items-center justify-between gap-4"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-white/70" />
                    <span className="text-sm font-semibold text-white">{t.settingsPortable}</span>
                  </div>
                  <p className="text-xs text-white/50 leading-relaxed max-w-xl">
                    {t.settingsPortableDesc}
                  </p>
                  <div className="text-[11px] font-mono text-white/40 pt-0.5">
                    {isPortable ? 'портативный • ' : 'обычный • '}
                    <span>{dataDir || 'C:\\Users\\Administrator\\AppData\\Roaming\\app.tempo.desktop'}</span>
                  </div>
                </div>

                <span
                  className={`text-xs font-semibold px-2.5 py-1 rounded-full shrink-0 ${
                    isPortable ? 'bg-white/15 text-white' : 'bg-white/5 text-white/50'
                  }`}
                >
                  {isPortable ? 'Включен' : 'Обычный'}
                </span>
              </div>

              {/* Каталоги */}
              <div
                className="p-4 rounded-xl border space-y-3"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center gap-2 mb-1">
                  <Folder className="w-4 h-4 text-white/70" />
                  <span className="text-sm font-semibold text-white">{t.settingsDirectories}</span>
                </div>

                <div className="space-y-2 text-xs">
                  {/* Модели */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-16 font-medium text-white/60">{t.settingsDirModels}</span>
                    <input
                      type="text"
                      readOnly
                      value={dataDir ? `${dataDir}\\models` : 'C:\\...\\models'}
                      className="flex-1 px-3 py-1.5 rounded-lg border font-mono text-xs bg-[var(--surface)] border-[var(--border)] text-white/80 select-all"
                    />
                    <button
                      type="button"
                      title={t.settingsOpenFolder}
                      onClick={() => handleOpenFolder(dataDir ? `${dataDir}\\models` : '')}
                      className="p-2 rounded-lg border border-white/10 hover:bg-white/10 text-white/70 transition-colors shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Движок */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-16 font-medium text-white/60">{t.settingsDirEngine}</span>
                    <input
                      type="text"
                      readOnly
                      value={dataDir ? `${dataDir}\\bin` : 'C:\\...\\bin'}
                      className="flex-1 px-3 py-1.5 rounded-lg border font-mono text-xs bg-[var(--surface)] border-[var(--border)] text-white/80 select-all"
                    />
                    <button
                      type="button"
                      title={t.settingsOpenFolder}
                      onClick={() => handleOpenFolder(dataDir ? `${dataDir}\\bin` : '')}
                      className="p-2 rounded-lg border border-white/10 hover:bg-white/10 text-white/70 transition-colors shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Логи */}
                  <div className="flex items-center justify-between gap-3">
                    <span className="w-16 font-medium text-white/60">{t.settingsDirLogs}</span>
                    <input
                      type="text"
                      readOnly
                      value={dataDir ? `${dataDir}\\logs` : 'C:\\...\\logs'}
                      className="flex-1 px-3 py-1.5 rounded-lg border font-mono text-xs bg-[var(--surface)] border-[var(--border)] text-white/80 select-all"
                    />
                    <button
                      type="button"
                      title={t.settingsOpenFolder}
                      onClick={() => handleOpenFolder(dataDir ? `${dataDir}\\logs` : '')}
                      className="p-2 rounded-lg border border-white/10 hover:bg-white/10 text-white/70 transition-colors shrink-0"
                    >
                      <FolderOpen className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Состояние распознавания */}
              <div
                className="p-4 rounded-xl border space-y-1.5"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="text-sm font-semibold text-white">{t.settingsRecognitionStatus}</div>
                {models.some((m) => m.installed) ? (
                  <div className="flex items-center gap-2 text-xs text-emerald-400">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0" />
                    <span>
                      {t.settingsWhisperInstalled
                        .replace('{model}', models.find((m) => m.installed)?.name ?? 'Base')
                        .replace('{size}', String(Math.round((models.find((m) => m.installed)?.bytes ?? 0) / 1048576)))}
                    </span>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-amber-400">
                      <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" />
                      <span>{t.settingsWhisperNotFound}</span>
                    </div>
                    <div className="text-[11px] text-white/40 pl-4">
                      {t.settingsWhisperNotFoundHint}
                    </div>
                  </div>
                )}
              </div>

              {/* Запускать свёрнутым в трей */}
              <div
                className="p-4 rounded-xl border flex items-center justify-between gap-4"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <Zap className="w-4 h-4 text-white/70" />
                    <span className="text-sm font-semibold text-white">{t.settingsAutostart}</span>
                  </div>
                  <p className="text-xs text-white/50">
                    {t.settingsAutostartHint}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleToggleAutostart}
                  className={`w-11 h-6 rounded-full transition-colors relative p-0.5 shrink-0 ${
                    autostartActive ? 'bg-white' : 'bg-white/20'
                  }`}
                >
                  <span
                    className={`block w-5 h-5 rounded-full transition-transform ${
                      autostartActive ? 'translate-x-5 bg-black' : 'translate-x-0 bg-white'
                    }`}
                  />
                </button>
              </div>
            </div>

            {/* 2. Обновления (Matching User Reference) */}
            <div className="space-y-3">
              <div>
                <h2 className="text-base font-semibold text-white">{t.settingsUpdatesTitle}</h2>
                <p className="text-xs text-white/50 mt-0.5">
                  {t.settingsUpdatesSubtitle}
                </p>
              </div>
              <div
                className="p-4 rounded-xl border space-y-3"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium text-white">{t.settingsVersion}</div>
                    <div className="text-xs text-white/50">
                      {updateInfo
                        ? `Update ${updateInfo.version} is ready to install`
                        : t.settingsUpdateHint}
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

                <div className="pt-3 flex items-center justify-between border-t gap-3" style={{ borderColor: 'var(--border)' }}>
                  <div className="text-xs">
                    {updateCheckStatus === 'checking' && (
                       <span className="inline-flex items-center gap-2 text-white/70">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                        <span>{t.settingsCheckingUpdates}</span>
                      </span>
                    )}
                    {updateCheckStatus === 'latest' && (
                      <span className="inline-flex items-center gap-1.5 text-emerald-400 font-medium">
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>{t.settingsLatestVersionInstalled.replace('{version}', appVersion)}</span>
                      </span>
                    )}
                    {updateCheckStatus === 'error' && (
                      <span className="inline-flex items-center gap-1.5 text-amber-400 font-medium">
                        <span>{t.settingsCheckUpdateFailed}</span>
                      </span>
                    )}
                    {updateCheckStatus === 'idle' && (
                      <span className="text-white/40">
                        {t.settingsCheckUpdateHint}
                      </span>
                    )}
                  </div>

                  <div>
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
                        className={`px-3.5 py-1.5 rounded-lg border text-xs font-medium inline-flex items-center gap-2 transition-all ${
                          isCheckingUpdate
                            ? 'opacity-70 cursor-not-allowed bg-white/10 text-white'
                            : 'text-white/90 hover:text-white hover:bg-white/10 bg-[var(--surface)]'
                        }`}
                        style={{
                          borderColor: 'var(--border)',
                        }}
                      >
                        {isCheckingUpdate ? (
                          <>
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
                            <span>{t.settingsChecking}</span>
                          </>
                        ) : (
                          <>
                            <RefreshCw className="w-3.5 h-3.5" />
                            <span>{updateCheckStatus === 'latest' ? t.settingsCheckAgain : t.settingsCheckUpdate}</span>
                          </>
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

              {/* Account / Google state */}
              <div
                className="p-4 rounded-xl border space-y-2"
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

              {/* Device Sync (R26, R27) */}
              <div
                className="p-4 rounded-xl border space-y-4"
                style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <RefreshCw className="w-4 h-4" style={{ color: 'var(--accent)' }} />
                    <span className="text-sm font-medium">{t.syncTitle}</span>
                  </div>
                  {syncStatus && (
                    <span
                      className="text-xs font-mono px-2 py-0.5 rounded"
                      style={{ backgroundColor: 'var(--surface)', color: 'var(--text-muted)' }}
                      title={`${t.syncDeviceIdFull.replace('{id}', syncStatus.device_id)}`}
                    >
                      Device: {syncStatus.device_id.slice(0, 8)}
                    </span>
                  )}
                </div>

                {/* Transport selection */}
                <div className="space-y-2">
                  <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                    {t.syncMethod}
                  </label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="syncTransport"
                        value="none"
                        checked={syncStatus?.transport === 'none'}
                        onChange={() => handleSetSyncTransport('none')}
                        className="cursor-pointer"
                      />
                      {t.syncDisabled}
                    </label>
                    <label className="flex items-center gap-2 text-xs cursor-pointer">
                      <input
                        type="radio"
                        name="syncTransport"
                        value="folder"
                        checked={syncStatus?.transport === 'folder'}
                        onChange={() => handleSetSyncTransport('folder', syncFolderInput || null)}
                        className="cursor-pointer"
                      />
                      {t.syncSharedFolder}
                    </label>
                  </div>
                </div>

                {/* Shared folder path input */}
                {syncStatus?.transport === 'folder' && (
                  <div className="space-y-2 pt-1">
                    <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                      {t.syncSharedFolderPath}
                    </label>
                    <div className="flex gap-2">
                      <div className="relative flex-1">
                        <Folder
                          className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                          style={{ color: 'var(--text-muted)' }}
                        />
                        <input
                          type="text"
                          placeholder={t.syncFolderPlaceholder}
                          value={syncFolderInput}
                          onChange={(e) => setSyncFolderInput(e.target.value)}
                          className="w-full pl-9 pr-3 py-1.5 rounded-md border text-xs outline-none focus:ring-1"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => handleSetSyncTransport('folder', syncFolderInput.trim() || null)}
                        className="px-3 py-1.5 rounded-md text-xs font-medium"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
                      >
                        {t.syncSavePath}
                      </button>
                    </div>
                  </div>
                )}

                {/* Sync status, pending count, sync now */}
                {syncStatus && syncStatus.transport !== 'none' && (
                  <div
                    className="p-3 rounded-md border space-y-3"
                    style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="text-xs font-medium">
                          {t.syncChangesPending
                            .replace('{count}', String(syncStatus.pending))
                            .replace('{pendingText}', syncStatus.pending === 1 ? 'change pending' : 'changes pending')}
                        </div>
                        <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                          {syncStatus.last_sync
                            ? `${t.syncLastSync.replace('{when}', new Date(syncStatus.last_sync).toLocaleString())}`
                            : t.syncNeverSynced}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={handleSyncNow}
                        disabled={isSyncing || (syncStatus.transport === 'folder' && !syncStatus.folder)}
                        className="px-3 py-1.5 rounded-md text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50"
                        style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
                      >
                        {isSyncing ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="w-3.5 h-3.5" />
                        )}
                        {t.syncNow}
                      </button>
                    </div>

                    {/* Sync outcome display */}
                    {syncOutcome && (
                      <div className="text-xs space-y-1 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
                        <div className="flex flex-wrap gap-x-4 gap-y-1" style={{ color: 'var(--text)' }}>
                          <span>{t.syncOutcomeSent.replace('{count}', String(syncOutcome.sent))}</span>
                          <span>{t.syncOutcomeReceived.replace('{count}', String(syncOutcome.received))}</span>
                          <span>{t.syncOutcomeApplied.replace('{count}', String(syncOutcome.applied))}</span>
                          <span>{t.syncOutcomeMediaCopied.replace('{count}', String(syncOutcome.media_copied))}</span>
                        </div>
                        {syncOutcome.conflicts > 0 && (
                          <div className="text-xs font-medium" style={{ color: '#eab308' }}>
                            {syncOutcome.conflicts === 1
                              ? t.syncOutcomeConflictSingle
                              : t.syncOutcomeConflictPlural.replace('{count}', String(syncOutcome.conflicts))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Sync error display */}
                {syncError && (
                  <div
                    className="p-3 rounded-md border flex items-start gap-2 text-xs"
                    style={{
                      backgroundColor: 'rgba(239, 68, 68, 0.1)',
                      borderColor: 'rgba(239, 68, 68, 0.3)',
                      color: '#ef4444',
                    }}
                  >
                    <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                    <div className="space-y-0.5">
                      <span className="font-semibold">{t.syncError}</span>
                      <div>{syncError}</div>
                    </div>
                  </div>
                )}

                {/* Media Sync Flag */}
                <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-medium">{t.syncMediaFiles}</div>
                      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        {t.syncMediaWarning}
                      </div>
                    </div>
                    <input
                      type="checkbox"
                      checked={syncStatus?.media ?? false}
                      onChange={(e) => handleToggleMedia(e.target.checked)}
                      className="w-4 h-4 rounded cursor-pointer"
                    />
                  </div>

                  {/* Media Confirmation Warning Banner */}
                  {showMediaConfirm && (
                    <div
                      className="p-3 rounded-md border space-y-2 text-xs"
                      style={{
                        backgroundColor: 'rgba(234, 179, 8, 0.1)',
                        borderColor: 'rgba(234, 179, 8, 0.3)',
                        color: 'var(--text)',
                      }}
                    >
                      <div className="flex items-center gap-2 font-medium" style={{ color: '#eab308' }}>
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        <span>{t.syncConfirmMedia}</span>
                      </div>
                      <p style={{ color: 'var(--text-muted)' }}>
                        {t.syncConfirmMediaDescription}
                      </p>
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleToggleMedia(true)}
                          className="px-2.5 py-1 rounded text-xs font-medium"
                          style={{ backgroundColor: 'var(--accent)', color: 'var(--bg)' }}
                        >
                          {t.syncEnableMedia}
                        </button>
                        <button
                          type="button"
                          onClick={() => setShowMediaConfirm(false)}
                          className="px-2.5 py-1 rounded text-xs font-medium border"
                          style={{
                            backgroundColor: 'var(--surface)',
                            borderColor: 'var(--border)',
                            color: 'var(--text)',
                          }}
                        >
                          {t.syncCancel}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Google Drive Status (Honest State) */}
                <div
                  className="p-3 rounded-md border space-y-1.5"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium">{t.syncDriveTitle}</span>
                    <span
                      className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                      style={{ backgroundColor: 'var(--surface-muted, rgba(120, 120, 120, 0.15))', color: 'var(--text-muted)' }}
                    >
                      {t.syncUnavailable}
                    </span>
                  </div>
                  <p className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                    {t.syncDriveBlocked}
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}
          </div>
        </div>
      </div>
    </div>
  );
};
