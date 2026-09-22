import React from 'react';
import type { SpeechConfig, PasteMethod, ClipboardBehavior } from '../../services/speechSettings';
import { I18nService } from '../../services/i18n';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type DeliverySettingsProps = SpeechSectionProps;

export const DeliverySettings: React.FC<DeliverySettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();

  const pasteMethodOptions: { value: PasteMethod; label: string }[] = [
    { value: 'ctrl_v', label: t.settingsSpeechPasteMethodCtrlV || 'Ctrl+V' },
    { value: 'shift_insert', label: t.settingsSpeechPasteMethodShiftInsert || 'Shift+Insert' },
    { value: 'direct', label: t.settingsSpeechPasteMethodDirect || 'Direct' },
  ];

  const clipboardBehaviorOptions: { value: ClipboardBehavior; label: string }[] = [
    { value: 'restore', label: t.settingsSpeechClipboardRestore || 'Restore' },
    { value: 'keep', label: t.settingsSpeechClipboardKeep || 'Keep' },
  ];

  const currentPasteMethod: PasteMethod =
    config.pasteMethod === 'shift_insert' || config.pasteMethod === 'direct'
      ? config.pasteMethod
      : 'ctrl_v';

  const currentClipboardBehavior: ClipboardBehavior =
    config.clipboardBehavior === 'keep' ? 'keep' : 'restore';

  return (
    <div data-testid="delivery-settings" className="space-y-4">
      {/* Paste Method */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {t.settingsSpeechPasteMethod}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {currentPasteMethod === 'ctrl_v'
              ? 'Ctrl+V shortcut for standard text paste'
              : currentPasteMethod === 'shift_insert'
                ? 'Shift+Insert for legacy and terminal windows'
                : 'Direct character typing emulation'}
          </div>
        </div>
        <div data-testid="paste-method-segmented">
          <Segmented<PasteMethod>
            value={currentPasteMethod}
            options={pasteMethodOptions}
            onChange={(val) => onChange({ pasteMethod: val })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Clipboard Behavior */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {t.settingsSpeechClipboardBehavior}
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {currentClipboardBehavior === 'restore'
              ? t.settingsSpeechClipboardRestore
              : t.settingsSpeechClipboardKeep}
          </div>
        </div>
        <div data-testid="clipboard-behavior-segmented">
          <Segmented<ClipboardBehavior>
            value={currentClipboardBehavior}
            options={clipboardBehaviorOptions}
            onChange={(val) => onChange({ clipboardBehavior: val })}
            disabled={disabled}
          />
        </div>
      </div>

      {/* Delays */}
      <div
        className="p-4 rounded-[10px] border space-y-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechPasteDelayBefore}
            </span>
            <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
              {config.pasteDelayMs} ms
            </span>
          </div>
          <div data-testid="paste-delay-before-slider">
            <Slider
              value={config.pasteDelayMs}
              min={0}
              max={500}
              step={5}
              onChange={(val) => onChange({ pasteDelayMs: val })}
              minLabel="0ms"
              maxLabel="500ms"
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechPasteDelayAfter}
            </span>
            <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
              {config.pasteDelayAfterMs} ms
            </span>
          </div>
          <div data-testid="paste-delay-after-slider">
            <Slider
              value={config.pasteDelayAfterMs}
              min={0}
              max={500}
              step={5}
              onChange={(val) => onChange({ pasteDelayAfterMs: val })}
              minLabel="0ms"
              maxLabel="500ms"
              disabled={disabled}
            />
          </div>
        </div>
      </div>

      {/* Trailing Space & Auto-Submit */}
      <div
        className="p-2 rounded-[10px] border divide-y divide-[var(--border)]"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
        }}
      >
        <Row
          label={t.settingsSpeechAppendSpace}
          control={
            <div data-testid="append-space-toggle">
              <Toggle
                checked={config.appendSpace}
                onChange={(val) => onChange({ appendSpace: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />
        <Row
          label={t.settingsSpeechAutoSubmit}
          control={
            <div data-testid="auto-submit-toggle">
              <Toggle
                checked={config.autoSubmit}
                onChange={(val) => onChange({ autoSubmit: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export default DeliverySettings;
