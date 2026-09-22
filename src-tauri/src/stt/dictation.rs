// src-tauri/src/stt/dictation.rs
// Windows text injection via SendInput with clipboard save/restore,
// elevation check for target window, multiple paste methods (Ctrl+V, Shift+Insert, Direct),
// clipboard behavior (Restore vs Keep), text shaping, auto-submit, and clipboard fallback.

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InjectionOutcome {
    Inserted,
    Copied,
}

pub type ClipboardOutcome = InjectionOutcome;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InjectionDecision {
    /// Injection succeeded or can proceed, and clipboard should be restored.
    RestoreClipboard,
    /// Target is elevated or injection failed; text is left on clipboard.
    LeaveOnClipboard,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum DictationMode {
    PushToTalk,
    #[default]
    Toggle,
}

/// Delivery method for injecting dictated text into the active window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PasteMethod {
    #[default]
    #[serde(alias = "ctrl_v", alias = "ctrlv")]
    CtrlV,
    #[serde(alias = "shift_insert", alias = "shiftinsert")]
    ShiftInsert,
    #[serde(alias = "direct")]
    Direct,
}

/// How the clipboard should be treated after injecting text.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ClipboardBehavior {
    /// Save clipboard before injection and restore it afterwards on success.
    #[default]
    #[serde(alias = "restore")]
    Restore,
    /// Leave the transcribed text on the clipboard permanently.
    #[serde(alias = "keep")]
    Keep,
}

/// Delivery configuration for dictation injection.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PasteOptions {
    pub method: PasteMethod,
    pub behavior: ClipboardBehavior,
    pub delay_before_ms: u64,
    pub delay_after_ms: u64,
    pub append_space: bool,
    pub auto_submit: bool,
}

impl Default for PasteOptions {
    fn default() -> Self {
        Self {
            method: PasteMethod::CtrlV,
            behavior: ClipboardBehavior::Restore,
            delay_before_ms: 60,
            delay_after_ms: 60,
            append_space: false,
            auto_submit: false,
        }
    }
}

pub const VK_RETURN: u16 = 13;
pub const VK_SHIFT: u16 = 16;
pub const VK_CONTROL: u16 = 17;
pub const VK_SPACE: u16 = 32;
pub const VK_INSERT: u16 = 45;
pub const VK_V: u16 = 86;

/// High-level representation of a simulated key action for SendInput.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum KeyAction {
    KeyDown(u16),
    KeyUp(u16),
    UnicodeDown(u16),
    UnicodeUp(u16),
}

/// Builds the keystroke chord for clipboard paste methods.
pub fn build_paste_chord(method: PasteMethod) -> Vec<KeyAction> {
    match method {
        PasteMethod::CtrlV => vec![
            KeyAction::KeyDown(VK_CONTROL),
            KeyAction::KeyDown(VK_V),
            KeyAction::KeyUp(VK_V),
            KeyAction::KeyUp(VK_CONTROL),
        ],
        PasteMethod::ShiftInsert => vec![
            KeyAction::KeyDown(VK_SHIFT),
            KeyAction::KeyDown(VK_INSERT),
            KeyAction::KeyUp(VK_INSERT),
            KeyAction::KeyUp(VK_SHIFT),
        ],
        PasteMethod::Direct => Vec::new(),
    }
}

/// Builds the simulated Unicode key events for direct typing.
pub fn build_direct_sequence(text: &str) -> Vec<KeyAction> {
    let mut seq = Vec::with_capacity(text.len() * 2);
    for code_unit in text.encode_utf16() {
        seq.push(KeyAction::UnicodeDown(code_unit));
        seq.push(KeyAction::UnicodeUp(code_unit));
    }
    seq
}

/// Builds the simulated Enter key sequence (Return down, Return up).
pub fn build_enter_sequence() -> Vec<KeyAction> {
    vec![
        KeyAction::KeyDown(VK_RETURN),
        KeyAction::KeyUp(VK_RETURN),
    ]
}

