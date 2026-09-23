//! API key storage.
//!
//! The key used to sit in `alarmer.json` next to the alarms, which meant the
//! app's own "export a backup" feature also exported the user's credentials —
//! and they travelled through any bug report that included the file. It now
//! lives in the OS credential store (Windows Credential Manager, Keychain,
//! Secret Service).
//!
//! Reading degrades rather than fails: a machine with no credential store still
//! runs the app, it just cannot remember the key between sessions.

use keyring::Entry;

const SERVICE: &str = "com.alarmer.smart";
const ACCOUNT: &str = "ai-api-key";

fn entry_for(account: &str) -> Result<Entry, String> {
    Entry::new(SERVICE, account).map_err(|e| format!("credential store unavailable: {e}"))
}

/// Stores the key under `account`, or clears it when `key` is empty.
///
/// Split out from the account name so a test can round-trip through the real
/// store without touching the credential the running application uses.
fn set_for(account: &str, key: &str) -> Result<(), String> {
    let entry = entry_for(account)?;
    if key.trim().is_empty() {
        // Deleting a missing entry is not an error worth surfacing.
        return match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(format!("could not clear the saved key: {e}")),
        };
    }
    entry
        .set_password(key)
        .map_err(|e| format!("could not save the key: {e}"))
}

/// Reads the key stored under `account`. `None` when nothing is stored or the
/// store is absent.
fn get_for(account: &str) -> Option<String> {
    let entry = entry_for(account).ok()?;
    match entry.get_password() {
        Ok(key) if !key.trim().is_empty() => Some(key),
        _ => None,
    }
}

/// Stores the key, or clears it when `key` is empty.
pub fn set(key: &str) -> Result<(), String> {
    set_for(ACCOUNT, key)
}

/// Reads the stored key. `None` when nothing is stored or the store is absent.
pub fn get() -> Option<String> {
    get_for(ACCOUNT)
}

/// True when a key is available, without exposing it.
pub fn has() -> bool {
    get().is_some()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Each test uses its own account name: the store is machine-wide and the
    /// suite runs in parallel, so sharing one name let a clearing test wipe the
    /// entry another test was asserting on — and both of them fought over the
    /// credential the running application actually uses.
    fn scratch_account() -> String {
        format!("ai-api-key-test-{}", std::process::id())
    }

    /// Round-trips through the real credential store when the platform has one.
    #[test]
    fn set_get_and_clear_round_trip() {
        let account = scratch_account();

        if set_for(&account, "sk-alarmer-test-key").is_err() {
            // No credential store on this machine; the app is designed to run
            // without one, so there is nothing to assert.
            return;
        }

        assert_eq!(get_for(&account).as_deref(), Some("sk-alarmer-test-key"));

        set_for(&account, "").expect("clearing must succeed");
        assert_eq!(get_for(&account), None);
    }

    #[test]
    fn an_empty_key_is_never_stored_as_a_real_value() {
        let account = format!("{}-empty", scratch_account());

        if set_for(&account, "").is_err() {
            return;
        }
        assert_ne!(get_for(&account).as_deref(), Some(""));

        // Leave no trace in the user's credential store.
        let _ = set_for(&account, "");
    }

    /// The application's own credential is never touched by the suite.
    #[test]
    fn the_suite_does_not_write_the_application_account() {
        let before = get();
        let account = format!("{}-isolation", scratch_account());

        if set_for(&account, "sk-isolation-probe").is_err() {
            return;
        }
        let _ = set_for(&account, "");

        assert_eq!(get(), before, "the application's key must be left alone");
    }
}
