import { describe, expect, it } from 'vitest';
import {
  currentStreak,
  dayKey,
  focusedSecOn,
  focusByHour,
  formatFocus,
  longestStreak,
  peakHour,
  taskProgress,
  totalFocusedSec,
  trailingDays,
} from '../stats';
import { SessionBuilder, recentSessions, trimSessions } from '../session';
import type { SessionRecord, TaskItem } from '../../types';

/** A session of `minutes` ending at the given local date. */
function session(endedAt: Date, minutes: number, overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: `s_${endedAt.getTime()}`,
    label: 'Блок',
    focusedSec: minutes * 60,
    startedAt: new Date(endedAt.getTime() - minutes * 60_000).toISOString(),
    endedAt: endedAt.toISOString(),
    completed: true,
    ...overrides,
  };
}

const wednesday = new Date(2026, 0, 7, 12, 0);

describe('day bucketing', () => {
  it('keys days in local time, not UTC', () => {
    // 00:30 local is the previous day in UTC for positive offsets; the key must
    // follow the user's calendar or sessions land on the wrong day.
    expect(dayKey(new Date(2026, 0, 7, 0, 30))).toBe('2026-01-07');
    expect(dayKey(new Date(2026, 0, 7, 23, 30))).toBe('2026-01-07');
  });

  it('sums only the sessions of that day', () => {
    const sessions = [
      session(new Date(2026, 0, 7, 9, 0), 30),
      session(new Date(2026, 0, 7, 18, 0), 20),
      session(new Date(2026, 0, 6, 9, 0), 99),
    ];

    expect(focusedSecOn(sessions, new Date(2026, 0, 7, 23, 0))).toBe(50 * 60);
  });
});

describe('trailing window', () => {
  it('returns the requested number of days, oldest first', () => {
    const buckets = trailingDays([], 7, wednesday);

    expect(buckets).toHaveLength(7);
    expect(buckets[0].key).toBe('2026-01-01');
    expect(buckets[6].key).toBe('2026-01-07');
  });

  it('keeps empty days instead of collapsing them', () => {
    // The gaps are the insight; a chart that skips them misleads.
    const buckets = trailingDays([session(new Date(2026, 0, 7, 9, 0), 30)], 3, wednesday);

    expect(buckets.map((b) => b.focusedSec)).toEqual([0, 0, 30 * 60]);
  });

  it('totals the window', () => {
    const sessions = [
      session(new Date(2026, 0, 7, 9, 0), 30),
      session(new Date(2026, 0, 5, 9, 0), 15),
      session(new Date(2025, 11, 20, 9, 0), 60),
    ];

    expect(totalFocusedSec(trailingDays(sessions, 7, wednesday))).toBe(45 * 60);
  });
});

describe('streaks', () => {
  it('counts consecutive days including an unfinished today', () => {
    const sessions = [
      session(new Date(2026, 0, 5, 9, 0), 30),
      session(new Date(2026, 0, 6, 9, 0), 30),
    ];

    // Today (the 7th) has no focus yet; the streak must survive the morning.
    expect(currentStreak(sessions, 1, wednesday)).toBe(2);
  });

  it('extends the streak when today is already done', () => {
    const sessions = [
      session(new Date(2026, 0, 6, 9, 0), 30),
      session(new Date(2026, 0, 7, 9, 0), 30),
    ];

    expect(currentStreak(sessions, 1, wednesday)).toBe(2);
  });

  it('breaks once a full day is genuinely missed', () => {
    const sessions = [session(new Date(2026, 0, 4, 9, 0), 30)];

    // The 5th and 6th were missed, so nothing is carried to the 7th.
    expect(currentStreak(sessions, 1, wednesday)).toBe(0);
  });

  it('ignores days below the threshold', () => {
    const sessions = [session(new Date(2026, 0, 6, 9, 0), 1)];

    expect(currentStreak(sessions, 5, wednesday)).toBe(0);
  });

  it('finds the longest historical run', () => {
    const sessions = [
      session(new Date(2025, 11, 1, 9, 0), 30),
      session(new Date(2025, 11, 2, 9, 0), 30),
      session(new Date(2025, 11, 3, 9, 0), 30),
      session(new Date(2025, 11, 10, 9, 0), 30),
    ];

    expect(longestStreak(sessions)).toBe(3);
  });
});

