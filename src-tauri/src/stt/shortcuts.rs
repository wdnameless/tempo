//! Global shortcut management for speech dictation.
//!
//! Parses accelerator strings into [`Shortcut`] definitions, binds transcribe and cancel
//! keys using `tauri-plugin-global-shortcut`, routes press/release events to
//! [`TranscriptionCoordinator`], and supports temporary suspension during in-app hotkey recording.

use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

use crate::stt::ptt::{ShortcutActivation, TranscriptionCoordinator, DEFAULT_HOLD_THRESHOLD_MS};

/// Configured keyboard shortcuts for speech operations.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SpeechBindings {
    /// Hotkey to start/stop or hold for dictation (e.g. "Ctrl+Shift+D", "Alt+Space").
    pub transcribe: String,
    /// Hotkey to cancel active dictation without transcribing (e.g. "Escape").
    pub cancel: String,
}

impl Default for SpeechBindings {
    fn default() -> Self {
        Self {
            transcribe: "Ctrl+S".to_string(),
            cancel: "Escape".to_string(),
        }
    }
}

struct ShortcutRegistryState {
    active_bindings: Option<SpeechBindings>,
    transcribe_shortcut: Option<Shortcut>,
    cancel_shortcut: Option<Shortcut>,
    suspended: bool,
}

impl ShortcutRegistryState {
    const fn new() -> Self {
        Self {
            active_bindings: None,
            transcribe_shortcut: None,
            cancel_shortcut: None,
            suspended: false,
        }
    }
}

static REGISTRY: Mutex<ShortcutRegistryState> = Mutex::new(ShortcutRegistryState::new());

/// Parse a human-readable accelerator string into a [`Shortcut`].
///
/// Supports combinations like:
/// - Modifiers: `Ctrl`, `Control`, `Alt`, `Option`, `Shift`, `Super`, `Cmd`, `Command`, `Win`, `Windows`
/// - Keys: letters `A`..`Z`, digits `0`..`9`, function keys `F1`..`F24`,
///   special keys `Space`, `Tab`, `Escape`, `Esc`, `Enter`, `Backspace`, `Delete`, `Del`,
///   arrows `ArrowUp`, `Up`, `ArrowDown`, `Down`, `ArrowLeft`, `Left`, `ArrowRight`, `Right`,
///   and punctuation (`[`, `]`, `;`, `,`, `.`, `/`, `\`, `-`, `=`).
pub fn parse_accelerator(s: &str) -> Result<Shortcut, String> {
    let trimmed = s.trim();
    if trimmed.is_empty() {
        return Err("Accelerator string cannot be empty".to_string());
    }

    let raw_tokens: Vec<&str> = trimmed.split('+').map(|t| t.trim()).collect();
    if raw_tokens.is_empty() {
        return Err("Accelerator string cannot be empty".to_string());
    }

    let mut normalized_tokens = Vec::with_capacity(raw_tokens.len());
    let mut has_non_modifier = false;

    for raw in raw_tokens {
        if raw.is_empty() {
            return Err(format!("Invalid accelerator '{s}': empty key token"));
        }

        if raw.eq_ignore_ascii_case("fn") {
            return Err("The Fn key is not supported as a global shortcut".to_string());
        }

        let upper = raw.to_uppercase();
        let token = match upper.as_str() {
            // Modifiers normalized to global_hotkey syntax
            "CTRL" | "CONTROL" => "CTRL",
            "ALT" | "OPTION" => "ALT",
            "SHIFT" => "SHIFT",
            "SUPER" | "CMD" | "COMMAND" | "WIN" | "WINDOWS" | "META" => "SUPER",
            "COMMANDORCONTROL" | "COMMANDORCTRL" | "CMDORCTRL" | "CMDORCONTROL" => "CMDORCTRL",

            // Common aliases
            "ESC" | "ESCAPE" => {
                has_non_modifier = true;
                "ESCAPE"
            }
            "DEL" | "DELETE" => {
                has_non_modifier = true;
                "DELETE"
            }
            "RETURN" | "ENTER" => {
                has_non_modifier = true;
                "ENTER"
            }
            "INS" | "INSERT" => {
                has_non_modifier = true;
                "INSERT"
            }
            "PGUP" | "PAGEUP" => {
                has_non_modifier = true;
                "PAGEUP"
            }
            "PGDN" | "PAGEDOWN" => {
                has_non_modifier = true;
                "PAGEDOWN"
            }
            "UP" | "ARROWUP" => {
                has_non_modifier = true;
                "ARROWUP"
            }
            "DOWN" | "ARROWDOWN" => {
                has_non_modifier = true;
                "ARROWDOWN"
            }
            "LEFT" | "ARROWLEFT" => {
                has_non_modifier = true;
                "ARROWLEFT"
            }
            "RIGHT" | "ARROWRIGHT" => {
                has_non_modifier = true;
                "ARROWRIGHT"
            }
            "SPACE" | "SPACEBAR" => {
                has_non_modifier = true;
                "SPACE"
            }

            _ => {
                has_non_modifier = true;
                raw
            }
        };

        normalized_tokens.push(token);
    }

    if !has_non_modifier {
        return Err(format!(
            "Invalid accelerator '{s}': must include a non-modifier key (e.g. letter, digit, F-key, Space)"
        ));
    }

    let normalized_str = normalized_tokens.join("+");
    normalized_str
        .parse::<Shortcut>()
        .map_err(|e| format!("Invalid accelerator syntax '{s}': {e}"))
}

