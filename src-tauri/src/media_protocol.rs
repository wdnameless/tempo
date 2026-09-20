//! Custom URI scheme protocol `tempo-media` for serving local media files.
//!
//! Replaces static scope serving which fails on Windows due to unsupported `$EXE` scope.
//! Resolves the media directory (`<data>/assets`) at runtime and enforces path security.

use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

use percent_encoding::percent_decode_str;
use tauri::http::{header, Request, Response, StatusCode};
use tauri::UriSchemeResponder;

use crate::storage::assets::verify_path_inside_assets;

pub const SCHEME_NAME: &str = "tempo-media";

/// Content-Type mapping by file extension.
pub fn mime_type_for_path(path: &Path) -> &'static str {
    match path.extension().and_then(|s| s.to_str()).map(|s| s.to_ascii_lowercase()).as_deref() {
        Some("wav") => "audio/wav",
        Some("mp4") => "video/mp4",
        Some("m4a") => "audio/mp4",
        Some("webm") => "video/webm",
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("svg") => "image/svg+xml",
        Some("json") => "application/json",
        _ => "application/octet-stream",
    }
}

/// Decodes the URI path into a filesystem path inside the assets directory.
pub fn decode_requested_path(assets_dir: &Path, raw_path_or_uri: &str) -> PathBuf {
    let mut decoded = percent_decode_str(raw_path_or_uri).decode_utf8_lossy().to_string();

    if let Some(pos) = decoded.find("://") {
        decoded = decoded[pos + 3..].to_string();
    }
    if let Some(pos) = decoded.find('/') {
        let after_host = &decoded[pos..];
        decoded = after_host.to_string();
    }

    let trimmed = decoded.trim_start_matches('/');

    let path = Path::new(trimmed);
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        #[cfg(windows)]
        {
            let bytes = trimmed.as_bytes();
            if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && (bytes[1] == b':' || bytes[1] == b'|') {
                let fixed = if bytes[1] == b'|' {
                    format!("{}:{}", trimmed.chars().next().unwrap(), &trimmed[2..])
                } else {
                    trimmed.to_string()
                };
                return PathBuf::from(fixed);
            }
        }
        assets_dir.join(path)
    }
}

/// Validates that the requested target is inside the assets directory.
/// Returns Ok(canonical_path) on success, Err((StatusCode, message)) on failure.
pub fn validate_and_resolve_media_path(
    assets_dir: &Path,
    raw_path_or_uri: &str,
) -> Result<PathBuf, (StatusCode, String)> {
    let target = decode_requested_path(assets_dir, raw_path_or_uri);

    match verify_path_inside_assets(assets_dir, &target) {
        Ok(canonical) => {
            if !canonical.exists() || !canonical.is_file() {
                Err((StatusCode::NOT_FOUND, "File not found".to_string()))
            } else {
                Ok(canonical)
            }
        }
        Err(e) => Err((StatusCode::FORBIDDEN, format!("Forbidden: {e}"))),
    }
}

/// Parses a `Range: bytes=start-end` HTTP header.
pub fn parse_range_header(header_val: &str, file_size: u64) -> Option<(u64, u64)> {
    let trimmed = header_val.trim();
    if !trimmed.starts_with("bytes=") {
        return None;
    }
    let range_str = &trimmed[6..];
    let parts: Vec<&str> = range_str.split('-').collect();
    if parts.len() != 2 {
        return None;
    }

    let start_str = parts[0].trim();
    let end_str = parts[1].trim();

    if start_str.is_empty() {
        let suffix_len: u64 = end_str.parse().ok()?;
        if suffix_len == 0 {
            return None;
        }
        let start = file_size.saturating_sub(suffix_len);
        let end = file_size.saturating_sub(1);
        Some((start, end))
    } else {
        let start: u64 = start_str.parse().ok()?;
        if start >= file_size {
            return None;
        }
        let end = if end_str.is_empty() {
            file_size.saturating_sub(1)
        } else {
            let parsed_end: u64 = end_str.parse().ok()?;
            parsed_end.min(file_size.saturating_sub(1))
        };
        if start > end {
            return None;
        }
        Some((start, end))
    }
}

/// Handles a media request synchronously for responder or tests.
pub fn handle_media_request(
    assets_dir: &Path,
    req: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let uri = req.uri();
    let path_str = uri.path();

    let resolved_path = match validate_and_resolve_media_path(assets_dir, path_str) {
        Ok(p) => p,
        Err((code, msg)) => {
            return Response::builder()
                .status(code)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CONTENT_TYPE, "text/plain")
                .body(msg.into_bytes())
                .unwrap();
        }
    };

    let mut file = match File::open(&resolved_path) {
        Ok(f) => f,
        Err(e) => {
            return Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                .header(header::CONTENT_TYPE, "text/plain")
                .body(format!("Failed to open file: {e}").into_bytes())
                .unwrap();
        }
    };

    let total_size = match file.metadata() {
        Ok(m) => m.len(),
        Err(_) => 0,
    };

    let mime = mime_type_for_path(&resolved_path);

    let range_header = req
        .headers()
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok());

    if let Some(range_val) = range_header {
        if let Some((start, end)) = parse_range_header(range_val, total_size) {
            let chunk_len = (end - start + 1) as usize;
            if file.seek(SeekFrom::Start(start)).is_ok() {
                let mut buffer = vec![0u8; chunk_len];
                if file.read_exact(&mut buffer).is_ok() {
                    return Response::builder()
                        .status(StatusCode::PARTIAL_CONTENT)
                        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                        .header(header::ACCEPT_RANGES, "bytes")
                        .header(header::CONTENT_TYPE, mime)
                        .header(
                            header::CONTENT_RANGE,
                            format!("bytes {start}-{end}/{total_size}"),
                        )
                        .header(header::CONTENT_LENGTH, chunk_len.to_string())
                        .body(buffer)
                        .unwrap();
                }
            }
        }
    }

    let mut full_body = Vec::new();
    if file.read_to_end(&mut full_body).is_err() {
        return Response::builder()
            .status(StatusCode::INTERNAL_SERVER_ERROR)
            .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
            .body(b"Failed to read file".to_vec())
            .unwrap();
    }

    Response::builder()
        .status(StatusCode::OK)
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::CONTENT_TYPE, mime)
        .header(header::CONTENT_LENGTH, full_body.len().to_string())
        .body(full_body)
        .unwrap()
}

