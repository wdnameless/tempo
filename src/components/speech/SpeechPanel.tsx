import React, { useState, useEffect } from 'react';
import {
  type SpeechConfig,
  loadSpeechConfig,
  saveSpeechConfig,
  subscribeSpeechConfig,
  DEFAULT_SPEECH_CONFIG,
} from '../../services/speechSettings';
import { setEngine, sttErrorKey, type SttEngineKind } from '../../services/stt';
import { onSttEvent } from '../../services/sttEvents';
import { I18nService, type Translations } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import {
  ShieldAlert,
  Layers,
  Keyboard,
  Sparkles,
  Volume2,
  FileText,
  History,
  Sliders,
} from 'lucide-react';

import { ModelLibrary } from './ModelLibrary';
import { PttSettings } from './PttSettings';
import { AudioSettings } from './AudioSettings';
import { DeliverySettings } from './DeliverySettings';
import { FeedbackSettings } from './FeedbackSettings';
import { LanguageSettings } from './LanguageSettings';
import { CustomWordsSettings } from './CustomWordsSettings';
import { HistoryPanel } from './HistoryPanel';
import { PostProcessSettings } from './PostProcessSettings';
import { SpeechDebug } from './SpeechDebug';
import { AdvancedSettings } from './AdvancedSettings';
import { SpeechOnboarding } from './SpeechOnboarding';