/// Register speech global shortcuts with Tauri's shortcut plugin.
///
/// Transcribe fires on both `Pressed` and `Released` so push-to-talk and
/// hold-or-toggle can measure hold duration. Cancel fires on `Pressed` only,
/// and only while recording is active.
pub fn apply_bindings(app: &AppHandle, bindings: &SpeechBindings) -> Result<(), String> {
    let transcribe = parse_accelerator(&bindings.transcribe)?;
    let cancel = parse_accelerator(&bindings.cancel)?;

    if transcribe == cancel {
        return Err("Transcribe and Cancel shortcuts cannot use the same key combination".to_string());
    }

    let mut state = REGISTRY.lock().map_err(|e| format!("Lock error: {e}"))?;

    // Unregister previously active speech shortcuts
    if let Some(old) = state.transcribe_shortcut.take() {
        let _ = app.global_shortcut().unregister(old);
    }
    if let Some(old) = state.cancel_shortcut.take() {
        let _ = app.global_shortcut().unregister(old);
    }

    state.active_bindings = Some(bindings.clone());
    state.transcribe_shortcut = Some(transcribe);
    state.cancel_shortcut = Some(cancel);

    if state.suspended {
        return Ok(());
    }

    register_transcribe(app, transcribe)
        .map_err(|e| format!("Failed to register transcribe shortcut '{}': {e}", bindings.transcribe))?;

    if let Err(e) = register_cancel(app, cancel) {
        let _ = app.global_shortcut().unregister(transcribe);
        state.transcribe_shortcut = None;
        state.cancel_shortcut = None;
        return Err(format!("Failed to register cancel shortcut '{}': {e}", bindings.cancel));
    }

    Ok(())
}

/// Unregister all active speech shortcuts.
pub fn unregister_all(app: &AppHandle) {
    if let Ok(mut state) = REGISTRY.lock() {
        if let Some(sc) = state.transcribe_shortcut.take() {
            let _ = app.global_shortcut().unregister(sc);
        }
        if let Some(sc) = state.cancel_shortcut.take() {
            let _ = app.global_shortcut().unregister(sc);
        }
        state.active_bindings = None;
        state.suspended = false;
    }
}

