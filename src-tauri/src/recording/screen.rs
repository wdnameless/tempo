use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use crate::recording::{RecordingError, SourceInfo};

#[cfg(windows)]
use windows_capture::{
    capture::{CaptureControl, Context, GraphicsCaptureApiHandler},
    encoder::{
        AudioSettingsBuilder, ContainerSettingsBuilder, ImageFormat, VideoEncoder,
        VideoSettingsBuilder,
    },
    frame::Frame,
    graphics_capture_api::InternalCaptureControl,
    monitor::Monitor,
    settings::{ColorFormat, CursorCaptureSettings, DrawBorderSettings, Settings},
    window::Window,
};

/// Represents an active Screen recording session
pub struct ScreenRecordingSession {
    output_path: PathBuf,
    is_paused: Arc<AtomicBool>,
    should_stop: Arc<AtomicBool>,
    duration_tracker: Arc<Mutex<ScreenDurationTracker>>,
    #[cfg(windows)]
    capture_control: Option<CaptureControl<ScreenCaptureHandler, String>>,
    #[cfg(not(windows))]
    _phantom: std::marker::PhantomData<()>,
}

#[derive(Default)]
pub struct ScreenDurationTracker {
    pub accumulated_secs: f64,
    pub last_frame_instant: Option<std::time::Instant>,
}

impl ScreenDurationTracker {
    pub fn on_frame(&mut self, is_paused: bool) {
        let now = std::time::Instant::now();
        if let Some(prev) = self.last_frame_instant {
            let delta = now.duration_since(prev).as_secs_f64();
            if !is_paused {
                self.accumulated_secs += delta;
            }
        }
        self.last_frame_instant = Some(now);
    }
}

impl ScreenRecordingSession {
    #[cfg(windows)]
    pub fn start(output_path: PathBuf, source_id: &str) -> Result<Self, RecordingError> {
        let is_paused = Arc::new(AtomicBool::new(false));
        let should_stop = Arc::new(AtomicBool::new(false));
        let duration_tracker = Arc::new(Mutex::new(ScreenDurationTracker::default()));

        let is_paused_clone = Arc::clone(&is_paused);
        let should_stop_clone = Arc::clone(&should_stop);
        let duration_clone = Arc::clone(&duration_tracker);

        // Find target source (monitor or window)
        let parts: Vec<&str> = source_id.splitn(2, ':').collect();
        if parts.len() < 2 {
            return Err(RecordingError::NoDevice(format!("Invalid source id: {source_id}")));
        }

        let kind = parts[0];
        let id_val = parts[1];

        let capture_control = if kind == "monitor" {
            let monitors = Monitor::enumerate()
                .map_err(|e| RecordingError::NoDevice(format!("Failed to enumerate monitors: {e}")))?;
            let monitor = monitors
                .into_iter()
                .find(|m| m.device_name().map(|n| n == id_val).unwrap_or(false))
                .ok_or_else(|| RecordingError::NoDevice(format!("Monitor '{id_val}' not found")))?;

            let flags = ScreenCaptureFlags {
                output_path: output_path.clone(),
                is_paused: is_paused_clone,
                should_stop: should_stop_clone,
                duration_tracker: duration_clone,
            };

            let settings = Settings::new(
                monitor,
                CursorCaptureSettings::WithCursor,
                DrawBorderSettings::WithoutBorder,
                windows_capture::settings::SecondaryWindowSettings::Default,
                windows_capture::settings::MinimumUpdateIntervalSettings::Default,
                windows_capture::settings::DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            );

            ScreenCaptureHandler::start_free_threaded(settings)
                .map_err(|e| RecordingError::DeviceBusy(format!("Failed to start screen capture: {e}")))?
        } else if kind == "window" {
            let windows = Window::enumerate()
                .map_err(|e| RecordingError::NoDevice(format!("Failed to enumerate windows: {e}")))?;
            let window = windows
                .into_iter()
                .find(|w| {
                    let title = w.title().unwrap_or_default();
                    let pid = w.process_id().unwrap_or(0);
                    let wid = format!("{pid}_{title}");
                    wid == id_val
                })
                .ok_or_else(|| RecordingError::NoDevice(format!("Window '{id_val}' not found")))?;

            let flags = ScreenCaptureFlags {
                output_path: output_path.clone(),
                is_paused: is_paused_clone,
                should_stop: should_stop_clone,
                duration_tracker: duration_clone,
            };

            let settings = Settings::new(
                window,
                CursorCaptureSettings::WithCursor,
                DrawBorderSettings::WithoutBorder,
                windows_capture::settings::SecondaryWindowSettings::Default,
                windows_capture::settings::MinimumUpdateIntervalSettings::Default,
                windows_capture::settings::DirtyRegionSettings::Default,
                ColorFormat::Bgra8,
                flags,
            );

            ScreenCaptureHandler::start_free_threaded(settings)
                .map_err(|e| RecordingError::DeviceBusy(format!("Failed to start window capture: {e}")))?
        } else {
            return Err(RecordingError::NoDevice(format!("Unknown source kind: {kind}")));
        };

        Ok(Self {
            output_path,
            is_paused,
            should_stop,
            duration_tracker,
            capture_control: Some(capture_control),
        })
    }

