use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};

use chrono::Local;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{Emitter, Manager};
use uuid::Uuid;

const TICK: Duration = Duration::from_millis(250);
pub const MIN_MINUTES: i64 = 10;
pub const MAX_MINUTES: i64 = 120;

/// The two operational modes supported by Tempo.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum TimerMode {
    #[default]
    Pomodoro,
    Stopwatch,
}

/// The three phases of the pomodoro cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum Phase {
    #[default]
    Focus,
    ShortRest,
    LongRest,
}

/// Snapshot emitted to listeners and returned to commands.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerSnapshot {
    pub total_secs: u64,
    pub remaining_secs: u64,
    pub elapsed_secs: u64,
    pub running: bool,
    pub mode: TimerMode,
    pub phase: Phase,
    pub pomodoro_index: u8,
    pub completed_today: u32,
    pub focus_min: u32,
    pub short_rest_min: u32,
    pub long_rest_min: u32,
    pub auto_start: bool,
}

/// A finished stretch of focus, ready to be recorded in the session log.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TimerSession {
    pub id: String,
    pub kind: String,
    pub started_at: String,
    pub ended_at: String,
    pub duration_sec: u64,
    pub completed: bool,
    pub task_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct TimerState {
    pub total_secs: u64,
    pub remaining_secs: u64,
    pub elapsed_secs: u64,
    pub deadline: Option<SystemTime>,
    pub stopwatch_started: Option<SystemTime>,
    pub mode: TimerMode,

    /// Instant the current focus session started running.
    pub session_started: Option<SystemTime>,
    /// Accumulated seconds in the current focus session across pauses.
    pub session_accumulated_secs: u64,

    pub pending_sessions: Vec<TimerSession>,

    // Pomodoro cycle fields
    pub phase: Phase,
    pub pomodoro_index: u8,
    pub completed_today: u32,
    pub focus_min: u32,
    pub short_rest_min: u32,
    pub long_rest_min: u32,
    pub auto_start: bool,

    pub last_focus_date: String,
    pub persist_path: Option<PathBuf>,
}

fn today_str() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

impl Default for TimerState {
    fn default() -> Self {
        let focus_min = 25;
        let short_rest_min = 5;
        let long_rest_min = 15;
        let total = (focus_min as u64) * 60;
        let mut state = Self {
            total_secs: total,
            remaining_secs: total,
            elapsed_secs: 0,
            deadline: None,
            stopwatch_started: None,
            mode: TimerMode::Pomodoro,
            session_started: None,
            session_accumulated_secs: 0,
            pending_sessions: Vec::new(),
            phase: Phase::Focus,
            pomodoro_index: 1,
            completed_today: 0,
            focus_min,
            short_rest_min,
            long_rest_min,
            auto_start: false,
            last_focus_date: today_str(),
            persist_path: default_store_file_path(),
        };
        state.load_persisted();
        state
    }
}

impl TimerState {
    pub fn is_break(&self) -> bool {
        self.phase == Phase::ShortRest || self.phase == Phase::LongRest
    }

    /// Closes a focus session and pushes it to `pending_sessions`. Breaks are NEVER recorded.
    pub fn close_session(&mut self, now: SystemTime, completed: bool) {
        if self.mode != TimerMode::Pomodoro || self.phase != Phase::Focus {
            self.session_started = None;
            self.session_accumulated_secs = 0;
            return;
        }

        let mut focused = self.session_accumulated_secs;
        if let Some(started) = self.session_started.take() {
            focused += now.duration_since(started).unwrap_or_default().as_secs();
        }
        self.session_accumulated_secs = 0;

        // Nothing shorter than a second is recorded
        if focused == 0 {
            return;
        }

        let now_dt = Local::now();
        let start_dt = now_dt - chrono::Duration::seconds(focused as i64);

        self.pending_sessions.push(TimerSession {
            id: Uuid::new_v4().to_string(),
            kind: "pomodoro".to_string(),
            started_at: start_dt.to_rfc3339(),
            ended_at: now_dt.to_rfc3339(),
            duration_sec: focused,
            completed,
            task_id: None,
        });
    }

    pub fn take_sessions(&mut self) -> Vec<TimerSession> {
        std::mem::take(&mut self.pending_sessions)
    }

    pub fn check_date_rollover(&mut self) {
        let today = today_str();
        if self.last_focus_date != today {
            self.completed_today = 0;
            self.last_focus_date = today;
            self.save_persisted();
        }
    }

