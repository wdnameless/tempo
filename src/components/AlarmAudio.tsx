import React, { useState, useEffect, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import { I18nService } from '../services/i18n';
import {
  getAlarmAudioPrefs,
  setAlarmAudioPrefs,
  type AlarmAudioPrefs,
  DEFAULT_ALARM_AUDIO_PREFS,
} from '../services/alarmAudio';
import { Card, Toggle } from './ui';

export interface AlarmAudioProps {
  onAudioPrefsChange?: (prefs: AlarmAudioPrefs) => void;
  className?: string;
}

export const AlarmAudio: React.FC<AlarmAudioProps> = ({ onAudioPrefsChange, className = '' }) => {
  const t = I18nService.t();
  const [prefs, setPrefs] = useState<AlarmAudioPrefs>(DEFAULT_ALARM_AUDIO_PREFS);

  useEffect(() => {
    let mounted = true;
    void getAlarmAudioPrefs().then((loaded) => {
      if (mounted) setPrefs(loaded);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const updatePrefs = useCallback(
    (patch: Partial<AlarmAudioPrefs>) => {
      setPrefs((prev) => {
        const next = { ...prev, ...patch };
        void setAlarmAudioPrefs(patch);
        onAudioPrefsChange?.(next);
        return next;
      });
    },
    [onAudioPrefsChange],
  );

  const handleToggleEnabled = (enabled: boolean) => {
    updatePrefs({ enabled });
  };

  const handleVolumeChange = (volume: number) => {
    updatePrefs({ volume });
  };

  return (
    <Card
      variant="surface"
      padding="sm"
      className={`flex items-center justify-between gap-3 ${className}`}
      data-testid="alarm-audio-settings"
    >
      {/* Icon & Label */}
      <div className="flex items-center gap-2 min-w-0">
        <button
          type="button"
          onClick={() => handleToggleEnabled(!prefs.enabled)}
          className="p-1 rounded-[6px] hover:bg-[var(--elevated)] transition-colors text-[var(--accent)] shrink-0 cursor-pointer"
          title={prefs.enabled ? t.settingsAlarmSoundEnabled : t.settingsAlarmSoundDisabled}
        >
          {prefs.enabled ? (
            <Volume2 className="w-4 h-4 text-[var(--accent)]" />
          ) : (
            <VolumeX className="w-4 h-4 text-[var(--text-muted)]" />
          )}
        </button>
        <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] truncate">
          {t.settingsAlarmAudio}
        </span>
      </div>

      {/* Volume slider & Toggle */}
      <div className="flex items-center gap-3 shrink-0">
        {prefs.enabled && (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={prefs.volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              aria-label={t.settingsAlarmVolume}
              data-testid="slider-alarm-volume"
              className="w-20 sm:w-28 accent-[var(--accent)] cursor-pointer h-1.5 bg-[var(--elevated)] rounded-lg"
            />
            <span className="text-[11px] font-mono tabular-nums text-[var(--text-muted)] w-8 text-right">
              {Math.round(prefs.volume * 100)}%
            </span>
          </div>
        )}
        <Toggle
          checked={prefs.enabled}
          onChange={handleToggleEnabled}
          data-testid="toggle-alarm-audio-enabled"
          aria-label={t.settingsAlarmAudio}
        />
      </div>
    </Card>
  );
};
