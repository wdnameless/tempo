import type { StoredSession } from './sessionStore';
import type { TaskItem } from '../types';

export interface DayBucket {
  date: string;
  seconds: number;
}

/**
 * Returns YYYY-MM-DD in local time.
 * Day boundaries are strictly LOCAL, not UTC.
 */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Returns a new Date set to the Monday of the given date's week at 00:00:00.000 local time.
 * Weeks start on Monday per interfaces §20.
 */
export function weekStart(date: Date): Date {
  const result = new Date(date);
  result.setHours(0, 0, 0, 0);
  const day = result.getDay();
  // Sunday is 0, Monday is 1, ..., Saturday is 6
  // Days to subtract to reach Monday:
  // Mon (1) -> 0, Tue (2) -> 1, ..., Sun (0) -> 6
  const diff = (day + 6) % 7;
  result.setDate(result.getDate() - diff);
  return result;
}

/**
 * Returns the Monday YYYY-MM-DD string for the week containing `date`.
 */
export function weekKey(date: Date): string {
  return dayKey(weekStart(date));
}

/** Parses session started_at or returns null if malformed. */
function parseSessionDate(session: StoredSession): Date | null {
  if (!session.started_at) return null;
  const d = new Date(session.started_at);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Every row in the `sessions` table is focus time: `timer.rs` writes only
 * pomodoro and stopwatch sessions, and a break never reaches the table. That is
 * why nothing below filters by kind — the filter would be a rule that can never
 * fire, and a reader would have to check the timer to find that out.
 */

/**
 * Returns focus duration in seconds for the last `days` local days.
 * If days is omitted, aggregates all sessions by local day key.
 * Every day in the range is present (empty days are 0, not gaps).
 */
export function focusByDay(
  sessions: StoredSession[],
  days?: number,
  now: Date = new Date(),
): DayBucket[] & Record<string, number> {
  const map: Record<string, number> = {};

  for (const s of sessions) {
    const d = parseSessionDate(s);
    if (!d) continue;
    const key = dayKey(d);
    map[key] = (map[key] || 0) + (s.duration_sec || 0);
  }

  if (typeof days !== 'number') {
    // Return record object which can be accessed by key or iterated
    return map as unknown as DayBucket[] & Record<string, number>;
  }

  const buckets: DayBucket[] = [];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const key = dayKey(d);
    buckets.push({
      date: key,
      seconds: map[key] || 0,
    });
  }

  // Assign map properties so callers expecting map[key] or DayBucket[] both work
  const resultWithMap = buckets as unknown as DayBucket[] & Record<string, number>;
  for (const k of Object.keys(map)) {
    resultWithMap[k] = map[k];
  }

  return resultWithMap;
}

/**
 * Returns focus duration in seconds for the last `weeks` weeks (Monday to Sunday).
 * If weeks is omitted, aggregates all sessions by Monday weekKey.
 */
export function focusByWeek(
  sessions: StoredSession[],
  weeks?: number,
  now: Date = new Date(),
): DayBucket[] & Record<string, number> {
  const map: Record<string, number> = {};

  for (const s of sessions) {
    const d = parseSessionDate(s);
    if (!d) continue;
    const key = weekKey(d);
    map[key] = (map[key] || 0) + (s.duration_sec || 0);
  }

  if (typeof weeks !== 'number') {
    return map as unknown as DayBucket[] & Record<string, number>;
  }

  const buckets: DayBucket[] = [];
  const currentWeekMonday = weekStart(now);

  for (let i = weeks - 1; i >= 0; i--) {
    const w = new Date(currentWeekMonday);
    w.setDate(currentWeekMonday.getDate() - i * 7);
    const key = dayKey(w);
    buckets.push({
      date: key,
      seconds: map[key] || 0,
    });
  }

  const resultWithMap = buckets as unknown as DayBucket[] & Record<string, number>;
  for (const k of Object.keys(map)) {
    resultWithMap[k] = map[k];
  }

  return resultWithMap;
}

/**
 * Heatmap: returns `weeks * 7` buckets (oldest week first, Monday first).
 * An array of DayBucket (length weeks * 7).
 * Empty days are 0, not omitted.
 */
