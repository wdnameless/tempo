import { describe, expect, it } from 'vitest';
import { dayKey, buildDay, findConflicts, type DayItem } from '../day';
import type { TaskItem } from '../../types';
import type { CalendarEvent } from '../events';

function makeTask(partial: Partial<TaskItem> & { id: string; title: string }): TaskItem {
  return {
    done: false,
    priority: 0,
    position: 0,
    listId: null,
    parentId: null,
    note: undefined,
    dueDate: null,
    startAt: null,
    plannedMinutes: null,
    createdAt: '2026-09-20T00:00:00.000Z',
    completedAt: null,
    ...partial,
  };
}

function makeEvent(partial: Partial<CalendarEvent> & { id: string; title: string; startAt: string; endAt: string }): CalendarEvent {
  return {
    source: 'local',
    googleId: null,
    calendarId: null,
    allDay: false,
    location: null,
    taskId: null,
    updated_at: '2026-09-20T00:00:00.000Z',
    deleted_at: null,
    ...partial,
  };
}

describe('day service', () => {
  describe('dayKey', () => {
    it('returns local date formatted as YYYY-MM-DD', () => {
      const d = new Date(2026, 8, 20); // September 20, 2026 local
      expect(dayKey(d)).toBe('2026-09-20');
    });
  });

  describe('buildDay', () => {
    it('includes an undated-but-started task on its start day and excludes another day task', () => {
      // Create local dates for test
      const targetDate = new Date(2026, 8, 20); // 2026-09-20
      const startAtTarget = new Date(2026, 8, 20, 14, 30).toISOString();
      const startAtOther = new Date(2026, 8, 21, 10, 0).toISOString();

      const taskOnDay = makeTask({
        id: 't-1',
        title: 'Task on Day',
        dueDate: null,
        startAt: startAtTarget,
        plannedMinutes: 45,
      });

      const taskOtherDay = makeTask({
        id: 't-2',
        title: 'Task tomorrow',
        dueDate: null,
        startAt: startAtOther,
      });

      const items = buildDay({
        date: targetDate,
        tasks: [taskOnDay, taskOtherDay],
        events: [],
      });

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('t-1');
      expect(items[0].kind).toBe('task');
      expect(items[0].startMin).toBe(14 * 60 + 30);
      expect(items[0].endMin).toBe(14 * 60 + 30 + 45);
      expect(items[0].allDay).toBe(false);
    });

    it('includes a task whose dueDate matches target day even if startAt is null', () => {
      const targetDate = new Date(2026, 8, 20);
      const task = makeTask({
        id: 't-due',
        title: 'Due today',
        dueDate: '2026-09-20',
        startAt: null,
      });

      const items = buildDay({
        date: targetDate,
        tasks: [task],
        events: [],
      });

      expect(items).toHaveLength(1);
      expect(items[0].id).toBe('t-due');
      expect(items[0].startMin).toBeNull();
      expect(items[0].endMin).toBeNull();
      expect(items[0].allDay).toBe(false);
    });

    it('places an event spanning midnight into both days it touches', () => {
      // Event from 2026-09-20 22:00 to 2026-09-21 02:00 local time
      const day1 = new Date(2026, 8, 20);
      const day2 = new Date(2026, 8, 21);
      const day3 = new Date(2026, 8, 22);

      const evtStart = new Date(2026, 8, 20, 22, 0).toISOString();
      const evtEnd = new Date(2026, 8, 21, 2, 0).toISOString();

      const spanningEvent = makeEvent({
        id: 'evt-midnight',
        title: 'Late Night Hackathon',
        startAt: evtStart,
        endAt: evtEnd,
      });

      // Day 1 view: from 22:00 (1320 min) to midnight (1440 min)
      const itemsDay1 = buildDay({
        date: day1,
        tasks: [],
        events: [spanningEvent],
      });
      expect(itemsDay1).toHaveLength(1);
      expect(itemsDay1[0].id).toBe('evt-midnight');
      expect(itemsDay1[0].startMin).toBe(22 * 60);
      expect(itemsDay1[0].endMin).toBe(24 * 60); // clamped to end of day 1440

      // Day 2 view: from midnight (0 min) to 02:00 (120 min)
      const itemsDay2 = buildDay({
        date: day2,
        tasks: [],
        events: [spanningEvent],
      });
      expect(itemsDay2).toHaveLength(1);
      expect(itemsDay2[0].id).toBe('evt-midnight');
      expect(itemsDay2[0].startMin).toBe(0); // clamped to start of day
      expect(itemsDay2[0].endMin).toBe(2 * 60);

      // Day 3 view: does not touch Day 3
      const itemsDay3 = buildDay({
        date: day3,
        tasks: [],
        events: [spanningEvent],
      });
      expect(itemsDay3).toHaveLength(0);
    });

    it('sets startMin and endMin to null for all-day events', () => {
      const targetDate = new Date(2026, 8, 20);
      const allDayEvent = makeEvent({
        id: 'evt-holiday',
        title: 'Company Holiday',
        startAt: '2026-09-20',
        endAt: '2026-09-20',
        allDay: true,
      });

      const items = buildDay({
        date: targetDate,
        tasks: [],
        events: [allDayEvent],
      });

      expect(items).toHaveLength(1);
      expect(items[0].allDay).toBe(true);
      expect(items[0].startMin).toBeNull();
      expect(items[0].endMin).toBeNull();
    });
  });

  describe('findConflicts', () => {
    it('detects two tasks or events overlapping in time', () => {
      const item1: DayItem = {
        kind: 'task',
        id: 't-1',
        title: 'Call Client',
        startMin: 600, // 10:00
        endMin: 660,   // 11:00
        allDay: false,
        done: false,
        source: null,
        ref: makeTask({ id: 't-1', title: 'Call Client' }),
      };

      const item2: DayItem = {
        kind: 'event',
        id: 'e-1',
        title: 'Team Standup',
        startMin: 630, // 10:30
        endMin: 690,   // 11:30
        allDay: false,
        done: false,
        source: 'local',
        ref: makeEvent({ id: 'e-1', title: 'Team Standup', startAt: '', endAt: '' }),
      };

      const conflicts = findConflicts([item1, item2]);
      expect(conflicts).toHaveLength(1);
      expect(conflicts[0].a.id).toBe('t-1');
      expect(conflicts[0].b.id).toBe('e-1');
    });

    it('detects conflict when two items are scheduled at the exact same minute', () => {
      const itemA: DayItem = {
        kind: 'task',
        id: 't-a',
        title: 'Task A',
        startMin: 540,
        endMin: 570,
        allDay: false,
        done: false,
        source: null,
        ref: makeTask({ id: 't-a', title: 'Task A' }),
      };

      const itemB: DayItem = {
        kind: 'task',
        id: 't-b',
        title: 'Task B',
        startMin: 540,
        endMin: 600,
        allDay: false,
        done: false,
        source: null,
        ref: makeTask({ id: 't-b', title: 'Task B' }),
      };

      const conflicts = findConflicts([itemA, itemB]);
      expect(conflicts).toHaveLength(1);
    });

    it('does NOT conflict on touching ranges where end == start', () => {
      const item1: DayItem = {
        kind: 'task',
        id: 't-1',
        title: 'Task 1',
        startMin: 600, // 10:00
        endMin: 660,   // 11:00
        allDay: false,
        done: false,
        source: null,
        ref: makeTask({ id: 't-1', title: 'Task 1' }),
      };

      const item2: DayItem = {
        kind: 'event',
        id: 'e-2',
        title: 'Event 2',
        startMin: 660, // 11:00 (touches previous end)
        endMin: 720,   // 12:00
        allDay: false,
        done: false,
        source: 'local',
        ref: makeEvent({ id: 'e-2', title: 'Event 2', startAt: '', endAt: '' }),
      };

      const conflicts = findConflicts([item1, item2]);
      expect(conflicts).toHaveLength(0);
    });

    it('never flags all-day events or items with null minutes as conflicts', () => {
      const allDayItem: DayItem = {
        kind: 'event',
        id: 'e-all',
        title: 'All Day Summit',
        startMin: null,
        endMin: null,
        allDay: true,
        done: false,
        source: 'google',
        ref: makeEvent({ id: 'e-all', title: 'All Day Summit', startAt: '', endAt: '', allDay: true }),
      };

      const timedItem: DayItem = {
        kind: 'task',
        id: 't-timed',
        title: 'Focus Work',
        startMin: 600,
        endMin: 700,
        allDay: false,
        done: false,
        source: null,
        ref: makeTask({ id: 't-timed', title: 'Focus Work' }),
      };

      const undatedTask: DayItem = {
        kind: 'task',
        id: 't-undated',
        title: 'Inbox Item',
        startMin: null,
        endMin: null,
        allDay: false,
        done: false,
        source: null,
        ref: makeTask({ id: 't-undated', title: 'Inbox Item' }),
      };

      const conflicts = findConflicts([allDayItem, timedItem, undatedTask]);
      expect(conflicts).toHaveLength(0);
    });
  });

  it('keeps a timed event that has no end, with a default duration', () => {
    const date = new Date('2026-09-20T00:00:00');
    const events = [
      {
        id: 'e1',
        source: 'local' as const,
        googleId: null,
        calendarId: null,
        title: 'No end',
        startAt: '2026-09-20T14:00:00',
        endAt: '',
        allDay: false,
        location: null,
        taskId: null,
        updated_at: '2026-09-20T09:00:00Z',
        deleted_at: null,
      },
    ];

    const items = buildDay({ date, tasks: [], events });

    // Dropping it hides a real appointment and gives the user nothing to go on.
    expect(items).toHaveLength(1);
    expect(items[0].startMin).toBe(14 * 60);
    expect(items[0].endMin).toBe(14 * 60 + 30);
  });
});