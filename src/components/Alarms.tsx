import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Bell,
  Clock,
  Edit2,
} from 'lucide-react';
import type { ThemeColors, AlarmItem, AISettings, DynamicUIConfig } from '../types';
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
import { Card, EmptyState, Toggle } from './ui';
import { AlarmAudio } from './AlarmAudio';
import { AlarmEditorSheet } from './AlarmEditorSheet';

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

/** Formats the next firing date into human-readable Russian string */
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

/** Formats repeat mode and days/date/interval into a concise human-readable summary */
export function formatRepeatSummary(
  alarm: { repeat: string; days?: number[]; date?: string | null; intervalMinutes?: number | null },
  t: Translations,
): string {
  switch (alarm.repeat) {
    case 'once':
      return t.alarmsRepeatOnce;
    case 'daily':
      return t.alarmsRepeatDaily;
    case 'days': {
      const days = alarm.days ?? [];
      if (days.length === 0) return t.alarmsRepeatDays;
      if (days.length === 7) return t.alarmsRepeatDaily;
      const sorted = [...days].sort((a, b) => a - b);
      if (sorted.length === 5 && sorted.every((d, i) => d === i + 1)) {
        return 'По будням';
      }
      if (sorted.length === 2 && sorted[0] === 0 && sorted[1] === 6) {
        return 'По выходным';
      }
      return sorted.map((d) => WEEKDAY_LABELS[d] || String(d)).join(', ');
    }
    case 'date':
      return alarm.date || t.alarmsRepeatDate;
    case 'interval':
      return `${t.alarmsIntervalEvery} ${alarm.intervalMinutes || 60} ${t.alarmsIntervalMinutes}`;
    default:
      return alarm.repeat;
  }
}