export function heatmap(
  sessions: StoredSession[],
  weeks = 12,
  now: Date = new Date(),
): DayBucket[] {
  // Aggregate all focus sessions into a map by local dayKey
  const map: Record<string, number> = {};
  for (const s of sessions) {
    const d = parseSessionDate(s);
    if (!d) continue;
    const key = dayKey(d);
    map[key] = (map[key] || 0) + (s.duration_sec || 0);
  }

  // The grid spans `weeks` full weeks, starting Monday of (weeks - 1) weeks ago
  const currentMonday = weekStart(now);
  const startMonday = new Date(currentMonday);
  startMonday.setDate(currentMonday.getDate() - (weeks - 1) * 7);

  const result: DayBucket[] = [];
  const totalDays = weeks * 7;

  for (let i = 0; i < totalDays; i++) {
    const d = new Date(startMonday);
    d.setDate(startMonday.getDate() + i);
    const key = dayKey(d);
    result.push({
      date: key,
      seconds: map[key] || 0,
    });
  }

  return result;
}

/**
 * Focus by hour of day (0..23) based on session started_at local hour.
 * Returns exactly 24 elements with aggregated seconds.
 */
export function focusByHour(sessions: StoredSession[]): number[] {
  const hours = new Array<number>(24).fill(0);

  for (const s of sessions) {
    const d = parseSessionDate(s);
    if (!d) continue;
    const h = d.getHours();
    hours[h] += s.duration_sec || 0;
  }

  return hours;
}

/**
 * Returns the hour (0..23) with the maximum focus seconds, or null if no focus recorded.
 */
export function peakHour(sessions: StoredSession[]): number | null {
  const hours = focusByHour(sessions);
  let maxSec = 0;
  let bestHour: number | null = null;

  for (let h = 0; h < 24; h++) {
    if (hours[h] > maxSec) {
      maxSec = hours[h];
      bestHour = h;
    }
  }

  return bestHour;
}

/**
 * Counts finished pomodoro focus sessions that were completed.
 */
export function pomodoroCount(sessions: StoredSession[]): number {
  return sessions.filter((s) => s.kind === 'pomodoro' && s.completed === true).length;
}

/**
 * Current streak in days.
 * A day counts as active if total focus minutes >= minMinutes (default 1 min).
 * A skipped day breaks the streak. Today counts if active; if today is not active yet,
 * yesterday counts as extending the streak.
 */