/// Returns the complete simulated key sequence for the given method and text.
pub fn build_injection_sequence(method: PasteMethod, text: &str) -> Vec<KeyAction> {
    match method {
        PasteMethod::Direct => build_direct_sequence(text),
        other => build_paste_chord(other),
    }
}

/// Shapes the transcribed text, appending a trailing space if requested
/// and the text does not already end with a space.
pub fn shape_text(text: &str, append_space: bool) -> String {
    if text.is_empty() {
        return String::new();
    }
    if append_space && !text.ends_with(' ') {
        format!("{text} ")
    } else {
        text.to_string()
    }
}

/// Shapes the transcribed text with optional trailing space and optional trailing newline.
pub fn shape_text_with_enter(text: &str, append_space: bool, append_enter: bool) -> String {
    let mut result = shape_text(text, append_space);
    if append_enter && !result.is_empty() && !result.ends_with('\n') {
        result.push('\n');
    }
    result
}
/// Removes verbal filler words from transcribed text while preserving real words in context.
///
/// Handles:
/// - Russian fillers: `эээ`, `ээ`, `эм`, `ммм`, `типа`, `как бы`, and standalone `ну`, `вот`
/// - English fillers: `um`, `uh`, `er`, `erm`, and standalone `like`
/// - Preserves real words and phrases:
///   - "нужно" (root "ну" inside a real word)
///   - "вот это дом" ("вот" as demonstrative pointer)
///   - "like this", "like that", "like a" ("like" as preposition/verb)
/// - Cleans punctuation and whitespace artefacts left behind (" ," -> ",", doubled spaces)
pub fn remove_filler_words(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    // 1. Remove multi-word fillers first
    let mut s = trimmed.to_string();
    let multi_fillers = ["как бы", "как-бы", "как будто бы"];
    for mf in multi_fillers {
        let mut idx = 0;
        while let Some(pos) = s[idx..].to_lowercase().find(mf) {
            let start = idx + pos;
            let end = start + mf.len();
            let prev_char = s[..start].chars().next_back();
            let next_char = s[end..].chars().next();
            let prev_bound = prev_char.map_or(true, |c| !c.is_alphanumeric());
            let next_bound = next_char.map_or(true, |c| !c.is_alphanumeric());

            if prev_bound && next_bound {
                s.replace_range(start..end, "");
                idx = start;
            } else {
                idx = end;
            }
        }
    }

    // 2. Tokenize and filter single-word fillers
    let tokens: Vec<&str> = s.split_whitespace().collect();
    let mut kept = Vec::with_capacity(tokens.len());

    let mut i = 0;
    while i < tokens.len() {
        let token = tokens[i];
        let stripped = token.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
        let next_stripped = if i + 1 < tokens.len() {
            tokens[i + 1].trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase()
        } else {
            String::new()
        };

        let is_filler = match stripped.as_str() {
            "эээ" | "ээ" | "эм" | "ммм" | "типа" => true,
            "um" | "uh" | "er" | "erm" => true,
            "ну" => true,
            "вот" => {
                let is_demonstrative = matches!(
                    next_stripped.as_str(),
                    "это" | "этот" | "эта" | "эти" | "этом" | "этому" | "то" | "тот" | "та" | "те" | "тут" | "здесь" | "там" | "так"
                );
                !is_demonstrative
            }
            "like" => {
                let is_not_filler = matches!(
                    next_stripped.as_str(),
                    "this" | "that" | "these" | "those" | "a" | "an" | "the" | "to" | "it" | "you" | "me" | "them" | "him" | "her" | "what" | "how"
                );
                !is_not_filler
            }
            _ => false,
        };

        if !is_filler {
            kept.push(token);
        }
        i += 1;
    }

    let joined = kept.join(" ");
    clean_punctuation_artefacts(&joined)
}