    /// Reconciles the stored remaining/elapsed time with the wall clock.
    ///
    /// Returns true when this call crossed zero, so the caller rings exactly
    /// once no matter how the loop was scheduled.
    pub fn advance(&mut self, now: SystemTime) -> bool {
        self.check_date_rollover();

        match self.mode {
            TimerMode::Stopwatch => {
                if let Some(start) = self.stopwatch_started {
                    let elapsed = now.duration_since(start).unwrap_or_default().as_secs();
                    self.elapsed_secs = elapsed;
                    self.total_secs = elapsed;
                    self.remaining_secs = 0;
                }
                false
            }
            TimerMode::Pomodoro => {
                let Some(deadline) = self.deadline else {
                    return false;
                };

                if now < deadline {
                    self.remaining_secs = deadline.duration_since(now).unwrap_or_default().as_secs();
                    self.elapsed_secs = self.total_secs.saturating_sub(self.remaining_secs);
                    return false;
                }

                self.remaining_secs = 0;
                self.elapsed_secs = self.total_secs;

                match self.phase {
                    Phase::Focus => {
                        // Focus completed! Close focus session with completed = true.
                        self.close_session(now, true);
                        self.completed_today += 1;

                        // Next phase: after 4th focus -> LongRest, else ShortRest
                        let next_phase = if self.pomodoro_index >= 4 {
                            Phase::LongRest
                        } else {
                            Phase::ShortRest
                        };

                        self.phase = next_phase;
                        let rest_min = match next_phase {
                            Phase::LongRest => self.long_rest_min,
                            _ => self.short_rest_min,
                        };
                        let rest_secs = (rest_min as u64) * 60;
                        self.total_secs = rest_secs;
                        self.remaining_secs = rest_secs;
                        self.elapsed_secs = 0;

                        // A break ALWAYS starts by itself the moment focus hits zero (R04)
                        self.deadline = Some(now + Duration::from_secs(rest_secs));
                        self.session_started = None;
                        self.session_accumulated_secs = 0;

                        self.save_persisted();
                        true
                    }
                    Phase::ShortRest => {
                        // Short break ended!
                        self.pomodoro_index += 1;
                        self.phase = Phase::Focus;
                        let focus_secs = (self.focus_min as u64) * 60;
                        self.total_secs = focus_secs;
                        self.remaining_secs = focus_secs;
                        self.elapsed_secs = 0;
                        self.session_started = None;
                        self.session_accumulated_secs = 0;

                        if self.auto_start {
                            self.deadline = Some(now + Duration::from_secs(focus_secs));
                            self.session_started = Some(now);
                        } else {
                            self.deadline = None;
                        }

                        self.save_persisted();
                        true
                    }
                    Phase::LongRest => {
                        // Long break ended!
                        self.pomodoro_index = 1;
                        self.phase = Phase::Focus;
                        let focus_secs = (self.focus_min as u64) * 60;
                        self.total_secs = focus_secs;
                        self.remaining_secs = focus_secs;
                        self.elapsed_secs = 0;
                        self.session_started = None;
                        self.session_accumulated_secs = 0;

                        if self.auto_start {
                            self.deadline = Some(now + Duration::from_secs(focus_secs));
                            self.session_started = Some(now);
                        } else {
                            self.deadline = None;
                        }

                        self.save_persisted();
                        true
                    }
                }
            }
        }
    }

    pub fn snapshot(&self) -> TimerSnapshot {
        TimerSnapshot {
            total_secs: self.total_secs,
            remaining_secs: self.remaining_secs,
            elapsed_secs: self.elapsed_secs,
            running: self.deadline.is_some() || self.stopwatch_started.is_some(),
            mode: self.mode,
            phase: self.phase,
            pomodoro_index: self.pomodoro_index,
            completed_today: self.completed_today,
            focus_min: self.focus_min,
            short_rest_min: self.short_rest_min,
            long_rest_min: self.long_rest_min,
            auto_start: self.auto_start,
        }
    }

