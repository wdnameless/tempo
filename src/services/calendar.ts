import type { CalendarEvent } from './events';
import type { TaskItem } from '../types';
import { dayKey } from './stats';

export type CalendarViewMode = 'month' | 'week' | 'day';

export interface CalendarDay {
  date: Date;
  dateKey: string; // 'YYYY-MM-DD'
  isCurrentMonth: boolean;
  isToday: boolean;
  isWeekend: boolean;
  dayOfWeek: number; // 0 = Monday, 6 = Sunday
}

export interface EventSlot {
  event: CalendarEvent;
  startMinutes: number; // 0..1440 minutes from midnight
  endMinutes: number; // 0..1440 minutes from midnight
  durationMinutes: number;
  isAllDay: boolean;
  isCrossMidnight: boolean;
  isMultiDay: boolean;
  isTask?: boolean;
  taskDone?: boolean;
}

/**
 * Format a Date to 'YYYY-MM-DD' in local time.
 */
export const formatDateKey = dayKey;
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 0, 0, 0, 0);
}

/**
 * Returns true if two dates fall on the same calendar day in local time.
 */
export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Adds days to a date, returning a new Date instance.
 */
export function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Adds weeks to a date.
 */
export function addWeeks(date: Date, weeks: number): Date {
  return addDays(date, weeks * 7);
}

/**
 * Adds months to a date, adjusting day of month if necessary.
 */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date);
  const targetMonth = result.getMonth() + months;
  result.setMonth(targetMonth);
  // If date overflowed (e.g. Jan 31 + 1 month -> March 3), snap to last day of target month
  if (result.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    result.setDate(0);
  }
  return result;
}

/**
 * Gets the Monday of the week containing the given date (at 00:00:00.000).
 */
export function getWeekStart(date: Date): Date {
  const result = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0, 0);
  // getDay(): 0 is Sunday, 1 is Monday ... 6 is Saturday
  const day = result.getDay();
  // Monday is 0 offset, Sunday is 6 offset
  const diff = day === 0 ? -6 : 1 - day;
  result.setDate(result.getDate() + diff);
  return result;
}
/**
 * Gets the Sunday of the week containing the given date (at 23:59:59.999).
 */
export function getWeekEnd(date: Date): Date {
  const start = getWeekStart(date);
  return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6, 23, 59, 59, 999);
}

/**
 * Gets the first instant of the month (1st at 00:00:00.000).
 */
export function getMonthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1, 0, 0, 0, 0);
}

/**
 * Gets the last instant of the month (last day at 23:59:59.999).
 */
export function getMonthEnd(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0, 23, 59, 59, 999);
}

/**
 * Gets the 7 days of the week containing the given date (Monday to Sunday).
 */
export function getCalendarWeekDays(date: Date, today: Date = new Date()): CalendarDay[] {
  const monday = getWeekStart(date);
  const days: CalendarDay[] = [];

  for (let i = 0; i < 7; i++) {
    const current = addDays(monday, i);
    const dayOfWeek = (current.getDay() + 6) % 7; // Mon=0 .. Sun=6
    days.push({
      date: current,
      dateKey: formatDateKey(current),
      isCurrentMonth: current.getMonth() === date.getMonth(),
      isToday: isSameDay(current, today),
      isWeekend: dayOfWeek >= 5,
      dayOfWeek,
    });
  }

  return days;
}

/**
 * Generates the full calendar month grid (35 or 42 days, starting on Monday).
 * Includes trailing days from the previous month and leading days from the next month.
 */
export function getCalendarMonthGrid(year: number, month: number, today: Date = new Date()): CalendarDay[] {
  // First day of target month
  const firstOfMonth = new Date(year, month, 1, 0, 0, 0, 0);
  // Last day of target month
  const lastOfMonth = new Date(year, month + 1, 0, 23, 59, 59, 999);

  // Day of week for first day (0=Monday .. 6=Sunday)
  const firstDayOfWeek = (firstOfMonth.getDay() + 6) % 7;

  // Grid start is the Monday on or before firstOfMonth
  const gridStart = addDays(firstOfMonth, -firstDayOfWeek);

  const days: CalendarDay[] = [];
  let current = new Date(gridStart);

  // We need at least enough days to reach lastOfMonth, rounded up to full weeks (multiples of 7)
  while (current <= lastOfMonth || days.length % 7 !== 0 || days.length < 35) {
    const dayOfWeek = (current.getDay() + 6) % 7;
    days.push({
      date: new Date(current),
      dateKey: formatDateKey(current),
      isCurrentMonth: current.getMonth() === month,
      isToday: isSameDay(current, today),
      isWeekend: dayOfWeek >= 5,
      dayOfWeek,
    });
    current = addDays(current, 1);
  }

  return days;
}

/**
 * Checks if an event crosses midnight in local time.
 */
export function isCrossMidnight(start: Date, end: Date): boolean {
  return !isSameDay(start, end);
}

/**
 * Checks if an event spans multiple days (duration >= 24h or crosses 2+ calendar midnights).
 */
export function isMultiDay(start: Date, end: Date): boolean {
  return end.getTime() - start.getTime() >= 24 * 60 * 60 * 1000;
}
/**
 * Returns true if an event crosses calendar midnight.
 */
export function eventSpansMidnight(event: CalendarEvent): boolean {
  const { start, end } = parseEventDates(event);
  return isCrossMidnight(start, end);
}

/**
 * Returns true if an event duration is 24 hours or more.
 */
export function isMultiDayEvent(event: CalendarEvent): boolean {
  const { start, end } = parseEventDates(event);
  return isMultiDay(start, end);
}

/**
 * Parses event start and end timestamps into local Date objects.
 */
