import { invoke } from '@tauri-apps/api/core';
import type { AlarmItem } from '../types';
import { repo, type EntityMeta } from './db';
import { isTauri } from './platform';
import { emitDataChanged } from './appEvents';
import type { AlarmRow } from './store';

export type AlarmRepeat = 'once' | 'daily' | 'days' | 'date' | 'interval';

export interface Alarm {
  id: string;
  label: string;
  time: string; // "HH:MM", 24-hour local time
  repeat: AlarmRepeat;
  days: number[]; // 0=Mon..6=Sun
  date?: string | null; // "YYYY-MM-DD"
  intervalMinutes?: number | null; // interval step in minutes
  windowStart?: string | null; // "HH:MM", defaults to "00:00"
  windowEnd?: string | null; // "HH:MM", defaults to "23:59"
  enabled: boolean;
  sound: string;
  voicePrompt?: string | null;
  note?: string | null;
  scheduleId?: string;
}

export interface AlarmPreview {
  id: string;
  next: string[]; // ISO-8601 strings in local time
  disabled: boolean;
}

/**
 * The wire shape of `ScheduledAlarm` on the Rust side. Rust has no
 * `rename_all` on that struct, so these keys are snake_case — renaming one
 * here silently drops the field on the other side of the IPC.
 */
export interface ScheduledAlarmPayload {
  id: string;
  label: string;
  time: string;
  repeat: string;
  days: number[];
  date: string | null;
  interval_minutes: number | null;
  window_start: string | null;
  window_end: string | null;
  enabled: boolean;
  sound: string;
  voice_prompt: string | null;
}

const alarmsRepo = repo<AlarmRow>('alarms');

/**
 * One alarm shape for the whole app: legacy rows (`AlarmItem`, which uses
 * `title`) and the newer `Alarm` both fold into `Alarm`. Every caller that
 * hands alarms to the backend goes through here, so the IPC payload has exactly
 * one author.
 */
export function toAlarm(item: AlarmItem | Alarm): Alarm {
  const isAlarmItem = 'title' in item;
  const label = (isAlarmItem ? item.title || item.label : item.label) || '';

  return {
    id: item.id,
    label,
    time: item.time,
    repeat: (item.repeat || 'once') as AlarmRepeat,
    days: item.days ?? [],
    date: item.date ?? null,
    intervalMinutes: item.intervalMinutes ?? null,
    windowStart: item.windowStart ?? null,
    windowEnd: item.windowEnd ?? null,
    enabled: item.enabled,
    sound: item.sound || 'gentle',
    voicePrompt: item.voicePrompt ?? null,
    note: item.note ?? null,
    scheduleId: item.scheduleId || undefined,
  };
}

export function alarmToScheduledAlarm(a: Alarm): ScheduledAlarmPayload {
  return {
    id: a.id,
    label: a.label,
    time: a.time,
    repeat: a.repeat,
    days: a.days ?? [],
    date: a.date ?? null,
    // Rust deserializes these field names as-is (`ScheduledAlarm` has no
    // rename_all), so the IPC payload stays snake_case here.
    interval_minutes: a.intervalMinutes ?? null,
    window_start: a.windowStart ?? null,
    window_end: a.windowEnd ?? null,
    enabled: a.enabled,
    sound: a.sound || 'gentle',
    voice_prompt: a.voicePrompt ?? null,
  };
}

export function alarmFromRow(rawRow: Partial<AlarmRow> | Record<string, unknown>): Alarm {
  const row = rawRow as Record<string, unknown>;

  const rawDays = row.days;
  let days: number[] = [];
  if (Array.isArray(rawDays)) {
    days = rawDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  } else if (typeof rawDays === 'string') {
    try {
      const parsed = JSON.parse(rawDays);
      if (Array.isArray(parsed)) {
        days = parsed.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      }
    } catch {
      days = [];
    }
  }

  const repeatRaw = String(row.repeat || '');
  let repeat: AlarmRepeat = 'once';
  if (
    repeatRaw === 'daily' ||
    repeatRaw === 'days' ||
    repeatRaw === 'once' ||
    repeatRaw === 'date' ||
    repeatRaw === 'interval'
  ) {
    repeat = repeatRaw as AlarmRepeat;
  } else if (days.length > 0) {
    repeat = 'days';
  }

  const label = String(row.label || row.title || '');
  const date = typeof row.date === 'string' && row.date ? row.date : null;
  const intervalMinutes =
    typeof row.interval_minutes === 'number'
      ? row.interval_minutes
      : typeof row.intervalMinutes === 'number'
        ? row.intervalMinutes
        : null;
  const windowStart =
    typeof row.window_start === 'string' && row.window_start
      ? row.window_start
      : typeof row.windowStart === 'string' && row.windowStart
        ? row.windowStart
        : null;
  const windowEnd =
    typeof row.window_end === 'string' && row.window_end
      ? row.window_end
      : typeof row.windowEnd === 'string' && row.windowEnd
        ? row.windowEnd
        : null;

  return {
    id: String(row.id || ''),
    label,
    time: String(row.time || '00:00'),
    days,
    repeat,
    date,
    intervalMinutes,
    windowStart,
    windowEnd,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : row.enabled === 1 || row.enabled === '1',
    sound: String(row.sound || 'gentle'),
    voicePrompt:
      typeof row.voice_prompt === 'string'
        ? row.voice_prompt
        : typeof row.voicePrompt === 'string'
          ? row.voicePrompt
          : null,
    note: typeof row.note === 'string' ? row.note : null,
  };
}

