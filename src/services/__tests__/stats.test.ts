import { describe, it, expect } from 'vitest';
import {
  weekStart,
  weekKey,
  focusByDay,
  focusByWeek,
  heatmap,
  focusByHour,
  peakHour,
  pomodoroCount,
  currentStreak,
  longestStreak,
  completionByDay,
  taskProgress,
  formatFocus,
} from '../stats';
import type { StoredSession } from '../sessionStore';
import type { TaskItem } from '../../types';

function makeSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    id: 's-' + Math.random().toString(36).slice(2, 7),
    kind: 'pomodoro',
    task_id: null,
    duration_sec: 1500,
    completed: true,
    started_at: '2026-09-20T10:00:00',
    ended_at: '2026-09-20T10:25:00',
    ...overrides,
  };
}

describe('stats service (interfaces §20)', () => {
  describe('local date boundary invariants', () => {
    it('a session at 23:59 local time lands in that local day, not UTC', () => {
      // Create a local timestamp at 23:59 on 2026-05-10
      const localDate = new Date(2026, 4, 10, 23, 59, 0);

      // Format ISO string representing local time:
      const pad = (n: number) => String(n).padStart(2, '0');
      const localStr = `${localDate.getFullYear()}-${pad(localDate.getMonth() + 1)}-${pad(localDate.getDate())}T23:59:00`;

      // Session with explicit local timestamp representation
      const session = makeSession({
        started_at: localStr,
        duration_sec: 1800,
      });

      const dayMap = focusByDay([session]);
      // Must be 2026-05-10 in local calendar
      expect(dayMap['2026-05-10']).toBe(1800);

      // Now verify with a Date that has non-zero UTC offset if applicable
      // If we pass an ISO with Z: e.g. If local timezone is UTC+X or UTC-X,
      // Date constructor parses ISO into local time components.
      // A local Date object:
      const d = new Date(2026, 8, 15, 23, 59, 30);
      const sessionFromDate = makeSession({
        started_at: d.toISOString(),
        duration_sec: 1200,
      });
      const dayMap2 = focusByDay([sessionFromDate]);
      const expectedDayKey = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
      expect(dayMap2[expectedDayKey]).toBe(1200);
    });
  });

  describe('weekStart & weekKey', () => {
    it('on a Monday returns that same day at 00:00:00.000', () => {
      // 2026-09-14 is a Monday
      const monday = new Date(2026, 8, 14, 15, 30, 0);
      const start = weekStart(monday);
      expect(start.getFullYear()).toBe(2026);
      expect(start.getMonth()).toBe(8);
      expect(start.getDate()).toBe(14);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);
      expect(start.getSeconds()).toBe(0);
      expect(start.getMilliseconds()).toBe(0);
      expect(weekKey(monday)).toBe('2026-09-14');
    });

    it('on a Sunday returns the previous Monday', () => {
      // 2026-09-20 is a Sunday
      const sunday = new Date(2026, 8, 20, 22, 15, 0);
      const start = weekStart(sunday);
      // Should be Monday 2026-09-14
      expect(start.getFullYear()).toBe(2026);
      expect(start.getMonth()).toBe(8);
      expect(start.getDate()).toBe(14);
      expect(start.getHours()).toBe(0);
      expect(weekKey(sunday)).toBe('2026-09-14');
    });

    it('on a Wednesday returns the Monday of that week', () => {
      // 2026-09-16 is Wednesday
      const wednesday = new Date(2026, 8, 16, 12, 0, 0);
      const start = weekStart(wednesday);
      expect(start.getDate()).toBe(14);
      expect(weekKey(wednesday)).toBe('2026-09-14');
    });
  });

  describe('focusByDay & focusByWeek', () => {
    it('aggregates focus duration in seconds by local day', () => {
      const s1 = makeSession({ started_at: '2026-09-15T10:00:00', duration_sec: 1500 });
      const s2 = makeSession({ started_at: '2026-09-15T14:00:00', duration_sec: 1500 });
      // s3 completed, s4 cut short (completed: false, stopwatch) - both count toward focus time
      const s3 = makeSession({ started_at: '2026-09-16T09:00:00', duration_sec: 2400, completed: true });
      const s4 = makeSession({ started_at: '2026-09-16T11:00:00', duration_sec: 600, kind: 'stopwatch', completed: false });

      const dayMap = focusByDay([s1, s2, s3, s4]);
      expect(dayMap['2026-09-15']).toBe(3000);
      expect(dayMap['2026-09-16']).toBe(3000);
    });

    it('aggregates focus duration by Monday-based weekKey', () => {
      // 2026-09-14 (Mon) and 2026-09-20 (Sun) are the same week (2026-09-14)
      const s1 = makeSession({ started_at: '2026-09-14T10:00:00', duration_sec: 1000 });
      const s2 = makeSession({ started_at: '2026-09-20T20:00:00', duration_sec: 2000 });
      // 2026-09-21 (Mon) is next week
      const s3 = makeSession({ started_at: '2026-09-21T08:00:00', duration_sec: 1500 });

      const weekMap = focusByWeek([s1, s2, s3]);
      expect(weekMap['2026-09-14']).toBe(3000);
      expect(weekMap['2026-09-21']).toBe(1500);
    });
  });

  describe('heatmap', () => {
    it('returns exactly weeks * 7 buckets with zeros for empty days, Monday first, oldest week first', () => {
      // Reference date: Thursday 2026-09-17
      const refDate = new Date(2026, 8, 17, 12, 0, 0);
      const weeks = 2;

      // Session on Tuesday 2026-09-15 (week 2)
      const s1 = makeSession({ started_at: '2026-09-15T10:00:00', duration_sec: 1800 });

      const grid = heatmap([s1], weeks, refDate);
      expect(grid).toHaveLength(14); // 2 * 7

      // The first bucket must be Monday of the oldest week:
      // Week 2 starts Monday 2026-09-14
      // Oldest week (week 1) starts Monday 2026-09-07
      expect(grid[0].date).toBe('2026-09-07');
      expect(grid[0].seconds).toBe(0);

      // 2026-09-15 is day index 8 (7 + 1)
      const target = grid.find((d) => d.date === '2026-09-15');
      expect(target).toBeDefined();
      expect(target?.seconds).toBe(1800);

      // Empty days must be zero, including today and days after it in current week
      const emptyDay = grid.find((d) => d.date === '2026-09-18');
      expect(emptyDay?.seconds).toBe(0);

      // Last bucket is Sunday of the current week (2026-09-20)
      expect(grid[13].date).toBe('2026-09-20');
    });

    it('a week with no sessions still produces 7 zero buckets', () => {
      const refDate = new Date(2026, 8, 20); // Sunday
      const grid = heatmap([], 1, refDate);
      expect(grid).toHaveLength(7);
      for (const bucket of grid) {
        expect(bucket.seconds).toBe(0);
      }
    });
  });

  describe('focusByHour & peakHour', () => {
    it('groups focus time by 0..23 hour of started_at', () => {
      const s1 = makeSession({ started_at: '2026-09-15T09:15:00', duration_sec: 1500 });
      const s2 = makeSession({ started_at: '2026-09-15T09:45:00', duration_sec: 1500 });
      const s3 = makeSession({ started_at: '2026-09-15T14:00:00', duration_sec: 1200 });

      const hours = focusByHour([s1, s2, s3]);
      expect(hours).toHaveLength(24);
      expect(hours[9]).toBe(3000);
      expect(hours[14]).toBe(1200);
      expect(hours[0]).toBe(0);

      expect(peakHour([s1, s2, s3])).toBe(9);
    });

    it('returns null peakHour when there are no focus sessions', () => {
      expect(peakHour([])).toBeNull();
    });
  });

  describe('pomodoroCount', () => {
    it('counts completed pomodoros only (ignores incomplete or stopwatch)', () => {
      const s1 = makeSession({ kind: 'pomodoro', completed: true });
      const s2 = makeSession({ kind: 'pomodoro', completed: false }); // stopped halfway: not a pomodoro
      const s3 = makeSession({ kind: 'stopwatch', completed: true }); // stopwatch: not a pomodoro
      const s4 = makeSession({ kind: 'pomodoro', completed: true });

      expect(pomodoroCount([s1, s2, s3, s4])).toBe(2);
    });
  });

  describe('currentStreak & longestStreak', () => {
    it('calculates current streak counting consecutive days up to today or yesterday', () => {
      // Assume today is 2026-09-20
      const refDate = new Date(2026, 8, 20, 10, 0, 0);

      // Sessions on 2026-09-20, 2026-09-19, 2026-09-18
      const sessions = [
        makeSession({ started_at: '2026-09-18T10:00:00' }),
        makeSession({ started_at: '2026-09-19T10:00:00' }),
        makeSession({ started_at: '2026-09-20T08:00:00' }),
      ];

      expect(currentStreak(sessions, refDate)).toBe(3);
    });

    it('counts yesterday as extending current streak if today has no session yet', () => {
      const refDate = new Date(2026, 8, 20, 10, 0, 0);

      const sessions = [
        makeSession({ started_at: '2026-09-18T10:00:00' }),
        makeSession({ started_at: '2026-09-19T10:00:00' }),
      ];

      expect(currentStreak(sessions, refDate)).toBe(2);
    });

    it('streak breaks across an empty day', () => {
      const refDate = new Date(2026, 8, 20, 10, 0, 0);

      // Active days: Sep 16, Sep 17, (Sep 18 empty), Sep 19, Sep 20
      const sessions = [
        makeSession({ started_at: '2026-09-16T10:00:00' }),
        makeSession({ started_at: '2026-09-17T10:00:00' }),
        makeSession({ started_at: '2026-09-19T10:00:00' }),
        makeSession({ started_at: '2026-09-20T10:00:00' }),
      ];

      expect(currentStreak(sessions, refDate)).toBe(2);
      expect(longestStreak(sessions)).toBe(2);
    });

    it('calculates longest streak correctly across past history', () => {
      const sessions = [
        // 4-day streak in past
        makeSession({ started_at: '2026-09-01T10:00:00' }),
        makeSession({ started_at: '2026-09-02T10:00:00' }),
        makeSession({ started_at: '2026-09-03T10:00:00' }),
        makeSession({ started_at: '2026-09-04T10:00:00' }),
        // Gap
        makeSession({ started_at: '2026-09-10T10:00:00' }),
        makeSession({ started_at: '2026-09-11T10:00:00' }),
      ];

      expect(longestStreak(sessions)).toBe(4);
    });
  });

  describe('completionByDay', () => {
    it('counts tasks by completed_at even when their current status says otherwise', () => {
      // Task that was marked completed on 2026-09-15, but someone might have reopened or toggled status
      const tasks = [
        {
          id: 't1',
          title: 'Task 1',
          completedAt: '2026-09-15T14:30:00',
          done: false,
          position: 0,
          priority: 0,
          createdAt: '2026-09-10T00:00:00',
        },
        {
          id: 't2',
          title: 'Task 2',
          completedAt: '2026-09-15T18:00:00',
          done: true,
          position: 1,
          priority: 0,
          createdAt: '2026-09-15T08:00:00',
        },
        {
          id: 't3',
          title: 'Task 3',
          completedAt: null,
          done: true,
          position: 2,
          priority: 0,
          createdAt: '2026-09-15T09:00:00',
        },
      ] as unknown as TaskItem[];
      const counts = completionByDay(tasks);
      // t1 and t2 have completed_at on 2026-09-15
      expect(counts['2026-09-15']).toBe(2);
    });
  });

  describe('taskProgress', () => {
    it('returns completed, total, and completion rate', () => {
      const tasks = [
        { id: 't1', title: 'Task 1', done: true, position: 0, priority: 0, createdAt: '2026-09-01' },
        { id: 't2', title: 'Task 2', done: true, position: 1, priority: 0, createdAt: '2026-09-01' },
        { id: 't3', title: 'Task 3', done: false, position: 2, priority: 0, createdAt: '2026-09-01' },
        { id: 't4', title: 'Task 4', done: false, position: 3, priority: 0, createdAt: '2026-09-01' },
      ] as unknown as TaskItem[];
      const progress = taskProgress(tasks);
      expect(progress.completed).toBe(2);
      expect(progress.total).toBe(4);
      expect(progress.rate).toBe(0.5);
    });

    it('handles empty task list', () => {
      const progress = taskProgress([]);
      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.rate).toBe(0);
    });
  });

  describe('formatFocus', () => {
    it('formats seconds into human readable hours and minutes', () => {
      expect(formatFocus(0)).toBe('0m');
      expect(formatFocus(1500)).toBe('25m');
      expect(formatFocus(3600)).toBe('1h 0m');
      expect(formatFocus(5400)).toBe('1h 30m');
    });
  });
});