fn clean_punctuation_artefacts(s: &str) -> String {
    let mut out = s.to_string();

    for p in [',', '.', '!', '?', ';', ':'] {
        let pat = format!(" {p}");
        let rep = format!("{p}");
        while out.contains(&pat) {
            out = out.replace(&pat, &rep);
        }
    }

    while out.contains(",,") {
        out = out.replace(",,", ",");
    }
    while out.contains(", ,") {
        out = out.replace(", ,", ",");
    }
    while out.contains("  ") {
        out = out.replace("  ", " ");
    }

    let trimmed = out.trim_start_matches(|c: char| c == ',' || c == ' ' || c == ';').trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let mut chars = trimmed.chars();
    if let Some(first) = chars.next() {
        if first.is_lowercase() {
            format!("{}{}", first.to_uppercase(), chars.as_str())
        } else {
            trimmed.to_string()
        }
    } else {
        trimmed.to_string()
    }
}


/// Determines whether auto-submit should be sent: only when enabled and injection succeeded.
pub fn should_auto_submit(auto_submit: bool, outcome: InjectionOutcome) -> bool {
    auto_submit && outcome == InjectionOutcome::Inserted
}

/// Pure function deciding whether to restore or leave clipboard based on injection success.
pub fn decide_clipboard_action(injection_succeeded: bool) -> InjectionDecision {
    decide_clipboard_action_with_behavior(injection_succeeded, ClipboardBehavior::Restore)
}

/// Pure function deciding clipboard action considering configured clipboard behavior.
pub fn decide_clipboard_action_with_behavior(
    injection_succeeded: bool,
    behavior: ClipboardBehavior,
) -> InjectionDecision {
    match (injection_succeeded, behavior) {
        (true, ClipboardBehavior::Restore) => InjectionDecision::RestoreClipboard,
        _ => InjectionDecision::LeaveOnClipboard,
    }
}

/// Decision logic for clipboard management given target elevation and injection result.
pub fn evaluate_injection_strategy(
    is_elevated: bool,
    injection_succeeded: bool,
) -> (InjectionDecision, InjectionOutcome) {
    evaluate_injection_strategy_with_behavior(
        is_elevated,
        injection_succeeded,
        ClipboardBehavior::Restore,
    )
}

/// Decision logic for clipboard management given target elevation, injection result, and behavior.
pub fn evaluate_injection_strategy_with_behavior(
    is_elevated: bool,
    injection_succeeded: bool,
    behavior: ClipboardBehavior,
) -> (InjectionDecision, InjectionOutcome) {
    if is_elevated || !injection_succeeded {
        (InjectionDecision::LeaveOnClipboard, InjectionOutcome::Copied)
    } else {
        let decision = match behavior {
            ClipboardBehavior::Restore => InjectionDecision::RestoreClipboard,
            ClipboardBehavior::Keep => InjectionDecision::LeaveOnClipboard,
        };
        (decision, InjectionOutcome::Inserted)
    }
}

pub fn execute_dictation_injection(text: &str) -> (bool, InjectionOutcome) {
    let outcome = inject_or_copy_text(text);
    let inserted = outcome == InjectionOutcome::Inserted;
    (inserted, outcome)
}

pub fn execute_dictation_injection_with_options(
    text: &str,
    opts: &PasteOptions,
) -> (bool, InjectionOutcome) {
    let outcome = deliver_text(text, opts);
    let inserted = outcome == InjectionOutcome::Inserted;
    (inserted, outcome)
}

pub fn inject_text(text: &str) -> bool {
    inject_or_copy_text(text) == InjectionOutcome::Inserted
}

/// Injects text using default paste options (Ctrl+V + Restore clipboard).
/// Preserved for backward compatibility with existing callers.
pub fn inject_or_copy_text(text: &str) -> InjectionOutcome {
    deliver_text(text, &PasteOptions::default())
}