export function alarmToRow(alarm: Alarm): Omit<AlarmRow, keyof EntityMeta> & { id?: string } {
  return {
    ...(alarm.id ? { id: alarm.id } : {}),
    label: alarm.label || '',
    time: alarm.time,
    days: JSON.stringify(alarm.days || []),
    repeat: alarm.repeat,
    enabled: alarm.enabled ? 1 : 0,
    sound: alarm.sound || 'gentle',
    voice_prompt: alarm.voicePrompt || null,
    note: alarm.note || null,
    date: alarm.date || null,
    interval_minutes: alarm.intervalMinutes ?? null,
    window_start: alarm.windowStart || null,
    window_end: alarm.windowEnd || null,
  };
}

async function syncToScheduler(alarms: Alarm[]): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('sync_alarms', {
      alarms: alarms.map(alarmToScheduledAlarm),
    });
  } catch (err) {
    console.warn('sync_alarms failed:', err);
  }
}

/**
 * Returns all active alarms.
 */
export async function listAlarms(): Promise<Alarm[]> {
  try {
    const rows = await alarmsRepo.all();
    return rows.map(alarmFromRow);
  } catch (err) {
    console.error('listAlarms failed:', err);
    return [];
  }
}

/**
 * Creates or updates an alarm in SQLite, synchronises scheduler, and emits data-changed signal.
 */
export async function saveAlarm(alarm: Alarm): Promise<void> {
  const id = alarm.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `alarm_${Date.now()}`);
  const target: Alarm = { ...alarm, id };

  try {
    const existing = await alarmsRepo.byId(id);
    const row = alarmToRow(target);
    if (existing) {
      await alarmsRepo.update(id, row);
    } else {
      await alarmsRepo.insert(row);
    }
  } catch (err) {
    console.warn('saveAlarm db error:', err);
  }

  const all = await listAlarms();
  await syncToScheduler(all);
  emitDataChanged('alarms', [id]);
}

/**
 * Deletes an alarm by ID, synchronises scheduler, and emits data-changed signal.
 */
export async function deleteAlarm(id: string): Promise<void> {
  try {
    await alarmsRepo.remove(id);
  } catch (err) {
    console.warn('deleteAlarm db error:', err);
  }
  const all = await listAlarms();
  await syncToScheduler(all);
  emitDataChanged('alarms', [id]);
}

/**
 * Toggles an alarm's enabled state, synchronises scheduler, and emits data-changed signal.
 */
export async function toggleAlarm(id: string, enabled: boolean): Promise<void> {
  try {
    await alarmsRepo.update(id, { enabled: enabled ? 1 : 0 });
  } catch (err) {
    console.warn('toggleAlarm db error:', err);
  }
  const all = await listAlarms();
  await syncToScheduler(all);
  emitDataChanged('alarms', [id]);
}

/**
 * Batch-creates multiple alarms (used by AI chat), synchronises scheduler, and emits data-changed signal.
 */
