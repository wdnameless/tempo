import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Bell,
  Clock,
  Check,
  X,
  StickyNote,
} from 'lucide-react';
import type { ThemeColors, AlarmItem, AISettings, DynamicUIConfig } from '../types';
import { soundService } from '../services/sound';
import { I18nService, type Translations } from '../services/i18n';
import {
  listAlarms,
  saveAlarm,
  deleteAlarm as apiDeleteAlarm,
  toggleAlarm as apiToggleAlarm,
  previewAlarms,
  type Alarm,
  type AlarmRepeat,
  type AlarmPreview,
  toAlarm,
} from '../services/alarms';
import { onDataChanged } from '../services/appEvents';
import { Card, EmptyState, Field, Toggle } from './ui';
import { AlarmAudio } from './AlarmAudio';

/** Short weekday labels, indexed 0 = Sunday to match stored format */
export const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;

export interface AlarmsProps {
  theme?: ThemeColors;
  alarms?: AlarmItem[];
  aiSettings?: AISettings;
  onUpdateAlarms?: (alarms: AlarmItem[]) => void;
  onOpenAISettings?: () => void;
  dynamicUi?: DynamicUIConfig;
}

export function formatNextFiring(nextIso: string | undefined, disabled: boolean, t: Translations): string {
  if (disabled) return t.alarmsDisabled;
  if (!nextIso) return t.alarmsNever;

  try {
    const d = new Date(nextIso);
    if (isNaN(d.getTime())) return nextIso;

    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;

    const isToday =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const isTomorrow =
      d.getFullYear() === tomorrow.getFullYear() &&
      d.getMonth() === tomorrow.getMonth() &&
      d.getDate() === tomorrow.getDate();

    const connector = t.alarmsToday === 'Today' ? 'at' : 'в';
    if (isToday) return `${t.alarmsToday} ${connector} ${timeStr}`;
    if (isTomorrow) return `${t.alarmsTomorrow} ${connector} ${timeStr}`;

    const dateStr = `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
    return `${dateStr} ${connector} ${timeStr}`;
  } catch {
    return nextIso;
  }
}

function toAlarmItem(alarm: Alarm): AlarmItem {
  // SAFETY: AlarmItem and Alarm have compatible field shapes for alarm projection
  return {
    id: alarm.id,
    title: alarm.label,
    label: alarm.label,
    time: alarm.time,
    repeat: alarm.repeat as AlarmItem['repeat'],
    days: alarm.days,
    enabled: alarm.enabled,
    sound: alarm.sound,
    voicePrompt: alarm.voicePrompt || undefined,
    note: alarm.note || undefined,
    ...(alarm.scheduleId ? { scheduleId: alarm.scheduleId } : {}),
    ...(alarm.date ? { date: alarm.date } : {}),
    ...(alarm.intervalMinutes !== null && alarm.intervalMinutes !== undefined
      ? { intervalMinutes: alarm.intervalMinutes }
      : {}),
    ...(alarm.windowStart ? { windowStart: alarm.windowStart } : {}),
    ...(alarm.windowEnd ? { windowEnd: alarm.windowEnd } : {}),
  } as unknown as AlarmItem;
}

export const Alarms: React.FC<AlarmsProps> = ({
  theme,
  alarms: propsAlarms,
  onUpdateAlarms,
  dynamicUi,
}) => {
  const t = I18nService.t();

  // Internal alarms state
  const [localAlarms, setLocalAlarms] = useState<Alarm[]>([]);
  const effectiveAlarms: Alarm[] = useMemo(() => {
    if (propsAlarms && propsAlarms.length > 0) {
      return propsAlarms.map(toAlarm);
    }
    return localAlarms;
  }, [propsAlarms, localAlarms]);

  // Next firing previews
  const [previews, setPreviews] = useState<Record<string, AlarmPreview>>({});

  // Clock
  const [currentTime, setCurrentTime] = useState('');

  // Form states: Create / Edit in ONE place
  const [editingId, setEditingId] = useState<string | null>(null);
  const [label, setLabel] = useState('Утренняя разминка');
  const [time, setTime] = useState('08:00');
  const [repeat, setRepeat] = useState<AlarmRepeat>('days');
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [date, setDate] = useState<string>(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  });
  const [intervalMinutes, setIntervalMinutes] = useState<number>(60);
  const [windowStart, setWindowStart] = useState<string>('08:00');
  const [windowEnd, setWindowEnd] = useState<string>('20:00');
  const [note, setNote] = useState<string>('');

  // Note inline editing state for backwards compatibility with tests
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);
  const [inlineNoteValue, setInlineNoteValue] = useState<string>('');
  const [inlineNoteOriginal, setInlineNoteOriginal] = useState<string>('');

  const fetchPreviews = useCallback(async (list: Alarm[]) => {
    try {
      const p = await previewAlarms(list);
      const map: Record<string, AlarmPreview> = {};
      for (const item of p) {
        map[item.id] = item;
      }
      setPreviews(map);
    } catch (e) {
      console.warn('Failed to load alarm previews:', e);
    }
  }, []);

  const refreshAlarms = useCallback(async () => {
    try {
      const dbList = await listAlarms();
      setLocalAlarms(dbList);
      void fetchPreviews(dbList);
      if (onUpdateAlarms) {
        onUpdateAlarms(dbList.map(toAlarmItem));
      }
    } catch (e) {
      console.warn('Failed to refresh alarms:', e);
    }
  }, [fetchPreviews, onUpdateAlarms]);

  // Loads through the promise itself, not through a callback that sets state:
  // the repo's lint forbids a synchronous setState reachable from an effect body.
  useEffect(() => {
    let active = true;
    const indexPreviews = (list: AlarmPreview[]) => {
      const map: Record<string, AlarmPreview> = {};
      for (const item of list) map[item.id] = item;
      return map;
    };

    const load = propsAlarms
      ? previewAlarms(propsAlarms.map(toAlarm)).then((list) => {
          if (active) setPreviews(indexPreviews(list));
        })
      : listAlarms().then((dbList) => {
          if (!active) return;
          setLocalAlarms(dbList);
          onUpdateAlarms?.(dbList.map(toAlarmItem));
          return previewAlarms(dbList).then((list) => {
            if (active) setPreviews(indexPreviews(list));
          });
        });

    void load.catch((e) => console.warn('Failed to load alarms:', e));
    return () => {
      active = false;
    };
  }, [propsAlarms, onUpdateAlarms]);

  // Subscribe to data changes
  useEffect(() => {
    const unsubscribe = onDataChanged((table) => {
      if (table === 'alarms') {
        void refreshAlarms();
      }
    });
    return unsubscribe;
  }, [refreshAlarms]);

  // Display clock
  useEffect(() => {
    const tick = () => {
      const d = new Date();
      setCurrentTime(
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const toggleDay = (dayIndex: number) => {
    soundService.playUiClick();
    setDays((prev) => {
      if (prev.includes(dayIndex)) {
        if (prev.length === 1) return prev; // Do not allow empty days
        return prev.filter((d) => d !== dayIndex);
      }
      return [...prev, dayIndex].sort((a, b) => a - b);
    });
  };

  const resetForm = () => {
    setEditingId(null);
    setLabel('Утренняя разминка');
    setTime('08:00');
    setRepeat('days');
    setDays([1, 2, 3, 4, 5]);
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setDate(`${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`);
    setIntervalMinutes(60);
    setWindowStart('08:00');
    setWindowEnd('20:00');
    setNote('');
  };

  const handleEditClick = (alarm: Alarm) => {
    soundService.playUiClick();
    setEditingId(alarm.id);
    setLabel(alarm.label);
    setTime(alarm.time);
    setRepeat(alarm.repeat);
    setDays(alarm.days && alarm.days.length > 0 ? alarm.days : [1, 2, 3, 4, 5]);
    if (alarm.date) setDate(alarm.date);
    if (alarm.intervalMinutes) setIntervalMinutes(alarm.intervalMinutes);
    if (alarm.windowStart) setWindowStart(alarm.windowStart);
    if (alarm.windowEnd) setWindowEnd(alarm.windowEnd);
    setNote(alarm.note || '');
  };

  const handleFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    soundService.playUiClick();

    const alarmData: Alarm = {
      id: editingId || `alarm_${Date.now()}`,
      label: label.trim() || t.alarmsNew,
      time,
      repeat,
      days: repeat === 'days' ? days : [],
      date: repeat === 'date' ? date : null,
      intervalMinutes: repeat === 'interval' ? Number(intervalMinutes) || 60 : null,
      windowStart: repeat === 'interval' ? windowStart : null,
      windowEnd: repeat === 'interval' ? windowEnd : null,
      enabled: true,
      sound: 'gentle',
      note: note.trim() || null,
    };

    // Update parent
    const updatedList = editingId
      ? effectiveAlarms.map((a) => (a.id === editingId ? alarmData : a))
      : [alarmData, ...effectiveAlarms];

    setLocalAlarms(updatedList);
    onUpdateAlarms?.(updatedList.map(toAlarmItem));

    await saveAlarm(alarmData);
    void fetchPreviews(updatedList);
    resetForm();
  };

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    soundService.playUiClick();
    const updated = effectiveAlarms.map((a) =>
      a.id === id ? { ...a, enabled: !currentEnabled } : a
    );
    setLocalAlarms(updated);
    onUpdateAlarms?.(updated.map(toAlarmItem));
    await apiToggleAlarm(id, !currentEnabled);
    void fetchPreviews(updated);
  };

  const handleDelete = async (id: string) => {
    soundService.playUiClick();
    const updated = effectiveAlarms.filter((a) => a.id !== id);
    setLocalAlarms(updated);
    onUpdateAlarms?.(updated.map(toAlarmItem));
    await apiDeleteAlarm(id);
    void fetchPreviews(updated);
    if (editingId === id) resetForm();
  };

  // In-place edits for backwards compatibility with tests
  const editAlarmTime = async (alarm: Alarm, newTimeVal: string) => {
    if (!/^\d{2}:\d{2}$/.test(newTimeVal)) return;
    const updated = { ...alarm, time: newTimeVal };
    const list = effectiveAlarms.map((a) => (a.id === alarm.id ? updated : a));
    setLocalAlarms(list);
    onUpdateAlarms?.(list.map(toAlarmItem));
    await saveAlarm(updated);
    void fetchPreviews(list);
  };

  const toggleAlarmDay = async (alarm: Alarm, dayIndex: number) => {
    soundService.playUiClick();
    const curDays = alarm.days ?? [];
    let nextDays: number[];
    if (curDays.includes(dayIndex)) {
      if (curDays.length === 1) return; // Prevent removing the last day
      nextDays = curDays.filter((d) => d !== dayIndex);
    } else {
      nextDays = [...curDays, dayIndex].sort((a, b) => a - b);
    }
    const updated = { ...alarm, days: nextDays, repeat: 'days' as const };
    const list = effectiveAlarms.map((a) => (a.id === alarm.id ? updated : a));
    setLocalAlarms(list);
    onUpdateAlarms?.(list.map(toAlarmItem));
    await saveAlarm(updated);
    void fetchPreviews(list);
  };

  const startNoteEdit = (alarm: Alarm) => {
    setNoteEditingId(alarm.id);
    setInlineNoteValue(alarm.note || '');
    setInlineNoteOriginal(alarm.note || '');
  };

  const commitNoteEdit = async (alarm: Alarm, overrideVal?: string) => {
    const raw = overrideVal !== undefined ? overrideVal : inlineNoteValue;
    const val = raw.trim();
    const updated = { ...alarm, note: val || null };
    const list = effectiveAlarms.map((a) => (a.id === alarm.id ? updated : a));
    setLocalAlarms(list);
    onUpdateAlarms?.(list.map(toAlarmItem));
    setNoteEditingId(null);
    await saveAlarm(updated);
  };

  const cancelNoteEdit = () => {
    setNoteEditingId(null);
    setInlineNoteValue(inlineNoteOriginal);
  };

  // Both shapes carry an optional scheduleId; `Alarm` is the narrowed one.
  const isDerived = (a: Alarm | AlarmItem) => Boolean(a.scheduleId);

  return (
    <div
      className="flex flex-col w-full max-w-full space-y-4"
      style={{
        color: theme?.text || 'var(--text)',
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-2 select-none">
        <div className="flex items-center gap-2">
          <Bell size={18} style={{ color: 'var(--accent)' }} />
          <h2 className="text-base font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
            {t.alarmsTitle}
          </h2>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-mono font-medium"
            style={{
              backgroundColor: 'var(--elevated)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {effectiveAlarms.length}
          </span>
        </div>

        {dynamicUi?.layout?.showCurrentTimeBadge !== false && (
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-[8px] text-xs font-mono font-medium border"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            <Clock size={13} />
            <span>{currentTime || '--:--'}</span>
          </div>
        )}
      </div>
      {/* Alarm Sound Settings (R13 / Overhaul) */}
      <AlarmAudio />


      {/* Unified Create / Edit Form in ONE place (R09 / R10) */}
      <Card variant="surface" padding="md" className="space-y-3">
        <div className="flex items-center justify-between pb-1 border-b border-[var(--border)]">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {editingId ? t.alarmsSave : t.alarmsNew}
          </span>
          {editingId && (
            <button
              type="button"
              onClick={resetForm}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] flex items-center gap-1"
            >
              <X size={12} />
              <span>{t.alarmsCancel}</span>
            </button>
          )}
        </div>

        <form onSubmit={handleFormSubmit} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            {/* Time */}
            <Field label={t.alarmsTime} className="shrink-0 sm:w-28">
              <input
                type="time"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                required
                className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
              />
            </Field>

            {/* Label */}
            <Field label={t.alarmsLabel} className="flex-1">
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="Название будильника..."
                className="w-full bg-[var(--elevated)] text-sm px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
              />
            </Field>

            {/* Repeat Mode Select (5 modes) */}
            <Field label={t.alarmsNext} className="shrink-0 sm:w-36">
              <select
                value={repeat}
                onChange={(e) => setRepeat(e.target.value as AlarmRepeat)}
                title="Как часто звонить"
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

          {/* Conditional mode controls */}
          {/* Weekday chips for 'days' */}
          {repeat === 'days' && (
            <Field label={t.alarmsRepeatDays}>
              <div className="flex items-center gap-1 w-full flex-wrap sm:flex-nowrap">
                {WEEKDAY_LABELS.map((wLabel, index) => {
                  const active = days.includes(index);
                  return (
                    <button
                      key={wLabel}
                      type="button"
                      onClick={() => toggleDay(index)}
                      className="flex-1 min-w-[32px] h-7 rounded-[6px] text-xs font-semibold transition-colors border"
                      style={{
                        backgroundColor: active ? 'var(--accent)' : 'var(--elevated)',
                        color: active ? 'var(--bg, #000)' : 'var(--text-muted)',
                        borderColor: active ? 'var(--accent)' : 'var(--border)',
                      }}
                      title={`Звонить в ${wLabel}`}
                      aria-pressed={active}
                    >
                      {wLabel}
                    </button>
                  );
                })}
              </div>
            </Field>
          )}

          {/* Date picker for 'date' mode (R05) */}
          {repeat === 'date' && (
            <Field label={t.alarmsDate}>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className="bg-[var(--elevated)] text-sm px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
              />
            </Field>
          )}

          {/* Interval settings for 'interval' mode (R06) */}
          {repeat === 'interval' && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Field label={`${t.alarmsIntervalEvery} (${t.alarmsIntervalMinutes})`}>
                <input
                  min="5"
                  max="1440"
                  step="5"
                  value={intervalMinutes}
                  onChange={(e) => setIntervalMinutes(Number(e.target.value) || 60)}
                  className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
                />
              </Field>
              <Field label={t.alarmsWindowFrom}>
                <input
                  type="time"
                  value={windowStart}
                  onChange={(e) => setWindowStart(e.target.value)}
                  className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
                />
              </Field>
              <Field label={t.alarmsWindowTo}>
                <input
                  type="time"
                  value={windowEnd}
                  onChange={(e) => setWindowEnd(e.target.value)}
                  className="w-full bg-[var(--elevated)] text-sm font-mono px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
                />
              </Field>
            </div>
          )}

          {/* Note input */}
          <Field label={t.alarmsNote}>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t.alarmsNotePlaceholder}
              className="w-full bg-[var(--elevated)] text-xs px-2.5 py-1.5 rounded-[8px] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] text-[var(--text)]"
            />
          </Field>

          {/* Submit Action */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button
              type="submit"
              title="Добавить будильник"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[8px] text-xs font-semibold shadow-sm transition-transform active:scale-95"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--bg, #000)',
              }}
            >
              <Plus size={14} />
              <span>{editingId ? t.alarmsSave : t.alarmsNew}</span>
            </button>
          </div>
        </form>
      </Card>

      {/* Alarm List with Next Firing times (R08) */}
      <div className="flex flex-col space-y-2">
        {effectiveAlarms.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} />}
            title={t.alarmsEmpty}
            description={t.assistantPrompt}
          />
        ) : (
          effectiveAlarms.map((alarm) => {
            const derived = isDerived(alarm);
            const preview = previews[alarm.id];
            const nextIso = preview?.next?.[0];
            const nextHuman = formatNextFiring(nextIso, !alarm.enabled, t);

            return (
              <Card
                key={alarm.id}
                variant="surface"
                padding="sm"
                className={`flex flex-col gap-2 transition-all ${
                  alarm.enabled ? 'opacity-100' : 'opacity-55'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  {/* Time + Next firing indicator */}
                  <div className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="text"
                      aria-label={`Время будильника ${alarm.label}`}
                      readOnly={derived}
                      value={alarm.time}
                      onChange={(e) => editAlarmTime(alarm, e.target.value)}
                      onBlur={(e) => editAlarmTime(alarm, e.target.value)}
                      className={`w-16 font-mono text-base font-semibold bg-transparent border-b border-dashed border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)] ${
                        derived ? 'cursor-default border-none' : 'cursor-text'
                      }`}
                    />

                    <div className="flex flex-col min-w-0">
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => !derived && handleEditClick(alarm)}
                          className={`text-sm font-medium truncate ${
                            !derived ? 'hover:underline cursor-pointer' : ''
                          }`}
                          style={{ color: 'var(--text)' }}
                        >
                          {alarm.label}
                        </span>
                        {derived && (
                          <span
                            className="text-[10px] px-1.5 py-0.2 rounded border text-[var(--text-faint)] border-[var(--border)] shrink-0"
                            title="Из программы"
                          >
                            Программа
                          </span>
                        )}
                      </div>

                      {/* Next firing badge */}
                      <span
                        className="text-xs font-medium"
                        style={{
                          color: alarm.enabled ? 'var(--accent)' : 'var(--text-muted)',
                        }}
                      >
                        {nextHuman}
                      </span>
                    </div>
                  </div>

                  {/* Right actions: Toggle + Delete + Note */}
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={derived}
                      title={derived ? 'Описание задаётся в шаге программы' : 'Добавить описание'}
                      onClick={() => !derived && startNoteEdit(alarm)}
                      className="p-1 rounded hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-30 disabled:cursor-not-allowed"
                    >
                      <StickyNote size={14} />
                    </button>

                    <button
                      type="button"
                      disabled={derived}
                      onClick={() => handleToggle(alarm.id, alarm.enabled)}
                      title={derived ? 'Включается вместе с программой' : (alarm.enabled ? 'Выключить будильник' : 'Включить будильник')}
                      className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Toggle
                        checked={alarm.enabled}
                        onChange={() => {}}
                        disabled={derived}
                      />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(alarm.id)}
                      title="Удалить"
                      className="p-1.5 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--accent-red,#EF4444)] transition-colors cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>

                {/* Per-row weekday chips if repeat is 'days' */}
                {alarm.repeat === 'days' && !derived && (
                  <div className="flex items-center gap-1 pt-1 border-t border-[var(--border)]">
                    {WEEKDAY_LABELS.map((wLabel, index) => {
                      const active = (alarm.days ?? []).includes(index);
                      return (
                        <button
                          key={wLabel}
                          type="button"
                          onClick={() => toggleAlarmDay(alarm, index)}
                          title={active ? `Убрать ${wLabel}` : `Добавить ${wLabel}`}
                          className="h-5 flex-1 rounded text-[10px] font-semibold transition-colors border"
                          style={{
                            backgroundColor: active ? 'var(--accent)' : 'transparent',
                            color: active ? 'var(--bg, #000)' : 'var(--text-muted)',
                            borderColor: active ? 'var(--accent)' : 'var(--border)',
                          }}
                        >
                          {wLabel}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* Inline note edit or display */}
                {noteEditingId === alarm.id ? (
                  <div className="flex items-center gap-2 pt-1 border-t border-[var(--border)]">
                    <input
                      type="text"
                      aria-label="Описание будильника"
                      autoFocus
                      value={inlineNoteValue}
                      onChange={(e) => setInlineNoteValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') void commitNoteEdit(alarm);
                        if (e.key === 'Escape') cancelNoteEdit();
                      }}
                      onBlur={(e) => void commitNoteEdit(alarm, e.target.value)}
                      placeholder={t.alarmsNotePlaceholder}
                      className="flex-1 bg-[var(--elevated)] text-xs px-2 py-1 rounded border border-[var(--border)] text-[var(--text)] focus:outline-none focus:border-[var(--accent)]"
                    />
                    <button
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        void commitNoteEdit(alarm);
                      }}
                      className="p-1 text-[var(--accent)]"
                    >
                      <Check size={14} />
                    </button>
                  </div>
                ) : (
                  alarm.note && (
                    <div className="text-xs text-[var(--text-muted)] italic pt-0.5 px-0.5 truncate">
                      {alarm.note}
                    </div>
                  )
                )}
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};
