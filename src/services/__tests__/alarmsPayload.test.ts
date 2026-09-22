// Contract test for the alarm IPC payload.
//
// This pins the exact field names `ScheduledAlarm` has on the Rust side
// (`src-tauri/src/scheduler.rs`). That struct has no `#[serde(rename_all)]`, so
// serde looks for snake_case keys: sending camelCase makes every new field
// silently deserialize to `None`, which is exactly the class of bug where the
// UI looks wired but the backend never receives the data.

import { describe, expect, it } from 'vitest';
import { alarmToScheduledAlarm, computeLocalAlarmPreview, type Alarm } from '../alarms';

/** Field names of `ScheduledAlarm` in src-tauri/src/scheduler.rs, in order. */
const RUST_FIELDS = [
  'id',
  'label',
  'time',
  'repeat',
  'days',
  'date',
  'interval_minutes',
  'window_start',
  'window_end',
  'enabled',
  'sound',
  'voice_prompt',
  'note',
];

const alarm: Alarm = {
  id: 'a1',
  label: 'Тренировка',
  time: '07:30',
  repeat: 'interval',
  days: [1, 3, 5],
  date: '2026-10-15',
  intervalMinutes: 90,
  windowStart: '08:00',
  windowEnd: '20:00',
  enabled: true,
  sound: 'gentle',
  voicePrompt: 'Пора на тренировку',
  note: 'Заметка к тренировке',
};

describe('alarmToScheduledAlarm', () => {
  it('sends exactly the fields the Rust struct deserializes', () => {
    expect(Object.keys(alarmToScheduledAlarm(alarm)).sort()).toEqual([...RUST_FIELDS].sort());
  });

  it('never leaks a camelCase key, which serde would drop', () => {
    const payload = alarmToScheduledAlarm(alarm) as unknown as Record<string, unknown>;
    for (const camel of ['intervalMinutes', 'windowStart', 'windowEnd', 'voicePrompt']) {
      expect(payload[camel]).toBeUndefined();
    }
  });

  it('carries the new schedule modes through unchanged', () => {
    const payload = alarmToScheduledAlarm(alarm);
    expect(payload.date).toBe('2026-10-15');
    expect(payload.interval_minutes).toBe(90);
    expect(payload.window_start).toBe('08:00');
    expect(payload.window_end).toBe('20:00');
    expect(payload.repeat).toBe('interval');
  });
  it('sends null rather than undefined for absent optionals', () => {
    const payload = alarmToScheduledAlarm({ ...alarm, date: null, intervalMinutes: null, note: null });
    expect(payload.date).toBeNull();
    expect(payload.interval_minutes).toBeNull();
    expect(payload.note).toBeNull();
  });

  it('preserves note field when present', () => {
    const payload = alarmToScheduledAlarm(alarm);
    expect(payload.note).toBe('Заметка к тренировке');
  });

  it('computeLocalAlarmPreview uses 0=Sunday (no weekday shift)', () => {
    // 2026-09-20 is Sunday (getDay() === 0)
    const sundayNow = new Date('2026-09-20T06:00:00');
    const sundayAlarm: Alarm = {
      ...alarm,
      repeat: 'days',
      days: [0], // Sunday
      time: '08:00',
    };
    const preview = computeLocalAlarmPreview(sundayAlarm, 1, sundayNow);
    expect(preview.next).toHaveLength(1);
    expect(preview.next[0]).toBe('2026-09-20T08:00:00');
  });

  it('computeLocalAlarmPreview handles midnight-crossing interval windows (e.g. 22:00 to 02:00)', () => {
    const now = new Date('2026-09-20T21:00:00');
    const nightAlarm: Alarm = {
      ...alarm,
      repeat: 'interval',
      windowStart: '22:00',
      windowEnd: '02:00',
      intervalMinutes: 60,
    };
    const preview = computeLocalAlarmPreview(nightAlarm, 3, now);
    expect(preview.next.length).toBeGreaterThanOrEqual(3);
    expect(preview.next[0]).toBe('2026-09-20T22:00:00');
    expect(preview.next[1]).toBe('2026-09-20T23:00:00');
    expect(preview.next[2]).toBe('2026-09-21T00:00:00');
  });
});
