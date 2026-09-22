// Contract test for the alarm IPC payload.
//
// This pins the exact field names `ScheduledAlarm` has on the Rust side
// (`src-tauri/src/scheduler.rs`). That struct has no `#[serde(rename_all)]`, so
// serde looks for snake_case keys: sending camelCase makes every new field
// silently deserialize to `None`, which is exactly the class of bug where the
// UI looks wired but the backend never receives the data.

import { describe, expect, it } from 'vitest';
import { alarmToScheduledAlarm, type Alarm } from '../alarms';

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
];

const alarm: Alarm = {
  id: 'a1',
  label: 'Тренировка',
  time: '07:30',
  repeat: 'interval',
  days: [0, 2, 4],
  date: '2026-10-15',
  intervalMinutes: 90,
  windowStart: '08:00',
  windowEnd: '20:00',
  enabled: true,
  sound: 'gentle',
  voicePrompt: 'Пора на тренировку',
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
    const payload = alarmToScheduledAlarm({ ...alarm, date: null, intervalMinutes: null });
    expect(payload.date).toBeNull();
    expect(payload.interval_minutes).toBeNull();
  });
});
