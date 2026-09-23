//! Chat-completion requests issued from the backend.
//!
//! Two problems with fetching from the webview:
//!
//! 1. The CSP `connect-src` list is fixed at build time, so a user pointing the
//!    app at OpenRouter, Groq, LM Studio or a local Ollama got a browser-level
//!    block that the code then swallowed and reported as a successful offline
//!    edit — the model was never called and nothing said so.
//! 2. The API key lived in the same `alarmer.json` the app exports as a backup,
//!    so "export my data" also meant "export my credentials".
//!
//! Requests therefore go out from Rust, where neither constraint exists, and the
//! key is held in the OS credential store instead of the data file.

use serde::{Deserialize, Serialize};

/// A chat message in OpenAI wire format.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChatMessage {
    pub role: String,
    pub content: String,
}

/// What the caller gets back, including what to show when it fails.
#[derive(Debug, Clone, Serialize)]
pub struct ChatOutcome {
    /// Raw assistant content. Empty when `error` is set.
    pub content: String,
    /// A message fit for the user, describing why no answer arrived.
    pub error: Option<String>,
}

/// Longest we wait for a model before giving up. Chat models can be slow, but
/// an unbounded wait leaves the UI spinning forever on a dead endpoint.
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// Asks an OpenAI-compatible endpoint for a completion.
///
/// Returns `ChatOutcome` rather than a hard error: a failed request is a normal
/// outcome the UI must report, not an exception to swallow and paper over with
/// a canned local reply.
pub async fn complete(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: Vec<ChatMessage>,
) -> ChatOutcome {
    let url = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let key = api_key.trim();

    if key.is_empty() {
        return ChatOutcome {
            content: String::new(),
            error: Some("Не задан API-ключ. Откройте «Настройки → Нейросеть».".into()),
        };
    }

    let client = match reqwest::Client::builder().timeout(TIMEOUT).build() {
        Ok(client) => client,
        Err(e) => {
            return ChatOutcome {
                content: String::new(),
                error: Some(format!("Не удалось создать HTTP-клиент: {e}")),
            }
        }
    };

    let body = serde_json::json!({
        "model": model,
        "messages": messages,
        "temperature": 0.3,
        "response_format": { "type": "json_object" },
    });

    let response = match client
        .post(&url)
        .header("Content-Type", "application/json")
        .bearer_auth(key)
        .json(&body)
        .send()
        .await
    {
        Ok(response) => response,
        Err(e) => {
            return ChatOutcome {
                content: String::new(),
                error: Some(if e.is_timeout() {
                    format!("Модель не ответила за {} с ({url}).", TIMEOUT.as_secs())
                } else if e.is_connect() {
                    format!("Не удалось подключиться к {url}. Проверьте Base URL и сеть.")
                } else {
                    format!("Ошибка сети: {e}")
                }),
            }
        }
    };

    let status = response.status();
    let text = response.text().await.unwrap_or_default();

    if !status.is_success() {
        // Providers put the useful part ("model not found", "insufficient
        // quota") in the body; showing it beats a bare status code.
        let detail = serde_json::from_str::<serde_json::Value>(&text)
            .ok()
            .and_then(|v| {
                v.pointer("/error/message")
                    .and_then(|m| m.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_else(|| text.chars().take(300).collect());

        return ChatOutcome {
            content: String::new(),
            error: Some(format!("Модель вернула ошибку {status}: {detail}")),
        };
    }

    let parsed: serde_json::Value = match serde_json::from_str(&text) {
        Ok(value) => value,
        Err(e) => {
            return ChatOutcome {
                content: String::new(),
                error: Some(format!("Ответ модели не является JSON: {e}")),
            }
        }
    };

    let content = parsed
        .pointer("/choices/0/message/content")
        .and_then(|c| c.as_str())
        .unwrap_or_default()
        .to_string();

    if content.trim().is_empty() {
        return ChatOutcome {
            content: String::new(),
            error: Some("Модель вернула пустой ответ.".into()),
        };
    }

    ChatOutcome { content, error: None }
}
/// Queries an OpenAI-compatible endpoint for available models (`GET /models`).
pub async fn list_models(base_url: &str, api_key: &str) -> Result<Vec<String>, String> {
    let url = format!("{}/models", base_url.trim_end_matches('/'));
    let key = api_key.trim();

    let client = match reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(10))
        .build()
    {
        Ok(c) => c,
        Err(e) => return Err(format!("Не удалось создать HTTP-клиент: {e}")),
    };

    let mut req = client.get(&url).header("Content-Type", "application/json");
    if !key.is_empty() {
        req = req.bearer_auth(key);
    }

    let response = req.send().await.map_err(|e| format!("Ошибка сети: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Статус ответа: {}", response.status()));
    }

    let parsed: serde_json::Value = response
        .json()
        .await
        .map_err(|e| format!("Ошибка парсинга списка моделей: {e}"))?;

    let mut models = Vec::new();
    if let Some(data) = parsed.get("data").and_then(|d| d.as_array()) {
        for item in data {
            if let Some(id) = item.get("id").and_then(|id| id.as_str()) {
                models.push(id.to_string());
            }
        }
    }
    models.sort();
    Ok(models)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn an_empty_key_fails_before_any_request_is_made() {
        // Pointing at a port nothing listens on proves no request was attempted.
        let outcome = complete("http://127.0.0.1:1", "  ", "gpt-4o-mini", vec![]).await;

        assert!(outcome.content.is_empty());
        assert!(outcome.error.unwrap().contains("API-ключ"));
    }

    #[tokio::test]
    async fn an_unreachable_endpoint_is_reported_not_hidden() {
        let outcome = complete("http://127.0.0.1:1", "sk-test", "gpt-4o-mini", vec![]).await;

        let error = outcome.error.expect("an unreachable host must be reported");
        assert!(outcome.content.is_empty());
        assert!(!error.is_empty());
    }

    #[test]
    fn the_chat_message_serialises_to_the_openai_shape() {
        let json = serde_json::to_string(&ChatMessage {
            role: "user".into(),
            content: "привет".into(),
        })
        .unwrap();

        assert!(json.contains("\"role\":\"user\""));
        assert!(json.contains("\"content\":\"привет\""));
    }

    #[tokio::test]
    async fn list_models_unreachable_endpoint_fails_gracefully() {
        let res = list_models("http://127.0.0.1:1", "sk-test").await;
        assert!(res.is_err());
    }
}