function toAlarmItem(alarm: Alarm): AlarmItem {
  return {
    id: alarm.id,
    title: alarm.label,
    label: alarm.label,
    time: alarm.time,
    repeat: alarm.repeat,
    days: alarm.days,
    date: alarm.date || undefined,
    intervalMinutes: alarm.intervalMinutes || undefined,
    windowStart: alarm.windowStart || undefined,
    windowEnd: alarm.windowEnd || undefined,
    enabled: alarm.enabled,
    sound: alarm.sound,
    voicePrompt: alarm.voicePrompt || undefined,
    note: alarm.note || undefined,
    ...(alarm.scheduleId ? { scheduleId: alarm.scheduleId } : {}),
  };
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

  // Modal sheet state
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [selectedAlarm, setSelectedAlarm] = useState<Alarm | null>(null);

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

  // Initial load
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
        `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`,
      );
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenCreate = () => {
    setSelectedAlarm(null);
    setIsSheetOpen(true);
  };

  const handleOpenEdit = (alarm: Alarm) => {
    setSelectedAlarm(alarm);
    setIsSheetOpen(true);
  };

  const handleCloseSheet = () => {
    setIsSheetOpen(false);
    setSelectedAlarm(null);
  };

  const handleSaveAlarm = async (alarmData: Alarm) => {
    const isEdit = effectiveAlarms.some((a) => a.id === alarmData.id);
    const updatedList = isEdit
      ? effectiveAlarms.map((a) => (a.id === alarmData.id ? alarmData : a))
      : [alarmData, ...effectiveAlarms];

    setLocalAlarms(updatedList);
    onUpdateAlarms?.(updatedList.map(toAlarmItem));

    await saveAlarm(alarmData);
    void fetchPreviews(updatedList);
  };

  const createQuickAlarm = async (labelVal: string, timeVal: string, repeatVal: AlarmRepeat) => {
    const alarmData: Alarm = {
      id: `alarm_${Date.now()}`,
      label: labelVal,
      time: timeVal,
      repeat: repeatVal,
      days: [],
      date: null,
      intervalMinutes: null,
      windowStart: null,
      windowEnd: null,
      enabled: true,
      sound: 'gentle',
      note: null,
    };
    const updatedList = [alarmData, ...effectiveAlarms];
    setLocalAlarms(updatedList);
    onUpdateAlarms?.(updatedList.map(toAlarmItem));
    await saveAlarm(alarmData);
    void fetchPreviews(updatedList);
  };

  const handleQuickIn30 = () => {
    const d = new Date(Date.now() + 30 * 60 * 1000);
    const pad = (n: number) => String(n).padStart(2, '0');
    const timeStr = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
    void createQuickAlarm(t.alarmsQuickIn30, timeStr, 'once');
  };

  const handleQuickTomorrow8 = () => {
    void createQuickAlarm(t.alarmsQuickTomorrow8, '08:00', 'once');
  };

  const handleQuickDaily730 = () => {
    void createQuickAlarm(t.alarmsQuickDaily730, '07:30', 'daily');
  };

  const handleToggle = async (id: string, currentEnabled: boolean) => {
    const updated = effectiveAlarms.map((a) =>
      a.id === id ? { ...a, enabled: !currentEnabled } : a,
    );
    setLocalAlarms(updated);
    onUpdateAlarms?.(updated.map(toAlarmItem));
    await apiToggleAlarm(id, !currentEnabled);
    void fetchPreviews(updated);
  };

  const handleDelete = async (id: string) => {
    const updated = effectiveAlarms.filter((a) => a.id !== id);
    setLocalAlarms(updated);
    onUpdateAlarms?.(updated.map(toAlarmItem));
    await apiDeleteAlarm(id);
    void fetchPreviews(updated);
  };

  const isDerived = (a: Alarm | AlarmItem) => Boolean(a.scheduleId);

  return (
    <div
      className="flex flex-col w-full max-w-full space-y-4"
      style={{
        color: theme?.text || 'var(--text)',
      }}
    >
      {/* Header bar */}
      <div className="flex items-center justify-between gap-3 select-none">
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

        <div className="flex items-center gap-2">
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

          <button
            type="button"
            onClick={handleOpenCreate}
            data-testid="new-alarm-btn"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold shadow-sm transition-transform active:scale-95 cursor-pointer"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--bg, #000)',
            }}
            title={t.alarmsNew}
            aria-label={t.alarmsNew}
          >
            <Plus size={14} />
            <span>{t.alarmsNew}</span>
          </button>
        </div>
      </div>

      {/* Global Sound Settings (compact row) */}
      <AlarmAudio />

      {/* Quick Presets (compact chips) */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={handleQuickIn30}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-xs font-medium bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          data-testid="quick-alarm-in-30"
        >
          <Clock size={12} className="text-[var(--accent)]" />
          <span>{t.alarmsQuickIn30}</span>
        </button>
        <button
          type="button"
          onClick={handleQuickTomorrow8}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-xs font-medium bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          data-testid="quick-alarm-tomorrow-8"
        >
          <Bell size={12} className="text-[var(--accent)]" />
          <span>{t.alarmsQuickTomorrow8}</span>
        </button>
        <button
          type="button"
          onClick={handleQuickDaily730}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[10px] text-xs font-medium bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
          data-testid="quick-alarm-daily-730"
        >
          <Plus size={12} className="text-[var(--accent)]" />
          <span>{t.alarmsQuickDaily730}</span>
        </button>
      </div>

      {/* Reserved slot for AIScheduleIntake (Slice B integration seam) */}
      <div id="ai-schedule-intake-slot" />

      {/* Alarm List (Hero surface) */}
      <div className="flex flex-col space-y-2">
        {effectiveAlarms.length === 0 ? (
          <EmptyState
            icon={<Bell size={24} />}
            title={t.alarmsEmpty}
            description={t.assistantPrompt}
            action={
              <button
                type="button"
                onClick={handleOpenCreate}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-semibold cursor-pointer shadow-sm transition-transform active:scale-95"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--bg, #000)',
                }}
              >
                <Plus size={14} />
                <span>{t.alarmsNew}</span>
              </button>
            }
          />
        ) : (
          effectiveAlarms.map((alarm) => {
            const derived = isDerived(alarm);
            const preview = previews[alarm.id];
            const nextIso = preview?.next?.[0];
            const nextHuman = formatNextFiring(nextIso, !alarm.enabled, t);
            const repeatSummary = formatRepeatSummary(alarm, t);

            return (
              <Card
                key={alarm.id}
                variant="surface"
                padding="md"
                className={`group flex items-center justify-between gap-4 transition-all rounded-xl border border-[var(--border)] hover:border-[var(--border-hover,var(--border))] ${
                  alarm.enabled ? 'opacity-100' : 'opacity-55'
                }`}
                data-testid={`alarm-row-${alarm.id}`}
              >
                {/* Left: Time + Label + Repeat summary + Next firing */}
                <div
                  className={`flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-4 min-w-0 flex-1 ${
                    !derived ? 'cursor-pointer' : ''
                  }`}
                  onClick={() => !derived && handleOpenEdit(alarm)}
                >
                  <div className="flex items-center gap-2">
                    <span
                      className="font-mono text-2xl font-bold tracking-tight text-[var(--text)] tabular-nums"
                      aria-label={`Время будильника ${alarm.label}`}
                    >
                      {alarm.time}
                    </span>
                    {derived && (
                      <span
                        className="text-[10px] px-1.5 py-0.5 rounded border text-[var(--text-faint)] border-[var(--border)] shrink-0 font-medium"
                        title="Из программы"
                      >
                        Программа
                      </span>
                    )}
                  </div>

                  <div className="flex flex-col min-w-0">
                    <span
                      className={`text-sm font-semibold truncate ${
                        !derived ? 'group-hover:text-[var(--accent)] transition-colors' : ''
                      }`}
                      style={{ color: 'var(--text)' }}
                    >
                      {alarm.label}
                    </span>
                    <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] flex-wrap">
                      <span>{repeatSummary}</span>
                      {nextHuman && (
                        <>
                          <span className="opacity-40">•</span>
                          <span
                            style={{
                              color: alarm.enabled ? 'var(--accent)' : 'var(--text-muted)',
                            }}
                          >
                            {nextHuman}
                          </span>
                        </>
                      )}
                      {alarm.note && (
                        <>
                          <span className="opacity-40">•</span>
                          <span className="italic truncate max-w-[200px]" title={alarm.note}>
                            {alarm.note}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Right actions: Toggle + Edit + Delete */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    disabled={derived}
                    onClick={() => handleToggle(alarm.id, alarm.enabled)}
                    title={
                      derived
                        ? 'Включается вместе с программой'
                        : alarm.enabled
                          ? 'Выключить будильник'
                          : 'Включить будильник'
                    }
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
                    disabled={derived}
                    onClick={() => handleOpenEdit(alarm)}
                    title={derived ? 'Редактируется в шаге программы' : 'Редактировать будильник'}
                    aria-label={`Редактировать ${alarm.label}`}
                    className="p-1.5 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    <Edit2 size={14} />
                  </button>

                  <button
                    type="button"
                    onClick={() => handleDelete(alarm.id)}
                    title="Удалить"
                    aria-label={`Удалить ${alarm.label}`}
                    className="p-1.5 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--accent-red,#EF4444)] transition-colors cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </Card>
            );
          })
        )}
      </div>

      {/* Modal sheet for create / edit */}
      {isSheetOpen && (
        <AlarmEditorSheet
          key={selectedAlarm?.id || 'new'}
          isOpen={isSheetOpen}
          alarm={selectedAlarm}
          onClose={handleCloseSheet}
          onSave={handleSaveAlarm}
          onDelete={handleDelete}
          theme={theme}
        />
      )}
    </div>
  );
};
