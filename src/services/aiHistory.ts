import type { SessionRecord } from '../types';

export interface DayFocusAggregate {
  /** YYYY-MM-DD in the user's local timezone. */
  day: string;
  totalFocusedSec: number;
  completedSessions: number;
  abandonedSessions: number;
  /**
   * Average rated quality in [1..5], or undefined if none of the day's sessions
   * were rated.
   */
  averageQuality?: number;
}

export interface HistoryDigest {
  /** Trailing calendar days, oldest first. Empty days are included with zeros. */
  days: DayFocusAggregate[];
  /** 24 bins, index 0 = 00:00..00:59 local time. Values are total seconds focused. */
  hourHistogram: number[];
  totals: {
    focusedSec: number;
    sessions: number;
    daysActive: number;
  };
}

const PAD = (n: number) => (n < 10 ? `0${n}` : `${n}`);

export function localDayKey(d: Date): string {
  return `${d.getFullYear()}-${PAD(d.getMonth() + 1)}-${PAD(d.getDate())}`;
}

export function buildHistoryDigest(
  sessions: SessionRecord[],
  daysCount = 14,
  now: Date = new Date(),
): HistoryDigest {
  const clampedDays = Math.max(1, Math.min(daysCount, 60));

  // Build the list of target day keys in chronological order.
  const dayKeys: string[] = [];
  for (let i = clampedDays - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    dayKeys.push(localDayKey(d));
  }
  const dayKeySet = new Set(dayKeys);

  const byDay = new Map<
    string,
    { focusedSec: number; completed: number; abandoned: number; qualitySum: number; qualityCount: number }
  >();
  for (const k of dayKeys) {
    byDay.set(k, { focusedSec: 0, completed: 0, abandoned: 0, qualitySum: 0, qualityCount: 0 });
  }

  const hourHistogram = new Array<number>(24).fill(0);
  let totalFocusedSec = 0;
  let totalSessions = 0;

  for (const s of sessions) {
    const started = new Date(s.startedAt);
    if (isNaN(started.getTime())) continue;

    const key = localDayKey(started);
    const sec = Math.max(0, s.focusedSec || 0);

    if (dayKeySet.has(key)) {
      const bucket = byDay.get(key)!;
      bucket.focusedSec += sec;
      if (s.completed) bucket.completed += 1;
      else bucket.abandoned += 1;
      if (typeof s.quality === 'number' && s.quality >= 1 && s.quality <= 5) {
        bucket.qualitySum += s.quality;
        bucket.qualityCount += 1;
      }

      const h = started.getHours();
      if (h >= 0 && h < 24) {
        hourHistogram[h] += sec;
      }

      totalFocusedSec += sec;
      totalSessions += 1;
    }
  }

  const days: DayFocusAggregate[] = dayKeys.map((day) => {
    const b = byDay.get(day)!;
    return {
      day,
      totalFocusedSec: b.focusedSec,
      completedSessions: b.completed,
      abandonedSessions: b.abandoned,
      averageQuality: b.qualityCount > 0 ? Math.round((b.qualitySum / b.qualityCount) * 10) / 10 : undefined,
    };
  });

  const daysActive = days.filter((d) => d.totalFocusedSec > 0 || d.completedSessions > 0).length;

  return {
    days,
    hourHistogram,
    totals: {
      focusedSec: totalFocusedSec,
      sessions: totalSessions,
      daysActive,
    },
  };
}
