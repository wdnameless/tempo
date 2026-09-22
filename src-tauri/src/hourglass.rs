use std::f32::consts::PI;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};
use tauri::AppHandle;

pub const DEFAULT_SIZE: u32 = 32;
pub const TRAY_ID: &str = "main-tray";

static IS_ANIMATING: AtomicBool = AtomicBool::new(false);
static SHOULD_ANIMATE: AtomicBool = AtomicBool::new(false);

/// Returns true if the tray animation loop is currently running.
pub fn is_animator_running() -> bool {
    IS_ANIMATING.load(Ordering::SeqCst)
}

/// Returns true if tray animation has been requested and not yet stopped.
pub fn should_animate() -> bool {
    SHOULD_ANIMATE.load(Ordering::SeqCst)
}

/// Signals the animation loop to stop.
pub fn stop() {
    SHOULD_ANIMATE.store(false, Ordering::SeqCst);
}

#[derive(Clone, Copy)]
struct Point {
    x: f32,
    y: f32,
}

#[derive(Clone, Copy)]
struct Segment {
    a: Point,
    b: Point,
}

impl Segment {
    fn dist_to(&self, p: Point) -> f32 {
        let abx = self.b.x - self.a.x;
        let aby = self.b.y - self.a.y;
        let apx = p.x - self.a.x;
        let apy = p.y - self.a.y;
        let ab_len_sq = abx * abx + aby * aby;
        if ab_len_sq < 1e-6 {
            return (apx * apx + apy * apy).sqrt();
        }
        let t = ((apx * abx + apy * aby) / ab_len_sq).clamp(0.0, 1.0);
        let cx = self.a.x + t * abx;
        let cy = self.a.y + t * aby;
        let dx = p.x - cx;
        let dy = p.y - cy;
        (dx * dx + dy * dy).sqrt()
    }
}

fn sample_cubic_bezier(p0: Point, p1: Point, p2: Point, p3: Point, n: usize) -> Vec<Segment> {
    let mut segments = Vec::with_capacity(n);
    let mut prev = p0;
    for i in 1..=n {
        let t = i as f32 / n as f32;
        let inv_t = 1.0 - t;
        let x = inv_t * inv_t * inv_t * p0.x
            + 3.0 * inv_t * inv_t * t * p1.x
            + 3.0 * inv_t * t * t * p2.x
            + t * t * t * p3.x;
        let y = inv_t * inv_t * inv_t * p0.y
            + 3.0 * inv_t * inv_t * t * p1.y
            + 3.0 * inv_t * t * t * p2.y
            + t * t * t * p3.y;
        let curr = Point { x, y };
        segments.push(Segment { a: prev, b: curr });
        prev = curr;
    }
    segments
}

fn hourglass_segments() -> Vec<Segment> {
    let mut segs = Vec::new();
    // 1. Top bar: slightly imperfect horizontal line
    segs.extend(sample_cubic_bezier(
        Point { x: -0.50, y: -0.68 },
        Point { x: -0.16, y: -0.67 },
        Point { x: 0.18, y: -0.66 },
        Point { x: 0.50, y: -0.66 },
        8,
    ));
    // 2. Upper-right curve down to waist
    segs.extend(sample_cubic_bezier(
        Point { x: 0.50, y: -0.66 },
        Point { x: 0.35, y: -0.38 },
        Point { x: 0.14, y: -0.15 },
        Point { x: 0.01, y: -0.01 },
        8,
    ));
    // 3. Lower-right curve from waist to bottom-right
    segs.extend(sample_cubic_bezier(
        Point { x: 0.01, y: -0.01 },
        Point { x: 0.15, y: 0.20 },
        Point { x: 0.34, y: 0.50 },
        Point { x: 0.48, y: 0.80 },
        8,
    ));
    // 4. Bottom bar: slightly imperfect horizontal line
    segs.extend(sample_cubic_bezier(
        Point { x: 0.48, y: 0.80 },
        Point { x: 0.16, y: 0.81 },
        Point { x: -0.16, y: 0.82 },
        Point { x: -0.48, y: 0.82 },
        8,
    ));
    // 5. Lower-left curve up to waist
    segs.extend(sample_cubic_bezier(
        Point { x: -0.48, y: 0.82 },
        Point { x: -0.35, y: 0.50 },
        Point { x: -0.14, y: 0.20 },
        Point { x: -0.01, y: 0.01 },
        8,
    ));
    // 6. Upper-left curve from waist to top-left
    segs.extend(sample_cubic_bezier(
        Point { x: -0.01, y: 0.01 },
        Point { x: -0.14, y: -0.16 },
        Point { x: -0.36, y: -0.38 },
        Point { x: -0.50, y: -0.68 },
        8,
    ));
    segs
}

