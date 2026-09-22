import { describe, it, expect } from 'vitest';
import {
  formatDateKey,
  parseDateKey,
  isSameDay,
  addDays,
  addWeeks,
  addMonths,
  getWeekStart,
  getWeekEnd,
  getMonthStart,
  getMonthEnd,
  getCalendarWeekDays,
  getCalendarMonthGrid,
  eventSpansMidnight,
  isMultiDayEvent,
  isEventOnDay,
  filterEventsForDay,
  calculateEventSlot,
  tasksToCalendarEvents,
} from '../calendar';
import type { CalendarEvent } from '../events';
import type { TaskItem } from '../../types';

describe('calendar service (Wave 8 / R18)', () => {
  describe('date navigation and math', () => {
    it('formats and parses date keys consistently', () => {
      const d = new Date(2026, 8, 20); // Sep 20, 2026
      const key = formatDateKey(d);
      expect(key).toBe('2026-09-20');

      const parsed = parseDateKey('2026-09-20');
      expect(parsed.getFullYear()).toBe(2026);
      expect(parsed.getMonth()).toBe(8);
      expect(parsed.getDate()).toBe(20);
    });

    it('identifies same days regardless of time', () => {
      const d1 = new Date(2026, 8, 20, 9, 30);
      const d2 = new Date(2026, 8, 20, 23, 59);
      const d3 = new Date(2026, 8, 21, 0, 0);

      expect(isSameDay(d1, d2)).toBe(true);
      expect(isSameDay(d1, d3)).toBe(false);
    });

    it('adds days, weeks, and handles month boundaries correctly', () => {
      const base = new Date(2026, 0, 31); // Jan 31, 2026
      const nextDay = addDays(base, 1);
      expect(nextDay.getMonth()).toBe(1); // Feb 1
      expect(nextDay.getDate()).toBe(1);

      const dec31 = new Date(2026, 11, 31); // Dec 31, 2026
      const nextYear = addDays(dec31, 1);
      expect(nextYear.getFullYear()).toBe(2027);
      expect(nextYear.getMonth()).toBe(0);
      expect(nextYear.getDate()).toBe(1);

      const oneWeek = addWeeks(new Date(2026, 8, 14), 1);
      expect(formatDateKey(oneWeek)).toBe('2026-09-21');

      // Month addition with clamping (Jan 31 + 1 month -> Feb 28)
      const jan31 = new Date(2026, 0, 31);
      const feb = addMonths(jan31, 1);
      expect(feb.getMonth()).toBe(1);
      expect(feb.getDate()).toBe(28);

      // Leap year check: 2024 is leap year
      const jan31_2024 = new Date(2024, 0, 31);
      const feb2024 = addMonths(jan31_2024, 1);
      expect(feb2024.getMonth()).toBe(1);
      expect(feb2024.getDate()).toBe(29);
    });

    it('calculates week boundaries with Monday as first day', () => {
      // Sunday Sep 20, 2026
      const sunday = new Date(2026, 8, 20, 15, 30);
      const mon = getWeekStart(sunday);
      expect(mon.getDay()).toBe(1); // Monday
      expect(formatDateKey(mon)).toBe('2026-09-14');

      const sun = getWeekEnd(sunday);
      expect(sun.getDay()).toBe(0); // Sunday
      expect(formatDateKey(sun)).toBe('2026-09-20');

      // Monday Sep 14, 2026
      const monday = new Date(2026, 8, 14, 8, 0);
      expect(formatDateKey(getWeekStart(monday))).toBe('2026-09-14');
    });

    it('calculates month boundaries', () => {
      const sep = new Date(2026, 8, 15);
      expect(formatDateKey(getMonthStart(sep))).toBe('2026-09-01');
      expect(formatDateKey(getMonthEnd(sep))).toBe('2026-09-30');
    });
  });

  describe('week and month grid generation (8.1, 8.4)', () => {
    it('generates a 7-day week starting on Monday', () => {
      const date = new Date(2026, 8, 16); // Wed Sep 16, 2026
      const days = getCalendarWeekDays(date);

      expect(days).toHaveLength(7);
      expect(days[0].dayOfWeek).toBe(0); // Mon
      expect(days[0].dateKey).toBe('2026-09-14');
      expect(days[6].dayOfWeek).toBe(6); // Sun
      expect(days[6].dateKey).toBe('2026-09-20');
      expect(days[5].isWeekend).toBe(true);
      expect(days[6].isWeekend).toBe(true);
      expect(days[0].isWeekend).toBe(false);
    });

    it('generates a month grid with leading and trailing days (35 or 42 slots)', () => {
      // September 2026: starts on Tuesday (Sep 1), ends on Wednesday (Sep 30)
      // 1 leading Monday (Aug 31) + 30 days of Sep + 4 trailing days (Oct 1..4) = 35 days
      const grid = getCalendarMonthGrid(2026, 8, new Date(2026, 8, 20));

      expect([35, 42]).toContain(grid.length);
      expect(grid.length % 7).toBe(0);
      expect(grid[0].dayOfWeek).toBe(0); // First cell is always Monday

      // August 31 should be leading (not current month)
      expect(grid[0].dateKey).toBe('2026-08-31');
      expect(grid[0].isCurrentMonth).toBe(false);

      // September 1 should be current month
      expect(grid[1].dateKey).toBe('2026-09-01');
      expect(grid[1].isCurrentMonth).toBe(true);

      // Today should be marked correctly
      const todayCell = grid.find((d) => d.dateKey === '2026-09-20');
      expect(todayCell).toBeDefined();
      expect(todayCell?.isToday).toBe(true);
    });

    it('handles February transition in non-leap year (2026)', () => {
      // Feb 2026: starts on Sunday Feb 1, ends on Saturday Feb 28.
      const grid = getCalendarMonthGrid(2026, 1);
      expect(grid.length % 7).toBe(0);

      // Starts on Monday Jan 26, ends on Sunday Mar 1 or Mar 8
      const feb1 = grid.find((d) => d.dateKey === '2026-02-01');
      expect(feb1?.isCurrentMonth).toBe(true);
      const feb28 = grid.find((d) => d.dateKey === '2026-02-28');
      expect(feb28?.isCurrentMonth).toBe(true);
      const mar1 = grid.find((d) => d.dateKey === '2026-03-01');
      expect(mar1?.isCurrentMonth).toBe(false);
    });

    it('handles December to January year transition', () => {
      const grid = getCalendarMonthGrid(2026, 11); // Dec 2026
      expect(grid.length % 7).toBe(0);

      const jan1 = grid.find((d) => d.dateKey === '2027-01-01');
      expect(jan1).toBeDefined();
      expect(jan1?.isCurrentMonth).toBe(false);
    });
  });

  describe('midnight crossover and multi-day events (8.4)', () => {
    it('detects events spanning midnight', () => {
      const regular: CalendarEvent = {
        id: '1',
        source: 'local',
        title: 'Meeting',
        startAt: '2026-09-20T14:00:00',
        endAt: '2026-09-20T15:30:00',
        allDay: false,
        updated_at: '',
        deleted_at: null,
      };
      expect(eventSpansMidnight(regular)).toBe(false);
      expect(isMultiDayEvent(regular)).toBe(false);

      const midnightCrosser: CalendarEvent = {
        id: '2',
        source: 'local',
        title: 'Late Night Hackathon',
        startAt: '2026-09-20T22:00:00',
        endAt: '2026-09-21T03:00:00',
        allDay: false,
        updated_at: '',
        deleted_at: null,
      };
      expect(eventSpansMidnight(midnightCrosser)).toBe(true);

      const multiDay: CalendarEvent = {
        id: '3',
        source: 'google',
        title: 'Tech Conference',
        startAt: '2026-09-20T09:00:00',
        endAt: '2026-09-23T18:00:00',
        allDay: false,
        updated_at: '',
        deleted_at: null,
      };
      expect(eventSpansMidnight(multiDay)).toBe(true);
      expect(isMultiDayEvent(multiDay)).toBe(true);
    });

    it('filters events accurately for single days across midnight and multi-day spans', () => {
      const multiDayEvent: CalendarEvent = {
        id: 'e-multi',
        source: 'local',
        title: 'Festival',
        startAt: '2026-09-15T12:00:00',
        endAt: '2026-09-18T18:00:00',
        allDay: false,
        updated_at: '',
        deleted_at: null,
      };

      const events = [multiDayEvent];

      // Day before
      expect(filterEventsForDay(events, new Date(2026, 8, 14))).toHaveLength(0);
      // Start day
      expect(filterEventsForDay(events, new Date(2026, 8, 15))).toHaveLength(1);
      // Middle days
      expect(filterEventsForDay(events, new Date(2026, 8, 16))).toHaveLength(1);
      expect(filterEventsForDay(events, new Date(2026, 8, 17))).toHaveLength(1);
      // End day
      expect(filterEventsForDay(events, new Date(2026, 8, 18))).toHaveLength(1);
      // Day after
      expect(filterEventsForDay(events, new Date(2026, 8, 19))).toHaveLength(0);
    });

    it('clips event slots correctly for midnight crossing events', () => {
      const midnightEvent: CalendarEvent = {
        id: 'e-mid',
        source: 'local',
        title: 'Overnight shift',
        startAt: '2026-09-20T22:30:00',
        endAt: '2026-09-21T02:00:00',
        allDay: false,
        updated_at: '',
        deleted_at: null,
      };

      // Day 1 (Sep 20): starts at 22:30 (1350m), ends at midnight (1440m)
      const slotDay1 = calculateEventSlot(midnightEvent, new Date(2026, 8, 20));
      expect(slotDay1.startMinutes).toBe(22 * 60 + 30);
      expect(slotDay1.endMinutes).toBe(1440);
      expect(slotDay1.durationMinutes).toBe(90);
      expect(slotDay1.isCrossMidnight).toBe(true);

      // Day 2 (Sep 21): starts at midnight (0m), ends at 02:00 (120m)
      const slotDay2 = calculateEventSlot(midnightEvent, new Date(2026, 8, 21));
      expect(slotDay2.startMinutes).toBe(0);
      expect(slotDay2.endMinutes).toBe(120);
      expect(slotDay2.durationMinutes).toBe(120);
      expect(slotDay2.isCrossMidnight).toBe(true);
    });

    it('does not project midnight-ending events as ghost slots on the following day', () => {
      const midnightEndingEvent: CalendarEvent = {
        id: 'e-end-midnight',
        source: 'local',
        title: 'Late Meeting',
        startAt: '2026-09-20T23:00:00',
        endAt: '2026-09-21T00:00:00',
        allDay: false,
        updated_at: '',
        deleted_at: null,
      };

      // Day 1 (Sep 20): event is active
      expect(isEventOnDay(midnightEndingEvent, new Date(2026, 8, 20))).toBe(true);
      // Day 2 (Sep 21): event ends exactly at 00:00, must NOT be active on Sep 21
      expect(isEventOnDay(midnightEndingEvent, new Date(2026, 8, 21))).toBe(false);
      expect(filterEventsForDay([midnightEndingEvent], new Date(2026, 8, 21))).toHaveLength(0);
    });

    it('properly classifies all-day events', () => {
      const allDayEvent: CalendarEvent = {
        id: 'e-allday',
        source: 'google',
        title: 'National Holiday',
        startAt: '2026-09-20T00:00:00',
        endAt: '2026-09-20T23:59:59',
        allDay: true,
        updated_at: '',
        deleted_at: null,
      };

      const slot = calculateEventSlot(allDayEvent, new Date(2026, 8, 20));
      expect(slot.isAllDay).toBe(true);
      expect(slot.startMinutes).toBe(0);
      expect(slot.endMinutes).toBe(1440);
    });
  });

  describe('task projection into calendar events (8.3)', () => {
    it('projects tasks with dueDate and startAt into timed calendar events', () => {
      const tasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Write report',
          done: false,
          priority: 2,
          dueDate: '2026-09-20',
          startAt: '2026-09-20T10:00:00',
          plannedMinutes: 45,
          position: 0,
          createdAt: '',
        },
        {
          id: 'task-2',
          title: 'All day milestone',
          done: true,
          priority: 1,
          dueDate: '2026-09-20',
          startAt: null,
          plannedMinutes: null,
          position: 1,
          createdAt: '',
        },
        {
          id: 'task-3',
          title: 'Unscheduled backlog task',
          done: false,
          priority: 0,
          dueDate: null,
          startAt: null,
          position: 2,
          createdAt: '',
        },
      ];

      const projected = tasksToCalendarEvents(tasks);
      expect(projected).toHaveLength(2); // task-3 has no dueDate -> not in calendar

      const timed = projected.find((p) => p.id === 'task-event-task-1');
      expect(timed).toBeDefined();
      expect(timed?.allDay).toBe(false);
      expect(timed?.startAt).toBe('2026-09-20T10:00:00');
      expect(timed?.endAt).toContain('10:45');
      expect(timed?.taskId).toBe('task-1');

      const allDay = projected.find((p) => p.id === 'task-event-task-2');
      expect(allDay).toBeDefined();
      expect(allDay?.allDay).toBe(true);
      expect(allDay?.startAt).toContain('2026-09-20');
    });

    it('projects tasks with startAt but no dueDate into timed calendar events', () => {
      const tasks: TaskItem[] = [
        {
          id: 'task-start-only',
          title: 'Scheduled without dueDate',
          done: false,
          priority: 0,
          dueDate: null,
          startAt: '2026-09-20T14:00:00',
          plannedMinutes: 60,
          position: 0,
          createdAt: '',
        },
      ];

      const projected = tasksToCalendarEvents(tasks);
      expect(projected).toHaveLength(1);
      expect(projected[0].id).toBe('task-event-task-start-only');
      expect(projected[0].allDay).toBe(false);
      expect(projected[0].startAt).toBe('2026-09-20T14:00:00');
      expect(projected[0].endAt).toContain('15:00:00');
      expect(projected[0].taskId).toBe('task-start-only');
    });
  });
});
