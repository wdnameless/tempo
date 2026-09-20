import { dayKey } from './stats';
import type { TaskItem } from '../types';
import type { CalendarEvent } from './events';

export { dayKey };

export interface DaySlot {
  startMin: number;
  endMin: number;
}

export interface DayItem {
  kind: 'task' | 'event';
  id: string;
  title: string;
  startMin: number | null;
  endMin: number | null;
  allDay: boolean;
  done: boolean;
  source: 'google' | 'local' | null;
  ref: TaskItem | CalendarEvent;
}

export interface BuildDayInput {
  date: Date;
  tasks: TaskItem[];
  events: CalendarEvent[];
}

export interface ConflictPair {
  a: DayItem;
  b: DayItem;
}

/**
 * Returns start of the day (00:00:00.000) in local time.
 */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
}

/**
 * Returns end of the day (start of the next local day 00:00:00.000) in local time.
 */
function endOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1, 0, 0, 0, 0);
}

/**
 * Parses a date string (ISO or YYYY-MM-DD or other format) into a Date object.
 * If invalid, returns null.
 */
function parseDate(dateStr: string | null | undefined): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Builds the day schedule for a given local date from tasks and events.
 *
 * Rules:
 * - Tasks whose `dueDate` is that day (`YYYY-MM-DD` match), OR
 * - Tasks whose `startAt` falls on that local day.
 * - Events overlapping that local day:
 *   An event with [start, end) overlaps local day [dayStart, dayEnd) iff:
 *   event.start < dayEnd && event.end > dayStart.
 *   An event spanning midnight belongs to both days it touches.
 * - All-day events have `allDay: true` and `startMin: null`, `endMin: null`.
 * - Timed items have `startMin` and `endMin` as minutes from local midnight of `date`.
 *   Clipped or shifted: if an event started before this day, startMin is clamped to 0.
 *   If an event ends after this day, endMin is clamped to 1440 (24 * 60).
 */
export function buildDay({ date, tasks, events }: BuildDayInput): DayItem[] {
  const targetKey = dayKey(date);
  const dayStart = startOfLocalDay(date);
  const dayEnd = endOfLocalDay(date);
  const dayStartMs = dayStart.getTime();

  const items: DayItem[] = [];

  // Process Tasks
  for (const task of tasks) {
    const taskDueMatches = task.dueDate === targetKey;
    const taskStartDate = parseDate(task.startAt);
    const taskStartMatches = taskStartDate !== null && dayKey(taskStartDate) === targetKey;

    if (!taskDueMatches && !taskStartMatches) {
      continue;
    }

    let startMin: number | null = null;
    let endMin: number | null = null;

    if (taskStartDate !== null && taskStartMatches) {
      startMin = taskStartDate.getHours() * 60 + taskStartDate.getMinutes();
      const durationMin = task.plannedMinutes && task.plannedMinutes > 0 ? task.plannedMinutes : 30;
      endMin = startMin + durationMin;
    }

    items.push({
      kind: 'task',
      id: task.id,
      title: task.title,
      startMin,
      endMin,
      allDay: false,
      done: task.done,
      source: null,
      ref: task,
    });
  }

  // Process Events
  for (const event of events) {
    if (event.allDay) {
      // For all-day events, check if targetKey falls within [startDayKey, endDayKey].
      // All-day startAt is typically "YYYY-MM-DD" or ISO date.
      const startKey = event.startAt.slice(0, 10);
      const endKey = event.endAt ? event.endAt.slice(0, 10) : startKey;

      if (targetKey >= startKey && targetKey <= endKey) {
        items.push({
          kind: 'event',
          id: event.id,
          title: event.title,
          startMin: null,
          endMin: null,
          allDay: true,
          done: false,
          source: event.source,
          ref: event,
        });
      }
      continue;
    }

    const eventStart = parseDate(event.startAt);
    const eventEnd = parseDate(event.endAt);

    if (!eventStart || !eventEnd) {
      continue;
    }

    const startMs = eventStart.getTime();
    const endMs = eventEnd.getTime();

    // Overlap condition: eventStart < dayEnd && eventEnd > dayStart
    if (startMs < dayEnd.getTime() && endMs > dayStartMs) {
      // Calculate minutes relative to local midnight of `date`
      // Clamp to [0, 1440] for the view of this day
      const rawStartMin = Math.round((startMs - dayStartMs) / (60 * 1000));
      const rawEndMin = Math.round((endMs - dayStartMs) / (60 * 1000));

      const clampedStartMin = Math.max(0, Math.min(1440, rawStartMin));
      const clampedEndMin = Math.max(0, Math.min(1440, rawEndMin));

      items.push({
        kind: 'event',
        id: event.id,
        title: event.title,
        startMin: clampedStartMin,
        endMin: clampedEndMin,
        allDay: false,
        done: false,
        source: event.source,
        ref: event,
      });
    }
  }

  return items;
}

/**
 * Finds conflicts between items in the day.
 *
 * Rules:
 * - Two items conflict if their time ranges overlap: [start, end) half-open.
 * - Touching ranges (a.end === b.start or b.end === a.start) do NOT conflict.
 * - A point in time does not overlap itself (e.g. 0-duration or identical point).
 * - All-day items are NEVER conflicts.
 * - Items with null startMin or endMin are NEVER conflicts.
 * - Returns `{ a, b }` once per pair.
 */
export function findConflicts(items: DayItem[]): ConflictPair[] {
  const timedItems = items.filter(
    (item): item is DayItem & { startMin: number; endMin: number } =>
      !item.allDay && item.startMin !== null && item.endMin !== null && item.endMin > item.startMin,
  );

  const conflicts: ConflictPair[] = [];

  for (let i = 0; i < timedItems.length; i++) {
    for (let j = i + 1; j < timedItems.length; j++) {
      const a = timedItems[i];
      const b = timedItems[j];

      // Overlap of [a.start, a.end) and [b.start, b.end)
      // a.start < b.end && b.start < a.end
      if (a.startMin < b.endMin && b.startMin < a.endMin) {
        conflicts.push({ a, b });
      }
    }
  }

  return conflicts;
}