    pub fn load_persisted(&mut self) {
        let Some(path) = &self.persist_path else {
            return;
        };
        if !path.exists() {
            return;
        }
        let Ok(contents) = fs::read_to_string(path) else {
            return;
        };
        let Ok(mut map) = serde_json::from_str::<serde_json::Map<String, Value>>(&contents) else {
            return;
        };

        // Prefer tempo_* keys, fallback to legacy alarmer_* keys once
        let mut loaded_settings = false;
        if let Some(settings) = map.get("tempo_pomodoro_settings").or_else(|| map.get("alarmer_pomodoro_settings")).or_else(|| map.get("alarmer_block_settings")) {
            if let Some(fm) = settings.get("focusMin").and_then(|v| v.as_u64()) {
                self.focus_min = (fm as u32).clamp(10, 120);
                loaded_settings = true;
            }
            if let Some(srm) = settings.get("shortRestMin").or_else(|| settings.get("restMin")).and_then(|v| v.as_u64()) {
                self.short_rest_min = (srm as u32).clamp(1, 60);
                loaded_settings = true;
            }
            if let Some(lrm) = settings.get("longRestMin").and_then(|v| v.as_u64()) {
                self.long_rest_min = (lrm as u32).clamp(1, 60);
                loaded_settings = true;
            }
            if let Some(as_val) = settings.get("autoStart").and_then(|v| v.as_bool()) {
                self.auto_start = as_val;
                loaded_settings = true;
            }
        }

        if let Some(idx) = map.get("tempo_pomodoro_index").and_then(|v| v.as_u64()) {
            self.pomodoro_index = (idx as u8).clamp(1, 4);
        }

        if let Some(today_count) = map.get("tempo_completed_today").and_then(|v| v.as_u64()) {
            self.completed_today = today_count as u32;
        }

        if let Some(date) = map.get("tempo_last_focus_date").and_then(|v| v.as_str()) {
            self.last_focus_date = date.to_string();
        }
        let mut loaded_phase = false;
        if let Some(phase_str) = map.get("tempo_phase").and_then(|v| v.as_str()) {
            match phase_str {
                "short_rest" => {
                    self.phase = Phase::ShortRest;
                    let secs = (self.short_rest_min as u64) * 60;
                    self.total_secs = secs;
                    self.remaining_secs = secs;
                    self.elapsed_secs = 0;
                    loaded_phase = true;
                }
                "long_rest" => {
                    self.phase = Phase::LongRest;
                    let secs = (self.long_rest_min as u64) * 60;
                    self.total_secs = secs;
                    self.remaining_secs = secs;
                    self.elapsed_secs = 0;
                    loaded_phase = true;
                }
                "focus" => {
                    self.phase = Phase::Focus;
                    loaded_phase = true;
                }
                _ => {}
            }
        }

        if let Some(tot) = map.get("tempo_total_secs").and_then(|v| v.as_u64()) {
            if tot > 0 {
                self.total_secs = tot;
                if let Some(rem) = map.get("tempo_remaining_secs").and_then(|v| v.as_u64()) {
                    self.remaining_secs = rem.min(tot);
                    self.elapsed_secs = tot.saturating_sub(self.remaining_secs);
                }
            }
        }

        if let Some(deadline_ms) = map.get("tempo_deadline_epoch_ms").and_then(|v| v.as_u64()) {
            let deadline = SystemTime::UNIX_EPOCH + Duration::from_millis(deadline_ms);
            let now = SystemTime::now();
            if deadline > now {
                self.deadline = Some(deadline);
                self.remaining_secs = deadline.duration_since(now).unwrap_or_default().as_secs();
                self.elapsed_secs = self.total_secs.saturating_sub(self.remaining_secs);
                if self.phase == Phase::Focus {
                    self.session_started = Some(now);
                }
            }
        }

        let in_flight_sec = map.get("tempo_in_flight_focus_sec").and_then(|v| v.as_u64()).unwrap_or(0);
        if in_flight_sec > 0 {
            let now_dt = Local::now();
            let start_dt = now_dt - chrono::Duration::seconds(in_flight_sec as i64);
            self.pending_sessions.push(TimerSession {
                id: Uuid::new_v4().to_string(),
                kind: "pomodoro".to_string(),
                started_at: start_dt.to_rfc3339(),
                ended_at: now_dt.to_rfc3339(),
                duration_sec: in_flight_sec,
                completed: false,
                task_id: None,
            });
            map.remove("tempo_in_flight_focus_sec");
            if let Ok(serialized) = serde_json::to_string_pretty(&map) {
                let _ = fs::write(path, serialized);
            }
        }

        if loaded_settings && self.mode == TimerMode::Pomodoro && self.phase == Phase::Focus && self.deadline.is_none() && !loaded_phase {
            let secs = (self.focus_min as u64) * 60;
            self.total_secs = secs;
            self.remaining_secs = secs;
            self.elapsed_secs = 0;
        }
    }

    pub fn save_persisted(&self) {
        let Some(path) = &self.persist_path else {
            return;
        };
        let mut map = if path.exists() {
            fs::read_to_string(path)
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Map<String, Value>>(&s).ok())
                .unwrap_or_default()
        } else {
            serde_json::Map::new()
        };

        let pomodoro_settings = serde_json::json!({
            "focusMin": self.focus_min,
            "shortRestMin": self.short_rest_min,
            "longRestMin": self.long_rest_min,
            "autoStart": self.auto_start,
        });
        map.insert("tempo_pomodoro_settings".into(), pomodoro_settings);
        map.insert("tempo_pomodoro_index".into(), serde_json::json!(self.pomodoro_index));
        map.insert("tempo_completed_today".into(), serde_json::json!(self.completed_today));
        map.insert("tempo_last_focus_date".into(), serde_json::json!(self.last_focus_date));

        let phase_str = match self.phase {
            Phase::Focus => "focus",
            Phase::ShortRest => "short_rest",
            Phase::LongRest => "long_rest",
        };
        map.insert("tempo_phase".into(), serde_json::json!(phase_str));
        map.insert("tempo_remaining_secs".into(), serde_json::json!(self.remaining_secs));
        map.insert("tempo_total_secs".into(), serde_json::json!(self.total_secs));

        if let Some(deadline) = self.deadline {
            if let Ok(dur) = deadline.duration_since(SystemTime::UNIX_EPOCH) {
                map.insert("tempo_deadline_epoch_ms".into(), serde_json::json!(dur.as_millis() as u64));
            }
        } else {
            map.remove("tempo_deadline_epoch_ms");
        }

        let mut in_flight_focus = self.session_accumulated_secs;
        if let Some(started) = self.session_started {
            in_flight_focus += SystemTime::now().duration_since(started).unwrap_or_default().as_secs();
        }
        if in_flight_focus > 0 && self.phase == Phase::Focus {
            map.insert("tempo_in_flight_focus_sec".into(), serde_json::json!(in_flight_focus));
        } else {
            map.remove("tempo_in_flight_focus_sec");
        }
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(serialized) = serde_json::to_string_pretty(&map) {
            let _ = fs::write(path, serialized);
        }
    }
}

