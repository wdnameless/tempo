// src-tauri/src/stt/postprocess.rs
// LLM post-processing for speech-to-text transcriptions.

use serde::{Deserialize, Serialize};

/// Configuration for speech post-processing via LLM.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PostProcessConfig {
    pub enabled: bool,
    pub prompt: String,
    pub base_url: String,
    pub api_key: String,
    pub model: String,
}

impl Default for PostProcessConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            prompt: String::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
        }
    }
}
/// Resolves the post-processing configuration using SQLite preferences and credential store.
pub fn resolve_config(
    conn: &rusqlite::Connection,
    enabled: bool,
    prompt: String,
) -> PostProcessConfig {
    let base_url = crate::storage::repo::pref_get(conn, "tempo_ai_base_url")
        .ok()
        .flatten()
        .or_else(|| {
            crate::storage::repo::pref_get(conn, "alarmer_ai_base_url")
                .ok()
                .flatten()
        })
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "https://api.openai.com/v1".to_string());

    let model = crate::storage::repo::pref_get(conn, "tempo_ai_model")
        .ok()
        .flatten()
        .or_else(|| {
            crate::storage::repo::pref_get(conn, "alarmer_ai_model")
                .ok()
                .flatten()
        })
        .map(|s| s.trim_matches('"').to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "gpt-4o-mini".to_string());

    let api_key = crate::credentials::get().unwrap_or_default();

    PostProcessConfig {
        enabled,
        prompt,
        base_url,
        api_key,
        model,
    }
}


const DEFAULT_SYSTEM_PROMPT: &str = "\
You are a speech-to-text post-processor. Your task is to clean up transcribed speech:
1. Fix spelling, capitalization, and punctuation errors.
2. Convert number words to digits (twenty-five -> 25, ten percent -> 10%, five dollars -> $5).
3. Replace spoken punctuation with symbols (period -> ., comma -> ,, question mark -> ?).
4. Remove filler words (um, uh, like as filler).
5. Keep the language and meaning of the original version. Do not paraphrase or invent content.
6. If the transcript contains a question, clean it up — do not answer it.
Respond in JSON format with a single key \"text\" containing the cleaned transcript.";

/// Cleans and polishes a raw transcript using an LLM.
///
/// NOTE: This is a blocking call. Callers MUST run it off the UI thread
/// (e.g. via `tokio::task::spawn_blocking` or on a background thread).
///
/// Under ANY failure (disabled config, missing key, connection timeout,
/// invalid JSON, empty output), this function returns the ORIGINAL raw text
/// so dictations are never lost, and logs the underlying reason.
pub fn polish(text: &str, cfg: &PostProcessConfig) -> Result<String, String> {
    if !cfg.enabled {
        return Ok(text.to_string());
    }

    let trimmed = text.trim();
    if trimmed.is_empty() {
        return Ok(text.to_string());
    }

    let base_url = cfg.base_url.trim();
    if base_url.is_empty() {
        eprintln!("[stt/postprocess] Base URL is empty; returning raw transcript");
        return Ok(text.to_string());
    }

    let model = cfg.model.trim();
    if model.is_empty() {
        eprintln!("[stt/postprocess] Model is empty; returning raw transcript");
        return Ok(text.to_string());
    }

    // Resolve API key from config or fallback to credential store
    let api_key = if !cfg.api_key.trim().is_empty() {
        cfg.api_key.trim().to_string()
    } else {
        crate::credentials::get().unwrap_or_default()
    };

    if api_key.is_empty() {
        eprintln!("[stt/postprocess] No API key available; returning raw transcript");
        return Ok(text.to_string());
    }

    // Prepare system and user prompts
    let system_prompt = if cfg.prompt.trim().is_empty() {
        DEFAULT_SYSTEM_PROMPT.to_string()
    } else if cfg.prompt.contains("${output}") {
        cfg.prompt.replace("${output}", trimmed)
    } else {
        format!(
            "{}\n\nIMPORTANT: Return a JSON object with a single key \"text\" containing the polished transcript.",
            cfg.prompt.trim()
        )
    };

    let user_content = format!("<transcript>\n{}\n</transcript>", trimmed);

    let messages = vec![
        crate::ai::ChatMessage {
            role: "system".to_string(),
            content: system_prompt,
        },
        crate::ai::ChatMessage {
            role: "user".to_string(),
            content: user_content,
        },
    ];

    let base_url_owned = base_url.to_string();
    let model_owned = model.to_string();

    // crate::ai::complete is async. Run on a separate thread to guarantee blocking
    // without conflicting with any existing Tokio runtime or caller context.
    let outcome = std::thread::spawn(move || {
        let rt = match tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            Err(e) => {
                return crate::ai::ChatOutcome {
                    content: String::new(),
                    error: Some(format!("Failed to build local tokio runtime: {e}")),
                };
            }
        };
        rt.block_on(crate::ai::complete(
            &base_url_owned,
            &api_key,
            &model_owned,
            messages,
        ))
    })
    .join()
    .unwrap_or_else(|_| crate::ai::ChatOutcome {
        content: String::new(),
        error: Some("Post-processing thread panicked".to_string()),
    });

    if let Some(err) = &outcome.error {
        eprintln!("[stt/postprocess] AI completion failed: {err}; returning raw transcript");
        return Ok(text.to_string());
    }

    let cleaned = extract_cleaned_text(&outcome.content);
    if cleaned.is_empty() {
        eprintln!("[stt/postprocess] AI completion returned empty text; returning raw transcript");
        return Ok(text.to_string());
    }

    Ok(cleaned)
}

