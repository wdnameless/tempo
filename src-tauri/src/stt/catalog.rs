//! Offline model catalog for Whisper speech recognition.
//!
//! Provides metadata and quant download targets for bundled whisper models,
//! parsed once from `catalog.json` at startup via [`std::sync::LazyLock`].

use std::sync::LazyLock;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct QuantFile {
    pub filename: String,
    pub quant: String,
    #[serde(alias = "size_bytes")]
    pub size_bytes: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CatalogModel {
    pub id: String,            // "whisper-small" (идентификатор позиции каталога)
    pub name: String,          // "Whisper Small"
    pub engine: String,        // "whisper" | "parakeet" | "canary" | "cohere" | "moonshine" | "sensevoice" | "gigaam"
    pub family: String,        // "whisper"
    pub parameters: String,    // "242M"
    pub description: String,
    pub languages: Vec<String>,
    pub language_count: u32,
    pub supports_translation: bool,
    pub supports_language_detect: bool,
    pub speed_score: f32,      // 0..1
    pub accuracy_score: f32,   // 0..1
    pub recommended: bool,
    pub recommended_rank: Option<u32>,
    pub repo_id: String,       // "handy-computer/whisper-small-gguf"
    pub revision: String,      // пин коммита HF
    pub files: Vec<QuantFile>,
    pub default_quant: String,
    pub archive: Option<String>,
    pub filename: String,
}

#[derive(Deserialize)]
struct RawCatalogCaps {
    #[serde(default)]
    translate: bool,
    #[serde(default)]
    lang_detect: bool,
}

#[derive(Deserialize)]
struct RawCatalogModel {
    id: String,
    revision: Option<String>,
    slug: Option<String>,
    name: String,
    engine: Option<String>,
    family: Option<String>,
    parameters: Option<String>,
    description: Option<String>,
    languages: Option<Vec<String>>,
    language_count: Option<u32>,
    capabilities: Option<RawCatalogCaps>,
    speed_score: Option<f32>,
    accuracy_score: Option<f32>,
    recommended: Option<bool>,
    recommended_rank: Option<u32>,
    #[serde(default)]
    files: Vec<QuantFile>,
    default_quant: Option<String>,
    archive: Option<String>,
    filename: Option<String>,
    bytes: Option<u64>,
    sha256: Option<String>,
}

#[derive(Deserialize)]
struct RawCatalogRoot {
    #[serde(default)]
    mirrors: Vec<String>,
    models: Vec<RawCatalogModel>,
}

static RAW_CATALOG: LazyLock<RawCatalogRoot> = LazyLock::new(|| {
    let json = include_str!("catalog.json");
    serde_json::from_str(json).expect("failed to parse bundled catalog.json")
});

pub static CATALOG: LazyLock<Vec<CatalogModel>> = LazyLock::new(|| {
    RAW_CATALOG.models.iter().map(|raw| {
        let repo_id = raw.id.clone();
        let id = raw.slug.clone().unwrap_or_else(|| {
            repo_id
                .strip_prefix("handy-computer/")
                .unwrap_or(&repo_id)
                .strip_suffix("-gguf")
                .unwrap_or(&repo_id)
                .to_string()
        });
        let engine = raw.engine.clone().unwrap_or_else(|| "whisper".to_string());
        let archive = raw.archive.clone();
        let filename = raw.filename.clone().unwrap_or_else(|| {
            raw.files.first().map(|f| f.filename.clone()).unwrap_or_else(|| id.clone())
        });

        let files = if raw.files.is_empty() && archive.is_some() {
            vec![QuantFile {
                filename: filename.clone(),
                quant: "int8".to_string(),
                size_bytes: raw.bytes.unwrap_or(0),
                sha256: raw.sha256.clone(),
            }]
        } else {
            raw.files.clone()
        };

        let default_quant = raw.default_quant.clone().unwrap_or_else(|| {
            files.first().map(|f| f.quant.clone()).unwrap_or_else(|| "int8".to_string())
        });

        let speed = raw.speed_score.unwrap_or(50.0);
        let normalized_speed = if speed > 1.0 { speed / 100.0 } else { speed }.clamp(0.0, 1.0);

        let acc = raw.accuracy_score.unwrap_or(50.0);
        let normalized_acc = if acc > 1.0 { acc / 100.0 } else { acc }.clamp(0.0, 1.0);

        let caps = raw.capabilities.as_ref();

        CatalogModel {
            id,
            name: raw.name.clone(),
            engine,
            family: raw.family.clone().unwrap_or_else(|| "whisper".to_string()),
            parameters: raw.parameters.clone().unwrap_or_else(|| "unknown".to_string()),
            description: raw.description.clone().unwrap_or_default(),
            languages: raw.languages.clone().unwrap_or_default(),
            language_count: raw.language_count.unwrap_or(0),
            supports_translation: caps.map(|c| c.translate).unwrap_or(false),
            supports_language_detect: caps.map(|c| c.lang_detect).unwrap_or(false),
            speed_score: normalized_speed,
            accuracy_score: normalized_acc,
            recommended: raw.recommended.unwrap_or(false),
            recommended_rank: raw.recommended_rank,
            repo_id,
            revision: raw.revision.clone().unwrap_or_else(|| "main".to_string()),
            files,
            default_quant,
            archive,
            filename,
        }
    }).collect()
});

/// Mirror base URLs to query in fallback order when Hugging Face fails.
pub fn mirrors() -> &'static [String] {
    &RAW_CATALOG.mirrors
}

