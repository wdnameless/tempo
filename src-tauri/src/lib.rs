use std::collections::hash_map::DefaultHasher;
use std::collections::HashMap;
use std::hash::{Hash, Hasher};
use std::sync::{Mutex, OnceLock};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Listener, Manager,
};
use scheduler::ScheduledAlarm;
use base64::Engine;
mod ai;
mod alarm_sound;
mod credentials;
pub mod hourglass;
mod media_protocol;
mod portable_update;
pub mod recording;
mod scheduler;
mod timer;
pub mod storage;
pub mod stt;
pub mod sync;
pub mod vault;

/// Whether this build keeps its data beside the executable.
#[tauri::command]
async fn is_portable_build() -> Result<bool, String> {
    Ok(portable_update::is_portable())
}

/// Downloads, verifies and stages the portable update for this platform.
///
/// The URL is resolved here rather than passed in: the update source is
/// therefore always our own release manifest, and a compromised webview cannot
/// point the updater at an arbitrary binary. The artifact is verified against
/// the project's signing key before anything is written to disk.
#[tauri::command]
async fn portable_stage_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri::Emitter;

    #[derive(Clone, serde::Serialize)]
    struct ProgressPayload {
        downloaded: usize,
        total: usize,
        stage: String,
    }

    let _ = app.emit("update-progress", ProgressPayload {
        downloaded: 0,
        total: 100,
        stage: "manifest".into(),
    });

    let manifest = portable_update::fetch_manifest().await?;
    let entry = manifest
        .portable_entry()
        .ok_or_else(|| "this release has no portable build for this platform".to_string())?;

    let bytes = portable_update::download_with_progress(&entry.url, &app).await?;

    let _ = app.emit("update-progress", ProgressPayload {
        downloaded: bytes.len(),
        total: bytes.len(),
        stage: "verifying".into(),
    });

    portable_update::verify(&bytes, &entry.signature)?;

    let _ = app.emit("update-progress", ProgressPayload {
        downloaded: bytes.len(),
        total: bytes.len(),
        stage: "extracting".into(),
    });

    portable_update::stage(bytes)?;

    let _ = app.emit("update-progress", ProgressPayload {
        downloaded: 100,
        total: 100,
        stage: "ready".into(),
    });

    Ok(())
}

/// True when a staged update is waiting to be applied.
#[tauri::command]
async fn portable_update_ready() -> Result<bool, String> {
    Ok(portable_update::has_staged_update())
}

/// What a portable build found in the release manifest.
#[derive(serde::Serialize)]
pub struct PortableUpdateCheck {
    /// Empty when the running version is already the newest.
    version: String,
    notes: String,
    date: Option<String>,
    /// Set when an update exists: where to download it from.
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
}

/// Checks our own release manifest for a newer portable build.
#[tauri::command]
async fn portable_check_update(app: tauri::AppHandle) -> Result<PortableUpdateCheck, String> {
    let current = app.package_info().version.to_string();
    let manifest = portable_update::fetch_manifest().await?;

    let latest = manifest.version.trim_start_matches('v').to_string();
    if !portable_update::is_newer(&latest, &current) {
        return Ok(PortableUpdateCheck {
            version: String::new(),
            notes: String::new(),
            date: None,
            url: None,
        });
    }

    let url = manifest
        .portable_entry()
        .map(|entry| entry.url)
        .ok_or_else(|| format!("release {latest} has no portable build for this platform"))?;

    Ok(PortableUpdateCheck {
        version: latest,
        notes: manifest.notes,
        date: manifest.pub_date,
        url: Some(url),
    })
}

/// Swaps in the staged binary and restarts, then exits this process.
#[tauri::command]
async fn portable_apply_update(app: tauri::AppHandle) -> Result<(), String> {
    portable_update::launch_swap_and_restart()?;
    app.exit(0);
    Ok(())
}