/// Delivers text into the active foreground window using the specified options.
///
/// 1. Applies text shaping (optional trailing space).
/// 2. If target window is elevated, falls back to copying text to clipboard and returns `Copied`.
/// 3. Depending on `opts.method`:
///    - `Direct`: types text via Unicode keystrokes (`KEYEVENTF_UNICODE`). If `behavior == Keep`,
///      also places text on clipboard. If typing fails, falls back to clipboard and returns `Copied`.
///    - `CtrlV` / `ShiftInsert`: places text on clipboard, waits `delay_before_ms`, sends chord,
///      waits `delay_after_ms`, and if `behavior == Restore`, restores previous clipboard.
/// 4. If injection succeeded and `opts.auto_submit` is true, sends an Enter key after a short pause.
/// 5. Returns `Inserted` on success or `Copied` if target is elevated or input delivery failed.
pub fn deliver_text(text: &str, opts: &PasteOptions) -> InjectionOutcome {
    let shaped = shape_text(text, opts.append_space);
    if shaped.is_empty() {
        return InjectionOutcome::Inserted;
    }

    #[cfg(windows)]
    {
        // 1. Check if target window belongs to an elevated process (UIPI block)
        if is_target_window_elevated() {
            let _ = set_clipboard_text(&shaped);
            return InjectionOutcome::Copied;
        }

        let is_direct = opts.method == PasteMethod::Direct;
        let saved = if !is_direct && opts.behavior == ClipboardBehavior::Restore {
            get_clipboard_text()
        } else {
            None
        };

        if is_direct {
            // If user requested Keep in Direct mode, also copy transcript to clipboard
            if opts.behavior == ClipboardBehavior::Keep {
                let _ = set_clipboard_text(&shaped);
            }
        } else if set_clipboard_text(&shaped).is_err() {
            return InjectionOutcome::Copied;
        }

        if opts.delay_before_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(opts.delay_before_ms));
        }

        let send_res = match opts.method {
            PasteMethod::CtrlV => send_ctrl_v(),
            PasteMethod::ShiftInsert => send_shift_insert(),
            PasteMethod::Direct => send_direct(&shaped),
        };

        if send_res.is_err() {
            // Delivery failed: ensure text is on clipboard and report Copied
            if is_direct {
                let _ = set_clipboard_text(&shaped);
            }
            return InjectionOutcome::Copied;
        }

        if opts.delay_after_ms > 0 {
            std::thread::sleep(std::time::Duration::from_millis(opts.delay_after_ms));
        }

        if let Some(prev) = saved {
            let _ = set_clipboard_text(&prev);
        }

        if opts.auto_submit {
            std::thread::sleep(std::time::Duration::from_millis(50));
            let _ = send_enter();
        }

        InjectionOutcome::Inserted
    }

    #[cfg(not(windows))]
    {
        let _ = (shaped, opts);
        InjectionOutcome::Copied
    }
}

/// Tests whether the target window belongs to an elevated process while our process is unelevated.
/// Returns true if target is elevated (injection impossible due to UIPI).
pub fn is_target_window_elevated() -> bool {
    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::{CloseHandle, FALSE, HANDLE, HWND};
        use windows_sys::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
        use windows_sys::Win32::System::Threading::{
            GetCurrentProcess, OpenProcess, OpenProcessToken, PROCESS_QUERY_LIMITED_INFORMATION,
        };
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            GetForegroundWindow, GetWindowThreadProcessId,
        };

        unsafe {
            let hwnd: HWND = GetForegroundWindow();
            if hwnd.is_null() {
                return false;
            }

            let mut process_id: u32 = 0;
            GetWindowThreadProcessId(hwnd, &mut process_id);
            if process_id == 0 {
                return false;
            }

            // Check our process elevation
            let mut our_token: HANDLE = std::ptr::null_mut();
            let mut our_elevated = false;
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut our_token) != FALSE {
                let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
                let mut return_length: u32 = 0;
                if GetTokenInformation(
                    our_token,
                    TokenElevation,
                    &mut elevation as *mut _ as *mut _,
                    std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                    &mut return_length,
                ) != FALSE
                {
                    our_elevated = elevation.TokenIsElevated != 0;
                }
                CloseHandle(our_token);
            }

            // If we are already elevated, UIPI won't block us from sending input to elevated windows
            if our_elevated {
                return false;
            }

            // Check target process elevation
            let target_process: HANDLE = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, process_id);
            if target_process.is_null() {
                // If we couldn't open target process with QUERY_LIMITED_INFORMATION, it is almost certainly elevated
                return true;
            }

            let mut target_token: HANDLE = std::ptr::null_mut();
            let mut target_elevated = false;
            if OpenProcessToken(target_process, TOKEN_QUERY, &mut target_token) != FALSE {
                let mut elevation: TOKEN_ELEVATION = std::mem::zeroed();
                let mut return_length: u32 = 0;
                if GetTokenInformation(
                    target_token,
                    TokenElevation,
                    &mut elevation as *mut _ as *mut _,
                    std::mem::size_of::<TOKEN_ELEVATION>() as u32,
                    &mut return_length,
                ) != FALSE
                {
                    target_elevated = elevation.TokenIsElevated != 0;
                }
                CloseHandle(target_token);
            }
            CloseHandle(target_process);

            target_elevated
        }
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(windows)]
fn is_extended_key(vk: u16) -> bool {
    vk == VK_INSERT
}