export function parseEventDates(event: CalendarEvent): { start: Date; end: Date } {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return {
    start: Number.isNaN(start.getTime()) ? new Date() : start,
    end: Number.isNaN(end.getTime()) ? new Date() : end,
  };
}

/**
 * Determines if a calendar event is active on a specific calendar day (local time).
 * Correctly handles:
 * - All-day events spanning single or multiple days
 * - Timed events starting and ending on the same day
 * - Timed events crossing midnight
 * - Multi-day continuous events
 */
export function isEventOnDay(event: CalendarEvent, targetDate: Date): boolean {
  const targetKey = formatDateKey(targetDate);

  if (event.allDay) {
    const startKey = event.startAt.slice(0, 10);
    const endKey = event.endAt ? event.endAt.slice(0, 10) : startKey;
    return targetKey >= startKey && targetKey <= endKey;
  }

  const { start, end } = parseEventDates(event);
  const dayStart = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 0, 0, 0, 0);
  const dayEnd = new Date(targetDate.getFullYear(), targetDate.getMonth(), targetDate.getDate(), 23, 59, 59, 999);

  return start <= dayEnd && end > dayStart;
}

/**
 * Filters and returns all events that are active on a specific day.
 */
export function filterEventsForDay(events: CalendarEvent[], targetDate: Date): CalendarEvent[] {
  return events.filter((e) => isEventOnDay(e, targetDate));
}

/**
 * Calculates slot rendering metrics for an event on a given day (0..1440 minutes).
 * Clips events crossing midnight so they display neatly within the day's boundaries.
 */
export function calculateEventSlot(event: CalendarEvent, targetDate: Date): EventSlot {
  if (event.allDay) {
    return {
      event,
      startMinutes: 0,
      endMinutes: 1440,
      durationMinutes: 1440,
      isAllDay: true,
      isCrossMidnight: false,
      isMultiDay: isEventOnDay(event, addDays(targetDate, 1)),
      isTask: event.source === 'local' && Boolean(event.taskId),
    };
  }

  const { start, end } = parseEventDates(event);
  const targetKey = formatDateKey(targetDate);
  const startKey = formatDateKey(start);
  const endKey = formatDateKey(end);

  const crossMidnight = isCrossMidnight(start, end);
  const multiDay = isMultiDay(start, end);

  // If start is before this day, clamp startMinutes to 0 (midnight)
  let startMinutes = 0;
  if (startKey === targetKey) {
    startMinutes = start.getHours() * 60 + start.getMinutes();
  }

  // If end is after this day, clamp endMinutes to 1440 (end of day)
  let endMinutes = 1440;
  if (endKey === targetKey) {
    endMinutes = end.getHours() * 60 + end.getMinutes();
  }

  // Guard against inverted or zero intervals
  if (endMinutes <= startMinutes) {
    endMinutes = Math.min(1440, startMinutes + 30);
  }

  return {
    event,
    startMinutes,
    endMinutes,
    durationMinutes: endMinutes - startMinutes,
    isAllDay: false,
    isCrossMidnight: crossMidnight,
    isMultiDay: multiDay,
    isTask: event.source === 'local' && Boolean(event.taskId),
  };
}

/**
 * Projects tasks with dueDate into virtual CalendarEvents so they can be
 * displayed on the calendar timeline alongside regular events (R18).
 */
export function tasksToCalendarEvents(tasks: TaskItem[]): CalendarEvent[] {
  const result: CalendarEvent[] = [];

  for (const task of tasks) {
    const taskDate = task.dueDate || (task.startAt ? task.startAt.slice(0, 10) : null);
    if (!taskDate) continue;

    const isAllDay = !task.startAt;
    let startAt: string;
    let endAt: string;

    if (task.startAt) {
      startAt = task.startAt;
      const startDate = new Date(task.startAt);
      if (!Number.isNaN(startDate.getTime())) {
        const dur = task.plannedMinutes && task.plannedMinutes > 0 ? task.plannedMinutes : 30;
        const endDate = new Date(startDate.getTime() + dur * 60 * 1000);
        const isUtc = task.startAt.endsWith('Z');
        if (isUtc) {
          endAt = endDate.toISOString();
        } else {
          const pad = (n: number) => String(n).padStart(2, '0');
          endAt = `${endDate.getFullYear()}-${pad(endDate.getMonth() + 1)}-${pad(endDate.getDate())}T${pad(endDate.getHours())}:${pad(endDate.getMinutes())}:${pad(endDate.getSeconds())}`;
        }
      } else {
        endAt = `${taskDate}T09:30:00`;
      }
    } else {
      startAt = `${taskDate}T00:00:00`;
      endAt = `${taskDate}T23:59:59`;
    }

    result.push({
      id: `task-event-${task.id}`,
      source: 'local',
      title: task.title,
      startAt,
      endAt,
      allDay: isAllDay,
      taskId: task.id,
      location: null,
      updated_at: task.createdAt,
      deleted_at: null,
    });
  }

  return result;
}

/**
 * Formats a period header according to current view mode and language.
 */
export function formatCalendarPeriod(
  date: Date,
  viewMode: CalendarViewMode,
  locale: string = 'ru'
): string {
  const lang = locale.startsWith('ru') ? 'ru-RU' : 'en-US';

  if (viewMode === 'month') {
    return date.toLocaleDateString(lang, { month: 'long', year: 'numeric' });
  }

  if (viewMode === 'week') {
    const start = getWeekStart(date);
    const end = addDays(start, 6);
    const startStr = start.toLocaleDateString(lang, { day: 'numeric', month: 'short' });
    const endStr = end.toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' });
    return `${startStr} — ${endStr}`;
  }

  // day mode
  return date.toLocaleDateString(lang, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}