/// Rasterises the hand-drawn hourglass at `angle_rad` (in radians) into an RGBA buffer.
/// Uses anti-aliasing via 2x2 supersampling and line distance fields.
pub fn render_frame(angle_rad: f32, size: u32) -> Vec<u8> {
    let segments = hourglass_segments();
    let mut buffer = vec![0u8; (size * size * 4) as usize];
    let half_size = (size as f32) / 2.0;

    let cos_a = angle_rad.cos();
    let sin_a = angle_rad.sin();

    let stroke_r = 0.040;
    let feather = 1.2 / half_size;

    let subpixel_offsets = [-0.25f32, 0.25f32];

    for y in 0..size {
        for x in 0..size {
            let mut alpha_acc = 0.0f32;

            for &dy in &subpixel_offsets {
                for &dx in &subpixel_offsets {
                    let px = ((x as f32 + 0.5 + dx) - half_size) / half_size;
                    let py = ((y as f32 + 0.5 + dy) - half_size) / half_size;

                    // Inverse rotation by angle_rad
                    let u_rot = px * cos_a + py * sin_a;
                    let v_rot = -px * sin_a + py * cos_a;
                    let p_rot = Point { x: u_rot, y: v_rot };

                    let mut min_d = f32::MAX;
                    for seg in &segments {
                        let d = seg.dist_to(p_rot);
                        if d < min_d {
                            min_d = d;
                        }
                    }

                    let a = if min_d <= stroke_r {
                        1.0
                    } else if min_d >= stroke_r + feather {
                        0.0
                    } else {
                        1.0 - (min_d - stroke_r) / feather
                    };
                    alpha_acc += a;
                }
            }

            let avg_alpha = (alpha_acc / 4.0).clamp(0.0, 1.0);
            let idx = ((y * size + x) * 4) as usize;
            if avg_alpha > 0.001 {
                let alpha_byte = (avg_alpha * 255.0).round() as u8;
                buffer[idx] = 255;
                buffer[idx + 1] = 255;
                buffer[idx + 2] = 255;
                buffer[idx + 3] = alpha_byte;
            } else {
                buffer[idx] = 0;
                buffer[idx + 1] = 0;
                buffer[idx + 2] = 0;
                buffer[idx + 3] = 0;
            }
        }
    }

    buffer
}

/// Convenience wrapper converting the rasterised frame into a `tauri::image::Image`.
pub fn frame_image(angle_rad: f32) -> Result<tauri::image::Image<'static>, String> {
    let rgba = render_frame(angle_rad, DEFAULT_SIZE);
    Ok(tauri::image::Image::new_owned(rgba, DEFAULT_SIZE, DEFAULT_SIZE))
}

/// Starts animating the tray icon if not already running.
/// The animation runs while an alarm is ringing, rotating the hourglass 180° over ~1.2s.
/// When the alarm stops, resets the icon to 0° and exits.
pub fn start_animation(app: &AppHandle) {
    SHOULD_ANIMATE.store(true, Ordering::SeqCst);
    if IS_ANIMATING
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return; // Already animating; no thread leak
    }

    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        struct AnimationGuard;
        impl Drop for AnimationGuard {
            fn drop(&mut self) {
                IS_ANIMATING.store(false, Ordering::SeqCst);
            }
        }
        let _guard = AnimationGuard;

        let start_time = Instant::now();
        let flip_duration = Duration::from_millis(1200);

        while SHOULD_ANIMATE.load(Ordering::SeqCst) {
            let elapsed = start_time.elapsed();
            let progress = (elapsed.as_millis() % flip_duration.as_millis()) as f32
                / flip_duration.as_millis() as f32;
            let angle = progress * PI;

            if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
                if let Ok(icon) = frame_image(angle) {
                    let _ = tray.set_icon(Some(icon));
                }
            }

            tokio::time::sleep(Duration::from_millis(60)).await;
        }

        // Alarm stopped: restore to static 0° orientation
        if let Some(tray) = app_handle.tray_by_id(TRAY_ID) {
            if let Ok(icon) = frame_image(0.0) {
                let _ = tray.set_icon(Some(icon));
            }
        }
    });
}