/// Asks the configured model for a completion.
///
/// Runs from the backend so any OpenAI-compatible endpoint works regardless of
/// the webview's CSP, and returns the failure reason instead of a canned reply.
#[tauri::command]
async fn ai_complete(
    base_url: String,
    model: String,
    messages: Vec<ai::ChatMessage>,
) -> Result<ai::ChatOutcome, String> {
    let key = credentials::get().unwrap_or_default();
    Ok(ai::complete(&base_url, &key, &model, messages).await)
}
/// Lists models available from the provider's `/models` endpoint.
#[tauri::command]
async fn ai_list_models(base_url: String) -> Result<Vec<String>, String> {
    let key = credentials::get().unwrap_or_default();
    ai::list_models(&base_url, &key).await
}


/// Saves the API key to the OS credential store; an empty key clears it.
#[tauri::command]
async fn set_api_key(key: String) -> Result<(), String> {
    credentials::set(&key)
}

/// Whether a key is stored, without returning it to the webview.
#[tauri::command]
async fn has_api_key() -> Result<bool, String> {
    Ok(credentials::has())
}

/// Silences a ring started by the backend (window hidden or in the tray).
#[tauri::command]
async fn stop_alarm_sound(app: tauri::AppHandle) -> Result<(), String> {
    alarm_sound::stop();
    hourglass::stop_animation(&app);
    Ok(())
}

/// Id of the alarm still ringing, so a window opened late still shows the
/// takeover for an alarm that started while it was hidden.
#[tauri::command]
async fn ringing_alarm_id(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let id = alarm_sound::ringing_id();
    if id.is_some() {
        hourglass::start_animation(&app);
    }
    Ok(id)
}

/// Pushes the user's alarm audio preferences down to the backend.
#[tauri::command]
async fn set_alarm_audio_prefs(
    app: tauri::AppHandle,
    volume: Option<f32>,
    enabled: Option<bool>,
    profile: Option<String>,
    custom_path: Option<String>,
    #[allow(non_snake_case)]
    customPath: Option<String>,
) -> Result<(), String> {
    let custom = custom_path.or(customPath);
    alarm_sound::set_prefs_and_persist(&app, volume, enabled, profile, custom)?;
    let p = alarm_sound::get_prefs(Some(&app));
    scheduler::set_audio_prefs(p.volume, p.enabled);
    Ok(())
}

#[tauri::command]
async fn get_alarm_audio_prefs(app: tauri::AppHandle) -> Result<alarm_sound::AlarmAudioPrefs, String> {
    Ok(alarm_sound::get_prefs(Some(&app)))
}

#[tauri::command]
async fn list_alarm_sound_profiles() -> Result<Vec<alarm_sound::AlarmSoundProfileDesc>, String> {
    Ok(alarm_sound::list_profiles())
}

#[tauri::command]
async fn preview_alarm_sound(
    profile: Option<String>,
    custom_path: Option<String>,
    #[allow(non_snake_case)]
    customPath: Option<String>,
    volume: Option<f32>,
) -> Result<(), String> {
    let custom = custom_path.or(customPath);
    alarm_sound::preview(profile.as_deref(), custom.as_deref(), volume)
}

#[tauri::command]
async fn pick_alarm_sound_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Audio Files", &["mp3", "wav", "flac", "ogg", "m4a", "aac"])
        .pick_file(move |file_path| {
            let res = file_path.map(|p| p.to_string());
            let _ = tx.send(res);
        });
    rx.await.map_err(|e| format!("dialog cancelled or failed: {e}"))
}
use msedge_tts::{tts::client::connect, tts::SpeechConfig, voice::{get_voices_list, Voice}};

static AUDIO_CACHE: OnceLock<Mutex<HashMap<String, String>>> = OnceLock::new();
static VOICES_CACHE: OnceLock<Mutex<Option<Vec<Voice>>>> = OnceLock::new();

fn get_or_fetch_voices() -> Result<Vec<Voice>, String> {
    let cell = VOICES_CACHE.get_or_init(|| Mutex::new(None));
    let mut guard = cell.lock().map_err(|e| format!("Voices lock error: {e}"))?;
    if let Some(voices) = &*guard {
        return Ok(voices.clone());
    }
    let voices = get_voices_list().map_err(|e| format!("Failed to fetch voices: {e}"))?;
    *guard = Some(voices.clone());
    Ok(voices)
}