/// Helper function to extract cleaned text from model response.
///
/// Because `ai::complete` specifies `response_format: { type: "json_object" }`,
/// the model will return a JSON object (e.g. `{"text": "..."}`).
/// We extract the string from common keys or fall back to unwrapped text.
pub(crate) fn extract_cleaned_text(raw: &str) -> String {
    let raw_trimmed = raw.trim();
    if raw_trimmed.is_empty() {
        return String::new();
    }

    let unwrapped = unwrap_fences(raw_trimmed);

    // Try parsing JSON from raw, or unwrapped markdown code blocks
    for candidate in [raw_trimmed, unwrapped] {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(candidate) {
            if let Some(obj) = value.as_object() {
                for key in &[
                    "text",
                    "cleaned",
                    "cleaned_text",
                    "result",
                    "output",
                    "transcript",
                    "response",
                ] {
                    if let Some(val) = obj.get(*key).and_then(|v| v.as_str()) {
                        let trimmed_val = val.trim();
                        if !trimmed_val.is_empty() {
                            return trimmed_val.to_string();
                        }
                    }
                }
                let string_values: Vec<&str> = obj.values().filter_map(|v| v.as_str()).collect();
                if string_values.len() == 1 {
                    return string_values[0].trim().to_string();
                }
            } else if let Some(s) = value.as_str() {
                return s.trim().to_string();
            }
        }
    }

    unwrapped.to_string()
}