/// Immediately resets the tray icon to 0° and signals the animator to stop,
/// unless an alarm is still actively ringing (e.g. stop_alarm_sound called by webview
/// to transfer audio playback to WebAudio).
pub fn stop_animation(app: &AppHandle) {
    if crate::scheduler::is_any_alarm_ringing() {
        return;
    }
    stop();
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        if let Ok(icon) = frame_image(0.0) {
            let _ = tray.set_icon(Some(icon));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_at_0_and_180_differ() {
        let f0 = render_frame(0.0, DEFAULT_SIZE);
        let f180 = render_frame(PI, DEFAULT_SIZE);
        assert_ne!(f0, f180, "frames at 0° and 180° must differ");
    }

    #[test]
    fn buffer_is_expected_size_and_fully_populated() {
        let f0 = render_frame(0.0, DEFAULT_SIZE);
        let expected_len = (DEFAULT_SIZE * DEFAULT_SIZE * 4) as usize;
        assert_eq!(f0.len(), expected_len, "buffer must match 32x32x4 size");

        let mut has_opaque = false;
        let mut has_transparent = false;
        for chunk in f0.as_chunks::<4>().0 {
            if chunk[3] > 200 {
                has_opaque = true;
            }
            if chunk[3] == 0 {
                has_transparent = true;
            }
        }
        assert!(has_opaque, "frame must contain drawn strokes (opaque pixels)");
        assert!(has_transparent, "frame must contain transparent background pixels");
    }

    #[test]
    fn rotation_maps_known_pixels_predictably() {
        let f0 = render_frame(0.0, DEFAULT_SIZE);
        let f180 = render_frame(PI, DEFAULT_SIZE);

        let get_alpha = |buf: &[u8], x: u32, y: u32| -> u8 {
            let idx = ((y * DEFAULT_SIZE + x) * 4 + 3) as usize;
            buf[idx]
        };

        // Center column is x = 16
        // At 0°, the top bar crosses near y = 5
        let center_x = DEFAULT_SIZE / 2;
        let top_row = 5;

        let a0 = get_alpha(&f0, center_x, top_row);
        let a180 = get_alpha(&f180, center_x, top_row);

        assert!(a0 > 100, "top row at center column must be solid in 0° frame, got alpha {a0}");
        assert_eq!(a180, 0, "top row at center column must be empty in 180° frame, got alpha {a180}");
    }

    #[test]
    fn animator_reports_not_running_when_no_alarm_rings() {
        // When no alarm is ringing, the animator must report false
        assert!(!is_animator_running(), "animator must report not running when idle");
    }

    #[test]
    fn frame_image_produces_valid_image() {
        let img = frame_image(0.0).expect("frame_image must succeed");
        assert_eq!(img.width(), DEFAULT_SIZE);
        assert_eq!(img.height(), DEFAULT_SIZE);
        assert_eq!(img.rgba().len(), (DEFAULT_SIZE * DEFAULT_SIZE * 4) as usize);
    }

    #[test]
    fn icon_bundle_files_are_valid_images() {
        let ico_bytes = include_bytes!("../icons/icon.ico");
        let ico = tauri::image::Image::from_bytes(ico_bytes).expect("icon.ico must parse");
        assert!(ico.width() > 0 && ico.height() > 0);

        let png_bytes = include_bytes!("../icons/32x32.png");
        let png = tauri::image::Image::from_bytes(png_bytes).expect("32x32.png must parse");
        assert_eq!(png.width(), 32);
        assert_eq!(png.height(), 32);
    }

    #[test]
    fn animation_flag_is_decoupled_from_audio_stream() {
        stop();
        assert!(!should_animate());

        SHOULD_ANIMATE.store(true, Ordering::SeqCst);
        assert!(should_animate());
        stop();
        assert!(!should_animate());

        assert!(crate::alarm_sound::ringing_id().is_none());
        SHOULD_ANIMATE.store(true, Ordering::SeqCst);
        assert!(should_animate(), "tray animation flag must be independent of audio ringing_id");
        stop();
    }
}
