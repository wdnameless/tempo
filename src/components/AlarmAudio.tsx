import React, { useState, useEffect, useCallback } from 'react';
import { Volume2, VolumeX, Play, Square, Folder, X, RefreshCw } from 'lucide-react';
import { I18nService } from '../services/i18n';
import {
  listAlarmSoundProfiles,
  getAlarmAudioPrefs,
  setAlarmAudioPrefs,
  previewAlarmSound,
  stopAlarmSound,
  pickAlarmSoundFile,
  type AlarmSoundProfile,
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
  const [profiles, setProfiles] = useState<AlarmSoundProfile[]>([]);
  const [prefs, setPrefs] = useState<AlarmAudioPrefs>(DEFAULT_ALARM_AUDIO_PREFS);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [playingProfile, setPlayingProfile] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    void listAlarmSoundProfiles().then((list) => {
      if (mounted && list.length > 0) setProfiles(list);
    });
    void getAlarmAudioPrefs().then((loaded) => {
      if (mounted) setPrefs(loaded);
    });
    return () => {
      mounted = false;
      void stopAlarmSound();
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
    if (!enabled && isPlaying) {
      void stopAlarmSound();
      setIsPlaying(false);
      setPlayingProfile(null);
    }
    updatePrefs({ enabled });
  };

  const handleVolumeChange = (volume: number) => {
    updatePrefs({ volume });
  };

  const handleSelectProfile = (profileId: string) => {
    updatePrefs({ profile: profileId });
  };

  const handlePlayPreview = async (profileId?: string, customPath?: string | null) => {
    const targetProfile = profileId ?? prefs.profile;
    const targetCustom = customPath !== undefined ? customPath : prefs.customPath;

    if (isPlaying && (playingProfile === (targetCustom || targetProfile))) {
      await stopAlarmSound();
      setIsPlaying(false);
      setPlayingProfile(null);
      return;
    }

    setIsPlaying(true);
    setPlayingProfile(targetCustom || targetProfile);
    await previewAlarmSound({
      profile: targetProfile,
      customPath: targetCustom,
      volume: prefs.volume,
    });
  };

  const handlePickCustomFile = async () => {
    const selectedPath = await pickAlarmSoundFile();
    if (selectedPath) {
      updatePrefs({ customPath: selectedPath });
    }
  };

  const handleClearCustomFile = () => {
    if (isPlaying && playingProfile === prefs.customPath) {
      void stopAlarmSound();
      setIsPlaying(false);
      setPlayingProfile(null);
    }
    updatePrefs({ customPath: '' });
  };

  const fileName = prefs.customPath
    ? prefs.customPath.split(/[/\\]/).pop() || prefs.customPath
    : null;

  return (
    <Card variant="surface" padding="md" className={`space-y-4 ${className}`} data-testid="alarm-audio-settings">
      {/* Header with Enable / Disable */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {prefs.enabled ? (
            <Volume2 className="w-4 h-4 text-[var(--accent)]" />
          ) : (
            <VolumeX className="w-4 h-4 text-[var(--text-muted)]" />
          )}
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t.settingsAlarmAudio}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            {prefs.enabled ? t.settingsAlarmSoundEnabled : t.settingsAlarmSoundDisabled}
          </span>
          <Toggle
            checked={prefs.enabled}
            onChange={handleToggleEnabled}
            data-testid="toggle-alarm-audio-enabled"
            aria-label={t.settingsAlarmAudio}
          />
        </div>
      </div>

      {prefs.enabled && (
        <>
          {/* Volume slider */}
          <div className="space-y-1.5 pt-1 border-t border-[var(--border)]">
            <div className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)]">{t.settingsAlarmVolume}</span>
              <span className="font-mono text-[var(--text)]">{Math.round(prefs.volume * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={prefs.volume}
              onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
              aria-label={t.settingsAlarmVolume}
              data-testid="slider-alarm-volume"
              className="w-full accent-[var(--accent)] cursor-pointer h-1.5 bg-[var(--elevated)] rounded-lg"
            />
          </div>

          {/* Built-in sounds selection */}
          <div className="space-y-2 pt-1 border-t border-[var(--border)]">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--text-muted)]">
                {t.settingsAlarmSoundProfile}
              </label>
              {prefs.customPath && (
                <span className="text-[10px] text-[var(--accent)] font-medium">
                  {t.settingsAlarmCustomActiveHint}
                </span>
              )}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="alarm-sound-profiles-grid">
              {profiles.map((p) => {
                const isSelected = prefs.profile === p.id && !prefs.customPath;
                const isCurrentPlaying = isPlaying && playingProfile === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-[8px] border text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)] font-medium'
                        : 'border-[var(--border)] bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-hover,var(--border))]'
                    }`}
                    onClick={() => handleSelectProfile(p.id)}
                    data-testid={`profile-item-${p.id}`}
                  >
                    <span className="truncate">{p.label}</span>
                    <button
                      type="button"
                      aria-label={`${t.settingsAlarmPreview} ${p.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePlayPreview(p.id, null);
                      }}
                      className="p-1 rounded hover:bg-white/10 text-[var(--accent)] shrink-0 transition-transform active:scale-95"
                    >
                      {isCurrentPlaying ? (
                        <Square className="w-3 h-3 fill-current" />
                      ) : (
                        <Play className="w-3 h-3 fill-current" />
                      )}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Custom sound file */}
          <div className="space-y-2 pt-1 border-t border-[var(--border)]" data-testid="custom-sound-section">
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-[var(--text-muted)]">
                {t.settingsAlarmCustomFile}
              </label>
              {prefs.customPath && (
                <button
                  type="button"
                  onClick={handleClearCustomFile}
                  className="text-xs text-[var(--accent-red,#EF4444)] hover:underline inline-flex items-center gap-1"
                  data-testid="clear-custom-sound-btn"
                >
                  <RefreshCw className="w-3 h-3" />
                  <span>{t.settingsAlarmResetToBuiltin}</span>
                </button>
              )}
            </div>

            {prefs.customPath ? (
              <div className="flex items-center gap-2 p-2 rounded-[8px] bg-[var(--elevated)] border border-[var(--border)]">
                <Folder className="w-4 h-4 text-[var(--accent)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--text)] truncate" title={prefs.customPath} data-testid="custom-sound-filename">
                    {fileName}
                  </p>
                  <p className="text-[10px] text-[var(--text-muted)] truncate" title={prefs.customPath}>
                    {prefs.customPath}
                  </p>
                </div>
                <button
                  type="button"
                  aria-label={t.settingsAlarmPreviewCustom}
                  onClick={() => void handlePlayPreview(prefs.profile, prefs.customPath)}
                  data-testid="preview-custom-sound-btn"
                  className="p-1.5 rounded-[6px] border border-[var(--border)] hover:bg-white/10 text-[var(--accent)] shrink-0"
                >
                  {isPlaying && playingProfile === prefs.customPath ? (
                    <Square className="w-3.5 h-3.5 fill-current" />
                  ) : (
                    <Play className="w-3.5 h-3.5 fill-current" />
                  )}
                </button>
                <button
                  type="button"
                  aria-label={t.settingsAlarmClearCustom}
                  onClick={handleClearCustomFile}
                  className="p-1.5 rounded-[6px] border border-[var(--border)] hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--accent-red,#EF4444)] shrink-0"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handlePickCustomFile}
                  data-testid="pick-custom-sound-btn"
                  className="px-3 py-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--elevated)] text-xs font-medium text-[var(--text)] hover:border-[var(--accent)] hover:bg-[var(--surface)] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>{t.settingsAlarmChooseFile}</span>
                </button>
                <span className="text-[11px] text-[var(--text-muted)]">
                  {t.settingsAlarmCustomFileHint}
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
};