/// Temporarily suspend active speech shortcuts without discarding configuration.
///
/// Used while the frontend settings UI is actively recording a new hotkey from the user.
pub fn suspend(app: &AppHandle) {
    if let Ok(mut state) = REGISTRY.lock() {
        if state.suspended {
            return;
        }
        state.suspended = true;
        if let Some(sc) = state.transcribe_shortcut {
            let _ = app.global_shortcut().unregister(sc);
        }
        if let Some(sc) = state.cancel_shortcut {
            let _ = app.global_shortcut().unregister(sc);
        }
    }
}

/// Resume suspended speech shortcuts.
pub fn resume(app: &AppHandle) {
    let to_register = {
        if let Ok(mut state) = REGISTRY.lock() {
            if !state.suspended {
                return;
            }
            state.suspended = false;
            (state.transcribe_shortcut, state.cancel_shortcut)
        } else {
            return;
        }
    };

    if let (Some(transcribe), Some(cancel)) = to_register {
        let _ = register_transcribe(app, transcribe);
        let _ = register_cancel(app, cancel);
    }
}

/// Test shortcut registration against the operating system and report exact failure reason.
///
/// Distinguishes between:
/// - Bad accelerator syntax or unsupported key tokens
/// - Conflict with existing internal registrations in this application
/// - Collision with a shortcut already claimed by another OS application
pub fn validate(app: &AppHandle, accelerator: &str) -> Result<(), String> {
    let shortcut = parse_accelerator(accelerator)?;

    // If already registered as our speech shortcut, it's valid to keep
    {
        if let Ok(state) = REGISTRY.lock() {
            if state.transcribe_shortcut == Some(shortcut) || state.cancel_shortcut == Some(shortcut) {
                return Ok(());
            }
        }
    }

    if app.global_shortcut().is_registered(shortcut) {
        return Err(format!(
            "Shortcut '{accelerator}' is already registered by another feature in this application"
        ));
    }

    // Probe registration with the OS
    match app.global_shortcut().register(shortcut) {
        Ok(()) => {
            let _ = app.global_shortcut().unregister(shortcut);
            Ok(())
        }
        Err(e) => Err(format!(
            "Shortcut '{accelerator}' is already taken by the operating system or another application: {e}"
        )),
    }
}

fn bind_shortcut<F>(app: &AppHandle, shortcut: Shortcut, on_event: F) -> Result<(), String>
where
    F: Fn(&AppHandle, bool) + Send + Sync + 'static,
{
    app.global_shortcut()
        .on_shortcut(shortcut, move |app, scut, event| {
            if scut == &shortcut {
                let is_pressed = event.state() == ShortcutState::Pressed;
                on_event(app, is_pressed);
            }
        })
        .map_err(|e| e.to_string())
}

fn register_transcribe(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    bind_shortcut(app, shortcut, handle_transcribe_event)
}

fn register_cancel(app: &AppHandle, shortcut: Shortcut) -> Result<(), String> {
    bind_shortcut(app, shortcut, handle_cancel_event)
}

fn handle_transcribe_event(app: &AppHandle, is_pressed: bool) {
    if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        let mode = get_activation_mode(app);
        let threshold = get_hold_threshold(app);
        coordinator.send_input(is_pressed, mode, threshold);
    } else {
        eprintln!("TranscriptionCoordinator is not initialized");
    }
}

fn handle_cancel_event(app: &AppHandle, is_pressed: bool) {
    if !is_pressed {
        return;
    }

    let is_recording = if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
        coordinator.is_recording()
    } else if let Some(state) = app.try_state::<crate::stt::SttState>() {
        state.capture_state.is_recording()
    } else {
        false
    };

    if is_recording {
        if let Some(coordinator) = app.try_state::<TranscriptionCoordinator>() {
            coordinator.notify_cancel();
        }
    }
}