#[tauri::command]
async fn synthesize_speech(text: String, voice_id: String) -> Result<String, String> {
    let mut hasher = DefaultHasher::new();
    text.hash(&mut hasher);
    let text_hash = hasher.finish();
    let cache_key = format!("{voice_id}::{text_hash:x}");

    let cache_mutex = AUDIO_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    if let Ok(guard) = cache_mutex.lock() {
        if let Some(cached_data) = guard.get(&cache_key) {
            return Ok(cached_data.clone());
        }
    }

    let audio_uri = tauri::async_runtime::spawn_blocking(move || {
        let voices = get_or_fetch_voices()?;
        
        // Match voice by ID or name substring
        let target_voice = voices
            .iter()
            .find(|v| {
                v.name.contains(&voice_id)
                    || v.short_name.as_deref().is_some_and(|s| s.contains(&voice_id))
            })
            .or_else(|| {
                if voice_id.contains("Jenny") {
                    voices.iter().find(|v| v.name.contains("JennyNeural"))
                } else if voice_id.contains("Guy") {
                    voices.iter().find(|v| v.name.contains("GuyNeural"))
                } else if voice_id.contains("Dmitry") {
                    voices.iter().find(|v| v.name.contains("DmitryNeural"))
                } else if voice_id.contains("Svetlana") {
                    voices.iter().find(|v| v.name.contains("SvetlanaNeural"))
                } else {
                    None
                }
            })
            .ok_or_else(|| format!("Voice {voice_id} not found in Edge TTS voice catalog"))?;

        let config = SpeechConfig::from(target_voice);
        let mut client = connect().map_err(|e| format!("WebSocket connect failed: {e}"))?;
        let audio = client
            .synthesize(&text, &config)
            .map_err(|e| format!("Synthesis failed: {e}"))?;

        if audio.audio_bytes.is_empty() {
            return Err("Synthesized 0 bytes".to_string());
        }

        let b64 = base64::engine::general_purpose::STANDARD.encode(&audio.audio_bytes);
        Ok(format!("data:audio/mp3;base64,{b64}"))
    })
    .await
    .map_err(|e| format!("Task join error: {e}"))??;

    if let Ok(mut guard) = cache_mutex.lock() {
        guard.insert(cache_key, audio_uri.clone());
    }

    Ok(audio_uri)
}

#[tauri::command]
async fn set_companion_mode(app: tauri::AppHandle, open: bool) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        let new_width = if open { 680.0 } else { 340.0 };
        let _ = win.set_size(tauri::LogicalSize::new(new_width, 480.0));
    }
    Ok(())
}

/// Shows or hides the compact always-on-top mini overlay.
#[tauri::command]
async fn toggle_mini_overlay(app: tauri::AppHandle, open: Option<bool>) -> Result<(), String> {
    const LABEL: &str = "mini-overlay";

    let should_close = match open {
        Some(true) => false,
        Some(false) => true,
        None => app.get_webview_window(LABEL).is_some(),
    };

    if should_close {
        if let Some(win) = app.get_webview_window(LABEL) {
            let _ = win.close();
        }
        return Ok(());
    }

    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.show();
        let _ = win.set_focus();
        return Ok(());
    }

    // Anchor bottom-right of the primary monitor so it never covers the main dial.
    let (x, y) = if let Some(main) = app.get_webview_window("main") {
        match (main.primary_monitor(), main.outer_position()) {
            (Ok(Some(monitor)), Ok(_)) => {
                let size = monitor.size();
                let scale = monitor.scale_factor();
                let logical_w = size.width as f64 / scale;
                let logical_h = size.height as f64 / scale;
                (logical_w - 220.0, logical_h - 120.0)
            }
            _ => (40.0, 40.0),
        }
    } else {
        (40.0, 40.0)
    };

    tauri::WebviewWindowBuilder::new(
        &app,
        LABEL,
        tauri::WebviewUrl::App("index.html?window=mini-overlay".into()),
    )
    .title("Tempo — Мини")
    .inner_size(200.0, 100.0)
    .position(x, y)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .build()
    .map_err(|e| format!("Failed to create mini overlay: {e}"))?;

    Ok(())
}

