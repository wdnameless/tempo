import React, { useState } from 'react';
import type { SpeechConfig, SoundTheme } from '../../services/speechSettings';
import { playTestSound } from '../../services/stt';
import { I18nService } from '../../services/i18n';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';
import { Volume2, Play } from 'lucide-react';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type FeedbackSettingsProps = SpeechSectionProps;

export const FeedbackSettings: React.FC<FeedbackSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [playingStart, setPlayingStart] = useState(false);
  const [playingStop, setPlayingStop] = useState(false);

  const themeOptions: { value: SoundTheme; label: string }[] = [
    { value: 'default', label: t.settingsSpeechSoundThemeDefault || 'Default' },
    { value: 'soft', label: t.settingsSpeechSoundThemeSoft || 'Soft' },
    { value: 'mechanical', label: t.settingsSpeechSoundThemeMechanical || 'Mechanical' },
  ];

  const currentTheme: SoundTheme =
    config.soundTheme === 'soft' || config.soundTheme === 'mechanical'
      ? config.soundTheme
      : 'default';

  const handlePlayTest = async (kind: 'start' | 'stop') => {
    if (kind === 'start') {
      setPlayingStart(true);
      try {
        await playTestSound('start');
      } catch (err) {
        console.error('Failed to play test sound (start):', err);
      } finally {
        setTimeout(() => setPlayingStart(false), 400);
      }
    } else {
      setPlayingStop(true);
      try {
        await playTestSound('stop');
      } catch (err) {
        console.error('Failed to play test sound (stop):', err);
      } finally {
        setTimeout(() => setPlayingStop(false), 400);
      }
    }
  };

  return (
    <div data-testid="feedback-settings" className="space-y-4">
      {/* Sound Feedback Master Toggle */}
      <div
        className="p-2 rounded-[10px] border divide-y divide-[var(--border)]"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label={t.settingsSpeechFeedbackEnabled}
          description={t.settingsSpeechFeedbackEnabledDesc}
          control={
            <div data-testid="feedback-enabled-toggle">
              <Toggle
                checked={config.feedbackEnabled}
                onChange={(val) => onChange({ feedbackEnabled: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />
      </div>

      {/* Volume Slider */}
      <div
        className="p-4 rounded-[10px] border space-y-2"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          opacity: config.feedbackEnabled ? 1 : 0.5,
        }}
      >
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-1.5 font-medium" style={{ color: 'var(--text)' }}>
            <Volume2 className="w-4 h-4 text-primary" />
            <span>{t.settingsSpeechFeedbackVolume}</span>
          </div>
          <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
            {Math.round(config.feedbackVolume * 100)}%
          </span>
        </div>
        <div data-testid="feedback-volume-slider">
          <Slider
            value={config.feedbackVolume}
            min={0}
            max={1}
            step={0.05}
            onChange={(val) => onChange({ feedbackVolume: val })}
            minLabel="0%"
            maxLabel="100%"
            disabled={disabled || !config.feedbackEnabled}
          />
        </div>
      </div>

      {/* Sound Theme Segmented Control */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          opacity: config.feedbackEnabled ? 1 : 0.5,
        }}
      >
        <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          {t.settingsSpeechSoundTheme}
        </div>
        <div data-testid="sound-theme-segmented">
          <Segmented<SoundTheme>
            value={currentTheme}
            options={themeOptions}
            onChange={(val) => onChange({ soundTheme: val })}
            disabled={disabled || !config.feedbackEnabled}
          />
        </div>
      </div>

      {/* Play Test Sound Buttons */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          opacity: config.feedbackEnabled ? 1 : 0.5,
        }}
      >
        <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          {t.settingsSpeechTabFeedback}
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            data-testid="play-test-start"
            disabled={disabled || !config.feedbackEnabled || playingStart}
            onClick={() => handlePlayTest('start')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-[var(--elevated)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <Play className={`w-3.5 h-3.5 text-primary ${playingStart ? 'animate-pulse' : ''}`} />
            <span>{t.settingsSpeechPlayTestStart}</span>
          </button>

          <button
            type="button"
            data-testid="play-test-stop"
            disabled={disabled || !config.feedbackEnabled || playingStop}
            onClick={() => handlePlayTest('stop')}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-[var(--elevated)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <Play className={`w-3.5 h-3.5 text-primary ${playingStop ? 'animate-pulse' : ''}`} />
            <span>{t.settingsSpeechPlayTestStop}</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default FeedbackSettings;
