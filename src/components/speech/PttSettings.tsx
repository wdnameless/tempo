import React from 'react';
import type { SpeechConfig, ShortcutActivation } from '../../services/speechSettings';
import { I18nService } from '../../services/i18n';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { HotkeyRecorder } from './HotkeyRecorder';

export interface PttSettingsProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export const PttSettings: React.FC<PttSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();

  const activationOptions = [
    {
      value: 'hold_or_toggle' as ShortcutActivation,
      label: t.settingsSpeechActivationHoldOrToggle,
    },
    {
      value: 'push_to_talk' as ShortcutActivation,
      label: t.settingsSpeechActivationPushToTalk,
    },
    {
      value: 'toggle' as ShortcutActivation,
      label: t.settingsSpeechActivationToggle,
    },
  ];

  const getActivationDescription = (mode: ShortcutActivation) => {
    switch (mode) {
      case 'hold_or_toggle':
        return t.settingsSpeechActivationHoldOrToggleDesc;
      case 'push_to_talk':
        return t.settingsSpeechActivationPushToTalkDesc;
      case 'toggle':
        return t.settingsSpeechActivationToggleDesc;
    }
  };

  return (
    <div className="space-y-4">
      {/* Activation Mode */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {t.settingsSpeechActivationMode}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {getActivationDescription(config.activation)}
          </div>
        </div>

        <Segmented<ShortcutActivation>
          value={config.activation}
          options={activationOptions}
          onChange={(val) => onChange({ activation: val })}
          disabled={disabled}
        />
      </div>

      {/* Dictation Hotkey */}
      <div
        className="p-4 rounded-[10px] border space-y-2"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechHotkey}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechEnableHint}
            </div>
          </div>

          <HotkeyRecorder
            value={config.hotkey}
            onChange={(hotkey) => onChange({ hotkey })}
            placeholder={t.settingsSpeechHotkeyPlaceholder}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Cancel Hotkey */}
      <div
        className="p-4 rounded-[10px] border space-y-2"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechCancelHotkey}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.dictationIndicatorCancel}
            </div>
          </div>

          <HotkeyRecorder
            value={config.cancelHotkey}
            onChange={(cancelHotkey) => onChange({ cancelHotkey })}
            placeholder={t.settingsSpeechCancelHotkeyPlaceholder}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Hold Threshold Slider (only relevant for hold_or_toggle and push_to_talk) */}
      {config.activation !== 'toggle' && (
        <div
          className="p-4 rounded-[10px] border space-y-3"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex flex-col gap-0.5">
              <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                {t.settingsSpeechHoldThreshold}
              </div>
              <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                {t.settingsSpeechHoldThresholdDesc}
              </div>
            </div>
            <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-[var(--elevated)]" style={{ color: 'var(--text)' }}>
              {config.holdThresholdMs} ms
            </span>
          </div>

          <Slider
            value={config.holdThresholdMs}
            min={100}
            max={1000}
            step={25}
            onChange={(val) => onChange({ holdThresholdMs: val })}
            minLabel="100ms"
            maxLabel="1000ms"
            disabled={disabled}
          />
        </div>
      )}
    </div>
  );
};