#[cfg(windows)]
pub fn send_key_actions(actions: &[KeyAction]) -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
        KEYEVENTF_UNICODE,
    };

    if actions.is_empty() {
        return Ok(());
    }

    let mut inputs: Vec<INPUT> = actions
        .iter()
        .map(|action| {
            let mut input: INPUT = unsafe { std::mem::zeroed() };
            input.r#type = INPUT_KEYBOARD;
            let ki = match *action {
                KeyAction::KeyDown(vk) => {
                    let flags = if is_extended_key(vk) {
                        KEYEVENTF_EXTENDEDKEY
                    } else {
                        0
                    };
                    KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    }
                }
                KeyAction::KeyUp(vk) => {
                    let mut flags = KEYEVENTF_KEYUP;
                    if is_extended_key(vk) {
                        flags |= KEYEVENTF_EXTENDEDKEY;
                    }
                    KEYBDINPUT {
                        wVk: vk,
                        wScan: 0,
                        dwFlags: flags,
                        time: 0,
                        dwExtraInfo: 0,
                    }
                }
                KeyAction::UnicodeDown(code) => KEYBDINPUT {
                    wVk: 0,
                    wScan: code,
                    dwFlags: KEYEVENTF_UNICODE,
                    time: 0,
                    dwExtraInfo: 0,
                },
                KeyAction::UnicodeUp(code) => KEYBDINPUT {
                    wVk: 0,
                    wScan: code,
                    dwFlags: KEYEVENTF_UNICODE | KEYEVENTF_KEYUP,
                    time: 0,
                    dwExtraInfo: 0,
                },
            };
            input.Anonymous.ki = ki;
            input
        })
        .collect();

    unsafe {
        let sent = SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );

        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err(format!(
                "SendInput sent {sent} of {} inputs",
                inputs.len()
            ))
        }
    }
}

#[cfg(windows)]
pub fn send_ctrl_v() -> Result<(), String> {
    send_key_actions(&build_paste_chord(PasteMethod::CtrlV))
}

#[cfg(windows)]
pub fn send_shift_insert() -> Result<(), String> {
    send_key_actions(&build_paste_chord(PasteMethod::ShiftInsert))
}

#[cfg(windows)]
pub fn send_direct(text: &str) -> Result<(), String> {
    send_key_actions(&build_direct_sequence(text))
}

#[cfg(windows)]
pub fn send_enter() -> Result<(), String> {
    send_key_actions(&build_enter_sequence())
}