/// Registers process-wide shortcuts so the timer can be driven from any app.
///
/// These act on the backend timer directly. They used to emit events into the
/// webview, which meant they did nothing at all unless the Timer sub-tab
/// happened to be mounted.
#[tauri::command]
async fn register_shortcuts(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

    let mut bound = 0usize;

    let timer_bindings: Vec<(Shortcut, fn())> = vec![
        (Shortcut::new(Some(Modifiers::ALT), Code::KeyS), || {
            if timer::snapshot().running {
                timer::pause();
            } else {
                timer::start();
            }
        }),
        (Shortcut::new(Some(Modifiers::ALT), Code::KeyR), timer::reset),
        (Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyU), || {
            timer::shift_minutes(5)
        }),
        (Shortcut::new(Some(Modifiers::ALT | Modifiers::SHIFT), Code::KeyD), || {
            timer::shift_minutes(-5)
        }),
    ];

    for (shortcut, action) in timer_bindings {
        match app.global_shortcut().on_shortcut(shortcut, move |app, _shortcut, press| {
            if press.state() == ShortcutState::Pressed {
                action();
                let _ = app.emit("timer://changed", ());
            }
        }) {
            Ok(()) => bound += 1,
            Err(e) => eprintln!("shortcut unavailable: {e}"),
        }
    }

    if bound == 0 {
        return Err("no global shortcuts could be bound".to_string());
    }
    Ok(())
}

/// Replaces the alarm schedule enforced by the backend.
#[tauri::command]
async fn sync_alarms(alarms: Vec<ScheduledAlarm>) -> Result<(), String> {
    scheduler::sync(alarms);
    Ok(())
}

/// Deletes an alarm's pending state and silences it.
#[tauri::command]
async fn snooze_alarm(app: tauri::AppHandle, id: String, minutes: u32) -> Result<(), String> {
    alarm_sound::stop();
    hourglass::stop_animation(&app);
    scheduler::snooze(&id, minutes);
    Ok(())
}

/// Marks an alarm as acknowledged.
#[tauri::command]
async fn dismiss_alarm(app: tauri::AppHandle, id: String) -> Result<(), String> {
    // The backend may be the one ringing (window hidden); silencing it here is
    // what makes Stop work when the webview never saw the alarm.
    alarm_sound::stop();
    hourglass::stop_animation(&app);
    scheduler::dismiss(&id);
    Ok(())
}

/// Previews the next occurrences for a list of alarms.
#[tauri::command]
async fn alarm_preview(
    alarms: Vec<ScheduledAlarm>,
    count: Option<usize>,
) -> Result<Vec<scheduler::AlarmPreview>, String> {
    Ok(scheduler::alarm_preview(alarms, count))
}

/// Resolves the directory the data file lives in.
///
/// A portable build keeps everything next to the executable: the app detects
/// either the `ALARMER_PORTABLE` environment variable or a `portable` marker
/// file beside the binary, and then writes `alarmer.json` into a `data` folder
/// there instead of the per-user application data directory.
/// Checks if a directory contains a portable marker.
pub fn has_portable_marker_in(dir: &std::path::Path) -> bool {
    dir.join("portable").exists() || dir.join(".portable").exists()
}

/// Resolves the application data root based on portable state and directories.
/// When portable is true, returns `<exe_dir>/data`.
/// When portable is false, returns `<os_dir>`.
pub fn resolve_data_root_dir(
    exe_dir: &std::path::Path,
    os_dir: &std::path::Path,
    is_portable: bool,
) -> std::path::PathBuf {
    if is_portable {
        exe_dir.join("data")
    } else {
        os_dir.to_path_buf()
    }
}

/// Resolves the application data root given an explicit portable flag,
/// an executable directory getter, and an OS app data directory getter.
pub fn resolve_data_root_with<FExe, FOs>(
    portable: bool,
    get_exe_dir: FExe,
    get_os_dir: FOs,
) -> Result<std::path::PathBuf, String>
where
    FExe: FnOnce() -> Result<std::path::PathBuf, String>,
    FOs: FnOnce() -> Result<std::path::PathBuf, String>,
{
    let dir = if portable {
        let exe_dir = get_exe_dir()?;
        exe_dir.join("data")
    } else {
        get_os_dir()?
    };
    let _ = std::fs::create_dir_all(&dir);
    Ok(dir)
}