export interface SpeechPanelProps {
  config?: SpeechConfig;
  onChange?: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type SpeechSubTab =
  | 'models'
  | 'keys'
  | 'animation'
  | 'sound'
  | 'text'
  | 'history'
  | 'advanced'
  // Compatibility aliases
  | 'ptt'
  | 'audio'
  | 'delivery'
  | 'feedback'
  | 'language'
  | 'postprocess'
  | 'debug';

interface SubSectionDef {
  id: SpeechSubTab;
  labelKey: keyof Translations;
  icon: React.ReactNode;
  testId: string;
  aliases?: string[];
}

const SUB_SECTIONS: SubSectionDef[] = [
  { id: 'models', labelKey: 'sttTabModels', icon: <Layers className="w-4 h-4" />, testId: 'speech-tab-models' },
  { id: 'keys', labelKey: 'sttTabKeys', icon: <Keyboard className="w-4 h-4" />, testId: 'speech-tab-keys', aliases: ['ptt'] },
  { id: 'animation', labelKey: 'sttTabAnimation', icon: <Sparkles className="w-4 h-4" />, testId: 'speech-tab-animation' },
  { id: 'sound', labelKey: 'sttTabSound', icon: <Volume2 className="w-4 h-4" />, testId: 'speech-tab-sound', aliases: ['audio', 'feedback'] },
  { id: 'text', labelKey: 'sttTabText', icon: <FileText className="w-4 h-4" />, testId: 'speech-tab-text', aliases: ['delivery', 'language', 'postprocess'] },
  { id: 'history', labelKey: 'sttTabHistory', icon: <History className="w-4 h-4" />, testId: 'speech-tab-history' },
  { id: 'advanced', labelKey: 'sttTabAdvanced', icon: <Sliders className="w-4 h-4" />, testId: 'speech-tab-advanced', aliases: ['debug'] },
];

function getTranslation(t: Translations, key: string): string | undefined {
  // SAFETY: sttErrorKey maps to Translations keys
  return (t as unknown as Record<string, string>)[key];
}

export const SpeechPanel: React.FC<SpeechPanelProps> = ({
  config: propConfig,
  onChange: propOnChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [localConfig, setLocalConfig] = useState<SpeechConfig>(() => {
    try {
      return loadSpeechConfig();
    } catch {
      return DEFAULT_SPEECH_CONFIG;
    }
  });

  const isControlled = propConfig !== undefined;
  const config = propConfig ?? localConfig;

  useEffect(() => {
    if (isControlled) return;
    return subscribeSpeechConfig((cfg) => {
      setLocalConfig(cfg);
    });
  }, [isControlled]);

  const handleChange = (patch: Partial<SpeechConfig>) => {
    if (propOnChange) {
      propOnChange(patch);
    }
    if (!isControlled) {
      setLocalConfig((prev) => ({ ...prev, ...patch }));
      void saveSpeechConfig(patch);
    }
  };

  const [activeTab, setActiveTab] = useState<SpeechSubTab>('models');
  const [prevOnboarded, setPrevOnboarded] = useState(config.onboarded);
  const [dismissedOnboarding, setDismissedOnboarding] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (config.onboarded !== prevOnboarded) {
    setPrevOnboarded(config.onboarded);
    if (!config.onboarded) {
      setDismissedOnboarding(false);
    }
  }

  // Subscribe to error events from backend
  useEffect(() => {
    const unsub = onSttEvent((e) => {
      if (e.type === 'speech-error') {
        const key = sttErrorKey(e.code);
        const translated = getTranslation(t, key) ?? e.message;
        setActionError(translated);
      } else if (e.type === 'model-failed') {
        const key = sttErrorKey(e.error);
        const translated = getTranslation(t, key) ?? e.error;
        setActionError(translated);
      }
    });
    return () => {
      unsub();
    };
  }, [t]);

  const handleSelectEngine = async (nextEngine: SttEngineKind) => {
    handleChange({ engine: nextEngine });
    try {
      await setEngine(nextEngine, config.modelId || null);
    } catch (err) {
      const key = sttErrorKey(err);
      const translated = getTranslation(t, key) ?? String(err);
      setActionError(translated);
    }
  };
  const engineValue: SttEngineKind = config.engine === 'cloud' ? 'cloud' : 'local';

  // Normalize active section from alias
  const normalizedActiveSection =
    activeTab === 'ptt'
      ? 'keys'
      : activeTab === 'audio' || activeTab === 'feedback'
      ? 'sound'
      : activeTab === 'delivery' || activeTab === 'language' || activeTab === 'postprocess'
      ? 'text'
      : activeTab === 'debug'
      ? 'advanced'
      : activeTab;

  return (
    <div
      data-testid="speech-panel"
      className="flex flex-col h-full overflow-hidden"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Onboarding Dialog */}
      <SpeechOnboarding
        open={!config.onboarded && !dismissedOnboarding}
        config={config}
        onChange={handleChange}
        onClose={() => setDismissedOnboarding(true)}
        onComplete={() => {
          handleChange({ onboarded: true });
        }}
      />

      {/* Header bar (macOS System Settings style) */}
      <div
        className="flex items-center justify-between px-6 py-4 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div>
          <h1 className="text-xl font-bold tracking-tight">{t.sttScreenTitle}</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t.sttScreenSubtitle}
          </p>
        </div>

        {/* Global enable toggle */}
        <label className="flex items-center gap-3 cursor-pointer shrink-0 select-none">
          <div className="flex flex-col text-right">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechEnable}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechEnableHint}
            </span>
          </div>
          <Toggle
            checked={config.enabled}
            onChange={(val) => handleChange({ enabled: val })}
            disabled={disabled}
          />
          <input
            type="checkbox"
            aria-label={t.settingsSpeechEnable}
            checked={config.enabled}
            disabled={disabled}
            onChange={(e) => handleChange({ enabled: e.target.checked })}
            className="sr-only"
          />
        </label>
      </div>

      {/* Body: Left column sidebar + Main content pane */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Navigation sidebar (macOS System Settings style) */}
        <aside
          className="w-60 shrink-0 border-r overflow-y-auto p-3 flex flex-col gap-1 select-none"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
          role="tablist"
          aria-orientation="vertical"
          aria-label={t.sttScreenTitle}
        >
          {SUB_SECTIONS.map((sec) => {
            const isActive = normalizedActiveSection === sec.id;
            return (
              <React.Fragment key={sec.id}>
                <button
                  role="tab"
                  id={`tab-stt-${sec.id}`}
                  aria-selected={isActive}
                  aria-controls={`section-stt-${sec.id}`}
                  data-testid={sec.testId}
                  onClick={() => setActiveTab(sec.id)}
                  className="flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm font-medium transition-colors text-left w-full cursor-pointer hover:bg-white/5"
                  style={{
                    backgroundColor: isActive ? 'var(--elevated)' : 'transparent',
                    color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  <span className="shrink-0">{sec.icon}</span>
                  <span className="truncate">{t[sec.labelKey]}</span>
                </button>
                {/* Render alias buttons for backwards test compatibility */}
                {sec.aliases?.map((alias) => (
                  <button
                    key={alias}
                    type="button"
                    data-testid={`speech-tab-${alias}`}
                    onClick={() => setActiveTab(sec.id)}
                    className="sr-only"
                    tabIndex={-1}
                    aria-hidden="true"
                  />
                ))}
              </React.Fragment>
            );
          })}
        </aside>

        {/* Main Content Pane */}
        <div
          className="flex-1 overflow-y-auto p-6 min-w-0 space-y-6"
          style={{ backgroundColor: 'var(--bg)' }}
        >
          {/* Action Error Banner */}
          {actionError && (
            <div
              data-testid="stt-action-error"
              className="p-3 rounded-md border text-xs flex items-start gap-2 bg-destructive/10 border-destructive/30 text-destructive"
            >
              <ShieldAlert className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="flex-1">
                <span className="font-medium">{actionError}</span>
              </div>
              <button
                type="button"
                onClick={() => setActionError(null)}
                className="text-xs hover:underline shrink-0"
              >
                ✕
              </button>
            </div>
          )}

          {/* 1. Models Sub-section */}
          {normalizedActiveSection === 'models' && (
            <section
              id="section-stt-models"
              role="tabpanel"
              aria-label={t.sttTabModels}
              data-testid="speech-panel-models"
              className="space-y-4"
            >
              {/* STT Engine Selector */}
              <div
                className="flex items-center justify-between p-4 rounded-[10px] border"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div>
                  <label className="block text-sm font-medium" style={{ color: 'var(--text)' }}>
                    {t.sttEngineLocal} / {t.sttEngineCloud}
                  </label>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                    {t.settingsSpeechHint}
                  </p>
                </div>
                <Segmented<SttEngineKind>
                  value={engineValue}
                  options={[
                    { value: 'local', label: t.sttEngineLocal },
                    { value: 'cloud', label: t.sttEngineCloud },
                  ]}
                  onChange={handleSelectEngine}
                  disabled={disabled}
                />
              </div>

              {/* Cloud Mode Explanation */}
              {engineValue === 'cloud' && (
                <div
                  className="p-4 rounded-[10px] border text-xs"
                  style={{ borderColor: 'var(--border)', backgroundColor: 'var(--elevated)' }}
                >
                  <p style={{ color: 'var(--text-muted)' }}>
                    {t.settingsSpeechHint}
                  </p>
                </div>
              )}

              {/* Local Model Library */}
              {engineValue === 'local' && (
                <ModelLibrary
                  activeModelId={config.modelId}
                  onSelectModel={(modelId) => handleChange({ modelId })}
                  disabled={disabled}
                />
              )}
            </section>
          )}

          {/* 2. Keys Sub-section */}
          {normalizedActiveSection === 'keys' && (
            <section
              id="section-stt-keys"
              role="tabpanel"
              aria-label={t.sttTabKeys}
              data-testid="speech-panel-keys"
              className="space-y-4"
            >
              <div data-testid="speech-panel-ptt">
                <PttSettings config={config} onChange={handleChange} disabled={disabled} />
              </div>
            </section>
          )}

          {/* 3. Animation Sub-section */}
          {normalizedActiveSection === 'animation' && (
            <section
              id="section-stt-animation"
              role="tabpanel"
              aria-label={t.sttTabAnimation}
              data-testid="speech-panel-animation"
              className="space-y-4"
            >
              <div
                className="p-5 rounded-lg border space-y-5"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                      {t.sttAnimationWave}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {t.sttAnimationWaveDesc}
                    </p>
                  </div>
                  <Toggle
                    checked={config.dictationWave ?? true}
                    onChange={(val) => handleChange({ dictationWave: val })}
                    disabled={disabled}
                  />
                </div>

                {(config.dictationWave ?? true) && (
                  <div className="space-y-2 pt-3 border-t border-[var(--border)]">
                    <div className="flex items-center justify-between">
                      <label className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                        {t.sttAnimationWaveBars}
                      </label>
                      <span className="text-xs font-mono font-bold" style={{ color: 'var(--accent)' }}>
                        {config.dictationWaveBars ?? 24}
                      </span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.sttAnimationWaveBarsDesc}
                    </p>
                    <Slider
                      value={config.dictationWaveBars ?? 24}
                      min={12}
                      max={48}
                      step={2}
                      onChange={(val) => handleChange({ dictationWaveBars: val })}
                      disabled={disabled}
                    />
                  </div>
                )}

                <div className="flex items-start justify-between gap-4 pt-3 border-t border-[var(--border)]">
                  <div>
                    <h3 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                      {t.sttAnimationOverlay}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                      {t.sttAnimationOverlayDesc}
                    </p>
                  </div>
                  <Toggle
                    checked={config.overlayEnabled ?? true}
                    onChange={(val) => handleChange({ overlayEnabled: val })}
                    disabled={disabled}
                  />
                </div>
              </div>
            </section>
          )}

          {/* 4. Sound Sub-section */}
          {normalizedActiveSection === 'sound' && (
            <section
              id="section-stt-sound"
              role="tabpanel"
              aria-label={t.sttTabSound}
              data-testid="speech-panel-sound"
              className="space-y-6"
            >
              <div data-testid="speech-panel-feedback">
                <FeedbackSettings config={config} onChange={handleChange} disabled={disabled} />
              </div>
              <div data-testid="speech-panel-audio">
                <AudioSettings config={config} onChange={handleChange} disabled={disabled} />
              </div>
            </section>
          )}

          {/* 5. Text Sub-section */}
          {normalizedActiveSection === 'text' && (
            <section
              id="section-stt-text"
              role="tabpanel"
              aria-label={t.sttTabText}
              data-testid="speech-panel-text"
              className="space-y-6"
            >
              <div data-testid="speech-panel-delivery">
                <DeliverySettings config={config} onChange={handleChange} disabled={disabled} />
              </div>
              <div data-testid="speech-panel-language" className="space-y-4">
                <LanguageSettings config={config} onChange={handleChange} disabled={disabled} />
                <CustomWordsSettings config={config} onChange={handleChange} disabled={disabled} />
              </div>
              <div data-testid="speech-panel-postprocess">
                <PostProcessSettings config={config} onChange={handleChange} disabled={disabled} />
              </div>
            </section>
          )}

          {/* 6. History Sub-section */}
          {normalizedActiveSection === 'history' && (
            <section
              id="section-stt-history"
              role="tabpanel"
              aria-label={t.sttTabHistory}
              data-testid="speech-panel-history"
            >
              <HistoryPanel config={config} onChange={handleChange} disabled={disabled} />
            </section>
          )}

          {/* 7. Advanced Sub-section */}
          {normalizedActiveSection === 'advanced' && (
            <section
              id="section-stt-advanced"
              role="tabpanel"
              aria-label={t.sttTabAdvanced}
              data-testid="speech-panel-advanced"
              className="space-y-6"
            >
              <AdvancedSettings config={config} onChange={handleChange} disabled={disabled} />
              <div data-testid="speech-panel-debug">
                <SpeechDebug config={config} onChange={handleChange} disabled={disabled} />
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpeechPanel;