fn default_store_file_path() -> Option<PathBuf> {
    // Check portable marker
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if dir.join(".portable").exists() || std::env::var_os("ALARMER_PORTABLE").is_some() || std::env::var_os("TEMPO_PORTABLE").is_some() {
                return Some(dir.join("tempo.json"));
            }
        }
    }
    // Standard data dir
    #[cfg(target_os = "windows")]
    {
        if let Ok(app_data) = std::env::var("APPDATA") {
            let tempo_path = PathBuf::from(&app_data).join("Tempo").join("tempo.json");
            if tempo_path.exists() {
                return Some(tempo_path);
            }
            let legacy_path = PathBuf::from(&app_data).join("Alarmer").join("alarmer.json");
            if legacy_path.exists() {
                return Some(legacy_path);
            }
            return Some(tempo_path);
        }
    }
    None
}

static STATE: Mutex<Option<TimerState>> = Mutex::new(None);

fn with_state<T>(f: impl FnOnce(&mut TimerState) -> T) -> T {
    let mut guard = STATE.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
    f(guard.get_or_insert_with(TimerState::default))
}

/// Sets the duration in seconds (clamped to 10..=120 minutes) and re-arms only when not running.
pub fn set_duration(secs: u64) {
    with_state(|state| {
        if state.deadline.is_some() || state.stopwatch_started.is_some() {
            return;
        }
        if state.is_break() {
            return;
        }
        let mins = (secs / 60).clamp(MIN_MINUTES as u64, MAX_MINUTES as u64);
        state.focus_min = mins as u32;
        let clamped_secs = mins * 60;
        state.total_secs = clamped_secs;
        state.remaining_secs = clamped_secs;
        state.elapsed_secs = 0;
        state.session_started = None;
        state.session_accumulated_secs = 0;
        state.save_persisted();
    });
}

/// Starts or resumes the countdown / stopwatch.
pub fn start() {
    with_state(|state| {
        let now = SystemTime::now();
        match state.mode {
            TimerMode::Stopwatch => {
                if state.stopwatch_started.is_some() {
                    return;
                }
                state.stopwatch_started = Some(now - Duration::from_secs(state.elapsed_secs));
            }
            TimerMode::Pomodoro => {
                if state.deadline.is_some() {
                    return;
                }
                if state.remaining_secs == 0 {
                    state.remaining_secs = state.total_secs;
                    state.elapsed_secs = 0;
                }
                state.deadline = Some(now + Duration::from_secs(state.remaining_secs));
                if state.session_started.is_none() && state.phase == Phase::Focus {
                    state.session_started = Some(now);
                }
            }
        }
        state.save_persisted();
    });
}

/// Freezes the countdown at its current remaining time.
/// A pause mid-focus closes the session with completed = false.
pub fn pause() {
    with_state(|state| {
        let now = SystemTime::now();
        match state.mode {
            TimerMode::Stopwatch => {
                if let Some(start) = state.stopwatch_started.take() {
                    state.elapsed_secs = now.duration_since(start).unwrap_or_default().as_secs();
                    state.total_secs = state.elapsed_secs;
                }
            }
            TimerMode::Pomodoro => {
                if let Some(deadline) = state.deadline.take() {
                    state.remaining_secs = deadline.duration_since(now).unwrap_or_default().as_secs();
                    state.elapsed_secs = state.total_secs.saturating_sub(state.remaining_secs);
                    if state.phase == Phase::Focus {
                        state.close_session(now, false);
                    }
                }
            }
        }
        state.save_persisted();
    });
}

/// Rewinds to the armed duration and stops.
/// A reset mid-focus closes the session with completed = false.
pub fn reset() {
    with_state(|state| {
        let now = SystemTime::now();
        match state.mode {
            TimerMode::Stopwatch => {
                state.stopwatch_started = None;
                state.elapsed_secs = 0;
                state.total_secs = 0;
                state.remaining_secs = 0;
            }
            TimerMode::Pomodoro => {
                if state.is_break() {
                    return;
                }
                state.close_session(now, false);
                state.deadline = None;
                let focus_secs = (state.focus_min as u64) * 60;
                state.total_secs = focus_secs;
                state.remaining_secs = focus_secs;
                state.elapsed_secs = 0;
            }
        }
        state.save_persisted();
    });
}

/// Nudges the armed duration by `delta` minutes, clamped to 10..=120, re-arming only when not running.
pub fn shift_minutes(delta: i64) {
    with_state(|state| {
        if state.deadline.is_some() || state.stopwatch_started.is_some() {
            return;
        }
        if state.is_break() {
            return;
        }
        let current = (state.total_secs / 60) as i64;
        let next = (current + delta).clamp(MIN_MINUTES, MAX_MINUTES);
        state.focus_min = next as u32;
        let secs = next as u64 * 60;
        state.total_secs = secs;
        state.remaining_secs = secs;
        state.elapsed_secs = 0;
        state.session_started = None;
        state.session_accumulated_secs = 0;
        state.save_persisted();
    });
}

/// Current state, reconciled against the clock.
pub fn snapshot() -> TimerSnapshot {
    with_state(|state| {
        state.advance(SystemTime::now());
        state.snapshot()
    })
}

