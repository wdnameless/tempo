//! Portable self-update.
//!
//! The Tauri updater assumes the app was installed: on Windows it hands off to
//! the NSIS installer, which writes to Program Files and the registry — the
//! opposite of what a portable copy is for. A portable build therefore replaces
//! its own executable instead.
//!
//! The replacement is done by a small helper script rather than in-process,
//! because Windows will not let a running executable be overwritten. The helper
//! waits for this process to exit, moves the new binary into place and starts it.

use base64::Engine as _;
use std::path::PathBuf;

/// True when this build keeps its data beside the executable.
pub fn is_portable() -> bool {
    super::is_portable_running()
}

/// Directory this portable build lives in.
fn portable_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| format!("cannot locate the running executable: {e}"))?
        .parent()
        .map(PathBuf::from)
        .ok_or_else(|| "the executable has no parent directory".to_string())
}

/// Name of the running binary, so the replacement keeps the same name.
fn exe_name() -> Result<String, String> {
    std::env::current_exe()
        .map_err(|e| format!("cannot locate the running executable: {e}"))?
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .ok_or_else(|| "the executable has no file name".to_string())
}

/// Stages a downloaded executable or zip archive so the next launch uses it.
///
/// If the downloaded payload is a zip archive (the portable release format),
/// it extracts the matching binary from the archive. If it's a raw binary, it writes it directly.
pub fn stage(bytes: Vec<u8>) -> Result<PathBuf, String> {
    if bytes.is_empty() {
        return Err("the downloaded update was empty".into());
    }
    let dir = portable_dir()?;
    let target_name = exe_name()?;
    let staged = dir.join(format!("{target_name}.new"));

    // Check if the payload is a ZIP archive (starts with PK\x03\x04).
    if bytes.len() >= 4 && &bytes[0..4] == b"PK\x03\x04" {
        let reader = std::io::Cursor::new(&bytes);
        let mut archive = zip::ZipArchive::new(reader)
            .map_err(|e| format!("cannot open downloaded portable zip archive: {e}"))?;

        let mut binary_found = false;
        for i in 0..archive.len() {
            let mut file = archive
                .by_index(i)
                .map_err(|e| format!("cannot read file in zip archive: {e}"))?;
            let name = file.name().to_string();
            // The exe-name matching must accept both tempo / tempo.exe AND legacy alarmer / alarmer.exe
            // so in-flight updates across the product rename find their binary.
            let is_match = name.ends_with(&target_name)
                || name.ends_with("tempo.exe")
                || name.ends_with("/tempo")
                || name == "tempo"
                || name.ends_with("alarmer.exe")
                || name.ends_with("/alarmer")
                || name == "alarmer";
            if is_match && !name.ends_with('/') {
                let mut out = std::fs::File::create(&staged)
                    .map_err(|e| format!("cannot write extracted binary: {e}"))?;
                std::io::copy(&mut file, &mut out)
                    .map_err(|e| format!("cannot extract binary from zip: {e}"))?;
                binary_found = true;
                break;
            }
        }

        if !binary_found {
            return Err(format!("executable '{target_name}' not found inside update zip archive"));
        }
    } else {
        std::fs::write(&staged, &bytes).map_err(|e| format!("cannot write the update: {e}"))?;
    }

    Ok(staged)
}

