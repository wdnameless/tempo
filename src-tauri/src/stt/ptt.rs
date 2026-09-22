//! Push-to-talk and shortcut activation state machine.
//!
//! Ports Handy's activation coordinator into a pure state machine without Tauri
//! dependencies, so all transition logic, debounce timing, auto-repeat
//! swallowing, hold-vs-tap classification, and cancel rollback can be tested
//! deterministically without real clocks, windows, or sleep calls.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Maximum window between physical key presses to debounce rapid-fire events.
pub const DEBOUNCE: Duration = Duration::from_millis(30);

/// Grace period before key-up is finalized, swallowing OS auto-repeat bursts.
pub const RELEASE_GRACE: Duration = Duration::from_millis(50);

/// Default hold threshold for `HoldOrToggle` mode. Holds longer than this stop
/// on release (PTT behavior); shorter presses lock recording on until next press.
pub const DEFAULT_HOLD_THRESHOLD_MS: u64 = 300;

/// How the global shortcut activates dictation recording.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutActivation {
    /// Press once to start, press again to stop. Releases are ignored.
    #[serde(alias = "toggle", alias = "Toggle")]
    Toggle,
    /// Hold to record, release to stop.
    #[serde(alias = "push_to_talk", alias = "pushToTalk", alias = "PushToTalk")]
    PushToTalk,
    /// Short tap locks recording on; long hold stops on release.
    #[serde(alias = "hold_or_toggle", alias = "holdOrToggle", alias = "HoldOrToggle")]
    #[default]
    HoldOrToggle,
}

/// Pipeline lifecycle stage.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Stage {
    /// No recording or transcription active.
    Idle,
    /// Microphone is capturing audio.
    Recording,
    /// Transcription engine is processing captured speech.
    Processing,
}

/// Side-effect decided by [`CoordinatorState`]; executed by [`TranscriptionCoordinator`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Effect {
    /// Begin microphone recording.
    Start,
    /// Stop microphone recording and begin transcription.
    Stop,
    /// Cancel microphone recording without transcribing.
    Cancel,
}

/// A keyboard or signal edge event driving the activation machine.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct InputEvent {
    /// True on key-down / trigger start, false on key-up.
    pub is_pressed: bool,
    /// Active shortcut activation mode.
    pub mode: ShortcutActivation,
    /// Minimum press duration that classifies as a hold in `HoldOrToggle` mode.
    pub hold_threshold: Duration,
    /// External triggers (CLI, tray, pedals) bypass debounce to preserve toggle parity.
    pub external: bool,
    /// Timestamp of this event, allowing deterministic virtual clocks in tests.
    pub now: Instant,
}

impl InputEvent {
    pub fn new(
        is_pressed: bool,
        mode: ShortcutActivation,
        hold_threshold: Duration,
        external: bool,
        now: Instant,
    ) -> Self {
        Self {
            is_pressed,
            mode,
            hold_threshold,
            external,
            now,
        }
    }