    #[cfg(not(windows))]
    pub fn start(_output_path: PathBuf, _source_id: &str) -> Result<Self, RecordingError> {
        Err(RecordingError::Unsupported("Screen recording is only supported on Windows".to_string()))
    }

    pub fn pause(&self) {
        self.is_paused.store(true, Ordering::SeqCst);
    }

    pub fn resume(&self) {
        self.is_paused.store(false, Ordering::SeqCst);
    }

    pub fn is_paused(&self) -> bool {
        self.is_paused.load(Ordering::SeqCst)
    }

    pub fn duration_sec(&self) -> f64 {
        self.duration_tracker.lock().unwrap().accumulated_secs
    }

    pub fn stop(mut self) -> Result<(PathBuf, f64), RecordingError> {
        self.should_stop.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        if let Some(control) = self.capture_control.take() {
            let _ = control.stop();
        }
        let duration = self.duration_tracker.lock().unwrap().accumulated_secs;
        Ok((self.output_path, duration))
    }

    pub fn cancel(mut self) -> Result<(), RecordingError> {
        self.should_stop.store(true, Ordering::SeqCst);
        #[cfg(windows)]
        if let Some(control) = self.capture_control.take() {
            let _ = control.stop();
        }
        if self.output_path.exists() {
            let _ = std::fs::remove_file(&self.output_path);
        }
        Ok(())
    }
}

pub struct ScreenCaptureFlags {
    pub output_path: PathBuf,
    pub is_paused: Arc<AtomicBool>,
    pub should_stop: Arc<AtomicBool>,
    pub duration_tracker: Arc<Mutex<ScreenDurationTracker>>,
}

#[cfg(windows)]
pub struct ScreenCaptureHandler {
    encoder: Option<VideoEncoder>,
    flags: ScreenCaptureFlags,
}