describe('time of day', () => {
  it('reports the hour with the most focus, bucketed by start time', () => {
    // The helper derives `startedAt` from `endedAt`, so a session ending at
    // 21:00 belongs to the hour it began in.
    const sessions = [
      session(new Date(2026, 0, 7, 7, 0), 20), // starts 06:40 -> hour 6
      session(new Date(2026, 0, 7, 21, 45), 45), // starts 21:00 -> hour 21
      session(new Date(2026, 0, 6, 21, 30), 30), // starts 21:00 -> hour 21
    ];

    expect(peakHour(sessions)).toBe(21);
  });

  it('returns null rather than midnight when there is no data', () => {
    expect(peakHour([])).toBeNull();
  });

  it('buckets by the start hour', () => {
    const hours = focusByHour([session(new Date(2026, 0, 7, 7, 30), 30)]);

    expect(hours[7]).toBe(30 * 60);
    expect(hours[8]).toBe(0);
  });
});

describe('session building', () => {
  it('records accumulated focus, not wall-clock elapsed time', () => {
    const builder = new SessionBuilder({ label: 'Разминка', startedAt: new Date() });
    builder.addFocus(60);
    builder.addFocus(90);

    const record = builder.finish(new Date(), true);

    expect(record?.focusedSec).toBe(150);
  });

  it('discards a session where nothing was done', () => {
    const builder = new SessionBuilder({ label: 'Случайно открытый блок', startedAt: new Date() });

    // Opening and immediately closing a block would otherwise pad the stats.
    expect(builder.finish(new Date(), false)).toBeNull();
  });

  it('ignores non-positive increments', () => {
    const builder = new SessionBuilder({ label: 'X', startedAt: new Date() });
    builder.addFocus(0);
    builder.addFocus(-30);

    expect(builder.finish(new Date(), true)).toBeNull();
  });
});

describe('session log housekeeping', () => {
  it('lists the newest sessions first', () => {
    const sessions = [
      session(new Date(2026, 0, 5, 9, 0), 10, { id: 'old' }),
      session(new Date(2026, 0, 7, 9, 0), 10, { id: 'new' }),
    ];

    expect(recentSessions(sessions, 1)[0].id).toBe('new');
  });

  it('trims to the newest entries so the store cannot grow forever', () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session(new Date(2026, 0, 1 + i, 9, 0), 10, { id: `s${i}` }),
    );

    const trimmed = trimSessions(sessions, 3);

    expect(trimmed).toHaveLength(3);
    expect(trimmed[0].id).toBe('s9');
  });

  it('leaves a log below the cap untouched', () => {
    const sessions = [session(new Date(2026, 0, 1, 9, 0), 10)];

    expect(trimSessions(sessions, 100)).toHaveLength(1);
  });
});

describe('presentation', () => {
  it('formats focus durations the way a person reads them', () => {
    expect(formatFocus(0)).toBe('0 мин');
    expect(formatFocus(45 * 60)).toBe('45 мин');
    expect(formatFocus(2 * 3600)).toBe('2 ч');
    expect(formatFocus(2 * 3600 + 5 * 60)).toBe('2 ч 5 мин');
  });

  it('counts completed tasks', () => {
    const tasks: TaskItem[] = [
      { id: '1', title: 'a', done: true, priority: 0, position: 0, createdAt: '' },
      { id: '2', title: 'b', done: false, priority: 0, position: 1, createdAt: '' },
    ];

    expect(taskProgress(tasks)).toEqual({ done: 1, total: 2 });
  });
});