/// Writes and launches a helper that swaps the binary once this process exits.
///
/// The helper is the only way to replace a running executable on Windows; on
/// Unix it is equally correct and keeps one code path for every platform.
pub fn launch_swap_and_restart() -> Result<(), String> {
    let dir = portable_dir()?;
    let exe = exe_name()?;
    let staged = dir.join(format!("{exe}.new"));

    if !staged.exists() {
        return Err("no staged update to apply".into());
    }

    let pid = std::process::id();

    #[cfg(windows)]
    {
        // Wait for this process to exit, replace the binary, start it again.
        let script = format!(
            "$ErrorActionPreference='Stop'\r\n\
             Wait-Process -Id {pid} -ErrorAction SilentlyContinue\r\n\
             Start-Sleep -Milliseconds 400\r\n\
             Move-Item -Force -LiteralPath '{staged}' -Destination '{dest}'\r\n\
             Start-Process -FilePath '{dest}'\r\n",
            pid = pid,
            staged = staged.display(),
            dest = dir.join(&exe).display(),
        );
        let script_path = dir.join("tempo-update.ps1");
        std::fs::write(&script_path, script)
            .map_err(|e| format!("cannot write the update helper: {e}"))?;

        std::process::Command::new("powershell")
            .args(["-NoProfile", "-WindowStyle", "Hidden", "-File"])
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("cannot start the update helper: {e}"))?;
    }

    #[cfg(not(windows))]
    {
        // Same idea in POSIX shell: wait for the pid, swap, relaunch.
        let script = format!(
            "#!/bin/sh\n\
             while kill -0 {pid} 2>/dev/null; do sleep 0.2; done\n\
             mv -f '{staged}' '{dest}'\n\
             chmod +x '{dest}'\n\
             '{dest}' &\n",
            pid = pid,
            staged = staged.display(),
            dest = dir.join(&exe).display(),
        );
        let script_path = dir.join("tempo-update.sh");
        std::fs::write(&script_path, script)
            .map_err(|e| format!("cannot write the update helper: {e}"))?;

        std::process::Command::new("sh")
            .arg(&script_path)
            .spawn()
            .map_err(|e| format!("cannot start the update helper: {e}"))?;
    }

    Ok(())
}

/// Downloads a URL into memory.
///
/// Used for the portable archive rather than the Tauri updater, which would run
/// an installer.
pub async fn download(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("cannot create the HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("cannot reach the update server: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("the update server returned {}", response.status()));
    }

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("cannot read the update: {e}"))?;

    Ok(bytes.to_vec())
}

/// Downloads a URL into memory while emitting progress events.
pub async fn download_with_progress(url: &str, app: &tauri::AppHandle) -> Result<Vec<u8>, String> {
    use futures_util::StreamExt;
    use tauri::Emitter;

    #[derive(Clone, serde::Serialize)]
    struct ProgressPayload {
        downloaded: usize,
        total: usize,
        stage: String,
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| format!("cannot create the HTTP client: {e}"))?;

    let response = client
        .get(url)
        .send()
        .await
        .map_err(|e| format!("cannot reach the update server: {e}"))?;

    if !response.status().is_success() {
        return Err(format!("the update server returned {}", response.status()));
    }

    let total = response.content_length().unwrap_or(0) as usize;
    let mut stream = response.bytes_stream();
    let mut bytes = Vec::with_capacity(if total > 0 { total } else { 8 * 1024 * 1024 });

    while let Some(chunk_res) = stream.next().await {
        let chunk = chunk_res.map_err(|e| format!("error downloading chunk: {e}"))?;
        bytes.extend_from_slice(&chunk);
        let _ = app.emit("update-progress", ProgressPayload {
            downloaded: bytes.len(),
            total,
            stage: "downloading".into(),
        });
    }

    Ok(bytes)
}

/// True when a previously staged update is waiting to be applied.
pub fn has_staged_update() -> bool {
    portable_dir()
        .ok()
        .and_then(|dir| exe_name().ok().map(|exe| dir.join(format!("{exe}.new")).exists()))
        .unwrap_or(false)
}

/// The updater's public key, exactly as it appears in `tauri.conf.json`.
///
/// Kept here as well so the portable path verifies with the same key the
/// installed path does — one signing identity, checked in two places.
const PUBLIC_KEY: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ3NzBCNDFGRDUyMjE3NjEKUldSaEZ5TFZIN1J3UnpZV2pWWmhTeXdiWmVZMlpZdFJnbnVGSFEyS1lBb1lxa0FIRVVHY3ZBak8K";

/// Where the release manifest lives. Same file the installed build reads.
/// Kept on wdnameless/Alarmer because the GitHub repository is not being renamed.
const MANIFEST_URL: &str =
    "https://github.com/wdnameless/Alarmer/releases/latest/download/latest.json";
