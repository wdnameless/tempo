//! OpenAI-compatible /audio/transcriptions client.
//! Uses copilot's stored base URL, API key, and model.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct OpenAiTranscriptionResponse {
    pub text: String,
    pub language: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CloudTranscriptionParams {
    pub base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct CloudTranscriptionResult {
    pub text: String,
    pub language: String,
}

pub async fn transcribe_audio_cloud(
    pcm: &[f32],
    sample_rate: u32,
    params: CloudTranscriptionParams,
) -> Result<(String, String), String> {
    transcribe_cloud(pcm, sample_rate, params.base_url, params.api_key, params.model).await
}
pub async fn transcribe_cloud(
    pcm: &[f32],
    _sample_rate: u32,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
) -> Result<(String, String), String> {
    let base_url = base_url.unwrap_or_else(|| "https://api.openai.com/v1".to_string());
    let api_key = api_key
        .or_else(crate::credentials::get)
        .unwrap_or_default();
    let model = model.unwrap_or_else(|| "whisper-1".to_string());
    if api_key.trim().is_empty() {
        return Err("cloud_refused: missing API key".to_string());
    }

    let wav_bytes = pcm_to_wav_bytes(pcm, 16000)?;

    let base = base_url.trim_end_matches('/');
    let endpoint = if base.ends_with("/audio/transcriptions") {
        base.to_string()
    } else if base.ends_with("/v1") {
        format!("{base}/audio/transcriptions")
    } else {
        format!("{base}/v1/audio/transcriptions")
    };

    let model_name = if model.trim().is_empty() {
        "whisper-1"
    } else {
        model.trim()
    };

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(90))
        .build()
        .map_err(|e| format!("network_error: failed to create http client: {e}"))?;

    let part = reqwest::multipart::Part::bytes(wav_bytes)
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| format!("network_error: mime error: {e}"))?;

    let form = reqwest::multipart::Form::new()
        .part("file", part)
        .text("model", model_name.to_string())
        .text("response_format", "json");

    let response = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("network_error: cloud request failed: {e}"))?;

    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err("cloud_refused: invalid or unauthorized API key".to_string());
    }

    if !response.status().is_success() {
        let err_body = response.text().await.unwrap_or_default();
        return Err(format!(
            "cloud_refused: cloud API error (status {}): {err_body}",
            err_body
        ));
    }

    let parsed: OpenAiTranscriptionResponse = response
        .json()
        .await
        .map_err(|e| format!("network_error: failed to parse transcription response: {e}"))?;

    let text = parsed.text.trim().to_string();
    let lang = parsed.language.unwrap_or_else(|| "auto".to_string());

    Ok((text, lang))
}

/// Helper to serialize 16 kHz mono f32 PCM to standard RIFF/WAV 16-bit PCM bytes.
pub fn pcm_to_wav_bytes(pcm: &[f32], sample_rate: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::with_capacity(44 + pcm.len() * 2);
    let channels: u16 = 1;
    let bits_per_sample: u16 = 16;
    let block_align: u16 = channels * (bits_per_sample / 8);
    let byte_rate: u32 = sample_rate * block_align as u32;
    let data_len: u32 = (pcm.len() * 2) as u32;
    let total_len: u32 = 36 + data_len;

    // RIFF Header
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&total_len.to_le_bytes());
    out.extend_from_slice(b"WAVE");

    // "fmt " Subchunk
    out.extend_from_slice(b"fmt ");
    out.extend_from_slice(&16u32.to_le_bytes()); // Subchunk1Size = 16 for PCM
    out.extend_from_slice(&1u16.to_le_bytes());  // AudioFormat = 1 (PCM)
    out.extend_from_slice(&channels.to_le_bytes());
    out.extend_from_slice(&sample_rate.to_le_bytes());
    out.extend_from_slice(&byte_rate.to_le_bytes());
    out.extend_from_slice(&block_align.to_le_bytes());
    out.extend_from_slice(&bits_per_sample.to_le_bytes());

    // "data" Subchunk
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());

    // PCM i16 samples
    for &sample in pcm {
        let clamped = sample.clamp(-1.0, 1.0);
        let val = (clamped * 32767.0).round() as i16;
        out.extend_from_slice(&val.to_le_bytes());
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wav_header_format_is_valid() {
        let samples = vec![0.0f32; 1600]; // 0.1s
        let wav = pcm_to_wav_bytes(&samples, 16000).unwrap();

        assert_eq!(&wav[0..4], b"RIFF");
        assert_eq!(&wav[8..12], b"WAVE");
        assert_eq!(&wav[12..16], b"fmt ");
        assert_eq!(&wav[36..40], b"data");

        let data_size = u32::from_le_bytes(wav[40..44].try_into().unwrap());
        assert_eq!(data_size, 3200);
        assert_eq!(wav.len(), 44 + 3200);
    }
}