#[cfg(not(windows))]
pub fn send_key_actions(_actions: &[KeyAction]) -> Result<(), String> {
    Err("SendInput is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn send_ctrl_v() -> Result<(), String> {
    Err("send_ctrl_v is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn send_shift_insert() -> Result<(), String> {
    Err("send_shift_insert is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn send_direct(_text: &str) -> Result<(), String> {
    Err("send_direct is only supported on Windows".to_string())
}

#[cfg(not(windows))]
pub fn send_enter() -> Result<(), String> {
    Err("send_enter is only supported on Windows".to_string())
}

#[cfg(windows)]
pub fn get_clipboard_text() -> Option<String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::Foundation::{FALSE, HANDLE, HWND};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, GetClipboardData, OpenClipboard,
    };
    use windows_sys::Win32::System::Memory::{GlobalLock, GlobalUnlock};

    const CF_UNICODETEXT: u32 = 13;

    unsafe {
        if OpenClipboard(0 as HWND) == FALSE {
            return None;
        }

        let handle: HANDLE = GetClipboardData(CF_UNICODETEXT);
        if handle.is_null() {
            CloseClipboard();
            return None;
        }

        let ptr = GlobalLock(handle) as *const u16;
        if ptr.is_null() {
            CloseClipboard();
            return None;
        }

        let mut len = 0;
        while *ptr.add(len) != 0 {
            len += 1;
        }

        let slice = std::slice::from_raw_parts(ptr, len);
        let os_str = std::ffi::OsString::from_wide(slice);
        GlobalUnlock(handle);
        CloseClipboard();

        os_str.into_string().ok()
    }
}

#[cfg(not(windows))]
pub fn get_clipboard_text() -> Option<String> {
    None
}

#[cfg(windows)]
pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{FALSE, HWND};
    use windows_sys::Win32::System::DataExchange::{
        CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData,
    };
    use windows_sys::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};

    const CF_UNICODETEXT: u32 = 13;

    let wide: Vec<u16> = std::ffi::OsStr::new(text)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    unsafe {
        // Retry a few times in case clipboard is temporarily locked by another app
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(0 as HWND) != FALSE {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        if !opened {
            return Err("Failed to open clipboard".to_string());
        }

        EmptyClipboard();

        let bytes_len = wide.len() * std::mem::size_of::<u16>();
        let h_mem = GlobalAlloc(GMEM_MOVEABLE, bytes_len);
        if h_mem.is_null() {
            CloseClipboard();
            return Err("Failed to allocate memory for clipboard".to_string());
        }

        let p_mem = GlobalLock(h_mem) as *mut u16;
        if p_mem.is_null() {
            CloseClipboard();
            return Err("Failed to lock clipboard memory".to_string());
        }

        std::ptr::copy_nonoverlapping(wide.as_ptr(), p_mem, wide.len());
        GlobalUnlock(h_mem);

        if SetClipboardData(CF_UNICODETEXT, h_mem).is_null() {
            CloseClipboard();
            return Err("Failed to set clipboard data".to_string());
        }

        CloseClipboard();
        Ok(())
    }
}

