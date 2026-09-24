import React, { useState, useEffect } from 'react';
import {
  X,
  Plus,
  Play,
  Square,
  Folder,
  Trash2,
  Bell,
  RefreshCw,
} from 'lucide-react';
import type { ThemeColors } from '../types';
import { I18nService } from '../services/i18n';
import {
  type Alarm,
  type AlarmRepeat,
} from '../services/alarms';
import {
  listAlarmSoundProfiles,
  previewAlarmSound,
  stopAlarmSound,
  pickAlarmSoundFile,
  type AlarmSoundProfile,
  BUILTIN_ALARM_PROFILES,
} from '../services/alarmAudio';
import { soundService } from '../services/sound';
import { isTauri } from '../services/platform';
import { Card, Field } from './ui';
import { WEEKDAY_LABELS } from './Alarms';

export interface AlarmEditorSheetProps {
  isOpen: boolean;
  alarm: Alarm | null;
  onClose: () => void;
  onSave: (alarm: Alarm) => Promise<void> | void;
  onDelete?: (id: string) => Promise<void> | void;
  theme?: ThemeColors;
}

export const AlarmEditorSheet: React.FC<AlarmEditorSheetProps> = ({
  isOpen,
  alarm,
  onClose,
  onSave,
  onDelete,
}) => {
  const t = I18nService.t();

  const [profiles, setProfiles] = useState<AlarmSoundProfile[]>(BUILTIN_ALARM_PROFILES);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playingSound, setPlayingSound] = useState<string | null>(null);

  // Form states initialized from alarm or defaults
  const [label, setLabel] = useState(() => alarm?.label ?? 'Утренняя разминка');
  const [time, setTime] = useState(() => alarm?.time ?? '08:00');
  const [repeat, setRepeat] = useState<AlarmRepeat>(() => alarm?.repeat ?? 'days');
  const [days, setDays] = useState<number[]>(() =>
    alarm?.days && alarm.days.length > 0 ? alarm.days : [1, 2, 3, 4, 5],
  );
  const [date, setDate] = useState<string>(() => {
    if (alarm?.date) return alarm.date;
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [intervalMinutes, setIntervalMinutes] = useState<number>(
    () => alarm?.intervalMinutes || 60,
  );
  const [windowStart, setWindowStart] = useState<string>(
    () => alarm?.windowStart || '08:00',
  );
  const [windowEnd, setWindowEnd] = useState<string>(
    () => alarm?.windowEnd || '20:00',
  );
  const [sound, setSound] = useState<string>(() => alarm?.sound || 'gentle');
  const [note, setNote] = useState<string>(() => alarm?.note || '');

  // Load sound profiles on mount
  useEffect(() => {
    let mounted = true;
    void listAlarmSoundProfiles().then((list) => {
      if (mounted && list && list.length > 0) {
        setProfiles(list);
      }
    });
    return () => {
      mounted = false;
    };
  }, []);

  // Handle escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  // Stop preview on unmount
  useEffect(() => {
    return () => {
      void stopAlarmSound();
      soundService.stopAlarmRamp?.();
    };
  }, []);

  const toggleDay = (dayIndex: number) => {
    setDays((prev) => {
      if (prev.includes(dayIndex)) {
        if (prev.length === 1) return prev; // Do not allow empty days
        return prev.filter((d) => d !== dayIndex);
      }
      return [...prev, dayIndex].sort((a, b) => a - b);
    });
  };

  const handlePlayPreview = async (soundTarget: string, isCustom = false) => {
    if (isPlaying && playingSound === soundTarget) {
      await stopAlarmSound();
      soundService.stopAlarmRamp?.();
      setIsPlaying(false);
      setPlayingSound(null);
      return;
    }

    setIsPlaying(true);
    setPlayingSound(soundTarget);

    if (isTauri()) {
      await previewAlarmSound(
        isCustom ? { customPath: soundTarget } : { profile: soundTarget },
      );
    } else {
      if (!isCustom) {
        soundService.startAlarmRamp(soundTarget);
      }
    }
  };

  const handlePickCustomFile = async () => {
    const selectedPath = await pickAlarmSoundFile();
    if (selectedPath) {
      setSound(selectedPath);
    }
  };

  const handleClearCustomFile = () => {
    if (isPlaying && playingSound === sound) {
      void stopAlarmSound();
      soundService.stopAlarmRamp?.();
      setIsPlaying(false);
      setPlayingSound(null);
    }
    setSound('gentle');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const alarmData: Alarm = {
      id: alarm?.id || `alarm_${Date.now()}`,
      label: label.trim() || t.alarmsNew,
      time,
      repeat,
      days: repeat === 'days' ? days : [],
      date: repeat === 'date' ? date : null,
      intervalMinutes: repeat === 'interval' ? Number(intervalMinutes) || 60 : null,
      windowStart: repeat === 'interval' ? windowStart : null,
      windowEnd: repeat === 'interval' ? windowEnd : null,
      enabled: alarm ? alarm.enabled : true,
      sound: sound || 'gentle',
      voicePrompt: alarm?.voicePrompt || null,
      note: note.trim() || null,
      ...(alarm?.scheduleId ? { scheduleId: alarm.scheduleId } : {}),
    };

    await onSave(alarmData);
    onClose();
  };

  if (!isOpen) return null;

  const isCustomSound = !profiles.some((p) => p.id === sound);
  const customFileName = isCustomSound ? sound.split(/[/\\]/).pop() || sound : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="alarm-editor-title"
      data-testid="alarm-editor-sheet"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs select-none"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0"
        onClick={onClose}
        aria-hidden="true"
      />

      <Card
        variant="surface"
        padding="md"
        className="relative z-10 w-full max-w-lg max-h-[90vh] overflow-y-auto space-y-4 rounded-2xl border border-[var(--border)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-2 border-b border-[var(--border)]">
          <div className="flex items-center gap-2">
            <Bell size={16} className="text-[var(--accent)]" />
            <h3 id="alarm-editor-title" className="text-sm font-semibold text-[var(--text)]">
              {alarm ? t.alarmsSave : t.alarmsNew}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.alarmsCancel}
            className="p-1 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          >
            <X size={16} />
          </button>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            {/* Time */}
            <Field label={t.alarmsTime} className="shrink-0 sm:w-32">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                aria-label={t.alarmsTime}
                className="w-full bg-[var(--elevated)] text-base font-mono font-semibold px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
              />
            </Field>

            {/* Label */}
            <Field label={t.alarmsLabel} className="flex-1">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={t.alarmsLabelPlaceholder}
                aria-label={t.alarmsLabel}
                className="w-full bg-[var(--elevated)] text-sm px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
              />
            </Field>

            {/* Repeat Mode Select */}
            <Field label={t.alarmsNext} className="shrink-0 sm:w-36">
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as AlarmRepeat)}
                title="Как часто звонить"
                aria-label={t.alarmsNext}
                className="w-full bg-[var(--elevated)] text-xs px-2.5 py-2 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)] cursor-pointer"
              >
                <option value="once">{t.alarmsRepeatOnce}</option>
                <option value="daily">{t.alarmsRepeatDaily}</option>
                <option value="days">{t.alarmsRepeatDays}</option>
                <option value="date">{t.alarmsRepeatDate}</option>
                <option value="interval">{t.alarmsRepeatInterval}</option>
              </select>
            </Field>
          </div>

          {/* Conditional Mode Controls */}
          {repeat === 'days' && (
            <Field label={t.alarmsRepeatDays}>
              <div className="flex items-center gap-1.5 w-full flex-wrap sm:flex-nowrap">
                {WEEKDAY_LABELS.map((wLabel, index) => {
                  const active = days.includes(index);
                  return (
                    <button
                      key={wLabel}
                      type="button"
                      onClick={() => toggleDay(index)}
                      className="flex-1 min-w-[34px] h-8 rounded-[6px] text-xs font-semibold transition-colors border cursor-pointer"
                      style={{
                        backgroundColor: active ? 'var(--accent)' : 'var(--elevated)',
                        color: active ? 'var(--bg, #000)' : 'var(--text-muted)',
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                      }}
                      title={`Звонить в ${wLabel}`}
                      aria-label={`Звонить в ${wLabel}`}
                      aria-pressed={active}
                    >
                      {wLabel}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {repeat === 'date' && (
            <Field label={t.alarmsDate}>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                aria-label={t.alarmsDate}
                className="bg-[var(--elevated)] text-sm px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
              />
            </Field>
          )}

          {repeat === 'interval' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Field label={`${t.alarmsIntervalEvery} (${t.alarmsIntervalMinutes})`}>
                <input
                  type="number"
                  min="5"
                  max="1440"
                  step="5"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
                  aria-label="Каждые"
                  className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
                />
              </Field>
              <Field label={t.alarmsWindowFrom}>
                <input
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  aria-label="С"
                  className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
                />
              </Field>
              <Field label={t.alarmsWindowTo}>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  aria-label="До"
                  className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
                />
              </Field>
            </div>
          )}

          {/* Sound selection inside editor */}
          <div className="space-y-2 pt-1 border-t border-[var(--border)]" data-testid="editor-sound-section">
            <label className="text-xs font-medium text-[var(--text-muted)]">
              {t.settingsAlarmSoundProfile}
            </label>

            {/* Built-in sound profiles */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" data-testid="editor-sound-profiles-grid">
              {profiles.map((p) => {
                const isSelected = sound === p.id && !isCustomSound;
                const isCurrentPlaying = isPlaying && playingSound === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between px-2.5 py-1.5 rounded-[8px] border text-xs transition-colors cursor-pointer ${
                      isSelected
                        ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--text)] font-medium'
                        : 'border-[var(--border)] bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--border-hover,var(--border))]'
                    }`}
                    onClick={() => setSound(p.id)}
                    data-testid={`editor-profile-${p.id}`}
                  >
                    <span className="truncate">{p.label}</span>
                    <button
                      type="button"
                      aria-label={`${t.settingsAlarmPreview} ${p.label}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePlayPreview(p.id, false);
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

            {/* Custom file */}
            <div className="pt-1">
              {isCustomSound ? (
                <div className="flex items-center gap-2 p-2 rounded-[8px] bg-[var(--elevated)] border border-[var(--border)]">
                  <Folder className="w-4 h-4 text-[var(--accent)] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[var(--text)] truncate" title={sound}>
                      {customFileName}
                    </p>
                    <p className="text-[10px] text-[var(--text-muted)] truncate" title={sound}>
                      {sound}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={t.settingsAlarmPreviewCustom}
                    onClick={() => void handlePlayPreview(sound, true)}
                    className="p-1.5 rounded-[6px] border border-[var(--border)] hover:bg-white/10 text-[var(--accent)] shrink-0"
                  >
                    {isPlaying && playingSound === sound ? (
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
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={handlePickCustomFile}
                  data-testid="editor-pick-custom-sound"
                  className="px-3 py-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--elevated)] text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)] transition-colors inline-flex items-center gap-1.5 cursor-pointer"
                >
                  <Folder className="w-3.5 h-3.5 text-[var(--accent)]" />
                  <span>{t.settingsAlarmChooseFile}</span>
                </button>
              )}
            </div>
          </div>

          {/* Note */}
          <Field label={t.alarmsNote}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.alarmsNotePlaceholder}
              aria-label={t.alarmsNote}
              className="w-full bg-[var(--elevated)] text-xs px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
            />
          </Field>

          {/* Form Actions */}
          <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
            <div>
              {alarm && onDelete && !alarm.scheduleId && (
                <button
                  type="button"
                  onClick={() => {
                    void onDelete(alarm.id);
                    onClose();
                  }}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium text-[var(--accent-red,#EF4444)] hover:bg-[var(--elevated)] border border-[var(--border)] transition-colors cursor-pointer"
                  title="Удалить будильник"
                  aria-label="Удалить будильник"
                >
                  <Trash2 size={13} />
                  <span>Удалить</span>
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 rounded-[8px] text-xs font-medium border border-[var(--border)] bg-[var(--elevated)] hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                {t.alarmsCancel}
              </button>
              <button
                type="submit"
                title="Добавить будильник"
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] text-xs font-semibold shadow-sm transition-transform active:scale-95 cursor-pointer"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--bg, #000)',
                }}
              >
                <Plus size={14} />
                <span>{alarm ? t.alarmsSave : t.alarmsNew}</span>
              </button>
            </div>
          </div>
        </form>
      </Card>
    </div>
  );
};