/// Sets the arming mode.
pub fn set_mode(mode: TimerMode) {
    with_state(|state| {
        if state.is_break() {
            return;
        }
        if state.mode == mode {
            return;
        }
        let now = SystemTime::now();
        if state.mode == TimerMode::Pomodoro && state.phase == Phase::Focus {
            state.close_session(now, false);
        }
        state.mode = mode;
        state.deadline = None;
        state.stopwatch_started = None;
        state.session_started = None;
        state.session_accumulated_secs = 0;

        match mode {
            TimerMode::Pomodoro => {
                state.phase = Phase::Focus;
                let focus_secs = (state.focus_min as u64) * 60;
                state.total_secs = focus_secs;
                state.remaining_secs = focus_secs;
                state.elapsed_secs = 0;
            }
            TimerMode::Stopwatch => {
                state.total_secs = 0;
                state.remaining_secs = 0;
                state.elapsed_secs = 0;
            }
        }
        state.save_persisted();
    });
}

pub fn set_pomodoro_settings(focus_min: u32, short_rest_min: u32, long_rest_min: u32, auto_start: bool) {
    with_state(|state| {
        state.focus_min = focus_min.clamp(10, 120);
        state.short_rest_min = short_rest_min.clamp(1, 60);
        state.long_rest_min = long_rest_min.clamp(1, 60);
        state.auto_start = auto_start;

        if state.mode == TimerMode::Pomodoro && state.deadline.is_none() {
            let secs = match state.phase {
                Phase::Focus => (state.focus_min as u64) * 60,
                Phase::ShortRest => (state.short_rest_min as u64) * 60,
                Phase::LongRest => (state.long_rest_min as u64) * 60,
            };
            state.total_secs = secs;
            state.remaining_secs = secs;
            state.elapsed_secs = 0;
        }
        state.save_persisted();
    });
}

pub fn skip_phase() {
    with_state(|state| {
        if state.mode != TimerMode::Pomodoro {
            return;
        }
        let now = SystemTime::now();
        match state.phase {
            Phase::Focus => {
                // Skips the remaining focus. Mid-focus close -> completed = false.
                state.close_session(now, false);
                let next_phase = if state.pomodoro_index >= 4 {
                    Phase::LongRest
                } else {
                    Phase::ShortRest
                };
                state.phase = next_phase;
                let rest_min = match next_phase {
                    Phase::LongRest => state.long_rest_min,
                    _ => state.short_rest_min,
                };
                let rest_secs = (rest_min as u64) * 60;
                state.total_secs = rest_secs;
                state.remaining_secs = rest_secs;
                state.elapsed_secs = 0;
                // Break ALWAYS starts by itself (R04)
                state.deadline = Some(now + Duration::from_secs(rest_secs));
                state.session_started = None;
                state.session_accumulated_secs = 0;
            }
            Phase::ShortRest => {
                state.deadline = None;
                state.pomodoro_index += 1;
                state.phase = Phase::Focus;
                let focus_secs = (state.focus_min as u64) * 60;
                state.total_secs = focus_secs;
                state.remaining_secs = focus_secs;
                state.elapsed_secs = 0;
                state.session_started = None;
                state.session_accumulated_secs = 0;
                if state.auto_start {
                    state.deadline = Some(now + Duration::from_secs(focus_secs));
                    state.session_started = Some(now);
                }
            }
            Phase::LongRest => {
                state.deadline = None;
                state.pomodoro_index = 1;
                state.phase = Phase::Focus;
                let focus_secs = (state.focus_min as u64) * 60;
                state.total_secs = focus_secs;
                state.remaining_secs = focus_secs;
                state.elapsed_secs = 0;
                state.session_started = None;
                state.session_accumulated_secs = 0;
                if state.auto_start {
                    state.deadline = Some(now + Duration::from_secs(focus_secs));
                    state.session_started = Some(now);
                }
            }
        }
        state.save_persisted();
    });
}

// --- Tauri commands -------------------------------------------------------

#[tauri::command]
pub async fn timer_set_duration(secs: u64) -> Result<(), String> {
    set_duration(secs);
    Ok(())
}

#[tauri::command]
pub async fn timer_start() -> Result<(), String> {
    start();
    Ok(())
}

#[tauri::command]
pub async fn timer_pause() -> Result<(), String> {
    pause();
    Ok(())
}

#[tauri::command]
pub async fn timer_reset() -> Result<(), String> {
    reset();
    Ok(())
}

#[tauri::command]
pub async fn timer_shift_minutes(delta: i64) -> Result<(), String> {
    shift_minutes(delta);
    Ok(())
}

#[tauri::command]
pub async fn timer_set_mode(mode: TimerMode) -> Result<(), String> {
    set_mode(mode);
    Ok(())
}

#[tauri::command]
pub async fn timer_set_pomodoro_settings(
    focus_min: u32,
    short_rest_min: u32,
    long_rest_min: u32,
    auto_start: bool,
) -> Result<(), String> {
    set_pomodoro_settings(focus_min, short_rest_min, long_rest_min, auto_start);
    Ok(())
}

#[tauri::command]
pub async fn timer_skip_phase() -> Result<(), String> {
    skip_phase();
    Ok(())
}

#[tauri::command]
pub async fn timer_get_state() -> Result<TimerSnapshot, String> {
    Ok(snapshot())
}