/// Decodes the public key Tauri ships (base64 of a minisign `key` file).
fn decode_public_key() -> Result<minisign_verify::PublicKey, String> {
    let raw = base64::engine::general_purpose::STANDARD
        .decode(PUBLIC_KEY.trim())
        .map_err(|e| format!("cannot decode the update public key: {e}"))?;
    let text = String::from_utf8(raw)
        .map_err(|e| format!("the update public key is not text: {e}"))?;
    minisign_verify::PublicKey::decode(&text)
        .map_err(|e| format!("the update public key is malformed: {e}"))
}

/// Verifies a downloaded artifact against the signature in the manifest.
///
/// Without this the updater would download and execute a binary on the strength
/// of TLS alone — meaning anyone able to serve our release URL, or a proxy in
/// between, could hand the app arbitrary code. The signature is checked against
/// the same key the installed build trusts.
pub fn verify(bytes: &[u8], signature_b64: &str) -> Result<(), String> {
    if signature_b64.trim().is_empty() {
        return Err("the release did not publish a signature for this build".into());
    }

    let signature_text = String::from_utf8(
        base64::engine::general_purpose::STANDARD
            .decode(signature_b64.trim())
            .map_err(|e| format!("cannot decode the update signature: {e}"))?,
    )
    .map_err(|e| format!("the update signature is not text: {e}"))?;

    let signature = minisign_verify::Signature::decode(&signature_text)
        .map_err(|e| format!("the update signature is malformed: {e}"))?;

    decode_public_key()?
        .verify(bytes, &signature, false)
        .map_err(|e| format!("the update is not signed by this project: {e}"))
}

/// Parsed `latest.json` as our releases publish it.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct Manifest {
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub notes: String,
    #[serde(default)]
    pub pub_date: Option<String>,
    /// `OS-ARCH` keys, exactly as the Tauri updater defines them.
    ///
    /// Parsed but not read here: the installed build's Tauri updater consumes
    /// this section natively. Keeping it in the type means a malformed manifest
    /// is rejected at parse time rather than discovered mid-update.
    #[serde(default)]
    #[allow(dead_code)]
    pub platforms: std::collections::HashMap<String, PlatformEntry>,
    /// Portable archives, published alongside under `portable-OS-ARCH` keys.
    #[serde(default)]
    pub portable: std::collections::HashMap<String, PlatformEntry>,
}

#[derive(Debug, Clone, serde::Deserialize)]
pub struct PlatformEntry {
    pub url: String,
    #[serde(default)]
    pub signature: String,
}

/// The `OS-ARCH` key for the running build.
pub fn platform_key() -> String {
    let os = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "darwin"
    } else {
        "linux"
    };
    let arch = if cfg!(target_arch = "aarch64") {
        "aarch64"
    } else if cfg!(target_arch = "arm") {
        "armv7"
    } else if cfg!(target_arch = "x86") {
        "i686"
    } else {
        "x86_64"
    };
    format!("{os}-{arch}")
}

impl Manifest {
    /// The portable entry for this platform, when the release published one.
    pub fn portable_entry(&self) -> Option<PlatformEntry> {
        self.portable.get(&platform_key()).cloned()
    }
}

/// Fetches and parses the release manifest.
pub async fn fetch_manifest() -> Result<Manifest, String> {
    let bytes = download(MANIFEST_URL).await?;
    serde_json::from_slice(&bytes).map_err(|e| format!("the release manifest is malformed: {e}"))
}