/// The single function that resolves the application's data root:
/// beside the executable when running portable, otherwise the OS app-data directory.
pub fn app_data_root(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    resolve_data_root_with(
        is_portable_running(),
        || {
            let exe = std::env::current_exe()
                .map_err(|e| format!("cannot locate the running executable: {e}"))?;
            let parent = exe
                .parent()
                .ok_or_else(|| "running executable has no parent directory".to_string())?;
            Ok(parent.to_path_buf())
        },
        || {
            app.path()
                .app_data_dir()
                .map_err(|e| format!("no app data dir: {e}"))
        },
    )
}

#[tauri::command]
async fn store_dir(app: tauri::AppHandle) -> Result<String, String> {
    app_data_root(&app).map(|p| p.to_string_lossy().into_owned())
}

/// True when this process is running as a standalone portable application.
///
/// Returns true if:
/// 1. `ALARMER_PORTABLE` or `TEMPO_PORTABLE` environment variable is set, or
/// 2. An explicit `portable` or `.portable` marker file exists beside the executable, or
/// 3. The executable is running outside standard system install directories
///    (not in `Program Files`, `Program Files (x86)`, or `AppData\Local\Programs`).
pub fn is_portable_running() -> bool {
    if std::env::var_os("ALARMER_PORTABLE").is_some() || std::env::var_os("TEMPO_PORTABLE").is_some() {
        return true;
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            if has_portable_marker_in(dir) {
                return true;
            }
        }
        let exe_str = exe.to_string_lossy().to_lowercase();
        // Check Windows standard installation directories
        let in_program_files = exe_str.contains("program files");
        let in_appdata_programs = exe_str.contains(r"appdata\local\programs");
        if !in_program_files && !in_appdata_programs {
            return true;
        }
    }
    false
}

/// Kept for backwards compatibility.
pub fn has_portable_marker() -> bool {
    is_portable_running()
}


/// Passed to the executable when the OS starts it, so the app can come up in the
/// tray instead of throwing a window at someone who has not asked for one.
const START_MINIMIZED_FLAG: &str = "--minimized";

