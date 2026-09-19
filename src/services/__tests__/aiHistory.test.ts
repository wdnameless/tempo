import { describe, expect, it } from 'vitest';
import { buildHistoryDigest, localDayKey } from '../aiHistory';
import type { SessionRecord } from '../../types';

function makeSession(overrides: Partial<SessionRecord> = {}): SessionRecord {
  return {
    id: 's1',
    mode: 'timer',
    durationSec: 1500,
    focusedSec: 1500,
    startedAt: new Date(2026, 3, 10, 10, 0, 0).toISOString(),
    endedAt: new Date(2026, 3, 10, 10, 25, 0).toISOString(),
    completed: true,
    ...overrides,
  };
}

describe('aiHistory.buildHistoryDigest', () => {
  const fixedNow = new Date(2026, 3, 15, 12, 0, 0);

  it('builds trailing calendar days with zeros when there are no sessions', () => {
    const digest = buildHistoryDigest([], 7, fixedNow);

    expect(digest.days).toHaveLength(7);
    expect(digest.days[digest.days.length - 1].day).toBe(localDayKey(fixedNow));
    expect(digest.totals).toEqual({ focusedSec: 0, sessions: 0, daysActive: 0 });
    expect(digest.hourHistogram).toHaveLength(24);
    expect(digest.hourHistogram.every((x) => x === 0)).toBe(true);
  });

  it('aggregates sessions by day, hour, and totals without directions or blocks', () => {
    const s1 = makeSession({
      id: 's1',
      startedAt: new Date(2026, 3, 15, 9, 15, 0).toISOString(),
      focusedSec: 1800,
      completed: true,
      quality: 4,
    });
    const s2 = makeSession({
      id: 's2',
      startedAt: new Date(2026, 3, 15, 9, 45, 0).toISOString(),
      focusedSec: 600,
      completed: false,
      quality: 2,
    });
    const s3 = makeSession({
      id: 's3',
      startedAt: new Date(2026, 3, 14, 14, 0, 0).toISOString(),
      focusedSec: 1200,
      completed: true,
    });

    const digest = buildHistoryDigest([s1, s2, s3], 7, fixedNow);

    expect(digest.totals).toEqual({
      focusedSec: 3600,
      sessions: 3,
      daysActive: 2,
    });

    const today = digest.days.find((d) => d.day === localDayKey(fixedNow));
    expect(today).toBeDefined();
    expect(today?.totalFocusedSec).toBe(2400);
    expect(today?.completedSessions).toBe(1);
    expect(today?.abandonedSessions).toBe(1);
    expect(today?.averageQuality).toBe(3);

    // 9:00 bin has s1 + s2 = 2400s
    expect(digest.hourHistogram[9]).toBe(2400);
    // 14:00 bin has s3 = 1200s
    expect(digest.hourHistogram[14]).toBe(1200);

    // Verify digest does not contain directions or blocks
    expect('directions' in digest).toBe(false);
  });
});