export async function applyAlarms(alarms: Alarm[]): Promise<Alarm[]> {
  const created: Alarm[] = [];
  const ids: string[] = [];

  for (const item of alarms) {
    const id = item.id || (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `alarm_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
    const target: Alarm = { ...item, id };
    const row = alarmToRow(target);
    const existing = await alarmsRepo.byId(id);
    if (existing) {
      await alarmsRepo.update(id, row);
    } else {
      await alarmsRepo.insert(row);
    }
    created.push(target);
    ids.push(id);
  }

  const all = await listAlarms();
  await syncToScheduler(all);
  emitDataChanged('alarms', ids);
  return created;
}

/**
 * Compute local firing preview when IPC is unavailable (e.g. tests or browser dev).
 */
export function computeLocalAlarmPreview(alarm: Alarm, count = 3, now = new Date()): AlarmPreview {
  if (!alarm.enabled) {
    return { id: alarm.id, next: [], disabled: true };
  }

  const [hoursStr, minutesStr] = alarm.time.split(':');
  const targetHour = parseInt(hoursStr, 10) || 0;
  const targetMin = parseInt(minutesStr, 10) || 0;

  const results: string[] = [];

  const formatIsoLocal = (d: Date): string => {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
  };

  if (alarm.repeat === 'date') {
    if (alarm.date) {
      const [yearStr, monthStr, dayStr] = alarm.date.split('-');
      const d = new Date(parseInt(yearStr, 10), parseInt(monthStr, 10) - 1, parseInt(dayStr, 10), targetHour, targetMin, 0);
      if (d.getTime() > now.getTime()) {
        results.push(formatIsoLocal(d));
      }
    }
    return { id: alarm.id, next: results.slice(0, count), disabled: false };
  }

  if (alarm.repeat === 'once') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMin, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    results.push(formatIsoLocal(d));
    return { id: alarm.id, next: results.slice(0, count), disabled: false };
  }

  if (alarm.repeat === 'daily') {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMin, 0);
    if (d.getTime() <= now.getTime()) {
      d.setDate(d.getDate() + 1);
    }
    while (results.length < count) {
      results.push(formatIsoLocal(new Date(d)));
      d.setDate(d.getDate() + 1);
    }
    return { id: alarm.id, next: results, disabled: false };
  }

  if (alarm.repeat === 'days') {
    const validDays = alarm.days && alarm.days.length > 0 ? alarm.days : [0, 1, 2, 3, 4, 5, 6];
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), targetHour, targetMin, 0);
    let iterations = 0;
    while (results.length < count && iterations < 365) {
      // 0 = Monday .. 6 = Sunday
      const weekday = (d.getDay() + 6) % 7;
      if (validDays.includes(weekday) && d.getTime() > now.getTime()) {
        results.push(formatIsoLocal(new Date(d)));
      }
      d.setDate(d.getDate() + 1);
      d.setHours(targetHour, targetMin, 0, 0);
      iterations++;
    }
    return { id: alarm.id, next: results, disabled: false };
  }

  if (alarm.repeat === 'interval') {
    const step = alarm.intervalMinutes || 60;
    const [wStartH, wStartM] = (alarm.windowStart || '00:00').split(':').map((s) => parseInt(s, 10) || 0);
    const [wEndH, wEndM] = (alarm.windowEnd || '23:59').split(':').map((s) => parseInt(s, 10) || 0);

    const checkDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let daysChecked = 0;

    while (results.length < count && daysChecked < 30) {
      const windowStartTime = new Date(checkDay.getFullYear(), checkDay.getMonth(), checkDay.getDate(), wStartH, wStartM, 0);
      const windowEndTime = new Date(checkDay.getFullYear(), checkDay.getMonth(), checkDay.getDate(), wEndH, wEndM, 0);

      let cur = new Date(windowStartTime);
      while (cur.getTime() <= windowEndTime.getTime() && results.length < count) {
        if (cur.getTime() > now.getTime()) {
          results.push(formatIsoLocal(new Date(cur)));
        }
        cur = new Date(cur.getTime() + step * 60 * 1000);
      }

      checkDay.setDate(checkDay.getDate() + 1);
      daysChecked++;
    }
    return { id: alarm.id, next: results, disabled: false };
  }

  return { id: alarm.id, next: [], disabled: false };
}

/**
 * Previews upcoming firing times for a list of alarms.
 * Calls Rust `alarm_preview` command when available; falls back to local computation.
 */
export async function previewAlarms(alarms: Alarm[], count = 3): Promise<AlarmPreview[]> {
  if (isTauri()) {
    try {
      const scheduled = alarms.map(alarmToScheduledAlarm);
      const res = await invoke<AlarmPreview[]>('alarm_preview', { alarms: scheduled, count });
      if (Array.isArray(res)) {
        return res;
      }
    } catch (err) {
      console.warn('alarm_preview IPC call failed, falling back to local calculation:', err);
    }
  }

  return alarms.map((a) => computeLocalAlarmPreview(a, count));
}