fn started_minimized() -> bool {
    std::env::args().any(|arg| arg == START_MINIMIZED_FLAG)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Both `aws-lc-rs` and `ring` are compiled into the dependency graph (the
    // TTS client and reqwest each pull one), so rustls cannot pick a provider
    // on its own and panics on the first HTTPS request — which would break every
    // AI call at runtime while all tests still passed. Name one explicitly.
    if rustls::crypto::ring::default_provider()
        .install_default()
        .is_err()
    {
        // Already installed by another initialiser; nothing to do.
    }

    tauri::Builder::default()
        .manage(storage::DbState(std::sync::Mutex::new(None)))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(recording::RecordingManager::new())
        .plugin(tauri_plugin_notification::init())
        .register_asynchronous_uri_scheme_protocol(media_protocol::SCHEME_NAME, |ctx, req, resp| {
            media_protocol::handle_uri_scheme(ctx.app_handle(), req, resp);
        })
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // The settings screen promises the app starts in the tray, so the
            // login entry has to say so — otherwise logging in pops a window.
            Some(vec![START_MINIMIZED_FLAG]),
        ))
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        // The updater checks our own GitHub releases for a newer signed build;
        // `process` is what lets the app relaunch into the installed version.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            synthesize_speech,
            set_companion_mode,
            sync_alarms,
            snooze_alarm,
            dismiss_alarm,
            alarm_preview,
            stop_alarm_sound,
            ringing_alarm_id,
            set_alarm_audio_prefs,
            get_alarm_audio_prefs,
            list_alarm_sound_profiles,
            preview_alarm_sound,
            pick_alarm_sound_file,
            ai_complete,
            ai_list_models,
            set_api_key,
            has_api_key,
            store_dir,
            is_portable_build,
            portable_stage_update,
            portable_check_update,
            portable_update_ready,
            portable_apply_update,
            timer::timer_set_duration,
            timer::timer_start,
            timer::timer_pause,
            timer::timer_reset,
            timer::timer_shift_minutes,
            timer::timer_set_mode,
            timer::timer_set_pomodoro_settings,
            timer::timer_skip_phase,
            timer::timer_get_state,
            register_shortcuts,
            toggle_mini_overlay,
            storage::db_path,
            storage::db_ready,
            storage::db_list,
            storage::db_get,
            storage::db_insert,
            storage::db_update,
            storage::db_delete,
            storage::db_changed_since,
            storage::db_pref_get,
            storage::db_pref_set,
            storage::db_search,
            storage::db_reindex,
            storage::links_set,
            storage::links_backlinks,
            storage::load_legacy_store,
            storage::asset_save,
            storage::asset_delete,
            storage::asset_usage,
            storage::asset_stat,
            storage::asset_prune,
            storage::db_note_by_path,
            vault::vault_root,
            vault::vault_set_root,
            vault::vault_pick_folder,
            vault::vault_list,
            vault::vault_read,
            vault::vault_write,
            vault::vault_create,
            vault::vault_rename,
            vault::vault_delete,
            vault::vault_mkdir,
            vault::vault_daily,
            vault::vault_open,
            recording::recording_devices,
            recording::recording_sources,
            recording::recording_start,
            recording::recording_pause,
            recording::recording_resume,
            recording::recording_stop,
            recording::recording_cancel,
            recording::recording_state,
            recording::recording_level,
            recording::recording_preview,
            stt::stt_catalog,
            stt::stt_download,
            stt::stt_download_cancel,
            stt::stt_model_delete,
            stt::stt_download_progress,
            stt::stt_engine,
            stt::stt_set_engine,
            stt::stt_start_dictation,
            stt::stt_stop_dictation,
            stt::stt_cancel_dictation,
            stt::stt_dictation_state,
            stt::stt_transcribe_file,
            stt::stt_transcribe_cloud,
            stt::stt_rescan_models,
            stt::stt_import_model,
            stt::stt_models_dir,
            stt::stt_open_models_dir,
            stt::stt_free_disk_space,
            stt::stt_speech_settings,
            stt::stt_apply_speech_settings,
            stt::stt_validate_hotkey,
            stt::stt_suspend_shortcuts,
            stt::stt_resume_shortcuts,
            stt::stt_input_devices,
            stt::stt_input_channels,
            stt::stt_output_devices,
            stt::stt_play_test_sound,
            stt::stt_mic_level,
            stt::stt_history_list,
            stt::stt_history_delete,
            stt::stt_history_set_saved,
            stt::stt_history_retry,
            stt::stt_history_clear,
            stt::stt_postprocess,
            stt::stt_cancel_transcription,
            stt::stt_accelerators,
            sync::sync_status,
            sync::sync_set_transport,
            sync::sync_set_media,
            sync::sync_now,
            sync::sync_pending,
        ])
        .setup(|app| {
            // Build Tray Menu
            let show_i = MenuItem::with_id(app, "show", "Показать Tempo", true, None::<&str>)?;
            let hide_i = MenuItem::with_id(app, "hide", "Скрыть в трей", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Выход", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &hide_i, &quit_i])?;

            let default_icon = app.default_window_icon().cloned();

            // Setup Tray Icon
            let mut builder = TrayIconBuilder::with_id(hourglass::TRAY_ID)
                .menu(&menu)
                .tooltip("Tempo — Умный таймер");
            let hourglass_bytes = include_bytes!("../icons/icon.ico");
            if let Ok(icon) = tauri::image::Image::from_bytes(hourglass_bytes) {
                builder = builder.icon(icon.clone());
                if let Some(win) = app.get_webview_window("main") {
                    let _ = win.set_icon(icon);
                }
            } else if let Some(icon) = default_icon {
                builder = builder.icon(icon);
            }

            let _tray = builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                    "hide" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.hide();
                        }
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build(app)?;

            // Alarms must fire even with the window hidden or another tab open.
            scheduler::spawn(app.handle().clone());

            // The timer tick loop outlives any screen it is displayed on.
            timer::spawn(app.handle().clone());

            // Flip the hourglass tray icon while an alarm is ringing
            let app_handle = app.handle().clone();
            let _ = app.listen("alarm://fired", move |_| {
                hourglass::start_animation(&app_handle);
            });
            if alarm_sound::ringing_id().is_some() {
                hourglass::start_animation(app.handle());
            }

            // Started by the OS at login: come up in the tray, as promised, and
            // let the scheduler wake the window when an alarm actually rings.
            if started_minimized() {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            // Timer control from any application, no window focus needed.
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = register_shortcuts(handle).await {
                    eprintln!("global shortcuts unavailable: {e}");
                }
            });
            let data_dir = stt::resolve_data_dir(app.handle());
            let stt_state = stt::SttState::new(data_dir);
            stt_state.models.set_app_handle(app.handle().clone());

            let driver = stt::TempoDictationDriver {
                app: app.handle().clone(),
                models: std::sync::Arc::clone(&stt_state.models),
                engine: std::sync::Arc::clone(&stt_state.engine),
                capture_state: std::sync::Arc::clone(&stt_state.capture_state),
                current_capture: std::sync::Arc::clone(&stt_state.current_capture),
                recording_started_at: std::sync::Arc::clone(&stt_state.recording_started_at),
                level_stop: std::sync::Arc::clone(&stt_state.level_stop),
            };
            let coordinator = stt::TranscriptionCoordinator::new(driver);
            app.manage(coordinator);
            app.manage(stt_state);

            let speech_cfg = stt::load_speech_config(app.handle());
            if speech_cfg.enabled {
                let bindings = stt::SpeechBindings {
                    transcribe: speech_cfg.hotkey,
                    cancel: speech_cfg.cancel_hotkey,
                };
                if let Err(e) = stt::shortcuts::apply_bindings(app.handle(), &bindings) {
                    eprintln!("[stt] Failed to register speech shortcuts on startup: {e}");
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod portable_resolver_tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn test_portable_resolver_returns_exe_dir_when_marker_present_and_os_dir_otherwise() {
        let tmp = tempdir().unwrap();
        let exe_dir = tmp.path().join("bin");
        let os_dir = tmp.path().join("os_appdata");
        std::fs::create_dir_all(&exe_dir).unwrap();
        std::fs::create_dir_all(&os_dir).unwrap();

        // 1. Without marker and not portable -> returns OS dir
        assert!(!has_portable_marker_in(&exe_dir));
        let root_os = resolve_data_root_dir(&exe_dir, &os_dir, false);
        assert_eq!(root_os, os_dir);

        // Assets and models paths built from it
        let assets_os = crate::storage::assets::assets_root_dir(&root_os);
        let models_os = root_os.join("models");
        let vault_os = root_os.join("vault");
        assert_eq!(assets_os, os_dir.join("assets"));
        assert_eq!(models_os, os_dir.join("models"));
        assert_eq!(vault_os, os_dir.join("vault"));

        // 2. With marker present in exe_dir -> returns exe_dir/data
        let marker = exe_dir.join("portable");
        std::fs::write(&marker, "").unwrap();
        assert!(has_portable_marker_in(&exe_dir));

        let is_portable = has_portable_marker_in(&exe_dir);
        let root_portable = resolve_data_root_dir(&exe_dir, &os_dir, is_portable);
        assert_eq!(root_portable, exe_dir.join("data"));

        let assets_port = crate::storage::assets::assets_root_dir(&root_portable);
        let models_port = root_portable.join("models");
        let vault_port = root_portable.join("vault");
        assert_eq!(assets_port, exe_dir.join("data").join("assets"));
        assert_eq!(models_port, exe_dir.join("data").join("models"));
        assert_eq!(vault_port, exe_dir.join("data").join("vault"));

        // 3. With dot-marker .portable -> also recognised
        std::fs::remove_file(&marker).unwrap();
        let dot_marker = exe_dir.join(".portable");
        std::fs::write(&dot_marker, "").unwrap();
        assert!(has_portable_marker_in(&exe_dir));
        let root_dot = resolve_data_root_dir(&exe_dir, &os_dir, has_portable_marker_in(&exe_dir));
        assert_eq!(root_dot, exe_dir.join("data"));
    }
}