/// Writes one finished session into the database.
///
/// Split from `save_sessions_to_db` so the row shape can be tested against a
/// real connection: a bug here loses every statistic the app has, and the
/// `AppHandle` version cannot be exercised from a unit test.
fn insert_session_row(conn: &rusqlite::Connection, session: &TimerSession) -> Result<(), String> {
    let row = serde_json::json!({
        "id": session.id,
        "kind": session.kind,
        "started_at": session.started_at,
        "ended_at": session.ended_at,
        "duration_sec": session.duration_sec,
        "completed": if session.completed { 1 } else { 0 },
        "task_id": session.task_id,
    });
    crate::storage::repo::insert(conn, "sessions", &row).map(|_| ())
}

/// Drains pending sessions and writes focus sessions to SQLite via `storage::with_db`.
fn save_sessions_to_db(app: &tauri::AppHandle, sessions: &[TimerSession]) {
    for session in sessions {
        if session.kind != "pomodoro" && session.kind != "stopwatch" {
            continue;
        }
        let app_handle = app.clone();
        let _ = crate::storage::with_db(&app_handle, |conn| insert_session_row(conn, session));
    }
}

/// Starts the tick loop, which broadcasts state and rings at zero.
pub fn spawn(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(TICK);
        let mut last_remaining = u64::MAX;
        let mut last_elapsed = u64::MAX;
        let mut last_running = false;
        let mut last_phase = Phase::Focus;
        let mut last_pomodoro_index = 0u8;

        loop {
            ticker.tick().await;

            let (fired, state, sessions) = with_state(|state| {
                let crossed = state.advance(SystemTime::now());
                (crossed, state.snapshot(), state.take_sessions())
            });

            // Write focus sessions to SQLite via storage::with_db
            if !sessions.is_empty() {
                save_sessions_to_db(&app, &sessions);
                for session in sessions {
                    let _ = app.emit("timer://session", session);
                }
            }

            // Emit on any real change rather than on every 250 ms poll
            if state.remaining_secs != last_remaining
                || state.elapsed_secs != last_elapsed
                || state.running != last_running
                || state.phase != last_phase
                || state.pomodoro_index != last_pomodoro_index
            {
                last_remaining = state.remaining_secs;
                last_elapsed = state.elapsed_secs;
                last_running = state.running;
                last_phase = state.phase;
                last_pomodoro_index = state.pomodoro_index;
                let _ = app.emit("timer://tick", state.clone());
            }

            if fired {
                let _ = app.emit("timer://finished", state.clone());

                // A hidden window cannot play the chime itself, so the OS notification says it
                let visible = app
                    .get_webview_window("main")
                    .and_then(|w| w.is_visible().ok())
                    .unwrap_or(false);
                if !visible {
                    use tauri_plugin_notification::NotificationExt;
                    let _ = app
                        .notification()
                        .builder()
                        .title("Время вышло")
                        .body("Таймер завершён.")
                        .show();
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn running_for(secs: u64) -> TimerState {
        let mut state = TimerState {
            total_secs: secs,
            remaining_secs: secs,
            elapsed_secs: 0,
            deadline: Some(SystemTime::now() + Duration::from_secs(secs)),
            stopwatch_started: None,
            mode: TimerMode::Pomodoro,
            session_started: Some(SystemTime::now()),
            session_accumulated_secs: 0,
            pending_sessions: Vec::new(),
            phase: Phase::Focus,
            pomodoro_index: 1,
            completed_today: 0,
            focus_min: (secs / 60).max(1) as u32,
            short_rest_min: 5,
            long_rest_min: 15,
            auto_start: false,
            last_focus_date: today_str(),
            persist_path: None,
        };
        state.deadline = Some(SystemTime::now() + Duration::from_secs(secs));
        state
    }

    #[test]
    fn counts_down_towards_the_deadline() {
        let mut state = running_for(60);
        let now = SystemTime::now();

        assert!(!state.advance(now));
        assert!(state.remaining_secs <= 60 && state.remaining_secs >= 59);
        assert!(state.snapshot().running);
    }

    #[test]
    fn crossing_zero_rings_and_transitions_focus_to_break() {
        let mut state = running_for(1);
        let after = SystemTime::now() + Duration::from_secs(2);

        assert!(state.advance(after), "the crossing tick must ring");
        assert_eq!(state.phase, Phase::ShortRest);
        assert!(state.snapshot().running, "a break starts automatically (R04)");
        assert_eq!(state.remaining_secs, 5 * 60);
    }

    #[test]
    fn fourth_focus_followed_by_long_break_fifth_by_short_and_index_resets() {
        let mut state = running_for(1);
        state.pomodoro_index = 4;
        let after = SystemTime::now() + Duration::from_secs(2);

        // 4th focus hits zero -> LongRest
        assert!(state.advance(after));
        assert_eq!(state.phase, Phase::LongRest);
        assert_eq!(state.remaining_secs, 15 * 60);
        assert_eq!(state.pomodoro_index, 4);

        // Long rest hits zero -> Focus, index resets to 1
        // (In test, auto_start is false, so it sits armed. To start next focus, start() it or set auto_start=true)
        state.auto_start = true;
        let after_long_rest = after + Duration::from_secs(15 * 60 + 1);
        assert!(state.advance(after_long_rest));
        assert_eq!(state.phase, Phase::Focus);
        assert_eq!(state.pomodoro_index, 1);

        // Next focus (1st of new cycle) completes -> ShortRest
        let after_focus_1 = after_long_rest + Duration::from_secs(25 * 60 + 1);
        assert!(state.advance(after_focus_1));
        assert_eq!(state.phase, Phase::ShortRest);
    }

    #[test]
    fn break_starts_by_itself_when_focus_ends() {
        let mut state = running_for(1);
        let after = SystemTime::now() + Duration::from_secs(2);
        state.advance(after);

        assert_eq!(state.phase, Phase::ShortRest);
        assert!(state.deadline.is_some(), "break deadline must be active");
        assert!(state.snapshot().running, "timer must be running break without manual command");
    }

    #[test]
    fn auto_start_controls_next_focus_after_break() {
        // Test auto_start = false
        let mut state = running_for(1);
        state.auto_start = false;
        let after_focus = SystemTime::now() + Duration::from_secs(2);
        state.advance(after_focus);
        assert_eq!(state.phase, Phase::ShortRest);

        let after_break = after_focus + Duration::from_secs(5 * 60 + 1);
        state.advance(after_break);
        assert_eq!(state.phase, Phase::Focus);
        assert!(!state.snapshot().running, "with auto_start off, timer sits armed and not running");
        assert_eq!(state.remaining_secs, state.total_secs);

        // Test auto_start = true
        let mut state2 = running_for(1);
        state2.auto_start = true;
        let after_focus2 = SystemTime::now() + Duration::from_secs(2);
        state2.advance(after_focus2);
        assert_eq!(state2.phase, Phase::ShortRest);

        let after_break2 = after_focus2 + Duration::from_secs(5 * 60 + 1);
        state2.advance(after_break2);
        assert_eq!(state2.phase, Phase::Focus);
        assert!(state2.snapshot().running, "with auto_start on, next focus runs automatically");
    }

    #[test]
    fn pausing_mid_break_and_resuming_continues_same_phase_and_time() {
        let mut state = running_for(1);
        let after_focus = SystemTime::now() + Duration::from_secs(2);
        state.advance(after_focus);
        assert_eq!(state.phase, Phase::ShortRest);

        // Advance 10 seconds into the break
        let ten_secs_in = after_focus + Duration::from_secs(10);
        state.advance(ten_secs_in);
        let rem_before_pause = state.remaining_secs;
        assert_eq!(rem_before_pause, 5 * 60 - 10);

        // Pause mid-break
        state.deadline = None;
        assert_eq!(state.remaining_secs, rem_before_pause);

        // Resume mid-break
        let resume_time = SystemTime::now();
        state.deadline = Some(resume_time + Duration::from_secs(rem_before_pause));
        assert_eq!(state.phase, Phase::ShortRest);

        // Advance 5 seconds after resume
        state.advance(resume_time + Duration::from_secs(5));
        assert_eq!(state.remaining_secs, rem_before_pause - 5);
        assert_eq!(state.phase, Phase::ShortRest);
    }

    #[test]
    fn reset_mid_focus_closes_uncompleted_session_focus_to_zero_closes_completed_break_closes_none() {
        let mut state = running_for(60);
        let start_time = SystemTime::now() - Duration::from_secs(30);
        state.session_started = Some(start_time);

        // Reset mid-focus
        let now = SystemTime::now();
        state.close_session(now, false);
        let sessions = state.take_sessions();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].kind, "pomodoro");
        assert!(!sessions[0].completed, "interrupted session must have completed = false");
        assert!(sessions[0].duration_sec >= 29 && sessions[0].duration_sec <= 31);

        // Run focus to zero
        let mut state2 = running_for(1);
        let after = SystemTime::now() + Duration::from_secs(2);
        state2.advance(after); // transitions to ShortRest and closes completed focus session
        let sessions2 = state2.take_sessions();
        assert_eq!(sessions2.len(), 1);
        assert_eq!(sessions2[0].kind, "pomodoro");
        assert!(sessions2[0].completed, "focus reaching zero must have completed = true");

        // Run break to zero
        let after_break = after + Duration::from_secs(5 * 60 + 1);
        state2.advance(after_break);
        let sessions_after_break = state2.take_sessions();
        assert!(sessions_after_break.is_empty(), "breaks are NEVER recorded as sessions");
    }

    #[test]
    fn stopwatch_counts_up_never_transitions_and_never_records_pomodoro() {
        let mut state = TimerState {
            mode: TimerMode::Stopwatch,
            total_secs: 0,
            remaining_secs: 0,
            elapsed_secs: 0,
            ..Default::default()
        };
        let start_time = SystemTime::now();
        state.stopwatch_started = Some(start_time);

        let ten_secs = start_time + Duration::from_secs(10);
        assert!(!state.advance(ten_secs), "stopwatch never fires crossing-zero");
        assert_eq!(state.elapsed_secs, 10);
        assert_eq!(state.total_secs, 10);
        assert_eq!(state.remaining_secs, 0);
        assert_eq!(state.phase, Phase::Focus, "phase stays unchanged in stopwatch");

        // Reset or pause stopwatch
        state.stopwatch_started = None;
        state.close_session(ten_secs, false);
        assert!(state.take_sessions().is_empty(), "stopwatch does not record pomodoro sessions");
    }

    #[test]
    fn daily_rollover_resets_completed_today_not_running_phase() {
        let mut state = running_for(100);
        state.completed_today = 5;
        state.last_focus_date = "2000-01-01".to_string();

        let now = SystemTime::now();
        state.advance(now);

        assert_eq!(state.completed_today, 0, "completed_today resets on day rollover");
        assert_eq!(state.phase, Phase::Focus, "running phase does not get wiped");
        assert!(state.snapshot().running, "still running");
    }

    #[test]
    fn skip_phase_transitions_properly() {
        let mut state = running_for(100);
        assert_eq!(state.phase, Phase::Focus);

        let now = SystemTime::now() + Duration::from_secs(10);
        state.advance(now);
        state.close_session(now, false);
        state.phase = Phase::ShortRest;
        state.deadline = Some(now + Duration::from_secs(5 * 60));
        assert_eq!(state.phase, Phase::ShortRest);

        let sessions = state.take_sessions();
        assert_eq!(sessions.len(), 1);
        assert!(!sessions[0].completed);
    }

    /// A finished focus phase must land in the sessions table as a row statistics
    /// can read: right kind, right duration, completed flag as an integer.
    #[test]
    fn finished_focus_phase_is_written_to_the_sessions_table() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::storage::migrations::migrate(&conn).expect("migrate");

        let session = TimerSession {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "pomodoro".to_string(),
            started_at: "2026-09-19T09:00:00+05:00".to_string(),
            ended_at: "2026-09-19T09:25:00+05:00".to_string(),
            duration_sec: 1500,
            completed: true,
            task_id: None,
        };
        insert_session_row(&conn, &session).expect("session insert");

        let rows = crate::storage::repo::list(&conn, "sessions", false).expect("list");
        assert_eq!(rows.len(), 1, "exactly one session row");
        let row = &rows[0];
        assert_eq!(row["kind"], "pomodoro");
        assert_eq!(row["duration_sec"], 1500.0);
        assert_eq!(row["completed"], 1, "completed is stored as an integer");
        assert!(row["deleted_at"].is_null(), "a fresh row is not soft-deleted");
    }

    /// An interrupted session is still recorded — the spec counts it separately,
    /// which is only possible if the row exists with the flag off.
    #[test]
    fn interrupted_session_is_recorded_as_incomplete() {
        let conn = rusqlite::Connection::open_in_memory().expect("in-memory db");
        crate::storage::migrations::migrate(&conn).expect("migrate");

        let session = TimerSession {
            id: uuid::Uuid::new_v4().to_string(),
            kind: "pomodoro".to_string(),
            started_at: "2026-09-19T09:00:00+05:00".to_string(),
            ended_at: "2026-09-19T09:05:00+05:00".to_string(),
            duration_sec: 300,
            completed: false,
            task_id: None,
        };
        insert_session_row(&conn, &session).expect("session insert");

        let rows = crate::storage::repo::list(&conn, "sessions", false).expect("list");
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0]["completed"], 0);
        assert_eq!(rows[0]["duration_sec"], 300.0);
    }

    /// The break is not work: a rest phase must never produce a row, or every
    /// focus statistic would count the time the user was away from the desk.
    #[test]
    fn a_break_records_no_session() {
        let mut state = running_for(60);
        state.mode = TimerMode::Pomodoro;
        state.phase = Phase::ShortRest;
        state.session_started = Some(SystemTime::now() - Duration::from_secs(5));

        state.close_session(SystemTime::now(), true);

        assert!(
            state.take_sessions().is_empty(),
            "a rest phase must not be recorded as focus"
        );
    }

    #[test]
    fn break_phase_is_persisted_across_restarts() {
        let tmp_dir = std::env::temp_dir().join(format!("tempo_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&tmp_dir);
        let persist_path = tmp_dir.join("tempo.json");

        let mut state = TimerState {
            persist_path: Some(persist_path.clone()),
            ..TimerState::default()
        };
        state.phase = Phase::ShortRest;
        state.total_secs = 300;
        state.remaining_secs = 240;
        state.elapsed_secs = 60;
        state.save_persisted();

        let mut state2 = TimerState {
            persist_path: Some(persist_path.clone()),
            ..TimerState::default()
        };
        state2.load_persisted();

        assert_eq!(state2.phase, Phase::ShortRest, "short rest phase must be restored on restart");
        assert_eq!(state2.remaining_secs, 240, "remaining time must be restored on restart");
        let _ = fs::remove_dir_all(&tmp_dir);
    }

    #[test]
    fn in_flight_focus_session_is_recovered_on_restart() {
        let tmp_dir = std::env::temp_dir().join(format!("tempo_test_{}", uuid::Uuid::new_v4()));
        let _ = fs::create_dir_all(&tmp_dir);
        let persist_path = tmp_dir.join("tempo.json");

        let mut state = TimerState {
            persist_path: Some(persist_path.clone()),
            ..TimerState::default()
        };
        state.phase = Phase::Focus;
        state.session_started = Some(SystemTime::now() - Duration::from_secs(180));
        state.save_persisted();

        let mut state2 = TimerState {
            persist_path: Some(persist_path.clone()),
            ..TimerState::default()
        };
        state2.load_persisted();

        let recovered = state2.take_sessions();
        assert_eq!(recovered.len(), 1, "in-flight focus session must be recovered");
        assert!(!recovered[0].completed, "in-flight session must be incomplete");
        assert!(recovered[0].duration_sec >= 180, "session duration must reflect in-flight elapsed time");
        let _ = fs::remove_dir_all(&tmp_dir);
    }
}
