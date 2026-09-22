import React, { useState, useEffect } from 'react';
import type { SpeechConfig } from '../../services/speechSettings';
import { setEngine, sttErrorKey, type SttEngineKind } from '../../services/stt';
import { onSttEvent } from '../../services/sttEvents';
import { I18nService, type Translations } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Segmented } from '../ui/Segmented';
import { ShieldAlert } from 'lucide-react';

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
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type SpeechSubTab =
  | 'models'
  | 'ptt'
  | 'audio'
  | 'delivery'
  | 'feedback'
  | 'language'
  | 'history'
  | 'postprocess'
  | 'advanced'
  | 'debug';

interface TabDef {
  id: SpeechSubTab;
  labelKey: keyof Translations;
}

const TABS: TabDef[] = [
  { id: 'models', labelKey: 'settingsSpeechTabModels' },
  { id: 'ptt', labelKey: 'settingsSpeechTabPtt' },
  { id: 'audio', labelKey: 'settingsSpeechTabAudio' },
  { id: 'delivery', labelKey: 'settingsSpeechTabDelivery' },
  { id: 'feedback', labelKey: 'settingsSpeechTabFeedback' },
  { id: 'language', labelKey: 'settingsSpeechTabLanguage' },
  { id: 'history', labelKey: 'settingsSpeechTabHistory' },
  { id: 'postprocess', labelKey: 'settingsSpeechTabPostprocess' },
  { id: 'advanced', labelKey: 'settingsSpeechTabAdvanced' },
  { id: 'debug', labelKey: 'settingsSpeechTabDebug' },
];

function getTranslation(t: Translations, key: string): string | undefined {
  // SAFETY: sttErrorKey maps to Translations keys
  return (t as unknown as Record<string, string>)[key];
}

export const SpeechPanel: React.FC<SpeechPanelProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
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
    onChange({ engine: nextEngine });
    try {
      await setEngine(nextEngine, config.modelId || null);
    } catch (err) {
      const key = sttErrorKey(err);
      const translated = getTranslation(t, key) ?? String(err);
      setActionError(translated);
    }
  };
  const engineValue: SttEngineKind = config.engine === 'cloud' ? 'cloud' : 'local';

  return (
    <div data-testid="speech-panel" className="space-y-6">
      {/* Onboarding Dialog */}
      <SpeechOnboarding
        open={!config.onboarded && !dismissedOnboarding}
        config={config}
        onChange={onChange}
        onClose={() => setDismissedOnboarding(true)}
        onComplete={() => {
          onChange({ onboarded: true });
        }}
      />

      {/* Main Header Card with Enable Toggle and Sub-Tabs */}
      <div
        className="p-5 rounded-lg border space-y-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold" style={{ color: 'var(--text)' }}>
              {t.settingsSpeech}
            </h2>
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechHint}
            </p>
          </div>

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
              onChange={(val) => onChange({ enabled: val })}
              disabled={disabled}
            />
            <input
              type="checkbox"
              aria-label={t.settingsSpeechEnable}
              checked={config.enabled}
              disabled={disabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="sr-only"
            />
          </label>
        </div>

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

        {/* Sub-tab Navigation */}
        <div
          className="flex items-center gap-1.5 overflow-x-auto pt-3 border-t border-[var(--border)] no-scrollbar"
          role="tablist"
          aria-label={t.settingsSpeech}
        >
          {TABS.map((tab) => {
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={isSelected}
                data-testid={`speech-tab-${tab.id}`}
                onClick={() => setActiveTab(tab.id)}
                className={`px-3 py-1.5 text-xs rounded-md font-medium whitespace-nowrap transition-all cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${
                  isSelected
                    ? 'shadow-xs'
                    : 'hover:text-[var(--text)]'
                }`}
                style={{
                  backgroundColor: isSelected ? 'var(--elevated)' : 'transparent',
                  color: isSelected ? 'var(--text)' : 'var(--text-muted)',
                  border: isSelected ? '1px solid var(--border)' : '1px solid transparent',
                  fontWeight: isSelected ? 600 : 500,
                }}
              >
                {t[tab.labelKey] as string}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tab Panels */}
      <div className="space-y-4">
        {/* 1. Models Tab */}
        {activeTab === 'models' && (
          <div data-testid="speech-panel-models" className="space-y-4">
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
                onSelectModel={(modelId) => onChange({ modelId })}
                disabled={disabled}
              />
            )}
          </div>
        )}

        {/* 2. PTT / Hotkeys Tab */}
        {activeTab === 'ptt' && (
          <div data-testid="speech-panel-ptt">
            <PttSettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 3. Audio & VAD Tab */}
        {activeTab === 'audio' && (
          <div data-testid="speech-panel-audio">
            <AudioSettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 4. Delivery Tab */}
        {activeTab === 'delivery' && (
          <div data-testid="speech-panel-delivery">
            <DeliverySettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 5. Feedback Tab */}
        {activeTab === 'feedback' && (
          <div data-testid="speech-panel-feedback">
            <FeedbackSettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 6. Language & Vocabulary Tab */}
        {activeTab === 'language' && (
          <div data-testid="speech-panel-language" className="space-y-4">
            <LanguageSettings config={config} onChange={onChange} disabled={disabled} />
            <CustomWordsSettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 7. History Tab */}
        {activeTab === 'history' && (
          <div data-testid="speech-panel-history">
            <HistoryPanel config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 8. Post-process Tab */}
        {activeTab === 'postprocess' && (
          <div data-testid="speech-panel-postprocess">
            <PostProcessSettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}
        {/* 9. Advanced Tab */}
        {activeTab === 'advanced' && (
          <div data-testid="speech-panel-advanced">
            <AdvancedSettings config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}

        {/* 10. Debug Tab */}
        {activeTab === 'debug' && (
          <div data-testid="speech-panel-debug">
            <SpeechDebug config={config} onChange={onChange} disabled={disabled} />
          </div>
        )}
      </div>
    </div>
  );
};

export default SpeechPanel;
