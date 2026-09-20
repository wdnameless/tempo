/**
 * Task Rollover (R40)
 *
 * Automatically moves unfinished tasks with due dates in the past to today
 * once a specified local hour has passed (default 03:00).
 *
 * All date calculations use LOCAL dates ("YYYY-MM-DD") so crossing midnight
 * or changing time zones does not introduce UTC drift.
 */

import { getPref, setPref } from './settings';
import { listTasks, updateTask } from './tasks';

export interface RolloverSettings {
  enabled: boolean;
  afterHour: number;
}

export interface RolloverResult {
  moved: number;
  cleared: number;
}

/**
 * Returns current rollover settings.
 * Disabled by default. Default rollover hour is 3 (03:00 local time).
 */
export function rolloverSettings(): RolloverSettings {
  const enabled = getPref<boolean>('tempo_rollover_enabled', false);
  const afterHour = getPref<number>('tempo_rollover_hour', 3);
  return { enabled, afterHour };
}

/**
 * Updates rollover settings.
 */
export async function setRolloverSettings(next: Partial<RolloverSettings>): Promise<void> {
  if (next.enabled !== undefined) {
    await setPref('tempo_rollover_enabled', next.enabled);
  }
  if (next.afterHour !== undefined) {
    await setPref('tempo_rollover_hour', next.afterHour);
  }
}

/**
 * Returns the user's local time zone and UTC offset as a human-readable string.
 * e.g., "Europe/Berlin (UTC+1)" or "America/New_York (UTC-5)".
 */
export function localTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const offsetMinutes = -new Date().getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? '+' : '-';
  const absMinutes = Math.abs(offsetMinutes);
  const hours = Math.floor(absMinutes / 60);
  const mins = absMinutes % 60;
  const formattedOffset = mins === 0 ? `UTC${sign}${hours}` : `UTC${sign}${hours}:${mins.toString().padStart(2, '0')}`;
  return `${timeZone} (${formattedOffset})`;
}

/**
 * Formats a Date into a local "YYYY-MM-DD" key.
 */
function toLocalDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Executes task rollover.
 *
 * - If disabled, returns { moved: 0, cleared: 0 } immediately with no writes.
 * - If current local hour is before `afterHour`, returns { moved: 0, cleared: 0 }.
 * - When enabled and at or after `afterHour`:
 *   Finds every unfinished task whose dueDate is strictly before today ("YYYY-MM-DD" lexicographical comparison).
 *   Updates each task's dueDate to today, and clears startAt (scheduled time slot).
 *   Tasks without dueDate or already dated today/future are untouched.
 *   Idempotent: "dueDate < today" ensures a task already moved to today is never moved again.
 *
 * @param now Optional date override (defaults to new Date()) for testing.
 */
export async function runRollover(now: Date = new Date()): Promise<RolloverResult> {
  const settings = rolloverSettings();
  if (!settings.enabled) {
    return { moved: 0, cleared: 0 };
  }

  const currentHour = now.getHours();
  if (currentHour < settings.afterHour) {
    return { moved: 0, cleared: 0 };
  }

  const todayKey = toLocalDateKey(now);
  const allTasks = await listTasks();

  let moved = 0;
  let cleared = 0;

  for (const task of allTasks) {
    // Only process unfinished tasks with a due date strictly before today
    if (task.done) {
      continue;
    }
    if (!task.dueDate) {
      continue;
    }
    if (task.dueDate >= todayKey) {
      continue;
    }

    // Task is overdue and unfinished: move to today and clear startAt
    const hadStartAt = !!task.startAt;
    await updateTask(task.id, {
      dueDate: todayKey,
      startAt: null,
    });

    moved += 1;
    if (hadStartAt) {
      cleared += 1;
    }
  }

  return { moved, cleared };
}
