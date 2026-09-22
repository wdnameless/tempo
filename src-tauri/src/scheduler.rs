//! Alarm scheduler that lives in the backend.
//!
//! The frontend owns the alarm list but cannot be trusted to fire alarms: its
//! timers stop when the window is hidden in the tray, when a different tab is
//! open, or when WebView2 throttles a background page. So the frontend pushes
//! the schedule down here and this loop decides when to ring.

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, Timelike};
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{Emitter, Manager};

/// How many minutes late an alarm may still ring.
///
/// Ticks can be delayed by a busy machine, a frozen process or a restart a
/// moment after the alarm's time, and all of those should still ring. Anything
/// later is reported as missed instead: a reminder that arrives hours late is
/// worse than one that never claims to have fired on time.
const CATCH_UP_MINUTES: i64 = 5;

/// How often the loop wakes. Just under a second, so a minute is never skipped.
const TICK_INTERVAL: Duration = Duration::from_millis(500);

/// How often a given alarm is allowed to ring.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize, Serialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Repeat {
    /// Rings at its next matching moment, then switches itself off.
    Once,
    /// Rings only on the weekdays in `days`.
    Days,
    /// Rings once at `date` + `time`, then switches itself off.
    Date,
    /// Rings repeatedly at interval minutes within a daily window.
    Interval,
    /// Rings every day. Weekdays are ignored.
    #[default]
    #[serde(other)]
    Daily,
}

/// One alarm as the scheduler sees it. Mirrors the frontend `AlarmItem`.
#[derive(Debug, Clone, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledAlarm {
    pub id: String,
    pub label: String,
    /// "HH:MM" in 24-hour local time.
    pub time: String,
    /// Weekdays, 0 = Sunday. Only consulted when `repeat` is `Days`.
    #[serde(default)]
    pub days: Vec<u32>,
    #[serde(default)]
    pub repeat: Repeat,
    #[serde(default)]
    pub date: Option<String>,
    #[serde(default, alias = "interval_minutes")]
    pub interval_minutes: Option<u32>,
    #[serde(default, alias = "window_start")]
    pub window_start: Option<String>,
    #[serde(default, alias = "window_end")]
    pub window_end: Option<String>,
    pub enabled: bool,
    /// Signal shape to play, matching the frontend alarm profiles.
    #[serde(default = "default_sound")]
    pub sound: String,
    /// Voice line spoken when the alarm rings.
    #[serde(default, alias = "voice_prompt")]
    pub voice_prompt: Option<String>,
    #[serde(default)]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlarmPreview {
    pub id: String,
    pub next: Vec<String>,
    pub disabled: bool,
}

