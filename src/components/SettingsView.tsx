import React, { useState, useEffect } from 'react';
import { enable, disable, isEnabled } from '@tauri-apps/plugin-autostart';
import { Volume2, VolumeX, Sparkles, Key, RotateCcw, Check, Play, Download, Upload, RefreshCw, Loader2, Music, Timer, Sliders } from 'lucide-react';
import { ThemeColors, AISettings, DynamicUIConfig, DEFAULT_DYNAMIC_UI } from '../types';
import { BLOCK_PRESETS, type BlockSettings } from '../types/focus';
import { ACCENTS, DEFAULT_ACCENT, applyAccent, type AccentId } from '../constants/design';
import { CLOUD_VOICES, EdgeTtsService } from '../services/edgeTts';
import { soundService } from '../services/sound';
import { I18nService, Language } from '../services/i18n';
import { AIGateway } from '../services/aiGateway';
import { checkForUpdate, currentVersion, detectPortable, installUpdate, type UpdateInfo } from '../services/update';
import { StoreService } from '../services/store';
import { PomodoroSettings } from './PomodoroSettings';
import { RolloverSettings } from './RolloverSettings';

interface SettingsViewProps {
  theme: ThemeColors;
  /** Currently applied base theme. */
  accentKey?: AccentId;
  onSelectAccent?: (accent: AccentId) => void;
  /** Alarm volume 0..1, and whether alarms sound at all. */
  alarmVolume: number;
  alarmEnabled: boolean;
  onAlarmAudioChange: (volume: number, enabled: boolean) => void;
  aiSettings: AISettings;
  onUpdateAISettings: (settings: AISettings) => void;
  onUpdateUI: (ui: DynamicUIConfig) => void;
  /** Focus/rest lengths for block mode. */
  blockSettings: BlockSettings;
  onBlockSettingsChange: (next: BlockSettings) => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  theme,
  accentKey,
  onSelectAccent,
  alarmVolume,
  alarmEnabled,
  onAlarmAudioChange,
  aiSettings,
  onUpdateAISettings,
  onUpdateUI,
  blockSettings,
  onBlockSettingsChange,
}) => {
  const [selectedVoice, setSelectedVoice] = useState<string>(() => {
    return StoreService.getPreference('alarmer_voice_id', 'none');
  });

  const [apiKey, setApiKey] = useState(aiSettings.apiKey);
  const [keyStored, setKeyStored] = useState(false);
  const [baseUrl, setBaseUrl] = useState(aiSettings.baseUrl);
  const [model, setModel] = useState(aiSettings.model);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testingVoice, setTestingVoice] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [activeTab, setActiveTab] = useState<'general' | 'pomodoro' | 'sound' | 'ai' | 'data'>('general');
  const [uiClicks, setUiClicks] = useState<boolean>(() => {
    return StoreService.getPreference('alarmer_ui_clicks', true);
  });
  const [countdownTicks, setCountdownTicks] = useState<boolean>(() => {
    return StoreService.getPreference('alarmer_countdown_ticks', true);
  });
  const [soundProfile, setSoundProfile] = useState<string>(() => {
    return StoreService.getPreference('alarmer_sound_profile', 'neon');
  });
  const [clockTick, setClockTick] = useState<boolean>(() => {
    return StoreService.getPreference('alarmer_clock_tick', true);
  });
  const [clickVolume, setClickVolume] = useState<number>(() => {
    return StoreService.getPreference('alarmer_click_volume', 0.5);
  });
  const [voiceVolume, setVoiceVolume] = useState<number>(() => {
    return StoreService.getPreference('alarmer_voice_volume', 0.8);
  });
  const [musicUrl, setMusicUrl] = useState<string>(() => {
    return StoreService.getPreference('alarmer_music_url', '');
  });
  const [currentLang, setCurrentLang] = useState<Language>(() => I18nService.getLang());

  /** Running version, resolved once so the panel can name it. */
  const [appVersion, setAppVersion] = useState('…');
  /** Whether this copy updates by replacing its own binary. */
  const [portable, setPortable] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<
    | { kind: 'idle' }
    | { kind: 'checking' }
    | { kind: 'current' }
    | { kind: 'available'; info: UpdateInfo }
    | { kind: 'downloading'; info: UpdateInfo; percent: number }
    | { kind: 'installing'; info: UpdateInfo }
    | { kind: 'ready'; info: UpdateInfo }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  useEffect(() => {
    void currentVersion().then(setAppVersion);
    void detectPortable().then(setPortable);
  }, []);

  const updatePercent =
    updatePhase.kind === 'downloading' ? updatePhase.percent : 0;

  const handleCheckUpdate = async () => {
    soundService.playUiClick();
    setUpdatePhase({ kind: 'checking' });

    const result = await checkForUpdate();
    if (result.status === 'update') {
      setUpdatePhase({ kind: 'available', info: result.info });
    } else if (result.status === 'current') {
      setUpdatePhase({ kind: 'current' });
    } else {
      setUpdatePhase({ kind: 'error', message: result.message });
    }
  };

  const handleInstallUpdate = async () => {
    if (updatePhase.kind !== 'available') return;
    const info = updatePhase.info;
    soundService.playCountdownTick();
    setUpdatePhase({ kind: 'downloading', info, percent: 0 });

    const result = await installUpdate(info, (downloaded, total) => {
      const percent = total > 0 ? Math.round((downloaded / total) * 100) : 0;
      setUpdatePhase({ kind: 'downloading', info, percent });
    });

    if (!result.ok) {
      setUpdatePhase({ kind: 'error', message: result.message });
      return;
    }
    // Installing restarts the app, so this state is only reached if the restart
    // did not happen — in which case saying so beats an endless spinner.
    setUpdatePhase({ kind: 'ready', info });
  };

  const handleLangChange = (lang: Language) => {
    I18nService.setLang(lang);
    setCurrentLang(lang);
    soundService.playUiClick();
  };

  const handleVoiceChange = (voiceId: string) => {
    setSelectedVoice(voiceId);
    StoreService.setPreference('alarmer_voice_id', voiceId);
    if (voiceId !== 'none') {
      EdgeTtsService.speak('Голос успешно выбран!', voiceId);
    } else {
      EdgeTtsService.stop();
    }
  };
  const handleToggleUiClicks = () => {
    const next = !uiClicks;
    setUiClicks(next);
    StoreService.setPreference('alarmer_ui_clicks', next);
    if (next) soundService.playUiClick();
  };

  const handleToggleCountdownTicks = () => {
    const next = !countdownTicks;
    setCountdownTicks(next);
    StoreService.setPreference('alarmer_countdown_ticks', next);
    if (next) soundService.playCountdownTick();
  };

  const handleSelectProfile = (prof: string) => {
    setSoundProfile(prof);
    StoreService.setPreference('alarmer_sound_profile', prof);
    soundService.playUiClick();
  };

  const handleTestVoice = async () => {
    if (selectedVoice === 'none') {
      soundService.playBeep(440, 0.2, 0.3);
      return;
    }
    setTestingVoice(true);
    try {
      await EdgeTtsService.speak('Привет! Это проверка новой естественной озвучки Alarmer.', selectedVoice);
    } catch (e) {
      console.error(e);
    } finally {
      setTestingVoice(false);
    }
  };

  const handleSaveAI = async (e: React.FormEvent) => {
    e.preventDefault();
    // The key goes to the OS credential store, not into the exported backup
    // file alongside alarms and settings.
    try {
      await AIGateway.setKey(apiKey);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Не удалось сохранить ключ');
      return;
    }
    onUpdateAISettings({
      ...aiSettings,
      // Left out of persisted state on purpose: `hasKey` reports the real thing.
      apiKey: '',
      baseUrl: baseUrl || 'https://api.openai.com/v1',
      model: model || 'gpt-4o-mini',
      enabled: Boolean(apiKey.trim()) || keyStored,
    });
    setKeyStored(Boolean(apiKey.trim()));
    setSavedSuccess(true);
    soundService.playCountdownTick();
    setTimeout(() => setSavedSuccess(false), 1500);
  };

  const handleResetUI = () => {
    onUpdateUI(DEFAULT_DYNAMIC_UI);
    soundService.playCountdownTick();
  };

  // Reflect a previously stored key without ever reading it back into the UI.
  useEffect(() => {
    void AIGateway.hasKey().then(setKeyStored);
  }, []);

  // Reflect the real OS-level autostart state rather than a cached flag.
  useEffect(() => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    void isEnabled()
      .then(setAutostartEnabled)
      .catch(() => setAutostartEnabled(false));
  }, []);
  const handleSaveMusicUrl = (url: string) => {
    setMusicUrl(url);
    void StoreService.setPreference('alarmer_music_url', url);
  };

  const t = I18nService.t();

  return (
    <div className="flex flex-col w-full h-full p-4 overflow-y-auto space-y-6">
      <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: theme.border }}>
        <div>
          <h2 className="text-base font-bold tracking-tight">{t.titleSettings}</h2>
          <p className="text-xs opacity-60">{t.settingsGeneral}</p>
        </div>
        <div className="flex items-center space-x-1 bg-white/5 p-1 rounded-xl border border-white/10 text-xs">
          <button
            type="button"
            onClick={() => handleLangChange('en')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
              currentLang === 'en' ? 'bg-white/20 text-white' : 'opacity-50 hover:opacity-100'
            }`}
          >
            EN
          </button>
          <button
            type="button"
            onClick={() => handleLangChange('ru')}
            className={`px-2.5 py-1 rounded-lg font-bold transition-all ${
              currentLang === 'ru' ? 'bg-white/20 text-white' : 'opacity-50 hover:opacity-100'
            }`}
          >
            RU
          </button>
        </div>
      </div>

      {/* Segmented settings menu */}
      <div className="flex items-center space-x-1 p-1 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold overflow-x-auto">
        <button
          type="button"
          onClick={() => { setActiveTab('general'); soundService.playUiClick(); }}
          className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-all shrink-0 ${
            activeTab === 'general' ? 'bg-white/20 font-bold shadow-sm' : 'opacity-60 hover:opacity-100'
          }`}
          style={{ color: activeTab === 'general' ? theme.text : theme.subtext }}
        >
          <Sliders size={13} />
          <span>Основные</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('pomodoro'); soundService.playUiClick(); }}
          className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-all shrink-0 ${
            activeTab === 'pomodoro' ? 'bg-white/20 font-bold shadow-sm' : 'opacity-60 hover:opacity-100'
          }`}
          style={{ color: activeTab === 'pomodoro' ? theme.text : theme.subtext }}
        >
          <Timer size={13} />
          <span>{I18nService.t().pomodoroSettings}</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('sound'); soundService.playUiClick(); }}
          className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-all shrink-0 ${
            activeTab === 'sound' ? 'bg-white/20 font-bold shadow-sm' : 'opacity-60 hover:opacity-100'
          }`}
          style={{ color: activeTab === 'sound' ? theme.text : theme.subtext }}
        >
          <Volume2 size={13} />
          <span>Звук и Голос</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('ai'); soundService.playUiClick(); }}
          className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-all shrink-0 ${
            activeTab === 'ai' ? 'bg-white/20 font-bold shadow-sm' : 'opacity-60 hover:opacity-100'
          }`}
          style={{ color: activeTab === 'ai' ? theme.text : theme.subtext }}
        >
          <Key size={13} />
          <span>Нейросеть</span>
        </button>
        <button
          type="button"
          onClick={() => { setActiveTab('data'); soundService.playUiClick(); }}
          className={`flex-1 py-1.5 px-3 rounded-lg flex items-center justify-center space-x-1.5 transition-all shrink-0 ${
            activeTab === 'data' ? 'bg-white/20 font-bold shadow-sm' : 'opacity-60 hover:opacity-100'
          }`}
          style={{ color: activeTab === 'data' ? theme.text : theme.subtext }}
        >
          <RotateCcw size={13} />
          <span>Данные</span>
        </button>
      </div>
      {activeTab === 'general' && (
        <div className="flex flex-col space-y-6">
          {/* Accent. One variable drives every screen, so the swatch row is the
              whole control — there is no per-theme colour set to pick from. */}
          <div className="flex flex-col space-y-3">
            <label
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: theme.subtext }}
            >
              Акцент
            </label>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(ACCENTS) as AccentId[]).map((id) => {
                const isActive = accentKey === id;
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={`Акцент ${id}`}
                    aria-pressed={isActive}
                    onClick={() => {
                      soundService.playUiClick();
                      onSelectAccent?.(id);
                    }}
                    className={`w-9 h-9 rounded-xl border-2 transition-all ${
                      isActive ? 'scale-110' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{
                      backgroundColor: ACCENTS[id],
                      borderColor: isActive ? theme.text : 'transparent',
                    }}
                  />
                );
              })}
            </div>
          </div>

          <div className="flex flex-col space-y-3 border-t pt-4" style={{ borderColor: theme.border }}>
            <label
              className="text-xs font-bold uppercase tracking-wider"
              style={{ color: theme.subtext }}
            >
              Язык интерфейса
            </label>
            <div className="flex items-center space-x-1 p-1 rounded-xl bg-white/5 border border-white/10 text-xs w-fit">
              {(['en', 'ru'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => handleLangChange(lang)}
                  className={`px-3 py-1.5 rounded-lg font-bold uppercase transition-all ${
                    currentLang === lang ? 'bg-white/20 text-white' : 'opacity-50 hover:opacity-100'
                  }`}
                >
                  {lang}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'pomodoro' && (
        <div className="flex flex-col space-y-8">
          <PomodoroSettings />
          <RolloverSettings />
        </div>
      )}

      {activeTab === 'sound' && (
        <div className="flex flex-col space-y-6">
        {/* Voice Selection */}
        <div className="flex flex-col space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5" style={{ color: theme.subtext }}>
              {selectedVoice === 'none' ? <VolumeX size={15} /> : <Volume2 size={15} />}
              <span>Голосовая озвучка (Cloud Neural TTS)</span>
            </label>
            <button
              type="button"
              onClick={handleTestVoice}
              disabled={testingVoice || selectedVoice === 'none'}
              className="px-2.5 py-1 rounded-lg text-xs font-medium flex items-center space-x-1 bg-white/10 hover:bg-white/15 disabled:opacity-30 transition-all"
            >
              <Play size={11} />
              <span>{testingVoice ? 'Воспроизведение...' : 'Тест голоса'}</span>
            </button>
          </div>
          <div className="flex flex-col space-y-2">
            <select
              value={selectedVoice}
              onChange={(e) => handleVoiceChange(e.target.value)}
              className="w-full px-3 py-2.5 rounded-xl border text-xs outline-none cursor-pointer transition-colors"
              style={{
                backgroundColor: theme.cardBg,
                borderColor: theme.border,
                color: theme.text,
              }}
            >
              {CLOUD_VOICES.map((v) => (
                <option key={v.id} value={v.id} className="bg-neutral-900 text-white">
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          </div>

          {/* Voice Volume Slider */}
          <div className="flex flex-col space-y-1.5 pt-1">
            <div className="flex justify-between text-xs">
              <span style={{ color: theme.subtext }}>Громкость голоса озвучки:</span>
              <span className="font-mono font-bold tabular-nums" style={{ color: theme.text }}>
                {Math.round(voiceVolume * 100)}%
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={voiceVolume}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                setVoiceVolume(val);
                StoreService.setPreference('alarmer_voice_volume', val);
              }}
              className="w-full accent-current h-1.5 rounded-lg cursor-pointer bg-white/10"
              style={{ accentColor: '#fafafa' }}
            />
          </div>

          <p className="text-[11px] opacity-60 leading-relaxed">
            По умолчанию озвучка отключена (только звуковые сигналы). Вы можете в любой момент выбрать нейросетевой облачный голос.
          </p>
        </div>

        {/* Sound Effects & Clicks Controls */}
        <div className="flex flex-col space-y-3 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5" style={{ color: theme.subtext }}>
            <Volume2 size={15} />
            <span>Звуковые эффекты и клики интерфейса</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleToggleUiClicks()}
              className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all"
              style={{
                borderColor: uiClicks ? 'rgba(255,255,255,0.38)' : theme.border,
                backgroundColor: uiClicks ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: theme.text,
              }}
            >
              <span>Клики кнопок и вкладок</span>
              <span className="text-[10px] font-bold opacity-80">{uiClicks ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>

            <button
              type="button"
              onClick={() => handleToggleCountdownTicks()}
              className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all"
              style={{
                borderColor: countdownTicks ? 'rgba(255,255,255,0.38)' : theme.border,
                backgroundColor: countdownTicks ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: theme.text,
              }}
            >
              <span>Тиканье таймера (3..2..1)</span>
              <span className="text-[10px] font-bold opacity-80">{countdownTicks ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
            <button
              type="button"
              onClick={() => {
                const next = !clockTick;
                setClockTick(next);
                StoreService.setPreference('alarmer_clock_tick', next);
                if (next) soundService.playUiClick();
              }}
              className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all col-span-2"
              style={{
                borderColor: clockTick ? 'rgba(255,255,255,0.38)' : theme.border,
                backgroundColor: clockTick ? 'rgba(255,255,255,0.06)' : 'transparent',
                color: theme.text,
              }}
            >
              <span>Звук тиканья часов (каждую секунду)</span>
              <span className="text-[10px] font-bold opacity-80">{clockTick ? 'ВКЛ' : 'ВЫКЛ'}</span>
            </button>
          </div>

          {/* Volume Sliders */}
          <div className="flex flex-col space-y-3 pt-2">
            <div className="flex flex-col space-y-1">
              <div className="flex justify-between text-[11px]">
                <span className="opacity-80">Громкость кликов и тиков:</span>
                <span className="font-mono font-bold tabular-nums" style={{ color: theme.text }}>{Math.round(clickVolume * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={clickVolume}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  setClickVolume(val);
                  StoreService.setPreference('alarmer_click_volume', val);
                  soundService.playUiClick();
                }}
                className="w-full accent-current h-1 rounded-lg cursor-pointer opacity-80"
                style={{ accentColor: '#fafafa' }}
              />
            </div>

            <div className="flex flex-col space-y-1">
              <div className="flex justify-between items-center text-[11px]">
                <button
                  type="button"
                  onClick={() => {
                    soundService.playUiClick();
                    onAlarmAudioChange(alarmVolume, !alarmEnabled);
                  }}
                  className="flex items-center gap-1.5 rounded-lg px-1.5 py-0.5 -ml-1.5 transition-colors hover:bg-white/5"
                  title={alarmEnabled ? 'Выключить звук будильников' : 'Включить звук будильников'}
                >
                  {alarmEnabled ? <Volume2 size={11} /> : <VolumeX size={11} />}
                  <span className="opacity-80">
                    Громкость будильников и сигналов
                  </span>
                  {!alarmEnabled && <span className="font-bold">— без звука</span>}
                </button>
                <span className="font-mono font-bold tabular-nums" style={{ color: theme.text }}>
                  {alarmEnabled ? `${Math.round(alarmVolume * 100)}%` : 'ВЫКЛ'}
                </span>
              </div>
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={alarmVolume}
                disabled={!alarmEnabled}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  // Moving the slider off zero is an intent to hear alarms.
                  onAlarmAudioChange(val, val > 0);
                }}
                className="w-full accent-current h-1 rounded-lg cursor-pointer opacity-80 disabled:opacity-30"
                style={{ accentColor: '#fafafa' }}
                aria-label="Громкость будильников"
              />
              <span className="text-[10px] opacity-60 leading-relaxed">
                Действует и когда окно скрыто: сигнал играет backend, поэтому
                будильник слышен и в трее.
              </span>
            </div>
          </div>
          <div className="flex flex-col space-y-1.5 pt-1">
            <span className="text-[10px] opacity-60">Профиль звука кликов:</span>
            <div className="grid grid-cols-4 gap-1.5">
              {(['neon', 'mechanical', 'soft', 'arcade'] as const).map((prof) => (
                <button
                  key={prof}
                  type="button"
                  onClick={() => handleSelectProfile(prof)}
                  className="py-1.5 px-2 rounded-lg border text-[11px] font-medium capitalize transition-all"
                  style={{
                    borderColor: soundProfile === prof ? 'rgba(255,255,255,0.38)' : theme.border,
                    backgroundColor: soundProfile === prof ? 'rgba(255,255,255,0.07)' : 'transparent',
                    color: theme.text,
                  }}
                >
                  {prof}
                </button>
              ))}
            </div>
          </div>
        </div>
        {/* Block cycle lengths */}
        <div className="flex flex-col space-y-3 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5" style={{ color: theme.subtext }}>
            <Timer size={15} />
            <span>Длина блока</span>
          </label>

          <div className="flex flex-wrap gap-2">
            {BLOCK_PRESETS.map((preset) => {
              const active =
                blockSettings.focusMin === preset.focusMin && blockSettings.restMin === preset.restMin;
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => onBlockSettingsChange({ focusMin: preset.focusMin, restMin: preset.restMin })}
                  className="py-1.5 px-3 rounded-lg border text-[11px] font-medium transition-all"
                  style={{
                    borderColor: active ? 'rgba(255,255,255,0.38)' : theme.border,
                    backgroundColor: active ? 'rgba(255,255,255,0.07)' : 'transparent',
                    color: theme.text,
                  }}
                >
                  {preset.label}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] opacity-60 flex-1">Фокус, мин</label>
            <input
              type="number"
              min={5}
              max={180}
              value={blockSettings.focusMin}
              onChange={(e) => {
                const value = Math.round(Number(e.target.value));
                if (!Number.isFinite(value)) return;
                // Clamped here as well as in the backend: a 0-minute focus phase
                // would make the rest phase start instantly and the counter run away.
                onBlockSettingsChange({
                  ...blockSettings,
                  focusMin: Math.min(180, Math.max(5, value)),
                });
              }}
              className="w-16 px-2 py-1 rounded-lg text-xs border outline-none bg-black/30 text-right"
              style={{ borderColor: theme.border, color: theme.text }}
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-[10px] opacity-60 flex-1">Отдых, мин</label>
            <input
              type="number"
              min={1}
              max={60}
              value={blockSettings.restMin}
              onChange={(e) => {
                const value = Math.round(Number(e.target.value));
                if (!Number.isFinite(value)) return;
                onBlockSettingsChange({
                  ...blockSettings,
                  restMin: Math.min(60, Math.max(1, value)),
                });
              }}
              className="w-16 px-2 py-1 rounded-lg text-xs border outline-none bg-black/30 text-right"
              style={{ borderColor: theme.border, color: theme.text }}
            />
          </div>

          <span className="text-[10px] opacity-60 leading-relaxed">
            Блок — это фокус и следующий за ним отдых. Перерыв начинается сам: смысл в том, чтобы он действительно случался.
          </span>
        </div>
        {/* Focus Music (YouTube) */}
        <div className="flex flex-col space-y-3 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5" style={{ color: theme.subtext }}>
            <Music size={15} />
            <span>Фоновая музыка (YouTube)</span>
          </label>

          <div className="flex flex-col space-y-1">
            <span className="text-[10px] opacity-60">Ссылка на видео или трансляцию YouTube</span>
            <input
              type="text"
              value={musicUrl}
              onChange={(e) => handleSaveMusicUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=... или https://youtu.be/..."
              className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-black/30"
              style={{ borderColor: theme.border, color: theme.text }}
            />
            <span className="text-[10px] opacity-60 leading-relaxed">
              Музыка играет автоматически во время фокуса и останавливается во время отдыха. Поддерживаются ссылки на YouTube видео, шортсы и трансляции.
            </span>
          </div>
        </div>
        </div>
      )}
      {activeTab === 'ai' && (
        <div className="flex flex-col space-y-6">
        {/* AI Key Config */}
        <form onSubmit={handleSaveAI} className="flex flex-col space-y-3 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5" style={{ color: theme.subtext }}>
            <Key size={15} />
            <span>Подключение ИИ (BYOK / OpenAI-Compatible)</span>
          </label>

          <div className="flex flex-col space-y-1">
            <span className="text-[10px] opacity-60">API Ключ</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyStored ? '•••••••• (ключ сохранён)' : 'sk-...'}
              className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-black/30"
              style={{ borderColor: theme.border, color: theme.text }}
            />
            <span className="text-[10px] opacity-60 leading-relaxed">
              {keyStored
                ? 'Ключ хранится в системном хранилище учётных данных и не попадает в резервную копию. Введите новый, чтобы заменить, или оставьте пустым и сохраните, чтобы удалить.'
                : 'Ключ будет сохранён в системном хранилище учётных данных (Windows Credential Manager / Keychain), а не в файле данных.'}
            </span>
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[10px] opacity-60">Base URL</span>
            <input
              type="text"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-black/30"
              style={{ borderColor: theme.border, color: theme.text }}
            />
          </div>

          <div className="flex flex-col space-y-1">
            <span className="text-[10px] opacity-60">Модель</span>
            <input
              type="text"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="gpt-4o-mini"
              className="w-full px-3 py-2 rounded-xl text-xs border outline-none bg-black/30"
              style={{ borderColor: theme.border, color: theme.text }}
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl font-bold text-xs flex items-center justify-center space-x-1.5 transition-all mt-1"
            style={{ backgroundColor: '#fafafa', color: '#0a0a0a' }}
          >
            {savedSuccess ? <Check size={14} /> : <Sparkles size={14} />}
            <span>{savedSuccess ? 'Настройки сохранены!' : 'Сохранить параметры ИИ'}</span>
          </button>
        </form>
        </div>
      )}
      {activeTab === 'data' && (
        <div className="flex flex-col space-y-6">
        {/* Updates */}
        <div className="flex flex-col space-y-2 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.subtext }}>
            Обновления
          </label>

          <div className="flex items-center justify-between text-[11px]">
            <span style={{ color: theme.subtext }}>Версия</span>
            <span className="font-mono tabular-nums" style={{ color: theme.text }}>
              {appVersion}
            </span>
          </div>

          {portable && (
            <span className="text-[10px] opacity-60 leading-relaxed">
              Портативная сборка: обновление подменяет сам файл программы рядом с
              данными — установщик не запускается.
            </span>
          )}

          {/* The update state is always stated in words. A silent updater is one
              the user cannot tell apart from a broken one. */}
          {updatePhase.kind === 'checking' && (
            <span className="text-[11px] flex items-center gap-1.5" style={{ color: theme.subtext }}>
              <Loader2 size={11} className="animate-spin" /> Проверяем…
            </span>
          )}
          {updatePhase.kind === 'current' && (
            <span className="text-[11px]" style={{ color: theme.subtext }}>
              Установлена последняя версия.
            </span>
          )}
          {updatePhase.kind === 'available' && (
            <span className="text-[11px]" style={{ color: theme.text }}>
              Доступна версия {updatePhase.info.version}.
            </span>
          )}
          {updatePhase.kind === 'ready' && (
            <span className="text-[11px]" style={{ color: theme.text }}>
              Версия {updatePhase.info.version} загружена — применится при перезапуске.
            </span>
          )}
          {updatePhase.kind === 'error' && (
            <span className="text-[11px] text-red-400 leading-snug">{updatePhase.message}</span>
          )}

          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={handleCheckUpdate}
              disabled={updatePhase.kind === 'checking' || updatePhase.kind === 'installing'}
              className="py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 hover:bg-white/5 disabled:opacity-40 transition-all"
              style={{ borderColor: theme.border }}
            >
              <RefreshCw size={13} />
              <span>Проверить</span>
            </button>

            <button
              type="button"
              onClick={handleInstallUpdate}
              disabled={updatePhase.kind !== 'available'}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold flex items-center justify-center space-x-1.5 disabled:opacity-30 transition-all"
              style={{ backgroundColor: '#fafafa', color: '#0a0a0a' }}
            >
              <Download size={13} />
              <span>
                {updatePhase.kind === 'downloading'
                  ? `Загрузка ${updatePercent}%`
                  : updatePhase.kind === 'installing'
                  ? 'Устанавливаем…'
                  : 'Обновить'}
              </span>
            </button>
          </div>
        </div>

        {/* Accent Selection */}
        <div className="flex flex-col space-y-2 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.subtext }}>
            Цветовой акцент
          </label>
          <div className="grid grid-cols-4 gap-2">
            {(Object.keys(ACCENTS) as AccentId[]).map((accId) => {
              const color = ACCENTS[accId];
              const isSelected = (accentKey ?? DEFAULT_ACCENT) === accId;
              return (
                <button
                  key={accId}
                  type="button"
                  onClick={() => {
                    soundService.playUiClick();
                    applyAccent(accId);
                    onSelectAccent?.(accId);
                  }}
                  className="p-2 rounded-xl border flex items-center gap-2 text-left transition-all"
                  style={{
                    borderColor: isSelected ? 'rgba(255,255,255,0.38)' : theme.border,
                    backgroundColor: isSelected ? 'rgba(255,255,255,0.06)' : 'transparent',
                  }}
                  title={accId}
                >
                  <span
                    className="w-5 h-5 rounded-full shrink-0 border border-white/10 flex items-center justify-center"
                    style={{ backgroundColor: color }}
                  >
                    {isSelected && <Check size={12} className="text-black" strokeWidth={3} />}
                  </span>
                  <span className="text-[11px] capitalize font-medium min-w-0" style={{ color: theme.text }}>
                    {accId}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-col space-y-2 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.subtext }}>
            Сброс внешнего вида
          </label>
          <button
            type="button"
            onClick={handleResetUI}
            className="w-full py-2.5 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 hover:bg-white/5 active:scale-98 transition-all"
            style={{ borderColor: theme.border }}
          >
            <RotateCcw size={13} />
            <span>Сбросить кастомный UI к дефолту</span>
          </button>
        </div>

          {/* Autostart with the operating system */}
        <div className="flex flex-col space-y-2 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.subtext }}>
            Запуск вместе с системой
          </label>
          <button
            type="button"
            onClick={async () => {
              soundService.playUiClick();
              try {
                if (autostartEnabled) {
                  await disable();
                  setAutostartEnabled(false);
                } else {
                  await enable();
                  setAutostartEnabled(true);
                }
              } catch (e) {
                console.warn('autostart toggle failed:', e);
              }
            }}
            className="p-2.5 rounded-xl border flex items-center justify-between text-xs transition-all"
            style={{
              borderColor: autostartEnabled ? 'rgba(255,255,255,0.38)' : theme.border,
              backgroundColor: autostartEnabled ? 'rgba(255,255,255,0.06)' : 'transparent',
              color: theme.text,
            }}
          >
            <span>Запускать Alarmer при входе в систему</span>
            <span className="text-[10px] font-bold opacity-80">{autostartEnabled ? 'ВКЛ' : 'ВЫКЛ'}</span>
          </button>
          <p className="text-[11px] opacity-60 leading-relaxed">
            Приложение стартует свёрнутым в трей — будильники срабатывают даже без открытого окна.
          </p>
        </div>

        {/* Global hotkeys reference */}
        <div className="flex flex-col space-y-2 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.subtext }}>
            Горячие клавиши (работают из любой программы)
          </label>
          <div className="flex flex-col space-y-1 text-[11px]" style={{ color: theme.subtext }}>
            <div className="flex justify-between"><span>Пауза / продолжить</span><span className="font-mono" style={{ color: theme.text }}>Alt + S</span></div>
            <div className="flex justify-between"><span>Сбросить таймер</span><span className="font-mono" style={{ color: theme.text }}>Alt + R</span></div>
            <div className="flex justify-between"><span>Прибавить 5 минут</span><span className="font-mono" style={{ color: theme.text }}>Alt + Shift + U</span></div>
            <div className="flex justify-between"><span>Убавить 5 минут</span><span className="font-mono" style={{ color: theme.text }}>Alt + Shift + D</span></div>
          </div>
        </div>

      {/* Data Management: Export / Import JSON */}
        <div className="flex flex-col space-y-2 border-t pt-4" style={{ borderColor: theme.border }}>
          <label className="text-xs font-bold uppercase tracking-wider" style={{ color: theme.subtext }}>
            Управление данными (Резервная копия)
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={async () => {
                const data = await StoreService.exportJson();
                const blob = new Blob([data], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `alarmer-backup-${new Date().toISOString().slice(0, 10)}.json`;
                a.click();
                URL.revokeObjectURL(url);
              }}
              className="py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 hover:bg-white/5 active:scale-98 transition-all"
              style={{ borderColor: theme.border }}
            >
              <Download size={13} />
              <span>Экспорт JSON</span>
            </button>

            <label
              className="py-2.5 px-3 rounded-xl border text-xs font-semibold flex items-center justify-center space-x-1.5 hover:bg-white/5 active:scale-98 transition-all cursor-pointer"
              style={{ borderColor: theme.border }}
            >
              <Upload size={13} />
              <span>Импорт JSON</span>
              <input
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = async (event) => {
                    try {
                      setImportError(null);
                      await StoreService.importJson(String(event.target?.result ?? ''));
                      window.location.reload();
                    } catch (err) {
                      // Surface a readable message instead of silently resetting state.
                      setImportError(err instanceof Error ? err.message : 'Не удалось импортировать файл');
                    }
                  };
                  reader.readAsText(file);
                }}
              />
            </label>
          </div>
          {importError && (
            <p className="text-[11px] text-red-400 leading-snug">Ошибка импорта: {importError}</p>
          )}
        </div>
        </div>
      )}
    </div>
  );
};