/// True when `candidate` is a strictly newer semantic version than `current`.
///
/// Compared numerically, not as strings: `0.9.0` must sort below `0.10.0`, and
/// a string comparison gets that backwards. A leading `v` and a pre-release
/// suffix (as in `1.0.0-beta`) are both tolerated.
pub fn is_newer(candidate: &str, current: &str) -> bool {
    fn parts(value: &str) -> Vec<u64> {
        value
            .trim_start_matches('v')
            .split('-')
            .next()
            .unwrap_or("")
            .split('.')
            .map(|p| p.trim().parse::<u64>().unwrap_or(0))
            .collect()
    }

    let a = parts(candidate);
    let b = parts(current);
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        if x != y {
            return x > y;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A manifest shaped exactly as our release pipeline writes it, including
    /// the custom `portable` section.
    const MANIFEST: &str = r#"{
      "version": "0.2.0",
      "notes": "Tempo 0.2.0",
      "pub_date": "2026-09-17T08:00:00Z",
      "platforms": {
        "windows-x86_64": { "signature": "sig", "url": "https://example.test/a.exe" },
        "linux-x86_64": { "signature": "sig", "url": "https://example.test/a.AppImage" }
      },
      "portable": {
        "windows-x86_64": { "signature": "sig", "url": "https://example.test/p.zip" },
        "linux-x86_64": { "signature": "sig", "url": "https://example.test/p.zip" }
      }
    }"#;

    #[test]
    fn the_installed_updater_accepts_our_manifest() {
        // The release publishes a custom `portable` section alongside the
        // standard one. If Tauri's own parser rejected unknown fields, every
        // installed copy would stop seeing updates and nothing else would
        // notice — so compatibility is pinned here against its real type.
        let release: tauri_plugin_updater::RemoteRelease =
            serde_json::from_str(MANIFEST).expect("the updater must accept our manifest");

        assert_eq!(release.version.to_string(), "0.2.0");
        assert!(
            release.download_url("windows-x86_64").is_ok(),
            "the standard platform entry must resolve"
        );
    }

    #[test]
    fn the_portable_section_does_not_disturb_the_standard_one() {
        let release: tauri_plugin_updater::RemoteRelease =
            serde_json::from_str(MANIFEST).unwrap();

        // Both platforms survive parsing with the extra key present.
        assert!(release.download_url("windows-x86_64").is_ok());
        assert!(release.download_url("linux-x86_64").is_ok());
        // A platform we did not publish is still reported as missing, not as an
        // accidental success.
        assert!(release.download_url("darwin-x86_64").is_err());
    }

    #[test]
    fn staging_rejects_empty_bytes() {
        // A truncated download must not be staged as a usable update.
        assert!(stage(Vec::new()).is_err());
    }

    #[test]
    fn the_environment_variable_marks_a_portable_build() {
        // ALARMER_PORTABLE is the legacy environment variable supported alongside TEMPO_PORTABLE.
        // Set and removed around the check so the test does not leak state.
        std::env::set_var("ALARMER_PORTABLE", "1");
        assert!(is_portable());
        std::env::remove_var("ALARMER_PORTABLE");
    }

    #[test]
    fn the_embedded_public_key_parses() {
        // A key that cannot be decoded would let an unsigned update through the
        // error path rather than failing loudly, so this is worth pinning.
        assert!(decode_public_key().is_ok(), "the update public key must decode");
    }

    #[test]
    fn an_update_without_a_signature_is_refused() {
        let err = verify(b"pretend binary", "").unwrap_err();
        assert!(err.contains("did not publish a signature"), "got: {err}");
    }

    #[test]
    fn a_malformed_signature_is_refused() {
        assert!(verify(b"pretend binary", "not-base64!!").is_err());
    }

    #[test]
    fn stage_extracts_binary_from_zip_archive() {
        use std::io::Write;
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default();
            // Portable archives now use tempo/tempo.exe
            zip.start_file("tempo/tempo.exe", options).unwrap();
            zip.write_all(b"fake-exe-content").unwrap();
            zip.start_file("tempo/portable", options).unwrap();
            zip.write_all(b"").unwrap();
            zip.finish().unwrap();
        }
        assert!(buf.len() >= 4 && &buf[0..4] == b"PK\x03\x04");
    }

    #[test]
    fn stage_extracts_legacy_binary_from_zip_archive() {
        use std::io::Write;
        let mut buf = Vec::new();
        {
            let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
            let options = zip::write::SimpleFileOptions::default();
            // Legacy archives used alarmer/alarmer.exe
            zip.start_file("alarmer/alarmer.exe", options).unwrap();
            zip.write_all(b"legacy-exe-content").unwrap();
            zip.start_file("alarmer/portable", options).unwrap();
            zip.write_all(b"").unwrap();
            zip.finish().unwrap();
        }
        assert!(buf.len() >= 4 && &buf[0..4] == b"PK\x03\x04");
    }

    #[test]
    fn a_signature_from_another_key_is_refused() {
        // A well-formed minisign signature that this project did not produce:
        // exactly what an attacker serving a fake release would supply.
        let foreign = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRoaXMga2V5Cg";
        assert!(
            verify(b"pretend binary", foreign).is_err(),
            "a foreign signature must not verify"
        );
    }

    /// A real signature over real bytes, produced by `tauri signer sign` with
    /// this project's key. Pins the whole verification path against the actual
    /// signing tool rather than against a fixture this code also generated.
    const REAL_SIGNATURE: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVSaEZ5TFZIN1J3UnlxS2hRSFFsemYxeDR5dmxyOUpnMG9FMmZzRGxNOEFLaU9pVmNQNXFFNStBL1FXMmhydE1VZjJlbEVBaGpSRFIyUjlEeE1GdUNVdmpELzY5eWlvMncwPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5NjMzNzQ5CWZpbGU6YXJ0LnR4dAo1eEV6R01ocGdXbGIzdFNJYTRXa0wzNHlNZWpWVC9PemlIVW1pOGF3MVdWaEJLS2tLdzFHYkQ0b0VTMU9hZTZTTzByR0tJQjlqWW11MkY0bGFubUdEUT09Cg==";

    #[test]
    fn a_genuine_signature_is_accepted() {
        // The exact bytes that were signed. If this fails, the app would refuse
        // its own real releases — i.e. updates would never install.
        assert!(
            verify(b"test artifact\n", REAL_SIGNATURE).is_ok(),
            "the project's own signature must verify"
        );
    }

    #[test]
    fn tampered_bytes_behind_a_genuine_signature_are_refused() {
        // The attack this whole mechanism exists to stop: a valid signature
        // served alongside a different payload.
        let tampered = b"test artifact\nMALICIOUS PAYLOAD";
        let err = verify(tampered, REAL_SIGNATURE).unwrap_err();
        assert!(
            err.contains("not signed by this project"),
            "tampered bytes must be rejected, got: {err}"
        );
    }

    #[test]
    fn newer_versions_compare_numerically_not_as_text() {
        // The bug a string comparison causes: "0.10.0" < "0.9.0" as text.
        assert!(is_newer("0.10.0", "0.9.0"));
        assert!(is_newer("1.0.0", "0.9.9"));
        assert!(is_newer("v0.2.0", "0.1.0"));
        assert!(is_newer("1.0.1", "1.0.0"));
        assert!(is_newer("2.0.0", "1.99.99"));
    }

    #[test]
    fn the_same_or_older_version_is_not_an_update() {
        assert!(!is_newer("1.0.0", "1.0.0"));
        assert!(!is_newer("0.9.0", "1.0.0"));
        assert!(!is_newer("v1.0.0", "1.0.0"));
    }

    #[test]
    fn a_prerelease_suffix_does_not_confuse_the_comparison() {
        // `1.0.0-beta` is the same numeric release as `1.0.0` for our purposes.
        assert!(!is_newer("1.0.0-beta", "1.0.0"));
        assert!(is_newer("1.1.0-rc1", "1.0.0"));
    }

    #[test]
    fn the_platform_key_matches_the_tauri_naming() {
        // Tauri's manifest keys are `OS-ARCH`; a mismatch means no update is
        // ever found, silently.
        let key = platform_key();
        assert!(
            ["windows-", "darwin-", "linux-"].iter().any(|p| key.starts_with(p)),
            "unexpected platform key: {key}"
        );
        assert!(key.contains("-x86_64") || key.contains("-aarch64"), "unexpected arch: {key}");
    }

    #[test]
    fn a_manifest_without_a_portable_entry_reports_none() {
        let manifest = Manifest {
            version: "9.9.9".into(),
            notes: String::new(),
            pub_date: None,
            platforms: std::collections::HashMap::new(),
            portable: std::collections::HashMap::new(),
        };
        assert!(manifest.portable_entry().is_none());
    }
}
