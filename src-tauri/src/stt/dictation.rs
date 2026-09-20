// src-tauri/src/stt/dictation.rs
// Windows text injection via SendInput with clipboard save/restore,
// elevation check for target window, and clipboard fallback.

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
pub fn execute_dictation_injection(text: &str) -> (bool, InjectionOutcome) {
    let outcome = inject_or_copy_text(text);
    let inserted = outcome == InjectionOutcome::Inserted;
    (inserted, outcome)
}

pub fn inject_text(text: &str) -> bool {
    inject_or_copy_text(text) == InjectionOutcome::Inserted
}

/// Pure function deciding whether to restore or leave clipboard based on injection success.
pub fn decide_clipboard_action(injection_succeeded: bool) -> InjectionDecision {
    if injection_succeeded {
        InjectionDecision::RestoreClipboard
    } else {
        InjectionDecision::LeaveOnClipboard
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

/// Decision logic for clipboard management given target elevation and injection result.
pub fn evaluate_injection_strategy(is_elevated: bool, injection_succeeded: bool) -> (InjectionDecision, InjectionOutcome) {
    if is_elevated || !injection_succeeded {
        (InjectionDecision::LeaveOnClipboard, InjectionOutcome::Copied)
    } else {
        (InjectionDecision::RestoreClipboard, InjectionOutcome::Inserted)
    }
}

/// Injects text into the active window.
/// 1. If active window is elevated, copies text to clipboard and returns Copied.
/// 2. Otherwise: saves previous clipboard text, sets new text, sends Ctrl+V via SendInput,
///    waits briefly, restores previous clipboard text, and returns Inserted.
pub fn inject_or_copy_text(text: &str) -> InjectionOutcome {
    if text.is_empty() {
        return InjectionOutcome::Inserted;
    }

    #[cfg(windows)]
    {
        if is_target_window_elevated() {
            let _ = set_clipboard_text(text);
            return InjectionOutcome::Copied;
        }

        let saved = get_clipboard_text();

        // Put transcribed text on clipboard
        if set_clipboard_text(text).is_err() {
            // Failed to open clipboard
            return InjectionOutcome::Copied;
        }

        // Send Ctrl + V
        let send_res = send_ctrl_v();

        // If send input failed, leave text on clipboard
        let (decision, outcome) = evaluate_injection_strategy(false, send_res.is_ok());

        if decision == InjectionDecision::RestoreClipboard {
            // Sleep briefly to allow target window to process paste message
            std::thread::sleep(std::time::Duration::from_millis(150));
            if let Some(prev) = saved {
                let _ = set_clipboard_text(&prev);
            }
        }

        outcome
    }

    #[cfg(not(windows))]
    {
        let _ = text;
        InjectionOutcome::Copied
    }
}

#[cfg(windows)]
fn send_ctrl_v() -> Result<(), String> {
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
        SendInput, INPUT, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP,
        VK_CONTROL, VK_V,
    };

    unsafe {
        let mut inputs: [INPUT; 4] = std::mem::zeroed();

        // 1. Ctrl down
        inputs[0].r#type = INPUT_KEYBOARD;
        inputs[0].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };

        // 2. V down
        inputs[1].r#type = INPUT_KEYBOARD;
        inputs[1].Anonymous.ki = KEYBDINPUT {
            wVk: VK_V,
            wScan: 0,
            dwFlags: 0,
            time: 0,
            dwExtraInfo: 0,
        };

        // 3. V up
        inputs[2].r#type = INPUT_KEYBOARD;
        inputs[2].Anonymous.ki = KEYBDINPUT {
            wVk: VK_V,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };

        // 4. Ctrl up
        inputs[3].r#type = INPUT_KEYBOARD;
        inputs[3].Anonymous.ki = KEYBDINPUT {
            wVk: VK_CONTROL,
            wScan: 0,
            dwFlags: KEYEVENTF_KEYUP,
            time: 0,
            dwExtraInfo: 0,
        };

        let sent = SendInput(
            inputs.len() as u32,
            inputs.as_mut_ptr(),
            std::mem::size_of::<INPUT>() as i32,
        );

        if sent == inputs.len() as u32 {
            Ok(())
        } else {
            Err("SendInput failed to send all keystrokes".to_string())
        }
    }
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
        assert_eq!(decide_clipboard_action(true), InjectionDecision::RestoreClipboard);
    }

    #[test]
    fn clipboard_decision_leaves_on_failure() {
        assert_eq!(decide_clipboard_action(false), InjectionDecision::LeaveOnClipboard);
    }
}