#[cfg(not(windows))]
pub fn set_clipboard_text(_text: &str) -> Result<(), String> {
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn injection_strategy_decision() {
        // Normal injection success -> restore clipboard
        let (decision, outcome) = evaluate_injection_strategy(false, true);
        assert_eq!(decision, InjectionDecision::RestoreClipboard);
        assert_eq!(outcome, InjectionOutcome::Inserted);

        // Elevated target -> leave on clipboard
        let (decision, outcome) = evaluate_injection_strategy(true, true);
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Copied);

        // SendInput failed -> leave on clipboard
        let (decision, outcome) = evaluate_injection_strategy(false, false);
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Copied);
    }

    #[test]
    fn clipboard_decision_restores_on_success() {
        assert_eq!(
            decide_clipboard_action(true),
            InjectionDecision::RestoreClipboard
        );
    }

    #[test]
    fn clipboard_decision_leaves_on_failure() {
        assert_eq!(
            decide_clipboard_action(false),
            InjectionDecision::LeaveOnClipboard
        );
    }

    #[test]
    fn clipboard_behavior_restore_vs_keep() {
        // Successful injection with Restore -> restore clipboard
        let (decision, outcome) = evaluate_injection_strategy_with_behavior(
            false,
            true,
            ClipboardBehavior::Restore,
        );
        assert_eq!(decision, InjectionDecision::RestoreClipboard);
        assert_eq!(outcome, InjectionOutcome::Inserted);

        // Successful injection with Keep -> keep on clipboard
        let (decision, outcome) =
            evaluate_injection_strategy_with_behavior(false, true, ClipboardBehavior::Keep);
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Inserted);

        // Failed injection with Restore -> keep on clipboard for recovery
        let (decision, outcome) = evaluate_injection_strategy_with_behavior(
            false,
            false,
            ClipboardBehavior::Restore,
        );
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Copied);

        // Failed injection with Keep -> keep on clipboard
        let (decision, outcome) =
            evaluate_injection_strategy_with_behavior(false, false, ClipboardBehavior::Keep);
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Copied);

        // Elevated target with Restore -> keep on clipboard
        let (decision, outcome) =
            evaluate_injection_strategy_with_behavior(true, true, ClipboardBehavior::Restore);
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Copied);

        // Elevated target with Keep -> keep on clipboard
        let (decision, outcome) =
            evaluate_injection_strategy_with_behavior(true, true, ClipboardBehavior::Keep);
        assert_eq!(decision, InjectionDecision::LeaveOnClipboard);
        assert_eq!(outcome, InjectionOutcome::Copied);

        // Direct decide_clipboard_action_with_behavior
        assert_eq!(
            decide_clipboard_action_with_behavior(true, ClipboardBehavior::Restore),
            InjectionDecision::RestoreClipboard
        );
        assert_eq!(
            decide_clipboard_action_with_behavior(true, ClipboardBehavior::Keep),
            InjectionDecision::LeaveOnClipboard
        );
        assert_eq!(
            decide_clipboard_action_with_behavior(false, ClipboardBehavior::Restore),
            InjectionDecision::LeaveOnClipboard
        );
        assert_eq!(
            decide_clipboard_action_with_behavior(false, ClipboardBehavior::Keep),
            InjectionDecision::LeaveOnClipboard
        );
    }

    #[test]
    fn text_shaping_space() {
        assert_eq!(shape_text("hello", true), "hello ");
        assert_eq!(shape_text("hello ", true), "hello ");
        assert_eq!(shape_text("hello", false), "hello");
        assert_eq!(shape_text("", true), "");
        assert_eq!(shape_text("", false), "");
    }

    #[test]
    fn text_shaping_enter() {
        assert_eq!(shape_text_with_enter("hello", false, true), "hello\n");
        assert_eq!(shape_text_with_enter("hello\n", false, true), "hello\n");
        assert_eq!(shape_text_with_enter("hello", true, true), "hello \n");
        assert_eq!(shape_text_with_enter("hello", false, false), "hello");
        assert_eq!(shape_text_with_enter("", false, true), "");

        assert!(should_auto_submit(true, InjectionOutcome::Inserted));
        assert!(!should_auto_submit(false, InjectionOutcome::Inserted));
        assert!(!should_auto_submit(true, InjectionOutcome::Copied));
        assert!(!should_auto_submit(false, InjectionOutcome::Copied));
    }

    #[test]
    fn sequence_building_ctrl_v() {
        let chord = build_paste_chord(PasteMethod::CtrlV);
        assert_eq!(
            chord,
            vec![
                KeyAction::KeyDown(VK_CONTROL),
                KeyAction::KeyDown(VK_V),
                KeyAction::KeyUp(VK_V),
                KeyAction::KeyUp(VK_CONTROL),
            ]
        );
    }

    #[test]
    fn sequence_building_shift_insert() {
        let chord = build_paste_chord(PasteMethod::ShiftInsert);
        assert_eq!(
            chord,
            vec![
                KeyAction::KeyDown(VK_SHIFT),
                KeyAction::KeyDown(VK_INSERT),
                KeyAction::KeyUp(VK_INSERT),
                KeyAction::KeyUp(VK_SHIFT),
            ]
        );
    }

    #[test]
    fn sequence_building_direct() {
        let chord = build_paste_chord(PasteMethod::Direct);
        assert!(chord.is_empty());

        let seq = build_direct_sequence("a");
        assert_eq!(
            seq,
            vec![
                KeyAction::UnicodeDown('a' as u16),
                KeyAction::UnicodeUp('a' as u16),
            ]
        );

        let seq_word = build_direct_sequence("hi");
        assert_eq!(seq_word.len(), 4);
        assert_eq!(seq_word[0], KeyAction::UnicodeDown('h' as u16));
        assert_eq!(seq_word[1], KeyAction::UnicodeUp('h' as u16));
        assert_eq!(seq_word[2], KeyAction::UnicodeDown('i' as u16));
        assert_eq!(seq_word[3], KeyAction::UnicodeUp('i' as u16));

        // UTF-16 Cyrillic test
        let cyrillic = "Э";
        let utf16_code = cyrillic.encode_utf16().next().unwrap();
        let cyrillic_seq = build_direct_sequence(cyrillic);
        assert_eq!(
            cyrillic_seq,
            vec![
                KeyAction::UnicodeDown(utf16_code),
                KeyAction::UnicodeUp(utf16_code),
            ]
        );
    }

    #[test]
    fn sequence_building_enter() {
        let seq = build_enter_sequence();
        assert_eq!(
            seq,
            vec![
                KeyAction::KeyDown(VK_RETURN),
                KeyAction::KeyUp(VK_RETURN),
            ]
        );
    }

    #[test]
    fn sequence_building_injection() {
        let text = "test";
        assert_eq!(
            build_injection_sequence(PasteMethod::CtrlV, text),
            build_paste_chord(PasteMethod::CtrlV)
        );
        assert_eq!(
            build_injection_sequence(PasteMethod::ShiftInsert, text),
            build_paste_chord(PasteMethod::ShiftInsert)
        );
        assert_eq!(
            build_injection_sequence(PasteMethod::Direct, text),
            build_direct_sequence(text)
        );
    }

    #[test]
    fn paste_options_default() {
        let opts = PasteOptions::default();
        assert_eq!(opts.method, PasteMethod::CtrlV);
        assert_eq!(opts.behavior, ClipboardBehavior::Restore);
        assert_eq!(opts.delay_before_ms, 60);
        assert_eq!(opts.delay_after_ms, 60);
        assert!(!opts.append_space);
        assert!(!opts.auto_submit);
    }

    #[test]
    fn paste_options_serde() {
        let opts = PasteOptions::default();
        let json = serde_json::to_string(&opts).unwrap();
        let deserialized: PasteOptions = serde_json::from_str(&json).unwrap();
        assert_eq!(opts, deserialized);

        // Deserialization with aliases
        let from_aliases: PasteMethod = serde_json::from_str("\"ctrl_v\"").unwrap();
        assert_eq!(from_aliases, PasteMethod::CtrlV);
        let from_shift_insert: PasteMethod = serde_json::from_str("\"shift_insert\"").unwrap();
        assert_eq!(from_shift_insert, PasteMethod::ShiftInsert);
        let from_direct: PasteMethod = serde_json::from_str("\"direct\"").unwrap();
        assert_eq!(from_direct, PasteMethod::Direct);

        let from_keep: ClipboardBehavior = serde_json::from_str("\"keep\"").unwrap();
        assert_eq!(from_keep, ClipboardBehavior::Keep);
        let from_restore: ClipboardBehavior = serde_json::from_str("\"restore\"").unwrap();
        assert_eq!(from_restore, ClipboardBehavior::Restore);
    }

    #[test]
    fn test_remove_filler_words_ru_and_en() {
        // Russian filler removal
        assert_eq!(
            remove_filler_words("Эээ, я думаю, эм, это работает"),
            "Я думаю, это работает"
        );
        assert_eq!(remove_filler_words("Типа, все готово"), "Все готово");
        assert_eq!(remove_filler_words("Как бы все сделано"), "Все сделано");

        // English filler removal
        assert_eq!(
            remove_filler_words("Um, hello, uh, world"),
            "Hello, world"
        );
        assert_eq!(remove_filler_words("Well, er, that is good"), "Well, that is good");

        // Real words preservation
        assert_eq!(remove_filler_words("Это нужно сделать"), "Это нужно сделать");
        assert_eq!(remove_filler_words("Вот это дом"), "Вот это дом");
        assert_eq!(remove_filler_words("I like this"), "I like this");
        assert_eq!(remove_filler_words("Look like a bird"), "Look like a bird");
    }
}