#[cfg(windows)]
impl GraphicsCaptureApiHandler for ScreenCaptureHandler {
    type Flags = ScreenCaptureFlags;
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        Ok(Self {
            encoder: None,
            flags: ctx.flags,
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if self.flags.should_stop.load(Ordering::SeqCst) {
            if let Some(encoder) = self.encoder.take() {
                let _ = encoder.finish();
            }
            capture_control.stop();
            return Ok(());
        }

        let is_paused = self.flags.is_paused.load(Ordering::SeqCst);
        self.flags.duration_tracker.lock().unwrap().on_frame(is_paused);

        if is_paused {
            return Ok(());
        }

        // Initialize encoder on first frame with exact dimensions
        if self.encoder.is_none() {
            let width = frame.width();
            let height = frame.height();
            let out_str = self.flags.output_path.to_string_lossy().to_string();

            let video_settings = VideoSettingsBuilder::new(width, height)
                .bitrate(6_000_000)
                .frame_rate(30);

            let audio_settings = AudioSettingsBuilder::default().disabled(true);
            let container_settings = ContainerSettingsBuilder::default();

            let enc = VideoEncoder::new(
                video_settings,
                audio_settings,
                container_settings,
                out_str,
            )
            .map_err(|e| e.to_string())?;

            self.encoder = Some(enc);
        }

        if let Some(ref mut encoder) = self.encoder {
            let _ = encoder.send_frame(frame);
        }

        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        if let Some(encoder) = self.encoder.take() {
            let _ = encoder.finish();
        }
        Ok(())
    }
}

/// Lists display monitors and top-level windows excluding Tempo
pub fn list_screen_sources() -> Result<Vec<SourceInfo>, RecordingError> {
    #[cfg(windows)]
    {
        let mut sources = Vec::new();

        let primary_name = Monitor::primary().ok().and_then(|m| m.device_name().ok());
        if let Ok(monitors) = Monitor::enumerate() {
            for (idx, m) in monitors.into_iter().enumerate() {
                let name = m.device_name().unwrap_or_else(|_| format!("Display {}", idx + 1));
                let width = m.width().unwrap_or(1920);
                let height = m.height().unwrap_or(1080);
                let id = format!("monitor:{name}");
                let is_primary = primary_name.as_deref() == Some(&name) || (primary_name.is_none() && idx == 0);
                sources.push(SourceInfo {
                    id,
                    name: format!("Display {} ({name})", idx + 1),
                    kind: "monitor".to_string(),
                    width,
                    height,
                    is_primary,
                });
            }
        }

        // Windows (excluding our own app process)
        let current_pid = std::process::id();
        if let Ok(windows) = Window::enumerate() {
            for w in windows {
                let pid = w.process_id().unwrap_or(0);
                if pid == current_pid {
                    continue;
                }

                let title = w.title().unwrap_or_default().trim().to_string();
                if title.is_empty() {
                    continue;
                }

                // Check window bounds
                let rect = w.rect().unwrap_or_default();
                let width = (rect.right - rect.left).max(0) as u32;
                let height = (rect.bottom - rect.top).max(0) as u32;
                if width < 50 || height < 50 {
                    continue;
                }

                let id = format!("window:{pid}_{title}");
                sources.push(SourceInfo {
                    id,
                    name: title,
                    kind: "window".to_string(),
                    width: rect.right.saturating_sub(rect.left) as u32,
                    height: rect.bottom.saturating_sub(rect.top) as u32,
                    is_primary: false,
                });
            }
        }

        Ok(sources)
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

/// Grabs a single preview PNG frame of the source
pub fn capture_preview_frame(source_id: &str, output_png_path: &Path) -> Result<PathBuf, RecordingError> {
    #[cfg(windows)]
    {
        let parts: Vec<&str> = source_id.splitn(2, ':').collect();
        if parts.len() < 2 {
            return Err(RecordingError::NoDevice(format!("Invalid source id: {source_id}")));
        }

        let kind = parts[0];
        let id_val = parts[1];

        let out_path = output_png_path.to_path_buf();
        let out_path_str = out_path.to_string_lossy().to_string();

        let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();

        if kind == "monitor" {
            let monitors = Monitor::enumerate()
                .map_err(|e| RecordingError::NoDevice(format!("Failed to enumerate monitors: {e}")))?;
            let monitor = monitors
                .into_iter()
                .find(|m| m.device_name().map(|n| n == id_val).unwrap_or(false))
                .ok_or_else(|| RecordingError::NoDevice(format!("Monitor '{id_val}' not found")))?;

            let settings = Settings::new(
                monitor,
                CursorCaptureSettings::WithoutCursor,
                DrawBorderSettings::WithoutBorder,
                windows_capture::settings::SecondaryWindowSettings::Default,
                windows_capture::settings::MinimumUpdateIntervalSettings::Default,
                windows_capture::settings::DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                (out_path_str, tx),
            );

            PreviewHandler::start_free_threaded(settings)
                .map_err(|e| RecordingError::DeviceBusy(format!("Failed to capture preview: {e}")))?;
        } else if kind == "window" {
            let windows = Window::enumerate()
                .map_err(|e| RecordingError::NoDevice(format!("Failed to enumerate windows: {e}")))?;
            let window = windows
                .into_iter()
                .find(|w| {
                    let title = w.title().unwrap_or_default();
                    let pid = w.process_id().unwrap_or(0);
                    let wid = format!("{pid}_{title}");
                    wid == id_val
                })
                .ok_or_else(|| RecordingError::NoDevice(format!("Window '{id_val}' not found")))?;

            let settings = Settings::new(
                window,
                CursorCaptureSettings::WithoutCursor,
                DrawBorderSettings::WithoutBorder,
                windows_capture::settings::SecondaryWindowSettings::Default,
                windows_capture::settings::MinimumUpdateIntervalSettings::Default,
                windows_capture::settings::DirtyRegionSettings::Default,
                ColorFormat::Rgba8,
                (out_path_str, tx),
            );

            PreviewHandler::start_free_threaded(settings)
                .map_err(|e| RecordingError::DeviceBusy(format!("Failed to capture preview: {e}")))?;
        } else {
            return Err(RecordingError::NoDevice(format!("Unknown source kind: {kind}")));
        }

        // Wait for preview capture to complete (with timeout)
        match rx.recv_timeout(std::time::Duration::from_secs(3)) {
            Ok(Ok(())) => Ok(out_path),
            Ok(Err(e)) => Err(RecordingError::DeviceBusy(e)),
            Err(_) => Err(RecordingError::DeviceBusy("Preview capture timed out".to_string())),
        }
    }

    #[cfg(not(windows))]
    {
        let _ = (source_id, output_png_path);
        Err(RecordingError::Unsupported("Screen preview is only supported on Windows".to_string()))
    }
}

#[cfg(windows)]
struct PreviewHandler {
    out_path: String,
    tx: Option<std::sync::mpsc::Sender<Result<(), String>>>,
}

#[cfg(windows)]
impl GraphicsCaptureApiHandler for PreviewHandler {
    type Flags = (String, std::sync::mpsc::Sender<Result<(), String>>);
    type Error = String;

    fn new(ctx: Context<Self::Flags>) -> Result<Self, Self::Error> {
        let (out_path, tx) = ctx.flags;
        Ok(Self {
            out_path,
            tx: Some(tx),
        })
    }

    fn on_frame_arrived(
        &mut self,
        frame: &mut Frame,
        capture_control: InternalCaptureControl,
    ) -> Result<(), Self::Error> {
        if let Some(tx) = self.tx.take() {
            let mut buf = match frame.buffer() {
                Ok(b) => b,
                Err(e) => {
                    let _ = tx.send(Err(e.to_string()));
                    capture_control.stop();
                    return Ok(());
                }
            };

            let res = buf.save_as_image(&self.out_path, ImageFormat::Png);
            let _ = tx.send(res.map_err(|e| e.to_string()));
        }

        capture_control.stop();
        Ok(())
    }

    fn on_closed(&mut self) -> Result<(), Self::Error> {
        if let Some(tx) = self.tx.take() {
            let _ = tx.send(Err("Capture closed before frame received".to_string()));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_screen_duration_tracker_active_and_paused() {
        let mut tracker = ScreenDurationTracker::default();
        tracker.on_frame(false);
        std::thread::sleep(std::time::Duration::from_millis(50));
        tracker.on_frame(false);
        assert!(tracker.accumulated_secs >= 0.04);

        let before = tracker.accumulated_secs;
        std::thread::sleep(std::time::Duration::from_millis(50));
        tracker.on_frame(true); // Paused frame
        assert_eq!(tracker.accumulated_secs, before);
    }
}