fn unwrap_fences(s: &str) -> &str {
    let mut text = s.trim();
    if text.starts_with("```") {
        if let Some(first_line_end) = text.find('\n') {
            text = &text[first_line_end + 1..];
        } else {
            text = &text[3..];
        }
        if text.ends_with("```") {
            text = &text[..text.len() - 3];
        }
    }
    text.trim()
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_disabled_returns_original() {
        let cfg = PostProcessConfig {
            enabled: false,
            prompt: String::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "dummy-key".to_string(),
            model: "gpt-4o-mini".to_string(),
        };

        let result = polish("raw transcription", &cfg).unwrap();
        assert_eq!(result, "raw transcription");
    }

    #[test]
    fn test_empty_text_returns_empty() {
        let cfg = PostProcessConfig {
            enabled: true,
            prompt: String::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "dummy-key".to_string(),
            model: "gpt-4o-mini".to_string(),
        };

        let result = polish("   ", &cfg).unwrap();
        assert_eq!(result, "   ");
    }

    #[test]
    fn test_empty_base_url_degrades_to_original() {
        let cfg = PostProcessConfig {
            enabled: true,
            prompt: String::new(),
            base_url: "".to_string(),
            api_key: "dummy-key".to_string(),
            model: "gpt-4o-mini".to_string(),
        };

        let result = polish("test text", &cfg).unwrap();
        assert_eq!(result, "test text");
    }

    #[test]
    fn test_empty_model_degrades_to_original() {
        let cfg = PostProcessConfig {
            enabled: true,
            prompt: String::new(),
            base_url: "https://api.openai.com/v1".to_string(),
            api_key: "dummy-key".to_string(),
            model: "   ".to_string(),
        };

        let result = polish("test text", &cfg).unwrap();
        assert_eq!(result, "test text");
    }

    #[test]
    fn test_extract_cleaned_text_json_variants() {
        // Standard "text" field
        assert_eq!(
            extract_cleaned_text(r#"{"text": "Hello world!"}"#),
            "Hello world!"
        );

        // "cleaned" field
        assert_eq!(
            extract_cleaned_text(r#"{"cleaned": "Cleaned sentence."}"#),
            "Cleaned sentence."
        );

        // "cleaned_text" field
        assert_eq!(
            extract_cleaned_text(r#"{"cleaned_text": "Another test."}"#),
            "Another test."
        );

        // Single generic string field
        assert_eq!(
            extract_cleaned_text(r#"{"custom_output": "Only string here."}"#),
            "Only string here."
        );

        // Plain string JSON
        assert_eq!(
            extract_cleaned_text(r#""Just a string""#),
            "Just a string"
        );

        // Markdown code block around JSON
        assert_eq!(
            extract_cleaned_text("```json\n{\"text\": \"In markdown\"}\n```"),
            "In markdown"
        );

        // Raw text fallback
        assert_eq!(
            extract_cleaned_text("Plain text without JSON"),
            "Plain text without JSON"
        );
    }

    #[test]
    fn test_polish_network_error_degrades_to_original() {
        // Point to an invalid/unreachable local port to simulate network failure
        let cfg = PostProcessConfig {
            enabled: true,
            prompt: String::new(),
            base_url: "http://127.0.0.1:1".to_string(),
            api_key: "test-api-key".to_string(),
            model: "gpt-4o-mini".to_string(),
        };

        let original = "Testing resilience to network error";
        let result = polish(original, &cfg).unwrap();
        assert_eq!(
            result, original,
            "Post-processing must degrade to original text on connection failure"
        );
    }

    #[test]
    fn test_resolve_config_with_preferences() {
        let conn = rusqlite::Connection::open_in_memory().unwrap();
        crate::storage::migrations::migrate(&conn).unwrap();

        // 1. Defaults when preferences are missing
        let cfg_default = resolve_config(&conn, true, "prompt".to_string());
        assert_eq!(cfg_default.base_url, "https://api.openai.com/v1");
        assert_eq!(cfg_default.model, "gpt-4o-mini");
        assert!(cfg_default.enabled);
        assert_eq!(cfg_default.prompt, "prompt");

        // 2. Custom preferences
        crate::storage::repo::pref_set(&conn, "tempo_ai_base_url", "\"https://custom.api.com/v1\"").unwrap();
        crate::storage::repo::pref_set(&conn, "tempo_ai_model", "\"custom-model-v2\"").unwrap();

        let cfg_custom = resolve_config(&conn, true, "clean up".to_string());
        assert_eq!(cfg_custom.base_url, "https://custom.api.com/v1");
        assert_eq!(cfg_custom.model, "custom-model-v2");

        // Missing API key degrades gracefully to original text
        let raw = "Degraded output test";
        let polished = polish(raw, &cfg_custom).unwrap();
        assert_eq!(polished, raw, "empty API key must return raw transcript");
    }
}