fn get_activation_mode(app: &AppHandle) -> ShortcutActivation {
    let raw = crate::storage::with_db(app, |conn| {
        let val = crate::storage::repo::pref_get(conn, "tempo_speech_activation")?
            .or_else(|| crate::storage::repo::pref_get(conn, "alarmer_speech_activation").ok().flatten());
        Ok(val)
    })
    .ok()
    .flatten();

    match raw.as_deref() {
        Some(s) => {
            let unquoted = s.trim_matches('"');
            if unquoted.eq_ignore_ascii_case("toggle") {
                ShortcutActivation::Toggle
            } else if unquoted.eq_ignore_ascii_case("push_to_talk")
                || unquoted.eq_ignore_ascii_case("pushtotalk")
            {
                ShortcutActivation::PushToTalk
            } else {
                ShortcutActivation::HoldOrToggle
            }
        }
        None => ShortcutActivation::HoldOrToggle,
    }
}

fn get_hold_threshold(app: &AppHandle) -> Duration {
    let raw = crate::storage::with_db(app, |conn| {
        let val = crate::storage::repo::pref_get(conn, "tempo_speech_hold_threshold_ms")?
            .or_else(|| crate::storage::repo::pref_get(conn, "alarmer_speech_hold_threshold_ms").ok().flatten());
        Ok(val)
    })
    .ok()
    .flatten();

    let ms = raw
        .and_then(|s| s.trim_matches('"').parse::<u64>().ok())
        .unwrap_or(DEFAULT_HOLD_THRESHOLD_MS);

    Duration::from_millis(ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    #[test]
    fn parse_ctrl_shift_d() {
        let shortcut = parse_accelerator("Ctrl+Shift+D").expect("parse Ctrl+Shift+D");
        assert!(shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyD));
    }
    #[test]
    fn parse_ctrl_s() {
        let shortcut = parse_accelerator("Ctrl+S").expect("parse Ctrl+S");
        assert!(shortcut.matches(Modifiers::CONTROL, Code::KeyS));
    }


    #[test]
    fn parse_alt_space() {
        let shortcut = parse_accelerator("Alt+Space").expect("parse Alt+Space");
        assert!(shortcut.matches(Modifiers::ALT, Code::Space));
    }

    #[test]
    fn parse_ctrl_space() {
        let shortcut = parse_accelerator("Ctrl+Space").expect("parse Ctrl+Space");
        assert!(shortcut.matches(Modifiers::CONTROL, Code::Space));

        let lower = parse_accelerator("ctrl+space").expect("parse ctrl+space");
        assert!(lower.matches(Modifiers::CONTROL, Code::Space));

        let upper = parse_accelerator("CTRL+SPACE").expect("parse CTRL+SPACE");
        assert!(upper.matches(Modifiers::CONTROL, Code::Space));
    }

    #[test]
    fn parse_ctrl_space_matches_space_same_as_alt_space() {
        // Ctrl+Space does not differ in parser structure from Alt+Space: both parse "Space"
        // into Code::Space and the modifier into Modifiers::CONTROL (or Modifiers::ALT).
        // The issue where Ctrl+Space was rejected occurred in the frontend HotkeyRecorder,
        // which submitted "Ctrl" alone due to reading stale React state on keyup.
        let ctrl_space = parse_accelerator("Ctrl+Space").expect("parse Ctrl+Space");
        assert!(ctrl_space.matches(Modifiers::CONTROL, Code::Space));

        let alt_space = parse_accelerator("Alt+Space").expect("parse Alt+Space");
        assert!(alt_space.matches(Modifiers::ALT, Code::Space));

        let spacebar = parse_accelerator("Ctrl+Spacebar").expect("parse Ctrl+Spacebar");
        assert!(spacebar.matches(Modifiers::CONTROL, Code::Space));
    }

    #[test]
    fn parse_shift_space_and_single_space() {
        let shift_space = parse_accelerator("Shift+Space").expect("parse Shift+Space");
        assert!(shift_space.matches(Modifiers::SHIFT, Code::Space));

        let single_space = parse_accelerator("Space").expect("parse single Space");
        assert!(single_space.matches(Modifiers::empty(), Code::Space));
    }

    #[test]
    fn parse_single_f_key() {
        let shortcut = parse_accelerator("F9").expect("parse F9");
        assert!(shortcut.matches(Modifiers::empty(), Code::F9));

        let f12 = parse_accelerator("F12").expect("parse F12");
        assert!(f12.matches(Modifiers::empty(), Code::F12));
    }

    #[test]
    fn parse_special_keys() {
        let esc = parse_accelerator("Escape").expect("parse Escape");
        assert!(esc.matches(Modifiers::empty(), Code::Escape));

        let esc_short = parse_accelerator("Esc").expect("parse Esc");
        assert!(esc_short.matches(Modifiers::empty(), Code::Escape));

        let tab = parse_accelerator("Ctrl+Tab").expect("parse Ctrl+Tab");
        assert!(tab.matches(Modifiers::CONTROL, Code::Tab));

        let enter = parse_accelerator("Ctrl+Enter").expect("parse Ctrl+Enter");
        assert!(enter.matches(Modifiers::CONTROL, Code::Enter));

        let del = parse_accelerator("Ctrl+Alt+Del").expect("parse Ctrl+Alt+Del");
        assert!(del.matches(Modifiers::CONTROL | Modifiers::ALT, Code::Delete));

        let up = parse_accelerator("Alt+Up").expect("parse Alt+Up");
        assert!(up.matches(Modifiers::ALT, Code::ArrowUp));
    }

    #[test]
    fn parse_digits_and_punctuation() {
        let digit = parse_accelerator("Ctrl+1").expect("parse Ctrl+1");
        assert!(digit.matches(Modifiers::CONTROL, Code::Digit1));

        let bracket = parse_accelerator("Ctrl+[").expect("parse Ctrl+[");
        assert!(bracket.matches(Modifiers::CONTROL, Code::BracketLeft));
    }

    #[test]
    fn parse_whitespace_tolerance() {
        let shortcut = parse_accelerator("  Ctrl + Shift + D  ").expect("parse with whitespace");
        assert!(shortcut.matches(Modifiers::CONTROL | Modifiers::SHIFT, Code::KeyD));
    }

    #[test]
    fn parse_aliases_super_cmd_win() {
        let win = parse_accelerator("Win+Shift+A").expect("parse Win+Shift+A");
        assert!(win.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyA));

        let cmd = parse_accelerator("Cmd+Shift+A").expect("parse Cmd+Shift+A");
        assert!(cmd.matches(Modifiers::SUPER | Modifiers::SHIFT, Code::KeyA));
    }

    #[test]
    fn parse_empty_error() {
        let err = parse_accelerator("").expect_err("empty string must fail");
        assert!(err.contains("cannot be empty"));

        let err2 = parse_accelerator("   ").expect_err("whitespace string must fail");
        assert!(err2.contains("cannot be empty"));
    }

    #[test]
    fn parse_modifier_only_error() {
        let err = parse_accelerator("Ctrl+Shift").expect_err("modifiers only must fail");
        assert!(err.contains("must include a non-modifier key"));

        let err2 = parse_accelerator("Alt").expect_err("single modifier must fail");
        assert!(err2.contains("must include a non-modifier key"));
    }

    #[test]
    fn parse_fn_key_error() {
        let err = parse_accelerator("Fn+Space").expect_err("Fn key must fail");
        assert!(err.contains("Fn key is not supported"));

        let err2 = parse_accelerator("Ctrl+Fn+A").expect_err("Fn combination must fail");
        assert!(err2.contains("Fn key is not supported"));
    }

    #[test]
    fn parse_invalid_key_error() {
        let err = parse_accelerator("Ctrl+Shift+InvalidKeyXYZ").expect_err("invalid key must fail");
        assert!(err.contains("Invalid accelerator syntax"));
    }

    #[test]
    fn speech_bindings_defaults() {
        let default_bindings = SpeechBindings::default();
        assert_eq!(default_bindings.transcribe, "Ctrl+S");
        assert_eq!(default_bindings.cancel, "Escape");
    }
}