    /// Effective hold duration required for a release to stop recording.
    pub fn effective_hold_threshold(&self) -> Duration {
        match self.mode {
            ShortcutActivation::HoldOrToggle => self.hold_threshold,
            ShortcutActivation::PushToTalk | ShortcutActivation::Toggle => Duration::ZERO,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PttAction {
    Passthrough,
    DeferRelease,
    CancelRelease,
}

/// A key-up deferred by [`RELEASE_GRACE`] so synthesized auto-repeat presses
/// cancel it. When the grace elapses, the hold is resolved.
#[derive(Debug, Clone, Copy)]
struct PendingRelease {
    deadline: Instant,
    released_at: Instant,
    hold_threshold: Duration,
}

/// A press that arrived while the engine was still busy processing the previous
/// transcription. Queued to start as soon as processing completes.
#[derive(Debug, Clone, Copy)]
struct PendingPress {
    pressed_at: Instant,
    locked: bool,
}

impl PendingPress {
    fn remembered(&self) -> Remembered {
        if self.locked {
            Remembered::Locked
        } else {
            Remembered::Held
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Remembered {
    Held,
    Locked,
}

#[derive(Debug, Clone, Copy)]
struct Hold {
    pressed_at: Instant,
    locked: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BusyAction {
    Ignore,
    Remember,
    Forget,
}

fn classify_busy_input(
    is_pressed: bool,
    mode: ShortcutActivation,
    remembered: Option<Remembered>,
) -> BusyAction {
    match (mode, is_pressed, remembered) {
        // Toggle: presses alternate remember/forget to preserve toggle parity.
        (ShortcutActivation::Toggle, true, Some(_)) => BusyAction::Forget,
        (ShortcutActivation::Toggle, true, None) => BusyAction::Remember,
        (ShortcutActivation::Toggle, false, _) => BusyAction::Ignore,

        // Hold modes: first press while busy starts when pipeline drains.
        // Second press while locked forgets queued start (toggle parity).
        // Press while already held is ignored repeat.
        (ShortcutActivation::PushToTalk | ShortcutActivation::HoldOrToggle, true, None) => {
            BusyAction::Remember
        }
        (
            ShortcutActivation::PushToTalk | ShortcutActivation::HoldOrToggle,
            true,
            Some(Remembered::Locked),
        ) => BusyAction::Forget,
        (
            ShortcutActivation::PushToTalk | ShortcutActivation::HoldOrToggle,
            true,
            Some(Remembered::Held),
        ) => BusyAction::Ignore,

        // Releases while busy are either deferred in grace or ignored noise.
        (ShortcutActivation::PushToTalk | ShortcutActivation::HoldOrToggle, false, _) => {
            BusyAction::Ignore
        }
    }
}

fn classify_ptt_event(
    has_pending_release: bool,
    is_pressed: bool,
    hold_to_talk: bool,
    is_held: bool,
) -> PttAction {
    if !hold_to_talk {
        return PttAction::Passthrough;
    }

    if is_pressed {
        if has_pending_release {
            PttAction::CancelRelease
        } else {
            PttAction::Passthrough
        }
    } else if is_held && !has_pending_release {
        PttAction::DeferRelease
    } else {
        PttAction::Passthrough
    }
}

/// Pure activation state machine.
///
/// Decides all transitions, release deferrals, tap-vs-hold classifications,
/// debouncing, and busy queuing without external dependencies.
#[derive(Debug, Clone)]
pub struct CoordinatorState {
    stage: Stage,
    hold: Option<Hold>,
    last_press: Option<Instant>,
    pending_release: Option<PendingRelease>,
    pending_press: Option<PendingPress>,
}

impl Default for CoordinatorState {
    fn default() -> Self {
        Self::new()
    }
}

impl CoordinatorState {
    pub fn new() -> Self {
        Self {
            stage: Stage::Idle,
            hold: None,
            last_press: None,
            pending_release: None,
            pending_press: None,
        }
    }

    /// Expiry deadline for any deferred release grace, driving coordinator timeout.
    pub fn grace_deadline(&self) -> Option<Instant> {
        self.pending_release.as_ref().map(|p| p.deadline)
    }

    /// Current lifecycle stage.
    pub fn stage(&self) -> Stage {
        self.stage
    }

    /// Whether recording or queued start is locked on and outlives the key.
    pub fn is_locked(&self) -> bool {
        self.hold.as_ref().is_some_and(|h| h.locked)
            || self.pending_press.as_ref().is_some_and(|p| p.locked)
    }

    /// Whether recording is actively in progress.
    pub fn is_recording(&self) -> bool {
        self.stage == Stage::Recording
    }

    /// Process an input edge and return any side-effect to execute.
    pub fn on_input(&mut self, input: InputEvent) -> Option<Effect> {
        let now = input.now;
        // External stop trigger (UI Stop button / CLI / tray) must immediately stop
        // recording regardless of activation mode or hold lock state.
        if input.external && !input.is_pressed {
            self.pending_release = None;
            self.pending_press = None;
            if self.stage == Stage::Recording {
                return Some(self.begin_processing());
            }
            return None;
        }

        let has_pending_release = self.pending_release.is_some();
        let is_held = match self.stage {
            Stage::Recording => true,
            Stage::Processing => self.pending_press.is_some(),
            Stage::Idle => false,
        };
        let hold_to_talk = input.mode != ShortcutActivation::Toggle && !self.is_locked();

        match classify_ptt_event(has_pending_release, input.is_pressed, hold_to_talk, is_held) {
            PttAction::CancelRelease => {
                self.pending_release = None;
                return None;
            }
            PttAction::DeferRelease => {
                self.pending_release = Some(PendingRelease {
                    hold_threshold: input.effective_hold_threshold(),
                    deadline: now + RELEASE_GRACE,
                    released_at: now,
                });
                return None;
            }
            PttAction::Passthrough => {}
        }

        // Debounce physical key presses. External triggers bypass debounce.
        if input.is_pressed && !input.external {
            if self
                .last_press
                .is_some_and(|t| now.saturating_duration_since(t) < DEBOUNCE)
            {
                return None;
            }
            self.last_press = Some(now);
        }

        // Queue or update pending actions while previous transcription is processing.
        if self.stage == Stage::Processing {
            let remembered = self.pending_press.as_ref().map(|p| p.remembered());
            match classify_busy_input(input.is_pressed, input.mode, remembered) {
                BusyAction::Remember => {
                    self.pending_press = Some(PendingPress {
                        locked: input.mode == ShortcutActivation::Toggle,
                        pressed_at: now,
                    });
                }
                BusyAction::Forget => {
                    self.pending_press = None;
                }
                BusyAction::Ignore => {}
            }
            return None;
        }

        if input.is_pressed {
            match self.stage {
                Stage::Idle => {
                    let locked = input.mode == ShortcutActivation::Toggle;
                    return Some(self.begin_recording(now, locked));
                }
                Stage::Recording => {
                    if self.is_locked() || input.mode == ShortcutActivation::Toggle {
                        return Some(self.begin_processing());
                    }
                }
                Stage::Processing => unreachable!(),
            }
        } else if hold_to_talk && self.stage == Stage::Recording {
            let threshold = input.effective_hold_threshold();
            return self.finish_hold(now, threshold);
        }

        None
    }

    /// The deferred release grace period expired without a cancelling auto-repeat press.
    pub fn on_grace_expired(&mut self) -> Option<Effect> {
        let pending = self.pending_release.take()?;
        match self.stage {
            Stage::Recording => self.finish_hold(pending.released_at, pending.hold_threshold),
            Stage::Processing => {
                self.finish_pending_hold(&pending);
                None
            }
            Stage::Idle => None,
        }
    }

    /// Transcription processing finished: drains any queued press or returns to Idle.
    pub fn on_processing_finished(&mut self) -> Option<Effect> {
        self.stage = Stage::Idle;
        self.hold = None;
        let pending = self.pending_press.take()?;
        Some(self.begin_recording(pending.pressed_at, pending.locked))
    }

    /// Explicit cancellation requested. Abandons queued starts and resets active recording.
    pub fn on_cancel(&mut self) -> Option<Effect> {
        self.pending_release = None;
        self.pending_press = None;
        if self.stage == Stage::Recording {
            self.stage = Stage::Idle;
            self.hold = None;
            Some(Effect::Cancel)
        } else {
            None
        }
    }

    /// Reconciles optimistic Recording transition with actual dictation start outcome.
    pub fn on_start_result(&mut self, started: bool) {
        if !started && self.stage == Stage::Recording {
            self.stage = Stage::Idle;
            self.hold = None;
        }
    }

    fn finish_pending_hold(&mut self, release: &PendingRelease) {
        let Some(pending) = self.pending_press.as_mut() else {
            return;
        };
        let held = release
            .released_at
            .saturating_duration_since(pending.pressed_at);
        if held < release.hold_threshold {
            pending.locked = true;
        } else {
            self.pending_press = None;
        }
    }

    fn finish_hold(&mut self, released_at: Instant, threshold: Duration) -> Option<Effect> {
        let held = self
            .hold
            .as_ref()
            .map(|h| released_at.saturating_duration_since(h.pressed_at))
            .unwrap_or(Duration::MAX);
        if held >= threshold {
            return Some(self.begin_processing());
        }
        if let Some(hold) = &mut self.hold {
            hold.locked = true;
        }
        None
    }

    fn begin_recording(&mut self, pressed_at: Instant, locked: bool) -> Effect {
        self.stage = Stage::Recording;
        self.hold = Some(Hold { pressed_at, locked });
        Effect::Start
    }

    fn begin_processing(&mut self) -> Effect {
        self.stage = Stage::Processing;
        self.hold = None;
        Effect::Stop
    }
}

/// Abstraction for dictation backend operations so [`ptt`] never depends on `SttState`.
pub trait DictationDriver: Send + Sync + 'static {
    /// Begin recording audio. Return true if capture started, false on failure (e.g. mic error).
    fn start(&self) -> bool;
    /// Stop audio recording. If `cancel` is true, discard audio without transcribing.
    fn stop(&self, cancel: bool);
}

impl<T: ?Sized + DictationDriver> DictationDriver for Arc<T> {
    fn start(&self) -> bool {
        (**self).start()
    }
    fn stop(&self, cancel: bool) {
        (**self).stop(cancel);
    }
}

impl<T: ?Sized + DictationDriver> DictationDriver for Box<T> {
    fn start(&self) -> bool {
        (**self).start()
    }
    fn stop(&self, cancel: bool) {
        (**self).stop(cancel);
    }
}

enum Command {
    Input(InputEvent),
    Cancel,
    ProcessingFinished,
}

/// Runs the [`CoordinatorState`] machine on a dedicated thread, serializing
/// shortcut input and dispatching side-effects to the [`DictationDriver`].
pub struct TranscriptionCoordinator {
    tx: mpsc::Sender<Command>,
    is_recording: Arc<AtomicBool>,
}

impl TranscriptionCoordinator {
    /// Spawn a new coordinator thread managing the dictation driver.
    pub fn new<D: DictationDriver>(dictation: D) -> Self {
        let (tx, rx) = mpsc::channel();
        let driver = Arc::new(dictation);
        let is_recording = Arc::new(AtomicBool::new(false));
        let is_recording_thread = Arc::clone(&is_recording);

        thread::Builder::new()
            .name("stt-transcription-coordinator".into())
            .spawn(move || {
                let mut state = CoordinatorState::new();

                loop {
                    let cmd = if let Some(deadline) = state.grace_deadline() {
                        let timeout = deadline.saturating_duration_since(Instant::now());
                        match rx.recv_timeout(timeout) {
                            Ok(cmd) => cmd,
                            Err(mpsc::RecvTimeoutError::Timeout) => {
                                if let Some(effect) = state.on_grace_expired() {
                                    run_effect(&*driver, &mut state, effect, &is_recording_thread);
                                }
                                continue;
                            }
                            Err(mpsc::RecvTimeoutError::Disconnected) => break,
                        }
                    } else {
                        match rx.recv() {
                            Ok(cmd) => cmd,
                            Err(mpsc::RecvError) => break,
                        }
                    };

                    match cmd {
                        Command::Input(input) => {
                            if let Some(effect) = state.on_input(input) {
                                run_effect(&*driver, &mut state, effect, &is_recording_thread);
                            }
                        }
                        Command::Cancel => {
                            if let Some(effect) = state.on_cancel() {
                                run_effect(&*driver, &mut state, effect, &is_recording_thread);
                            }
                        }
                        Command::ProcessingFinished => {
                            if let Some(effect) = state.on_processing_finished() {
                                run_effect(&*driver, &mut state, effect, &is_recording_thread);
                            }
                        }
                    }
                }
            })
            .expect("failed to spawn transcription coordinator thread");

        Self { tx, is_recording }
    }

    /// Fast, non-blocking check whether dictation is currently recording.
    pub fn is_recording(&self) -> bool {
        self.is_recording.load(Ordering::SeqCst)
    }

    /// Forward a keyboard shortcut edge to the coordinator.
    pub fn send_input(&self, is_pressed: bool, mode: ShortcutActivation, hold_threshold: Duration) {
        let _ = self.tx.send(Command::Input(InputEvent {
            is_pressed,
            mode,
            hold_threshold,
            external: false,
            now: Instant::now(),
        }));
    }

    /// Forward an external trigger edge (CLI / tray). Always toggle, bypasses debounce.
    pub fn send_external(&self, is_pressed: bool) {
        let _ = self.tx.send(Command::Input(InputEvent {
            is_pressed,
            mode: ShortcutActivation::Toggle,
            hold_threshold: Duration::ZERO,
            external: true,
            now: Instant::now(),
        }));
    }
    /// Explicitly stop recording from an external trigger (UI / CLI / tray).
    pub fn stop(&self) {
        self.send_external(false);
    }


    /// Signal user cancellation (e.g. Esc pressed).
    pub fn notify_cancel(&self) {
        let _ = self.tx.send(Command::Cancel);
    }

    /// Signal that transcription processing has finished and the coordinator may start queued presses.
    pub fn notify_processing_finished(&self) {
        let _ = self.tx.send(Command::ProcessingFinished);
    }
}

fn run_effect(
    driver: &dyn DictationDriver,
    state: &mut CoordinatorState,
    effect: Effect,
    is_recording: &AtomicBool,
) {
    match effect {
        Effect::Start => {
            let started = driver.start();
            state.on_start_result(started);
            is_recording.store(started, Ordering::SeqCst);
        }
        Effect::Stop => {
            driver.stop(false);
            is_recording.store(false, Ordering::SeqCst);
        }
        Effect::Cancel => {
            driver.stop(true);
            is_recording.store(false, Ordering::SeqCst);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    fn input(mode: ShortcutActivation, is_pressed: bool, now: Instant) -> InputEvent {
        InputEvent {
            is_pressed,
            mode,
            hold_threshold: Duration::from_millis(DEFAULT_HOLD_THRESHOLD_MS),
            external: false,
            now,
        }
    }

    fn ptt_input(is_pressed: bool, now: Instant) -> InputEvent {
        InputEvent {
            is_pressed,
            mode: ShortcutActivation::PushToTalk,
            hold_threshold: Duration::ZERO,
            external: false,
            now,
        }
    }

    fn toggle_input(external: bool, now: Instant) -> InputEvent {
        InputEvent {
            is_pressed: true,
            mode: ShortcutActivation::Toggle,
            hold_threshold: Duration::ZERO,
            external,
            now,
        }
    }

    fn drive_into_processing(state: &mut CoordinatorState, t0: Instant) {
        let mode = ShortcutActivation::HoldOrToggle;
        assert_eq!(
            state.on_input(input(mode, true, t0)),
            Some(Effect::Start)
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(800))),
            None
        );
        assert_eq!(state.on_grace_expired(), Some(Effect::Stop));
        assert_eq!(state.stage(), Stage::Processing);
    }

    #[test]
    fn long_hold_stops_on_release() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        assert_eq!(
            state.on_input(input(mode, true, t0)),
            Some(Effect::Start)
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(800))),
            None
        );
        assert_eq!(state.on_grace_expired(), Some(Effect::Stop));
        assert_eq!(state.stage(), Stage::Processing);
    }

    #[test]
    fn short_tap_locks_recording_until_next_press() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        assert_eq!(
            state.on_input(input(mode, true, t0)),
            Some(Effect::Start)
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(120))),
            None
        );
        assert_eq!(state.on_grace_expired(), None);
        assert_eq!(state.stage(), Stage::Recording);
        assert!(state.is_locked());

        // Press seconds later stops the locked recording
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(5000))),
            Some(Effect::Stop)
        );
        assert_eq!(state.stage(), Stage::Processing);

        // Key release during processing is ignored
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(5080))),
            None
        );
        assert_eq!(state.on_processing_finished(), None);
        assert_eq!(state.stage(), Stage::Idle);
    }

    #[test]
    fn locked_session_ignores_releases() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        state.on_input(input(mode, true, t0));
        state.on_input(input(mode, false, t0 + ms(100)));
        assert_eq!(state.on_grace_expired(), None);
        assert!(state.is_locked());

        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(900))),
            None
        );
        assert_eq!(state.grace_deadline(), None);
        assert_eq!(state.stage(), Stage::Recording);
    }

    #[test]
    fn press_while_held_is_ignored() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        assert_eq!(
            state.on_input(input(mode, true, t0)),
            Some(Effect::Start)
        );
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(400))),
            None
        );
        assert_eq!(state.stage(), Stage::Recording);
        assert!(!state.is_locked());
    }

    #[test]
    fn auto_repeat_burst_counts_as_one_long_hold() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        let mut clock = t0;

        assert_eq!(
            state.on_input(input(mode, true, clock)),
            Some(Effect::Start)
        );

        // ~600ms of synthesized release/press pairs
        for _ in 0..60 {
            clock += ms(5);
            assert_eq!(state.on_input(input(mode, false, clock)), None);
            clock += ms(5);
            assert_eq!(state.on_input(input(mode, true, clock)), None);
            assert_eq!(state.grace_deadline(), None);
        }
        assert!(!state.is_locked());

        // Genuine release
        clock += ms(5);
        assert_eq!(state.on_input(input(mode, false, clock)), None);
        assert_eq!(state.on_grace_expired(), Some(Effect::Stop));
        assert_eq!(state.stage(), Stage::Processing);
    }

    #[test]
    fn tap_during_processing_queues_locked_start() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        drive_into_processing(&mut state, t0);

        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(1000))),
            None
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(1100))),
            None
        );
        assert_eq!(state.on_grace_expired(), None);
        assert!(state.is_locked());

        assert_eq!(state.on_processing_finished(), Some(Effect::Start));
        assert!(state.is_locked());
    }

    #[test]
    fn completed_hold_during_processing_is_noop() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        drive_into_processing(&mut state, t0);

        // 600ms hold while busy: finished before drain
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(1000))),
            None
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(1600))),
            None
        );
        assert_eq!(state.on_grace_expired(), None);
        assert!(!state.is_locked());

        assert_eq!(state.on_processing_finished(), None);
        assert_eq!(state.stage(), Stage::Idle);
    }

    #[test]
    fn two_taps_during_processing_net_to_nothing() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        drive_into_processing(&mut state, t0);

        // Tap 1
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(1000))),
            None
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(1100))),
            None
        );
        assert_eq!(state.on_grace_expired(), None);
        assert!(state.is_locked());

        // Tap 2 cancels remembered tap
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(1500))),
            None
        );
        assert!(!state.is_locked());
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(1600))),
            None
        );
        assert_eq!(state.grace_deadline(), None);

        assert_eq!(state.on_processing_finished(), None);
        assert_eq!(state.stage(), Stage::Idle);
    }

    #[test]
    fn cancel_clears_locked_session() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        state.on_input(input(mode, true, t0));
        state.on_input(input(mode, false, t0 + ms(100)));
        assert_eq!(state.on_grace_expired(), None);
        assert!(state.is_locked());

        assert_eq!(state.on_cancel(), Some(Effect::Cancel));
        assert_eq!(state.stage(), Stage::Idle);
        assert!(!state.is_locked());

        // Fresh press starts new recording cleanly
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(2000))),
            Some(Effect::Start)
        );
    }

    #[test]
    fn failed_start_returns_to_idle() {
        let mut state = CoordinatorState::new();
        let now = Instant::now();

        assert_eq!(state.on_input(ptt_input(true, now)), Some(Effect::Start));
        state.on_start_result(false);
        assert_eq!(state.stage(), Stage::Idle);
    }

    #[test]
    fn press_inside_debounce_is_dropped_while_external_edge_is_not() {
        let mut state = CoordinatorState::new();
        let now = Instant::now();

        // External triggers: both edges honored inside DEBOUNCE window
        assert_eq!(
            state.on_input(toggle_input(true, now)),
            Some(Effect::Start)
        );
        assert_eq!(
            state.on_input(toggle_input(true, now + ms(5))),
            Some(Effect::Stop)
        );
        assert_eq!(state.stage(), Stage::Processing);

        // Keyboard triggers: repeat inside DEBOUNCE window is dropped
        let mut kb_state = CoordinatorState::new();
        assert_eq!(
            kb_state.on_input(toggle_input(false, now)),
            Some(Effect::Start)
        );
        assert_eq!(
            kb_state.on_input(toggle_input(false, now + ms(5))),
            None
        );
        assert_eq!(kb_state.stage(), Stage::Recording);
    }

    #[test]
    fn push_to_talk_short_press_still_stops_on_release() {
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        assert_eq!(state.on_input(ptt_input(true, t0)), Some(Effect::Start));
        assert_eq!(state.on_input(ptt_input(false, t0 + ms(40))), None);
        assert_eq!(state.on_grace_expired(), Some(Effect::Stop));
    }

    #[test]
    fn toggle_mode_ignores_release_and_stops_on_next_press() {
        let mode = ShortcutActivation::Toggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();

        assert_eq!(
            state.on_input(input(mode, true, t0)),
            Some(Effect::Start)
        );
        assert!(state.is_locked());
        assert_eq!(state.on_input(input(mode, false, t0 + ms(100))), None);
        assert_eq!(state.grace_deadline(), None);
        assert_eq!(state.on_input(input(mode, false, t0 + ms(3000))), None);
        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(4000))),
            Some(Effect::Stop)
        );
    }

    #[test]
    fn cancel_during_processing_drops_remembered_press() {
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        drive_into_processing(&mut state, t0);

        // Press while busy
        assert_eq!(
            state.on_input(input(ShortcutActivation::HoldOrToggle, true, t0 + ms(1000))),
            None
        );

        // Cancel while busy
        assert_eq!(state.on_cancel(), None);
        assert_eq!(state.stage(), Stage::Processing);

        // Drain to idle
        assert_eq!(state.on_processing_finished(), None);
        assert_eq!(state.stage(), Stage::Idle);
    }

    #[test]
    fn x11_autorepeat_burst_does_not_toggle_recording_ptt() {
        let mut state = CoordinatorState::new();
        let mut clock = Instant::now();

        assert_eq!(state.on_input(ptt_input(true, clock)), Some(Effect::Start));
        for _ in 0..6 {
            clock += ms(5);
            assert_eq!(state.on_input(ptt_input(false, clock)), None);
            clock += ms(5);
            assert_eq!(state.on_input(ptt_input(true, clock)), None);
        }
        assert_eq!(state.stage(), Stage::Recording);

        // Genuine release after burst
        clock += ms(5);
        assert_eq!(state.on_input(ptt_input(false, clock)), None);
        assert_eq!(state.on_grace_expired(), Some(Effect::Stop));
        assert_eq!(state.stage(), Stage::Processing);
    }

    #[test]
    fn toggle_presses_alternate_remember_and_forget_while_busy() {
        let mut remembered = None;
        for expected in [
            BusyAction::Remember,
            BusyAction::Forget,
            BusyAction::Remember,
        ] {
            let action = classify_busy_input(true, ShortcutActivation::Toggle, remembered);
            assert_eq!(action, expected);
            remembered = (action == BusyAction::Remember).then_some(Remembered::Locked);
        }
        assert!(remembered.is_some());
    }

    #[test]
    fn hold_or_toggle_drain_inside_busy_release_grace_still_classifies_tap() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        drive_into_processing(&mut state, t0);

        assert_eq!(
            state.on_input(input(mode, true, t0 + ms(1000))),
            None
        );
        assert_eq!(
            state.on_input(input(mode, false, t0 + ms(1100))),
            None
        );

        // Pipeline drains before release grace expired
        assert_eq!(state.on_processing_finished(), Some(Effect::Start));
        assert!(!state.is_locked());

        // Grace now resolves against live recording as a tap
        assert_eq!(state.on_grace_expired(), None);
        assert!(state.is_locked());
    }

    #[test]
    fn hold_or_toggle_autorepeat_burst_straddling_drain_measures_from_first_press() {
        let mode = ShortcutActivation::HoldOrToggle;
        let mut state = CoordinatorState::new();
        let t0 = Instant::now();
        drive_into_processing(&mut state, t0);

        let mut clock = t0 + ms(1000);
        assert_eq!(state.on_input(input(mode, true, clock)), None);
        for _ in 0..30 {
            clock += ms(5);
            assert_eq!(state.on_input(input(mode, false, clock)), None);
            clock += ms(5);
            assert_eq!(state.on_input(input(mode, true, clock)), None);
            assert_eq!(state.grace_deadline(), None);
        }

        // Drain at ~1300ms with key still down
        assert_eq!(state.on_processing_finished(), Some(Effect::Start));
        assert!(!state.is_locked());

        for _ in 0..10 {
            clock += ms(5);
            assert_eq!(state.on_input(input(mode, false, clock)), None);
            clock += ms(5);
            assert_eq!(state.on_input(input(mode, true, clock)), None);
        }
        assert_eq!(clock, t0 + ms(1400));
        assert_eq!(state.on_input(input(mode, false, clock)), None);
        // Held 400ms since initial key-down (1000ms..1400ms) -> stops, does not lock
        assert_eq!(state.on_grace_expired(), Some(Effect::Stop));
        assert_eq!(state.stage(), Stage::Processing);
    }

    #[test]
    fn external_start_and_stop_drives_driver() {
        use std::sync::atomic::AtomicBool;
        use std::sync::mpsc::channel;

        struct TestDriver {
            started: Arc<AtomicBool>,
            stopped: Arc<AtomicBool>,
            stop_tx: mpsc::Sender<bool>,
        }

        impl DictationDriver for TestDriver {
            fn start(&self) -> bool {
                self.started.store(true, Ordering::SeqCst);
                true
            }
            fn stop(&self, cancel: bool) {
                self.stopped.store(true, Ordering::SeqCst);
                let _ = self.stop_tx.send(cancel);
            }
        }

        let started = Arc::new(AtomicBool::new(false));
        let stopped = Arc::new(AtomicBool::new(false));
        let (stop_tx, stop_rx) = channel();

        let driver = TestDriver {
            started: Arc::clone(&started),
            stopped: Arc::clone(&stopped),
            stop_tx,
        };

        let coordinator = TranscriptionCoordinator::new(driver);

        // Start via the external path (equivalent to stt_start_dictation)
        coordinator.send_external(true);

        let t0 = Instant::now();
        while !coordinator.is_recording() && t0.elapsed() < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            coordinator.is_recording(),
            "coordinator should be recording after external start"
        );
        assert!(
            started.load(Ordering::SeqCst),
            "driver should have received start"
        );

        // Stop via the external path (equivalent to stt_stop_dictation)
        coordinator.send_external(false);

        let cancel = stop_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("driver must receive stop");
        assert!(!cancel, "stop must not be a cancel");
        assert!(
            stopped.load(Ordering::SeqCst),
            "driver should have received stop"
        );

        let t1 = Instant::now();
        while coordinator.is_recording() && t1.elapsed() < Duration::from_secs(1) {
            std::thread::sleep(Duration::from_millis(10));
        }
        assert!(
            !coordinator.is_recording(),
            "coordinator should not be recording after external stop"
        );
    }

    #[test]
    fn external_stop_stops_all_activation_modes() {
        for mode in [
            ShortcutActivation::PushToTalk,
            ShortcutActivation::HoldOrToggle,
            ShortcutActivation::Toggle,
        ] {
            let mut state = CoordinatorState::new();
            let t0 = Instant::now();
            let start_effect = state.on_input(input(mode, true, t0));
            assert_eq!(start_effect, Some(Effect::Start), "mode {mode:?} should start");
            assert!(state.is_recording());

            // External stop via send_external(false)
            let stop_input = InputEvent {
                is_pressed: false,
                mode: ShortcutActivation::Toggle,
                hold_threshold: Duration::ZERO,
                external: true,
                now: t0 + Duration::from_millis(200),
            };
            let stop_effect = state.on_input(stop_input);
            assert_eq!(
                stop_effect,
                Some(Effect::Stop),
                "mode {mode:?} must stop on external stop"
            );
            assert_eq!(state.stage(), Stage::Processing);
            assert!(!state.is_recording());
        }
    }
}