fn default_sound() -> String {
    "gentle".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct AlarmFiredEvent {
    pub id: String,
    pub label: String,
    pub time: String,
    pub voice_prompt: Option<String>,
    pub note: Option<String>,
    pub snoozed_for: u32,
    /// Minutes past its own time when it eventually rang; 0 when on time.
    pub late_by_minutes: u32,
    /// Set when ringing this alarm switched it off for good.
    pub consumed: bool,
}

/// An alarm whose moment passed while nothing was listening.
#[derive(Debug, Clone, Serialize)]
pub struct MissedAlarm {
    pub id: String,
    pub label: String,
    pub time: String,
    /// Minutes past its own time when it was noticed.
    pub late_by_minutes: u32,
}

#[derive(Debug, Clone)]
struct Snooze {
    id: String,
    due_at: SystemTime,
    minutes: u32,
}

#[derive(Default, Debug)]
struct SchedulerState {
    alarms: Vec<ScheduledAlarm>,
    snoozed: Vec<Snooze>,
    /// `(alarm_id, local date)` already handled today, so nothing rings twice —
    /// including after the user acknowledges it mid-minute.
    /// `(alarm_id, local date, minute_of_day)` already handled today, so nothing rings twice —
    /// including after the user acknowledges it mid-minute.
    handled: Vec<(String, NaiveDate, i64)>,
    /// Today's skipped alarms, for the "missed" surface.
    missed: Vec<(NaiveDate, MissedAlarm)>,
    /// False until the first sync, which carries restored state rather than a
    /// newly created alarm and therefore keeps its catch-up chance.
    synced_once: bool,
}

static STATE: Mutex<Option<SchedulerState>> = Mutex::new(None);

/// Runs `f` against the scheduler state.
///
/// Poisoning is recovered rather than propagated: with `panic = "abort"` in the
/// release profile, an abort here would take the whole process — and every
/// pending alarm — down with it.
fn with_state<T>(f: impl FnOnce(&mut SchedulerState) -> T) -> T {
    let mut guard = STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(guard.get_or_insert_with(SchedulerState::default))
}

/// "HH:MM" to minutes since local midnight.
fn parse_hhmm(value: &str) -> Option<i64> {
    let (hours, minutes) = value.split_once(':')?;
    let hours: i64 = hours.trim().parse().ok()?;
    let minutes: i64 = minutes.trim().parse().ok()?;
    (hours <= 23 && minutes <= 59).then_some(hours * 60 + minutes)
}

fn rings_on(alarm: &ScheduledAlarm, date: NaiveDate) -> bool {
    let weekday = date.weekday().num_days_from_sunday();
    match alarm.repeat {
        Repeat::Once | Repeat::Daily | Repeat::Interval => true,
        Repeat::Days => alarm.days.contains(&weekday),
        Repeat::Date => match &alarm.date {
            Some(d) => NaiveDate::parse_from_str(d, "%Y-%m-%d").map(|target| target == date).unwrap_or(false),
            None => false,
        },
    }
}

fn firing_minutes_today(alarm: &ScheduledAlarm, date: NaiveDate) -> Vec<i64> {
    if !rings_on(alarm, date) {
        return Vec::new();
    }

    match alarm.repeat {
        Repeat::Once | Repeat::Daily | Repeat::Days | Repeat::Date => {
            parse_hhmm(&alarm.time).map(|m| vec![m]).unwrap_or_default()
        }
        Repeat::Interval => {
            let step = alarm.interval_minutes.unwrap_or(60).max(1) as i64;
            let start_min = alarm.window_start.as_deref().and_then(parse_hhmm).unwrap_or(0);
            let end_min = alarm.window_end.as_deref().and_then(parse_hhmm).unwrap_or(23 * 60 + 59);

            let mut minutes = Vec::new();
            if start_min <= end_min {
                let mut m = start_min;
                while m <= end_min {
                    minutes.push(m);
                    m += step;
                }
            } else {
                let total_span = (1440 - start_min) + end_min;

                let mut offset = 0;
                while offset <= total_span {
                    if offset >= 1440 - start_min {
                        let m = start_min + offset - 1440;
                        if m <= end_min {
                            minutes.push(m);
                        }
                    }
                    offset += step;
                }

                let mut offset = 0;
                while offset <= total_span {
                    if offset < 1440 - start_min {
                        let m = start_min + offset;
                        minutes.push(m);
                    }
                    offset += step;
                }
            }
            minutes
        }
    }
}

/// Replaces the schedule the frontend wants enforced.
pub fn sync(alarms: Vec<ScheduledAlarm>) {
    with_state(|state| {
        let known: Vec<String> = state.alarms.iter().map(|a| a.id.clone()).collect();

        // An alarm created now for a time that has already gone today waits for
        // its next occurrence instead of ringing — or being reported as missed —
        // the moment it is created. The first sync after startup is different:
        // that list is restored state, and its alarms keep their catch-up chance.
        if state.synced_once {
            let now = Local::now().naive_local();
            let today = now.date();
            let minute_of_day = now.hour() as i64 * 60 + now.minute() as i64;
            for alarm in &alarms {
                let already_known = known.contains(&alarm.id);
                if !already_known {
                    let slots = firing_minutes_today(alarm, today);
                    for at in slots {
                        if at < minute_of_day {
                            state.handled.push((alarm.id.clone(), today, at));
                        }
                    }
                }
            }
        }
        state.synced_once = true;

        state.alarms = alarms;
        let ids: Vec<String> = state.alarms.iter().map(|a| a.id.clone()).collect();
        state.snoozed.retain(|s| ids.contains(&s.id));
        state.missed.retain(|(_, m)| ids.contains(&m.id));
        let mut ringing = ACTIVE_RINGING.lock().unwrap_or_else(|e| e.into_inner());
        ringing.retain(|id| ids.contains(id));
    });
}

/// Defers an alarm by `minutes`, replacing any pending snooze for it.
///
/// The "handled today" marker is left alone: the alarm already had its moment,
/// and snoozing must not re-arm that slot as well as the deferred one.
pub fn snooze(id: &str, minutes: u32) {
    unmark_alarm_ringing(id);
    if !is_any_alarm_ringing() {
        crate::hourglass::stop();
    }
    with_state(|state| {
        state.snoozed.push(Snooze {
            id: id.to_string(),
            due_at: SystemTime::now() + Duration::from_secs(minutes as u64 * 60),
            minutes,
        });
    });
}

/// Marks an alarm as acknowledged by clearing its pending snooze.
///
/// The "handled today" marker stays. Clearing it would let the next tick —
/// half a second later, still inside the same minute — match the alarm again and
/// ring it straight back at the person who just silenced it.
pub fn dismiss(id: &str) {
    unmark_alarm_ringing(id);
    if !is_any_alarm_ringing() {
        crate::hourglass::stop();
    }
    with_state(|state| state.snoozed.retain(|s| s.id != id));
}

/// Records a ring and returns the event to broadcast.
///
/// A one-shot alarm is switched off here rather than in the frontend, so it
/// stays quiet even if the window never acknowledges the event.
fn ring(
    state: &mut SchedulerState,
    alarm: &ScheduledAlarm,
    time: &str,
    snoozed_for: u32,
    late_by_minutes: u32,
) -> AlarmFiredEvent {
    let consumed = alarm.repeat == Repeat::Once || alarm.repeat == Repeat::Date;
    if consumed {
        if let Some(slot) = state.alarms.iter_mut().find(|a| a.id == alarm.id) {
            slot.enabled = false;
        }
    }

    AlarmFiredEvent {
        id: alarm.id.clone(),
        label: alarm.label.clone(),
        time: time.to_string(),
        voice_prompt: alarm.voice_prompt.clone(),
        note: alarm.note.clone(),
        snoozed_for,
        late_by_minutes,
        consumed,
    }
}

fn find_alarm(state: &SchedulerState, id: &str) -> Option<ScheduledAlarm> {
    state.alarms.iter().find(|a| a.id == id).cloned()
}

/// Pure decision step: given the state and the local clock, returns the alarms
/// that must ring plus any that had to be marked as missed.
///
/// Extracted from the polling loop so both outcomes can be tested without a
/// Tauri runtime.
fn tick(state: &mut SchedulerState, now: NaiveDateTime) -> (Vec<AlarmFiredEvent>, Vec<MissedAlarm>) {
    let today = now.date();
    let minute_of_day = now.hour() as i64 * 60 + now.minute() as i64;

    // Yesterday's bookkeeping says nothing about today.
    state.handled.retain(|(_, day, _)| *day == today);
    state.missed.retain(|(day, _)| *day == today);

    let mut fired = Vec::new();
    let mut missed = Vec::new();

    // Snoozed alarms are due purely by elapsed wall-clock time.
    let due: Vec<Snooze> = state
        .snoozed
        .iter()
        .filter(|s| s.due_at <= SystemTime::now())
        .cloned()
        .collect();

    for entry in due {
        state.snoozed.retain(|s| s.id != entry.id);
        if let Some(alarm) = find_alarm(state, &entry.id) {
            let is_consumed = alarm.repeat == Repeat::Once || alarm.repeat == Repeat::Date;
            if alarm.enabled || is_consumed {
                fired.push(ring(state, &alarm, &alarm.time, entry.minutes, 0));
                if alarm.repeat == Repeat::Interval {
                    let slots = firing_minutes_today(&alarm, today);
                    for at in slots {
                        if at <= minute_of_day
                            && !state.handled.iter().any(|(id, day, m)| id == &alarm.id && *day == today && *m == at)
                        {
                            state.handled.push((alarm.id.clone(), today, at));
                        }
                    }
                }
            }
        }
    }

    // Scheduled matches: enabled, not snoozed, has slot today not already handled.
    let alarms = state.alarms.clone();

    for alarm in alarms {
        if !alarm.enabled {
            continue;
        }
        if state.snoozed.iter().any(|s| s.id == alarm.id) {
            continue;
        }

        let slots = firing_minutes_today(&alarm, today);
        for at in slots {
            if state.handled.iter().any(|(id, day, m)| id == &alarm.id && *day == today && *m == at) {
                continue;
            }
            let late_by = minute_of_day - at;
            if late_by < 0 {
                continue; // still ahead of us today
            }

            state.handled.push((alarm.id.clone(), today, at));
            let firing_time = format!("{:02}:{:02}", at / 60, at % 60);

            if late_by <= CATCH_UP_MINUTES {
                fired.push(ring(state, &alarm, &firing_time, 0, late_by as u32));
            } else {
                missed.push(MissedAlarm {
                    id: alarm.id.clone(),
                    label: alarm.label.clone(),
                    time: firing_time,
                    late_by_minutes: late_by as u32,
                });
            }
        }
    }

    for alarm in &missed {
        state.missed.push((today, alarm.clone()));
    }

    (fired, missed)
}

pub fn next_occurrences(alarm: &ScheduledAlarm, count: usize, now: NaiveDateTime) -> Vec<String> {
    if !alarm.enabled || count == 0 {
        return Vec::new();
    }

    let max_count = match alarm.repeat {
        Repeat::Once | Repeat::Date => count.min(1),
        _ => count,
    };

    let mut results = Vec::new();
    let mut day_offset = 0;

    while results.len() < max_count && day_offset < 366 {
        if let Some(d) = now.date().checked_add_signed(chrono::Duration::days(day_offset)) {
            let slots = firing_minutes_today(alarm, d);
            for m in slots {
                if let Some(dt) = d.and_hms_opt((m / 60) as u32, (m % 60) as u32, 0) {
                    if dt > now {
                        results.push(dt.format("%Y-%m-%dT%H:%M:%S").to_string());
                        if results.len() == max_count {
                            break;
                        }
                    }
                }
            }
        }
        day_offset += 1;
    }

    results
}

pub fn preview_alarm_at(alarm: &ScheduledAlarm, count: usize, now: NaiveDateTime) -> AlarmPreview {
    AlarmPreview {
        id: alarm.id.clone(),
        next: next_occurrences(alarm, count, now),
        disabled: !alarm.enabled,
    }
}

pub fn alarm_preview(alarms: Vec<ScheduledAlarm>, count: Option<usize>) -> Vec<AlarmPreview> {
    let count = count.unwrap_or(3);
    let now = chrono::Local::now().naive_local();
    alarms.iter().map(|a| preview_alarm_at(a, count, now)).collect()
}

/// Signal profile configured for `id`, falling back to a global default.
fn find_sound(id: &str) -> String {
    with_state(|state| {
        state
            .alarms
            .iter()
            .find(|a| a.id == id)
            .map(|a| a.sound.clone())
            .unwrap_or_else(default_sound)
    })
}

/// Alarm volume (0..1) with a sensible default.
pub fn audio_settings() -> (f32, bool) {
    let guard = AUDIO_PREFS.lock().unwrap_or_else(|e| e.into_inner());
    guard.unwrap_or((0.8, true))
}

/// Pushes the user's audio preferences down from the frontend.
pub fn set_audio_prefs(volume: f32, enabled: bool) {
    let mut guard = AUDIO_PREFS.lock().unwrap_or_else(|e| e.into_inner());
    *guard = Some((volume.clamp(0.0, 1.0), enabled));
}

static AUDIO_PREFS: Mutex<Option<(f32, bool)>> = Mutex::new(None);
static ACTIVE_RINGING: Mutex<Vec<String>> = Mutex::new(Vec::new());

pub fn is_any_alarm_ringing() -> bool {
    let guard = ACTIVE_RINGING.lock().unwrap_or_else(|e| e.into_inner());
    !guard.is_empty()
}

pub fn mark_alarm_ringing(id: &str) {
    let mut guard = ACTIVE_RINGING.lock().unwrap_or_else(|e| e.into_inner());
    if !guard.contains(&id.to_string()) {
        guard.push(id.to_string());
    }
}

pub fn unmark_alarm_ringing(id: &str) {
    let mut guard = ACTIVE_RINGING.lock().unwrap_or_else(|e| e.into_inner());
    guard.retain(|x| x != id);
}
/// Starts the polling loop. Runs for the lifetime of the process.
pub fn spawn(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(TICK_INTERVAL);
        loop {
            ticker.tick().await;

            let now = Local::now().naive_local();
            let (fired, missed) = with_state(|state| tick(state, now));

            for alarm in missed {
                let _ = app.emit("alarm://missed", alarm);
            }

            for event in fired {
                mark_alarm_ringing(&event.id);
                let id = event.id.clone();
                let label = event.label.clone();
                let prompt = event.voice_prompt.clone();
                let sound = find_sound(&id);

                let _ = app.emit("alarm://fired", event);

                // The webview is ringing it out loud whenever it is alive; a
                // hidden window has nothing to play from, so the OS takes over.
                let visible = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);

                if !visible {
                    // A hidden window cannot play anything, so the backend
                    // raises the signal itself rather than letting the alarm
                    // go off in silence.
                    if let Err(e) = crate::alarm_sound::start(&id, &sound, audio_settings().0) {
                        eprintln!("alarm audio unavailable: {e}");
                    }

                    use tauri_plugin_notification::NotificationExt;
                    let body = prompt.unwrap_or_else(|| label.clone());
                    let _ = app
                        .notification()
                        .builder()
                        .title(format!("Будильник — {label}"))
                        .body(body)
                        .show();
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.unminimize();
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alarm(id: &str, time: &str, days: Vec<u32>) -> ScheduledAlarm {
        ScheduledAlarm {
            id: id.to_string(),
            label: format!("Alarm {id}"),
            time: time.to_string(),
            days,
            repeat: Repeat::Days,
            date: None,
            interval_minutes: None,
            window_start: None,
            window_end: None,
            enabled: true,
            sound: default_sound(),
            voice_prompt: None,
            note: None,
        }
    }

    fn one_shot(id: &str, time: &str) -> ScheduledAlarm {
        ScheduledAlarm {
            repeat: Repeat::Once,
            days: Vec::new(),
            ..alarm(id, time, Vec::new())
        }
    }

    /// 2026-01-07 is a Wednesday (weekday index 3 with Sunday = 0).
    fn wednesday(hour: u32, minute: u32) -> NaiveDateTime {
        NaiveDate::from_ymd_opt(2026, 1, 7)
            .unwrap()
            .and_hms_opt(hour, minute, 0)
            .unwrap()
    }

    fn state_with(alarms: Vec<ScheduledAlarm>) -> SchedulerState {
        SchedulerState {
            alarms,
            ..SchedulerState::default()
        }
    }

    #[test]
    fn fires_when_time_and_weekday_match() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);
        let (fired, missed) = tick(&mut state, wednesday(7, 0));

        assert_eq!(fired.len(), 1, "matching alarm must fire");
        assert_eq!(fired[0].id, "a");
        assert!(missed.is_empty());
    }

    #[test]
    fn skips_a_weekday_the_alarm_does_not_run_on() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![6])]);
        assert!(tick(&mut state, wednesday(7, 0)).0.is_empty());
    }

    #[test]
    fn daily_alarm_rings_every_day() {
        let mut state = state_with(vec![ScheduledAlarm {
            repeat: Repeat::Daily,
            ..alarm("a", "09:30", Vec::new())
        }]);

        for day in 5..12 {
            state.handled.clear();
            let date = NaiveDate::from_ymd_opt(2026, 1, day).unwrap().and_hms_opt(9, 30, 0).unwrap();
            assert_eq!(tick(&mut state, date).0.len(), 1, "daily alarm must ring on {date}");
        }
    }

    #[test]
    fn disabled_alarm_never_fires() {
        let mut slot = alarm("a", "07:00", Vec::new());
        slot.repeat = Repeat::Daily;
        slot.enabled = false;
        let mut state = state_with(vec![slot]);

        assert!(tick(&mut state, wednesday(7, 0)).0.is_empty());
    }

    #[test]
    fn rings_once_per_day_not_once_per_tick() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);

        assert_eq!(tick(&mut state, wednesday(7, 0)).0.len(), 1);
        // The loop wakes twice a minute; the same slot must not ring twice.
        assert_eq!(tick(&mut state, wednesday(7, 0)).0.len(), 0, "must ring once per day");
    }

    #[test]
    fn dismissed_alarm_stays_silent_for_the_rest_of_the_minute() {
        // Regression: dismiss() used to clear the "handled" marker, so the very
        // next tick re-matched the same minute and rang straight back at whoever
        // had just pressed Stop.
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);

        assert_eq!(tick(&mut state, wednesday(7, 0)).0.len(), 1, "first ring");
        dismiss("a");
        assert!(
            tick(&mut state, wednesday(7, 0)).0.is_empty(),
            "an acknowledged alarm must not ring again in the same minute"
        );
    }

    #[test]
    fn snoozed_alarm_is_suppressed_then_rings_at_the_deferred_time() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);
        state.handled.push(("a".into(), wednesday(7, 0).date(), 420));
        state.snoozed.push(Snooze {
            id: "a".into(),
            due_at: SystemTime::now() - Duration::from_secs(1),
            minutes: 5,
        });

        let (fired, _) = tick(&mut state, wednesday(7, 5));
        assert_eq!(fired.len(), 1, "a due snooze must ring");
        assert_eq!(fired[0].snoozed_for, 5);
    }

    #[test]
    fn a_pending_snooze_suppresses_the_scheduled_slot() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);
        state.snoozed.push(Snooze {
            id: "a".into(),
            due_at: SystemTime::now() + Duration::from_secs(600),
            minutes: 10,
        });

        assert!(tick(&mut state, wednesday(7, 0)).0.is_empty(), "snoozed slot must stay quiet");
    }

    #[test]
    fn one_shot_alarm_switches_itself_off_after_ringing() {
        let mut state = state_with(vec![one_shot("a", "07:00")]);

        let (fired, _) = tick(&mut state, wednesday(7, 0));
        assert_eq!(fired.len(), 1);
        assert!(fired[0].consumed, "the ring must report that it consumed the alarm");
        assert!(!state.alarms[0].enabled, "a one-shot must not stay armed");
        assert!(tick(&mut state, wednesday(7, 0)).0.is_empty());
    }

    #[test]
    fn re_arming_a_one_shot_lets_it_ring_again() {
        let mut state = state_with(vec![one_shot("a", "07:00")]);
        tick(&mut state, wednesday(7, 0));

        // The user turns it back on; the next occurrence rings normally.
        state.alarms[0].enabled = true;
        state.handled.clear();

        let (fired, _) = tick(&mut state, wednesday(7, 0));
        assert_eq!(fired.len(), 1, "a re-armed one-shot must ring");
    }

    #[test]
    fn an_alarm_a_minute_late_still_rings() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);

        let (fired, missed) = tick(&mut state, wednesday(7, 2));

        assert_eq!(fired.len(), 1, "a slightly delayed tick must still ring");
        assert_eq!(fired[0].late_by_minutes, 2);
        assert!(missed.is_empty());
    }

    #[test]
    fn an_alarm_hours_late_is_reported_as_missed_not_rung() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);

        let (fired, missed) = tick(&mut state, wednesday(11, 30));

        assert!(fired.is_empty(), "a stale reminder must not ring hours later");
        assert_eq!(missed.len(), 1);
        assert_eq!(missed[0].time, "07:00");
        assert_eq!(state.missed.len(), 1, "it stays visible for the rest of the day");
        // And it is not re-reported on every following tick.
        assert!(tick(&mut state, wednesday(11, 30)).1.is_empty());
    }

    #[test]
    fn a_future_alarm_is_neither_rung_nor_missed() {
        let mut state = state_with(vec![alarm("a", "22:00", vec![3])]);

        let (fired, missed) = tick(&mut state, wednesday(7, 0));
        assert!(fired.is_empty());
        assert!(missed.is_empty());
    }

    #[test]
    fn a_malformed_time_is_ignored_rather_than_crashing_the_loop() {
        let mut state = state_with(vec![alarm("a", "скоро", vec![3])]);
        assert!(tick(&mut state, wednesday(7, 0)).0.is_empty());
    }

    #[test]
    fn markers_from_yesterday_do_not_suppress_today() {
        let mut state = state_with(vec![alarm("a", "07:00", vec![3])]);
        state.handled.push(("a".into(), NaiveDate::from_ymd_opt(2026, 1, 6).unwrap(), 420));

        assert_eq!(tick(&mut state, wednesday(7, 0)).0.len(), 1);
    }

    #[test]
    fn yesterday_is_forgotten_so_an_alarm_can_ring_again() {
        let mut state = state_with(vec![ScheduledAlarm {
            repeat: Repeat::Daily,
            ..alarm("a", "07:00", Vec::new())
        }]);
        tick(&mut state, wednesday(7, 0));

        // Thursday, same alarm: yesterday's marker must not silence it.
        let thursday = NaiveDate::from_ymd_opt(2026, 1, 8).unwrap().and_hms_opt(7, 0, 0).unwrap();
        assert_eq!(tick(&mut state, thursday).0.len(), 1);
    }

    #[test]
    fn date_alarm_fires_once_at_right_local_datetime_and_is_disabled() {
        let mut a = alarm("date1", "14:30", Vec::new());
        a.repeat = Repeat::Date;
        a.date = Some("2026-05-15".to_string());
        a.time = "14:30".to_string();

        let mut state = state_with(vec![a]);

        // Wrong date (day before): does not fire
        let day_before = NaiveDate::from_ymd_opt(2026, 5, 14).unwrap().and_hms_opt(14, 30, 0).unwrap();
        let (fired, _) = tick(&mut state, day_before);
        assert!(fired.is_empty(), "must not fire on a different date");

        // Target date and time: fires once, consumed = true, enabled becomes false
        let target_dt = NaiveDate::from_ymd_opt(2026, 5, 15).unwrap().and_hms_opt(14, 30, 0).unwrap();
        let (fired, _) = tick(&mut state, target_dt);
        assert_eq!(fired.len(), 1, "must fire on target date and time");
        assert_eq!(fired[0].id, "date1");
        assert!(fired[0].consumed, "date alarm ring must be consumed");
        assert!(!state.alarms[0].enabled, "date alarm must be disabled after firing");

        // Subsequent tick: does not fire again
        let (fired2, _) = tick(&mut state, target_dt);
        assert!(fired2.is_empty(), "disabled date alarm must not fire again");

        // Day after: does not fire
        let day_after = NaiveDate::from_ymd_opt(2026, 5, 16).unwrap().and_hms_opt(14, 30, 0).unwrap();
        let (fired3, _) = tick(&mut state, day_after);
        assert!(fired3.is_empty(), "disabled date alarm must not fire on subsequent days");
    }

    #[test]
    fn interval_produces_expected_sequence_inside_window() {
        let mut a = alarm("int1", "09:00", Vec::new());
        a.repeat = Repeat::Interval;
        a.interval_minutes = Some(30);
        a.window_start = Some("09:00".to_string());
        a.window_end = Some("11:00".to_string());

        let mut state = state_with(vec![a.clone()]);
        let d = NaiveDate::from_ymd_opt(2026, 5, 15).unwrap();

        // 08:30: before window, does not fire
        assert!(tick(&mut state, d.and_hms_opt(8, 30, 0).unwrap()).0.is_empty());

        // 09:00: first slot
        let fired = tick(&mut state, d.and_hms_opt(9, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "09:00");
        assert!(!fired[0].consumed);
        assert!(state.alarms[0].enabled);

        // 09:30: second slot
        let fired = tick(&mut state, d.and_hms_opt(9, 30, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "09:30");

        // 10:00: third slot
        let fired = tick(&mut state, d.and_hms_opt(10, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "10:00");

        // 10:30: fourth slot
        let fired = tick(&mut state, d.and_hms_opt(10, 30, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "10:30");

        // 11:00: fifth slot (window_end)
        let fired = tick(&mut state, d.and_hms_opt(11, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "11:00");

        // 11:30: after window, does not fire
        assert!(tick(&mut state, d.and_hms_opt(11, 30, 0).unwrap()).0.is_empty());

        // Preview from 08:00
        let previews = preview_alarm_at(&a, 5, d.and_hms_opt(8, 0, 0).unwrap());
        assert_eq!(
            previews.next,
            vec![
                "2026-05-15T09:00:00",
                "2026-05-15T09:30:00",
                "2026-05-15T10:00:00",
                "2026-05-15T10:30:00",
                "2026-05-15T11:00:00",
            ]
        );
    }

    #[test]
    fn window_crossing_midnight_works() {
        let mut a = alarm("mid1", "22:00", Vec::new());
        a.repeat = Repeat::Interval;
        a.interval_minutes = Some(60);
        a.window_start = Some("22:00".to_string());
        a.window_end = Some("02:00".to_string());

        let mut state = state_with(vec![a.clone()]);
        let d1 = NaiveDate::from_ymd_opt(2026, 5, 15).unwrap();
        let d2 = NaiveDate::from_ymd_opt(2026, 5, 16).unwrap();

        // 21:00 on Day 1: does not fire
        assert!(tick(&mut state, d1.and_hms_opt(21, 0, 0).unwrap()).0.is_empty());

        // 22:00 on Day 1: fires
        let fired = tick(&mut state, d1.and_hms_opt(22, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "22:00");

        // 23:00 on Day 1: fires
        let fired = tick(&mut state, d1.and_hms_opt(23, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "23:00");

        // 00:00 on Day 2 (midnight cross): fires
        let fired = tick(&mut state, d2.and_hms_opt(0, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "00:00");

        // 01:00 on Day 2: fires
        let fired = tick(&mut state, d2.and_hms_opt(1, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "01:00");

        // 02:00 on Day 2: fires
        let fired = tick(&mut state, d2.and_hms_opt(2, 0, 0).unwrap()).0;
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].time, "02:00");

        // 03:00 on Day 2: after window end, does not fire
        assert!(tick(&mut state, d2.and_hms_opt(3, 0, 0).unwrap()).0.is_empty());

        // Preview from 20:00 on Day 1 across midnight
        let preview = preview_alarm_at(&a, 5, d1.and_hms_opt(20, 0, 0).unwrap());
        assert_eq!(
            preview.next,
            vec![
                "2026-05-15T22:00:00",
                "2026-05-15T23:00:00",
                "2026-05-16T00:00:00",
                "2026-05-16T01:00:00",
                "2026-05-16T02:00:00",
            ]
        );
    }

    #[test]
    fn missing_window_defaults_to_whole_day() {
        let mut a = alarm("wholeday", "00:00", Vec::new());
        a.repeat = Repeat::Interval;
        a.interval_minutes = Some(120);
        a.window_start = None;
        a.window_end = None;

        let d = NaiveDate::from_ymd_opt(2026, 5, 15).unwrap();
        let slots = firing_minutes_today(&a, d);
        assert_eq!(slots.len(), 12);
        assert_eq!(slots[0], 0); // 00:00
        assert_eq!(slots[11], 1320); // 22:00

        let preview = preview_alarm_at(&a, 3, d.and_hms_opt(1, 0, 0).unwrap());
        assert_eq!(
            preview.next,
            vec![
                "2026-05-15T02:00:00",
                "2026-05-15T04:00:00",
                "2026-05-15T06:00:00",
            ]
        );
    }

    #[test]
    fn legacy_alarm_no_new_fields_computes_same_next_fire_as_before() {
        let legacy_json = r#"{
            "id": "leg1",
            "label": "Morning",
            "time": "08:00",
            "repeat": "daily",
            "enabled": true
        }"#;

        let a: ScheduledAlarm = serde_json::from_str(legacy_json).expect("deserialize legacy alarm");
        assert!(a.date.is_none());
        assert!(a.interval_minutes.is_none());
        assert!(a.window_start.is_none());
        assert!(a.window_end.is_none());
        assert_eq!(a.repeat, Repeat::Daily);

        let d = NaiveDate::from_ymd_opt(2026, 5, 15).unwrap();
        let preview_before = preview_alarm_at(&a, 3, d.and_hms_opt(7, 0, 0).unwrap());
        assert_eq!(
            preview_before.next,
            vec![
                "2026-05-15T08:00:00",
                "2026-05-16T08:00:00",
                "2026-05-17T08:00:00",
            ]
        );

        let preview_after = preview_alarm_at(&a, 3, d.and_hms_opt(9, 0, 0).unwrap());
        assert_eq!(
            preview_after.next,
            vec![
                "2026-05-16T08:00:00",
                "2026-05-17T08:00:00",
                "2026-05-18T08:00:00",
            ]
        );
    }

    #[test]
    fn alarm_preview_honours_count_and_defaults_to_3() {
        let mut a = alarm("cnt1", "08:00", Vec::new());
        a.repeat = Repeat::Daily;

        let previews_default = alarm_preview(vec![a.clone()], None);
        assert_eq!(previews_default.len(), 1);
        assert_eq!(previews_default[0].next.len(), 3);
        assert!(!previews_default[0].disabled);

        let previews_1 = alarm_preview(vec![a.clone()], Some(1));
        assert_eq!(previews_1[0].next.len(), 1);

        let previews_5 = alarm_preview(vec![a.clone()], Some(5));
        assert_eq!(previews_5[0].next.len(), 5);

        let previews_0 = alarm_preview(vec![a.clone()], Some(0));
        assert_eq!(previews_0[0].next.len(), 0);

        let mut dis = a.clone();
        dis.enabled = false;
        let previews_dis = alarm_preview(vec![dis], Some(3));
        assert!(previews_dis[0].disabled);
        assert!(previews_dis[0].next.is_empty());
    }

    #[test]
    fn snoozed_once_alarm_rings_even_though_consumed() {
        let mut state = state_with(vec![one_shot("once1", "07:00")]);
        let (fired1, _) = tick(&mut state, wednesday(7, 0));
        assert_eq!(fired1.len(), 1);
        assert!(fired1[0].consumed);
        assert!(!state.alarms[0].enabled);

        state.snoozed.push(Snooze {
            id: "once1".to_string(),
            due_at: SystemTime::now() - Duration::from_secs(1),
            minutes: 5,
        });

        let (fired2, _) = tick(&mut state, wednesday(7, 5));
        assert_eq!(fired2.len(), 1, "snoozed one-shot alarm must ring when due");
        assert_eq!(fired2[0].id, "once1");
        assert_eq!(fired2[0].snoozed_for, 5);
        assert!(fired2[0].consumed);
    }

    #[test]
    fn snoozed_interval_alarm_does_not_double_fire() {
        let mut a = alarm("int1", "09:00", Vec::new());
        a.repeat = Repeat::Interval;
        a.interval_minutes = Some(30);
        a.window_start = Some("09:00".to_string());
        a.window_end = Some("11:00".to_string());
        let mut state = state_with(vec![a]);

        let (fired1, _) = tick(&mut state, wednesday(9, 0));
        assert_eq!(fired1.len(), 1);

        state.snoozed.push(Snooze {
            id: "int1".to_string(),
            due_at: SystemTime::now() - Duration::from_secs(1),
            minutes: 30,
        });

        let (fired2, _) = tick(&mut state, wednesday(9, 30));
        assert_eq!(fired2.len(), 1, "must not double-fire coinciding snooze and interval slot");
        assert_eq!(fired2[0].snoozed_for, 30);
    }

    #[test]
    fn unknown_repeat_deserializes_to_daily() {
        let json_unknown = r#"{"id":"test","label":"Test","time":"08:00","repeat":"custom","enabled":true}"#;
        let parsed: Result<ScheduledAlarm, _> = serde_json::from_str(json_unknown);
        assert!(parsed.is_ok(), "unknown repeat string must not fail deserialization");
        let alarm = parsed.unwrap();
        assert_eq!(alarm.repeat, Repeat::Daily);

        let json_weekdays = r#"{"id":"test2","label":"Test2","time":"08:00","repeat":"weekdays","enabled":true}"#;
        let parsed2: ScheduledAlarm = serde_json::from_str(json_weekdays).unwrap();
        assert_eq!(parsed2.repeat, Repeat::Daily);

        let json_empty = r#"{"id":"test3","label":"Test3","time":"08:00","repeat":"","enabled":true}"#;
        let parsed3: ScheduledAlarm = serde_json::from_str(json_empty).unwrap();
        assert_eq!(parsed3.repeat, Repeat::Daily);
    }

    #[test]
    fn alarm_note_field_in_scheduled_alarm_and_fired_event() {
        let json_with_note = r#"{"id":"note1","label":"Note Alarm","time":"08:00","repeat":"daily","enabled":true,"note":"Take pills"}"#;
        let alarm: ScheduledAlarm = serde_json::from_str(json_with_note).unwrap();
        assert_eq!(alarm.note.as_deref(), Some("Take pills"));

        let mut state = state_with(vec![alarm]);
        let (fired, _) = tick(&mut state, wednesday(8, 0));
        assert_eq!(fired.len(), 1);
        assert_eq!(fired[0].note.as_deref(), Some("Take pills"));

        let json_no_note = r#"{"id":"note2","label":"No Note","time":"08:00","repeat":"daily","enabled":true}"#;
        let alarm2: ScheduledAlarm = serde_json::from_str(json_no_note).unwrap();
        assert_eq!(alarm2.note, None);
    }
}