export function currentStreak(
  sessions: StoredSession[],
  minMinutesOrNow: number | Date = 1,
  optionalNow?: Date,
): number {
  const minMinutes = typeof minMinutesOrNow === 'number' ? minMinutesOrNow : 1;
  const now = minMinutesOrNow instanceof Date ? minMinutesOrNow : (optionalNow ?? new Date());

  // Aggregate focus seconds by local day
  const dayTotals: Record<string, number> = {};
  for (const s of sessions) {
    const d = parseSessionDate(s);
    if (!d) continue;
    const key = dayKey(d);
    dayTotals[key] = (dayTotals[key] || 0) + (s.duration_sec || 0);
  }

  const minSec = minMinutes * 60;
  const todayKey = dayKey(now);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const yesterdayKey = dayKey(yesterday);

  const active = (key: string) => (dayTotals[key] || 0) >= minSec;

  // Today may simply not have happened yet: a streak that dies at midnight and
  // revives after the first session would be telling the user they broke a habit
  // they have not broken.
  let cursor: Date;
  if (active(todayKey)) {
    cursor = new Date(now);
  } else if (active(yesterdayKey)) {
    cursor = yesterday;
  } else {
    return 0;
  }

  let streak = 0;
  while (active(dayKey(cursor))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

/**
 * Longest streak in days across all session history.
 */
export function longestStreak(sessions: StoredSession[], minMinutes = 1): number {
  const dayTotals: Record<string, number> = {};
  for (const s of sessions) {
    const d = parseSessionDate(s);
    if (!d) continue;
    const key = dayKey(d);
    dayTotals[key] = (dayTotals[key] || 0) + (s.duration_sec || 0);
  }

  const minSec = minMinutes * 60;
  const activeDays = Object.keys(dayTotals)
    .filter((k) => dayTotals[k] >= minSec)
    .sort(); // Lexicographical sort works for YYYY-MM-DD

  if (activeDays.length === 0) return 0;

  let maxStreak = 1;
  let currStreak = 1;

  for (let i = 1; i < activeDays.length; i++) {
    const prev = new Date(
      Number(activeDays[i - 1].slice(0, 4)),
      Number(activeDays[i - 1].slice(5, 7)) - 1,
      Number(activeDays[i - 1].slice(8, 10)),
    );
    const curr = new Date(
      Number(activeDays[i].slice(0, 4)),
      Number(activeDays[i].slice(5, 7)) - 1,
      Number(activeDays[i].slice(8, 10)),
    );

    prev.setDate(prev.getDate() + 1);
    if (dayKey(prev) === dayKey(curr)) {
      currStreak++;
      if (currStreak > maxStreak) {
        maxStreak = currStreak;
      }
    } else {
      currStreak = 1;
    }
  }

  return maxStreak;
}

export interface DayCompletion {
  day: string;
  done: number;
  created: number;
}

/**
 * Groups tasks by completed_at local day.
 * If `days` is provided, returns an array of DayCompletion for the last `days` days.
 * If `days` is omitted, returns Record<string, number> counting completions per day.
 *
 * NOTE ON CREATED: Tasks table carries created / updated_at, but TaskItem interface has created/completed_at.
 * If created is present on TaskItem, it counts tasks created that day; otherwise created is 0.
 */
export function completionByDay(
  tasks: TaskItem[],
  days?: number,
  now: Date = new Date(),
): DayCompletion[] & Record<string, number> {
  const doneMap: Record<string, number> = {};
  const createdMap: Record<string, number> = {};

  for (const t of tasks) {
    const tAny = t as unknown as Record<string, unknown>;
    const completedStr = (typeof t.completedAt === 'string' ? t.completedAt : null)
      ?? (typeof tAny.completed_at === 'string' ? tAny.completed_at : null);

    if (completedStr) {
      const cd = new Date(completedStr);
      if (!Number.isNaN(cd.getTime())) {
        const key = dayKey(cd);
        doneMap[key] = (doneMap[key] || 0) + 1;
      }
    }

    const createdStr = (typeof t.createdAt === 'string' ? t.createdAt : null)
      ?? (typeof tAny.created === 'string' ? tAny.created : null)
      ?? (typeof tAny.created_at === 'string' ? tAny.created_at : null);
    if (typeof createdStr === 'string') {
      const crd = new Date(createdStr);
      if (!Number.isNaN(crd.getTime())) {
        const key = dayKey(crd);
        createdMap[key] = (createdMap[key] || 0) + 1;
      }
    }
  }

  if (typeof days !== 'number') {
    return doneMap as unknown as DayCompletion[] & Record<string, number>;
  }

  const result: DayCompletion[] = [];
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(base.getDate() - i);
    const key = dayKey(d);
    result.push({
      day: key,
      done: doneMap[key] || 0,
      created: createdMap[key] || 0,
    });
  }

  const resultWithMap = result as unknown as DayCompletion[] & Record<string, number>;
  for (const k of Object.keys(doneMap)) {
    resultWithMap[k] = doneMap[k];
  }

  return resultWithMap;
}


/** Backward compatibility helper while StatsView finishes rebuild. */
export function totalFocusedSec(sessions: StoredSession[]): number {
  return sessions.reduce((acc, s) => acc + (s.duration_sec || 0), 0);
}

/** Backward compatibility helper while StatsView finishes rebuild. */
export function trailingDays(days: number): string[] {
  const out: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() - i);
    out.push(dayKey(d));
  }
  return out;
}
/**
 * Task completion progress metrics.
 * Supports both §20 shape { done, total } and { completed, total, rate }.
 */
export function taskProgress(tasks: TaskItem[]): {
  done: number;
  completed: number;
  total: number;
  rate: number;
} {
  const total = tasks.length;
  const completed = tasks.filter((t) => {
    const tAny = t as unknown as Record<string, unknown>;
    return t.done || tAny.status === 'done' || tAny.status === 'completed';
  }).length;
  const rate = total === 0 ? 0 : completed / total;

  return {
    done: completed,
    completed,
    total,
    rate,
  };
}

/**
 * Formats seconds into human readable duration (e.g. "25m", "1h 30m").
 */
export function formatFocus(seconds: number): string {
  const totalMin = Math.round(seconds / 60);
  if (totalMin < 60) {
    return `${totalMin}m`;
  }
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${h}h ${m}m`;
}