pub fn handle_uri_scheme(
    app: &tauri::AppHandle,
    request: Request<Vec<u8>>,
    responder: UriSchemeResponder,
) {
    let assets_dir = match crate::storage::assets_path(app) {
        Ok(dir) => dir,
        Err(_) => {
            responder.respond(
                Response::builder()
                    .status(StatusCode::INTERNAL_SERVER_ERROR)
                    .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, "*")
                    .body(b"Failed to resolve assets directory".to_vec())
                    .unwrap(),
            );
            return;
        }
    };

    std::thread::spawn(move || {
        let response = handle_media_request(&assets_dir, &request);
        responder.respond(response);
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::atomic::{AtomicU64, Ordering};
    static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);

    struct TestTempDir {
        path: PathBuf,
    }

    impl TestTempDir {
        fn new() -> Self {
            let cnt = TEST_COUNTER.fetch_add(1, Ordering::SeqCst);
            let path = std::env::temp_dir().join(format!("tempo_media_proto_test_{}_{}", std::process::id(), cnt));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("create_dir_all");
            Self { path }
        }
        fn path(&self) -> &Path {
            &self.path
        }
    }

    impl Drop for TestTempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.path);
        }
    }

    fn setup_test_assets() -> (TestTempDir, PathBuf) {
        let temp = TestTempDir::new();
        let assets = temp.path().join("assets");
        fs::create_dir_all(assets.join("audio")).unwrap();
        (temp, assets)
    }
    #[test]
    fn test_mime_types() {
        assert_eq!(mime_type_for_path(Path::new("file.wav")), "audio/wav");
        assert_eq!(mime_type_for_path(Path::new("video.mp4")), "video/mp4");
        assert_eq!(mime_type_for_path(Path::new("audio.m4a")), "audio/mp4");
        assert_eq!(mime_type_for_path(Path::new("clip.webm")), "video/webm");
        assert_eq!(mime_type_for_path(Path::new("image.png")), "image/png");
        assert_eq!(mime_type_for_path(Path::new("photo.jpg")), "image/jpeg");
        assert_eq!(mime_type_for_path(Path::new("other.bin")), "application/octet-stream");
    }

    #[test]
    fn test_validate_and_resolve_media_path() {
        let (_tmp, assets_dir) = setup_test_assets();
        let test_file = assets_dir.join("audio").join("sample.wav");
        fs::write(&test_file, b"test audio content").unwrap();

        // Inside and exists -> Ok
        let res = validate_and_resolve_media_path(&assets_dir, "/audio/sample.wav");
        assert!(res.is_ok(), "Valid file inside assets should resolve");

        // Inside and missing -> 404
        let res_missing = validate_and_resolve_media_path(&assets_dir, "/audio/nonexistent.wav");
        assert_eq!(res_missing.unwrap_err().0, StatusCode::NOT_FOUND);

        // Outside assets -> 403 (or 404 if path doesn't exist)
        let outside_file = _tmp.path().join("secret.txt");
        fs::write(&outside_file, b"secret").unwrap();
        let outside_str = outside_file.to_str().unwrap();
        let res_outside = validate_and_resolve_media_path(&assets_dir, outside_str);
        assert_eq!(res_outside.unwrap_err().0, StatusCode::FORBIDDEN);
    }

    #[test]
    fn test_handle_media_request_range_and_headers() {
        let (_tmp, assets_dir) = setup_test_assets();
        let test_file = assets_dir.join("audio").join("song.mp4");
        let data = b"0123456789ABCDEF"; // 16 bytes
        fs::write(&test_file, data).unwrap();

        // Full GET request
        let req_full = Request::builder()
            .uri("/audio/song.mp4")
            .body(Vec::new())
            .unwrap();
        let resp_full = handle_media_request(&assets_dir, &req_full);
        assert_eq!(resp_full.status(), StatusCode::OK);
        assert_eq!(resp_full.headers().get(header::CONTENT_TYPE).unwrap(), "video/mp4");
        assert_eq!(resp_full.headers().get(header::ACCESS_CONTROL_ALLOW_ORIGIN).unwrap(), "*");
        assert_eq!(resp_full.body(), data);

        // Range request
        let req_range = Request::builder()
            .uri("/audio/song.mp4")
            .header(header::RANGE, "bytes=4-9")
            .body(Vec::new())
            .unwrap();
        let resp_range = handle_media_request(&assets_dir, &req_range);
        assert_eq!(resp_range.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(
            resp_range.headers().get(header::CONTENT_RANGE).unwrap(),
            "bytes 4-9/16"
        );
        assert_eq!(resp_range.body(), &b"456789"[..]);
    }
}