/// Find a catalog model entry by catalog id or huggingface repo id.
pub fn find(id: &str) -> Option<&'static CatalogModel> {
    CATALOG.iter().find(|m| m.id == id || m.repo_id == id)
}

/// The default quant file for a catalog model.
pub fn default_file(m: &CatalogModel) -> Option<&QuantFile> {
    m.files
        .iter()
        .find(|f| f.quant == m.default_quant)
        .or_else(|| m.files.first())
}

/// Download URLs for a model file: Hugging Face resolve URL first, followed by mirror URLs.
pub fn download_urls(m: &CatalogModel, f: &QuantFile) -> Vec<String> {
    if let Some(archive_url) = &m.archive {
        return vec![archive_url.clone()];
    }
    let mut urls = Vec::with_capacity(1 + RAW_CATALOG.mirrors.len());
    urls.push(format!(
        "https://huggingface.co/{}/resolve/{}/{}",
        m.repo_id, m.revision, f.filename
    ));
    for mirror in &RAW_CATALOG.mirrors {
        let base = mirror.trim_end_matches('/');
        urls.push(format!("{}/{}/{}/{}", base, m.repo_id, m.revision, f.filename));
    }
    urls
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn catalog_loads_and_meets_invariants() {
        assert_eq!(CATALOG.len(), 24, "expected 24 models in catalog (13 whisper + 11 handy)");

        let mut seen_ids = HashSet::new();
        let mut total_quants = 0;

        for m in CATALOG.iter() {
            assert!(seen_ids.insert(&m.id), "duplicate model id: {}", m.id);
            assert!(!m.name.is_empty(), "model name is empty");
            assert!(!m.engine.is_empty(), "engine is empty");
            if m.engine == "whisper" {
                assert!(!m.repo_id.is_empty(), "repo_id is empty");
                assert!(!m.revision.is_empty(), "revision is empty");
                assert!(
                    m.files.len() >= 2,
                    "model {} has {} quants, expected at least 2",
                    m.id,
                    m.files.len()
                );
            } else {
                assert!(m.archive.is_some(), "archive missing for non-whisper model");
                assert!(!m.files.is_empty(), "files empty for non-whisper model");
            }

            total_quants += m.files.len();

            assert!(m.speed_score >= 0.0 && m.speed_score <= 1.0);
            assert!(m.accuracy_score >= 0.0 && m.accuracy_score <= 1.0);

            for f in &m.files {
                assert!(f.size_bytes > 0, "file size must be > 0: {}", f.filename);
                let sha = f.sha256.as_ref().expect("sha256 missing");
                assert_eq!(sha.len(), 64, "sha256 must be 64-hex characters");
                assert!(sha.chars().all(|c| c.is_ascii_hexdigit()), "sha256 not hex");
            }

            let def_file = default_file(m).expect("default file not found");
            assert!(!def_file.filename.is_empty());
        }

        assert!(
            total_quants >= 20,
            "expected at least 20 downloadable quant files, got {}",
            total_quants
        );
    }

    #[test]
    fn download_urls_generation() {
        let m = find("whisper-small").expect("whisper-small should exist");
        let f = default_file(m).expect("default file should exist");
        let urls = download_urls(m, f);

        assert!(!urls.is_empty());
        assert!(urls[0].starts_with("https://huggingface.co/"));
        assert!(urls[0].contains(&m.repo_id));
        assert!(urls[0].contains(&m.revision));
        assert!(urls[0].contains(&f.filename));

        if !mirrors().is_empty() {
            assert_eq!(urls.len(), 1 + mirrors().len());
            assert!(urls[1].starts_with(&mirrors()[0]));
            assert!(urls[1].contains(&m.repo_id));
        }
    }

    #[test]
    fn find_works_by_slug_and_repo_id() {
        let by_slug = find("whisper-small").expect("find by slug failed");
        let by_repo = find("handy-computer/whisper-small-gguf").expect("find by repo failed");
        assert_eq!(by_slug.id, by_repo.id);
    }
}
