# Interfaces: Handy → Tempo speech module (заморожено для параллельной работы)

Владельцы файлов назначены так, чтобы **два исполнителя никогда не правили один файл**.
Волна 1 (Rust) и волна 3 (Frontend) идут параллельно по этому контракту.

## 1. Владение файлами

| Волна | Исполнитель | Владеет (только эти файлы) |
|---|---|---|
| W1 | ModelsBackend | `src-tauri/src/stt/catalog.rs`, `src-tauri/src/stt/catalog.json`, `src-tauri/src/stt/models.rs` |
| W1 | PttBackend | `src-tauri/src/stt/ptt.rs`, `src-tauri/src/stt/shortcuts.rs` |
| W1 | AudioBackend | `src-tauri/src/stt/capture.rs`, `src-tauri/src/stt/vad.rs`, `src-tauri/src/stt/feedback.rs` |
| W1 | HistoryBackend | `src-tauri/src/stt/history.rs`, `src-tauri/src/stt/postprocess.rs`, `src-tauri/src/storage/schema.rs`, `src-tauri/src/storage/migrations.rs` |
| W1 | InjectionBackend | `src-tauri/src/stt/dictation.rs` |
| W2 | Integration | `src-tauri/src/stt/mod.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/stt/engine.rs` |
| W3 | FrontendServices | `src/services/stt.ts`, `src/services/speechSettings.ts`, `src/services/sttEvents.ts`, `src/services/__tests__/*` |
| W3 | SpeechUI | `src/components/speech/**`, `src/components/SettingsView.tsx`, `src/components/DictationIndicator.tsx`, `src/components/__tests__/DictationIndicator.test.tsx` |

`src-tauri/Cargo.toml`, `src/services/i18n.ts` уже правит только оркестратор/W3 (см. ниже).

## 2. Общие типы (Rust)

Все типы сериализуются `#[serde(rename_all = "camelCase")]`. Существующие имена полей
(`ModelInfo`, `DownloadProgress`) сохраняются там, где уже используются фронтом.

```rust
// stt/catalog.rs
pub struct QuantFile { pub filename: String, pub quant: String, pub size_bytes: u64, pub sha256: Option<String> }
pub struct CatalogModel {
    pub id: String,            // "whisper-small"  (идентификатор позиции каталога)
    pub name: String,          // "Whisper Small"
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
}
pub static CATALOG: Lazy<Vec<CatalogModel>>;         // из catalog.json (include_str!)
pub fn mirrors() -> &'static [String];               // ["https://blob.handy.computer"]
pub fn find(id: &str) -> Option<&'static CatalogModel>;
pub fn default_file(m: &CatalogModel) -> Option<&QuantFile>;
pub fn download_urls(m: &CatalogModel, f: &QuantFile) -> Vec<String>; // HF resolve, затем зеркала
```

```rust
// stt/models.rs  (переписывается целиком; команды объявляются здесь, регистрируются в W2)
pub struct ModelInfo {
    pub id: String, pub name: String, pub description: String,
    pub filename: String, pub quant: String, pub quants: Vec<String>,
    pub bytes: u64, pub sha256: Option<String>, pub revision: Option<String>,
    pub languages: Vec<String>, pub language_count: u32,
    pub speed_score: f32, pub accuracy_score: f32,
    pub parameters: String, pub recommended: bool,
    pub supports_translation: bool, pub supports_language_detect: bool,
    pub installed: bool, pub path: Option<String>,
    pub is_downloading: bool, pub partial_bytes: u64,
    pub is_custom: bool, pub source: String, // "catalog" | "custom"
}
pub struct DownloadProgress {
    pub model_id: String, pub received: u64, pub total: u64,
    pub percentage: f64, pub speed_bps: f64, pub eta_secs: Option<u64>,
    pub phase: String, // "downloading" | "verifying" | "done" | "cancelled" | "error"
    pub error: Option<String>,
}
pub struct ModelManager { /* models_dir, active downloads, catalog seed */ }
impl ModelManager {
    pub fn new(models_dir: PathBuf) -> Self;
    pub async fn list(&self) -> Vec<ModelInfo>;                 // каталог ∪ локальные файлы ∪ кастомные
    pub async fn start_download(&self, model_id: &str, quant: Option<String>) -> Result<(), String>;
    pub async fn cancel_download(&self, model_id: &str) -> Result<(), String>;
    pub fn delete(&self, model_id: &str) -> Result<(), String>;
    pub async fn rescan(&self) -> Result<Vec<ModelInfo>, String>;
    pub fn import_file(&self, path: &str) -> Result<ModelInfo, String>;
    pub fn models_dir(&self) -> &Path;
    pub async fn progress(&self) -> Vec<DownloadProgress>;
    pub fn installed_path(&self, model_id: &str) -> Option<PathBuf>;
}
// Отдельные шаги загрузчика (тестируемо без сети):
pub(crate) async fn download_resumable(urls: &[String], partial: &Path, expected_size: Option<u64>,
    expected_sha256: Option<&str>, cancel: &AtomicBool,
    on_progress: &(dyn Fn(u64, u64) + Send + Sync)) -> Result<DownloadOutcome, String>;
pub(crate) fn verify_sha256(path: &Path, expected: &str) -> Result<(), String>;
pub(crate) fn parse_content_range_start(value: &str) -> Option<u64>;
```

```rust
// stt/ptt.rs  (чистое ядро — без Tauri; переносится из Handy transcription_coordinator.rs)
pub const DEBOUNCE: Duration = Duration::from_millis(30);
pub const RELEASE_GRACE: Duration = Duration::from_millis(50);
pub const DEFAULT_HOLD_THRESHOLD_MS: u64 = 300;

pub enum ShortcutActivation { Toggle, PushToTalk, HoldOrToggle } // default HoldOrToggle
pub enum Stage { Idle, Recording, Processing }
pub enum Effect { Start, Stop, Cancel }
pub struct InputEvent { pub is_pressed: bool, pub mode: ShortcutActivation, pub hold_threshold: Duration, pub external: bool, pub now: Instant }
pub struct CoordinatorState { /* stage, hold, pending_release, pending_press, last_press */ }
impl CoordinatorState {
    pub fn new() -> Self;
    pub fn on_input(&mut self, input: InputEvent) -> Option<Effect>;
    pub fn on_grace_expired(&mut self) -> Option<Effect>;
    pub fn on_processing_finished(&mut self) -> Option<Effect>;
    pub fn on_cancel(&mut self) -> Option<Effect>;
    pub fn on_start_result(&mut self, started: bool);
    pub fn grace_deadline(&self) -> Option<Instant>;
    pub fn stage(&self) -> Stage;
    pub fn is_locked(&self) -> bool;
    pub fn is_recording(&self) -> bool;
}
pub struct TranscriptionCoordinator { /* mpsc::Sender<Command>, thread */ }
impl TranscriptionCoordinator {
    pub fn new(app: AppHandle, dictation: DictationDriver) -> Self;
    pub fn send_input(&self, is_pressed: bool, mode: ShortcutActivation, hold_threshold: Duration);
    pub fn send_external(&self, is_pressed: bool);  // CLI/трей — без debounce
    pub fn notify_cancel(&self);
    pub fn notify_processing_finished(&self);
}
pub trait DictationDriver: Send + 'static {       // шов к stt/mod.rs, чтобы ptt.rs не зависел от SttState
    fn start(&self) -> bool;                      // true, если запись реально началась
    fn stop(&self, cancel: bool);
}
```
Тесты `ptt.rs` переносятся из Handy: длинное удержание, тап-фиксация, автоповтор-серия =
одна запись, отпускание внутри grace, нажатие во время распознавания, два тапа = no-op,
отмена снимает фиксацию, отказ старта возвращает в Idle.

```rust
// stt/shortcuts.rs
pub struct SpeechBindings { pub transcribe: String, pub cancel: String }
pub fn parse_accelerator(s: &str) -> Result<Shortcut, String>;   // "Ctrl+Shift+D" -> Shortcut
pub fn apply_bindings(app: &AppHandle, bindings: &SpeechBindings) -> Result<(), String>;
pub fn unregister_all(app: &AppHandle);
pub fn suspend(app: &AppHandle);
pub fn resume(app: &AppHandle);
pub fn validate(app: &AppHandle, accelerator: &str) -> Result<(), String>; // пробная регистрация + снятие
```
Обработчик: `Pressed`/`Released` → `TranscriptionCoordinator::send_input`; `cancel` — только на `Pressed`.

```rust
// stt/vad.rs
pub enum VadBackend { Energy, Earshot }
pub struct VadConfig { pub backend: VadBackend, pub energy_threshold: f32,
    pub prefill_ms: u32, pub onset_ms: u32, pub hangover_ms: u32, pub sample_rate: u32 }
impl Default for VadConfig { /* 0.015, 450, 60, 450, 16000 */ }
pub enum VadFrame<'a> { Speech(&'a [f32]), Noise(&'a [f32]) }
pub trait VoiceActivityDetector: Send { fn push_frame<'a>(&mut self, frame: &'a [f32]) -> VadFrame<'a>;
    fn frame_samples(&self) -> usize; fn reset(&mut self); }
pub struct EnergyVad { /* 30 мс кадр, RMS */ }
pub struct EarshotVad { /* 16 мс кадр, earshot::Detector, порог 0.5 */ }
pub struct SmoothedVad { /* prefill-пре-ролл, onset, hangover; см. R14 */ }
pub fn build(cfg: &VadConfig) -> Box<dyn VoiceActivityDetector + Send>;

// stt/capture.rs (переписывается; публичная поверхность)
pub const SAMPLE_RATE: u32 = 16_000;
pub struct AudioDeviceInfo { pub name: String, pub is_default: bool, pub channels: u16 }
pub fn input_devices() -> Result<Vec<AudioDeviceInfo>, String>;
pub fn output_devices() -> Result<Vec<String>, String>;
pub fn input_channels(device: &str) -> Result<u16, String>;
pub struct CaptureOptions { pub device: Option<String>, pub channel: Option<u16>, pub vad: VadConfig }
pub struct AudioCaptureState { /* как сейчас: is_recording(), level(), request_stop() */ }
pub fn start_audio_capture(opts: CaptureOptions, state: AudioCaptureState)
    -> Result<AudioCaptureHandle, CaptureError>;
// native rate + ресемплинг в 16 кГц сохраняются; добавляются выбор канала и VAD-политика

// stt/feedback.rs
pub enum SoundKind { Start, Stop, Cancel, Error }
pub enum SoundTheme { Default, Soft, Mechanical }
pub fn play(kind: SoundKind, theme: SoundTheme, volume: f32);
pub fn play_test(kind: SoundKind, theme: SoundTheme, volume: f32);
// rodio; mp3/wav, встроенные тоны синтезируются, если файла темы нет

// stt/history.rs
pub struct HistoryEntry { pub id: String, pub text: String, pub created_at: String,
    pub duration_ms: u64, pub model_id: Option<String>, pub language: Option<String>,
    pub audio_path: Option<String>, pub saved: bool, pub app_name: Option<String> }
pub fn insert(app: &AppHandle, entry: &HistoryEntry) -> Result<(), String>;
pub fn list(app: &AppHandle, limit: usize) -> Result<Vec<HistoryEntry>, String>;
pub fn delete(app: &AppHandle, id: &str) -> Result<(), String>;
pub fn set_saved(app: &AppHandle, id: &str, saved: bool) -> Result<(), String>;
pub fn get(app: &AppHandle, id: &str) -> Result<Option<HistoryEntry>, String>;
pub fn prune(app: &AppHandle, limit: usize, retention_days: u32) -> Result<usize, String>;
pub fn clear(app: &AppHandle) -> Result<(), String>;

// stt/postprocess.rs
pub struct PostProcessConfig { pub enabled: bool, pub prompt: String, pub base_url: String,
    pub api_key: String, pub model: String }
pub fn polish(text: &str, cfg: &PostProcessConfig) -> Result<String, String>; // блокирующий вызов, вызывать в spawn_blocking
```

```rust
// stt/dictation.rs (расширяется)
pub enum PasteMethod { CtrlV, ShiftInsert, Direct }      // default CtrlV
pub enum ClipboardBehavior { Restore, Keep }             // default Restore
pub struct PasteOptions { pub method: PasteMethod, pub behavior: ClipboardBehavior,
    pub delay_before_ms: u64, pub delay_after_ms: u64, pub append_space: bool, pub auto_submit: bool }
impl Default for PasteOptions { /* CtrlV, Restore, 60, 60, false, false */ }
pub fn deliver_text(text: &str, opts: &PasteOptions) -> InjectionOutcome;
pub fn is_target_window_elevated() -> bool;              // существует
pub fn inject_or_copy_text(text: &str) -> InjectionOutcome; // существует, сохраняется
```

## 3. Команды Tauri (регистрирует W2; имена заморожены)

Существующие (сохраняются, меняется только форма ответа там, где указано):
`stt_catalog`, `stt_download`, `stt_download_cancel`, `stt_model_delete`, `stt_download_progress`,
`stt_engine`, `stt_set_engine`, `stt_start_dictation`, `stt_stop_dictation`, `stt_cancel_dictation`,
`stt_dictation_state`, `stt_transcribe_file`, `stt_transcribe_cloud`.

Новые:

| Команда | Сигнатура | Смысл |
|---|---|---|
| `stt_rescan_models` | `() -> Vec<ModelInfo>` | пересканировать папку моделей (положить файл руками) |
| `stt_import_model` | `(path: String) -> ModelInfo` | принять свой `.gguf` в папку моделей |
| `stt_models_dir` | `() -> String` | путь к папке моделей |
| `stt_open_models_dir` | `() -> ()` | открыть в проводнике |
| `stt_free_disk_space` | `() -> u64` | свободно на диске моделей |
| `stt_speech_settings` | `() -> SpeechConfig` | настройки речи как их видит backend |
| `stt_apply_speech_settings` | `(patch: SpeechConfigPatch) -> SpeechConfig` | записать в префы и применить (хоткеи, VAD…) |
| `stt_validate_hotkey` | `(accelerator: String) -> ()` | `Err(причина)`, если комбинация невалидна/занята |
| `stt_suspend_shortcuts` / `stt_resume_shortcuts` | `() -> ()` | на время записи хоткея в UI |
| `stt_input_devices` | `() -> Vec<AudioDeviceInfo>` | список микрофонов |
| `stt_input_channels` | `(device: String) -> u16` | каналы устройства |
| `stt_output_devices` | `() -> Vec<String>` | устройства вывода для звуков |
| `stt_play_test_sound` | `(kind: String) -> ()` | прослушать звук старт/стоп |
| `stt_mic_level` | `() -> f32` | уровень для шкалы без записи (проверка микрофона) |
| `stt_history_list` | `(limit: Option<usize>) -> Vec<HistoryEntry>` | история |
| `stt_history_delete` | `(id: String) -> ()` | удалить запись |
| `stt_history_set_saved` | `(id: String, saved: bool) -> ()` | «сохранить» запись |
| `stt_history_retry` | `(id: String) -> TranscriptionResult` | распознать сохранённое аудио заново |
| `stt_history_clear` | `() -> ()` | очистить историю |
| `stt_postprocess` | `(text: String) -> String` | прогнать транскрипт через модель |
| `stt_cancel_transcription` | `(path: String) -> ()` | **уже есть**, добавить в `generate_handler!` |
| `stt_accelerators` | `() -> Vec<AcceleratorInfo>` | доступные устройства вычисления для Whisper (см. §5a) |

`stt_speech_settings` возвращает:

```rust
pub struct SpeechConfig {
    pub enabled: bool, pub activation: ShortcutActivation, pub hotkey: String,
    pub cancel_hotkey: String, pub hold_threshold_ms: u64, pub engine: String,
    pub model_id: Option<String>, pub device: Option<String>, pub channel: Option<u16>,
    pub vad_backend: String, pub vad_energy_threshold: f32,
    pub language: Option<String>, pub translate_to_english: bool,
    pub custom_words: Vec<String>, pub remove_filler_words: bool,
    pub paste_method: String, pub clipboard_behavior: String,
    pub paste_delay_ms: u64, pub paste_delay_after_ms: u64,
    pub append_space: bool, pub auto_submit: bool,
    pub feedback_enabled: bool, pub feedback_volume: f32, pub sound_theme: String,
    pub history_enabled: bool, pub history_limit: usize, pub retention_days: u32,
    pub postprocess_enabled: bool, pub postprocess_prompt: String,
    pub overlay_enabled: bool, pub onboarded: bool,
}
pub struct SpeechConfigPatch { /* те же поля в Option<…> */ }
```
`SpeechConfigPatch` сериализуется с `#[serde(default)]` — отсутствующее поле не меняется.

## 4. События backend → frontend

| Событие | Payload | Когда |
|---|---|---|
| `stt://model-progress` | `DownloadProgress` (см. §2) | во время скачивания/проверки, ≤10 Гц |
| `stt://model-complete` | `{ "modelId": String }` | файл скачан, проверен, переименован |
| `stt://model-failed` | `{ "modelId": String, "error": String }` | ошибка/отмена |
| `stt://models-updated` | `{}` | список моделей изменился (пересканирование, импорт, удаление) |
| `stt://dictation-started` | `{ "mode": String }` | запись началась (уже эмитится) |
| `stt://dictation-stopped` | `TranscriptionResult` (уже эмитится) | запись закончилась, текст готов |
| `stt://dictation-cancelled` | `{}` | отмена без вставки |
| `stt://dictation-level` | `{ "level": f32 }` | 20 Гц во время записи (шкала) |
| `stt://speech-error` | `{ "code": String, "message": String }` | `SttErrorCode` из `stt.ts` |

Polling `stt_dictation_state` сохраняется (обратная совместимость), события — основной путь.

### 5a. Добавлено 2026-09-22 (паритет с разделом Advanced у Handy)

| Ключ префа | Тип | Смысл |
|---|---|---|
| `tempo_speech_accelerator` | string | `auto` \| `cpu` \| `gpu` — какой backend просить у transcribe-cpp (Handy: `AccelerationSelector`) |
| `tempo_speech_gpu_device` | string | стабильный id устройства из `transcribe_cpp::devices()`; пусто — выбор бэкенда |
| `tempo_speech_model_unload_secs` | number | `0` — не выгружать модель из памяти; иначе простой в секундах (Handy: `ModelUnloadTimeout`) |

`SpeechConfig` расширяется тремя полями: `accelerator: string`, `gpuDevice: string | null`,
`modelUnloadSecs: number` (значение `0` = никогда). `SpeechConfigPatch` — те же поля в `Option`.

Команда `stt_accelerators() -> Vec<AcceleratorInfo>` возвращает доступное железо:

```rust
pub struct AcceleratorInfo { pub id: String, pub name: String, pub kind: String,
    pub device_type: String, pub memory_total: u64, pub memory_free: u64, pub is_cpu: bool }
```

Загрузка модели (`engine.rs`) использует `Model::load_with(path, &ModelOptions { backend, device })`:
`auto` → `Backend::Auto`, `cpu` → `Backend::Cpu`, `gpu` + `gpu_device` → соответствующий `Device`.
Смена настройки в `stt_apply_speech_settings` выгружает уже загруженную модель, чтобы новый
backend применился к следующему распознаванию, а не к следующему запуску приложения.

### 5. Префы (SQLite `preferences`, Rust читает те же ключи через `repo::pref_get`)

`tempo_speech_enabled` (bool), `tempo_speech_activation` (`toggle|push_to_talk|hold_or_toggle`),
`tempo_speech_hotkey` (string, уже есть), `tempo_speech_cancel_hotkey`, `tempo_speech_hold_threshold_ms`,
`tempo_speech_engine` (`local|cloud`), `tempo_speech_model_id` (уже есть), `tempo_speech_device`,
`tempo_speech_channel`, `tempo_speech_vad_backend` (`energy|earshot`), `tempo_speech_vad_energy_threshold`,
`tempo_speech_language`, `tempo_speech_translate_to_english`, `tempo_speech_custom_words` (string),
`tempo_speech_remove_filler_words`, `tempo_speech_paste_method`, `tempo_speech_clipboard_behavior`,
`tempo_speech_paste_delay_ms`, `tempo_speech_paste_delay_after_ms`, `tempo_speech_append_space`,
`tempo_speech_auto_submit`, `tempo_speech_feedback_enabled`, `tempo_speech_feedback_volume`,
`tempo_speech_sound_theme`, `tempo_speech_history_enabled`, `tempo_speech_history_limit`,
`tempo_speech_retention_days`, `tempo_speech_postprocess_enabled`, `tempo_speech_postprocess_prompt`,
`tempo_speech_overlay_enabled`, `tempo_speech_onboarded`.
Устаревший префикс `alarmer_speech_*` читается как fallback (как сейчас в `speechSettings.ts`).

Таблица истории (владелец HistoryBackend, регистрируется в `storage/schema.rs` + `migrations.rs`):

```
stt_history(id TEXT PRIMARY KEY, text TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, deleted_at TEXT, duration_ms INTEGER, model_id TEXT,
  language TEXT, audio_path TEXT, saved INTEGER NOT NULL DEFAULT 0, app_name TEXT)
```
`soft_delete: false` — записи удаляются физически вместе с аудиофайлом.

## 6. Frontend: сервисы (W3 FrontendServices)

```ts
// src/services/stt.ts — расширяется; имена ниже заморожены для SpeechUI
export function listModels(): Promise<ModelInfo[]>;              // было
export function downloadModel(modelId: string, quant?: string): Promise<void>; // расширено
export function cancelDownload(modelId: string): Promise<void>;  // было
export function downloadProgress(): Promise<DownloadProgress[]>; // теперь массив
export function deleteModel(modelId: string): Promise<void>;     // было
export function rescanModels(): Promise<ModelInfo[]>;
export function importModel(path: string): Promise<ModelInfo>;
export function modelsDir(): Promise<string>;
export function openModelsDir(): Promise<void>;
export function freeDiskSpace(): Promise<number>;
export function setEngine(engine: SttEngineKind, modelId?: string | null): Promise<void>; // было
export function startDictation(mode?: DictationMode): Promise<void>;   // было
export function stopDictation(): Promise<DictationResult>;             // было
export function cancelDictation(): Promise<void>;                      // было
export function dictationState(): Promise<DictationState>;             // было
export function transcribeFile(path: string): Promise<TranscribeResult>; // было
export function getSpeechConfig(): Promise<SpeechConfig>;   // stt_speech_settings (alias: speechConfig)
export function applySpeechConfig(patch: Partial<SpeechConfig>): Promise<SpeechConfig>;
export function validateHotkey(accel: string): Promise<void>;
export function suspendShortcuts(): Promise<void>;
export function resumeShortcuts(): Promise<void>;
export function inputDevices(): Promise<AudioDeviceInfo[]>;
export function inputChannels(device: string): Promise<number>;
export function outputDevices(): Promise<string[]>;
export function playTestSound(kind: 'start' | 'stop'): Promise<void>;
export function micLevel(): Promise<number>;
export function historyList(limit?: number): Promise<HistoryEntry[]>;
export function historyDelete(id: string): Promise<void>;
export function historySetSaved(id: string, saved: boolean): Promise<void>;
export function historyRetry(id: string): Promise<TranscribeResult>;
export function historyClear(): Promise<void>;
export function postprocessText(text: string): Promise<string>;

// src/services/sttEvents.ts — единая подписка; возвращает unsubscribe
export type SttEvent =
  | { type: 'model-progress'; progress: DownloadProgress }
  | { type: 'model-complete'; modelId: string }
  | { type: 'model-failed'; modelId: string; error: string }
  | { type: 'models-updated' }
  | { type: 'dictation-started'; mode: string }
  | { type: 'dictation-stopped'; result: DictationResult }
  | { type: 'dictation-cancelled' }
  | { type: 'dictation-level'; level: number }
  | { type: 'speech-error'; code: SttErrorCode; message: string };
export function onSttEvent(handler: (e: SttEvent) => void): () => void;

// src/services/speechSettings.ts — расширяется до полного SpeechConfig
export interface SpeechConfig { /* те же поля, что в Rust §3, camelCase */ }
export const DEFAULT_SPEECH_CONFIG: SpeechConfig;
export function loadSpeechConfig(): SpeechConfig;
export function saveSpeechConfig(patch: Partial<SpeechConfig>): Promise<SpeechConfig>;
export function subscribeSpeechConfig(cb: (c: SpeechConfig) => void): () => void;
export const speechSettings = loadSpeechConfig;      // обратная совместимость
export const setSpeechSettings = saveSpeechConfig;
```
Сохранение настроек — **через backend** (`applySpeechConfig` → `stt_apply_speech_settings`),
чтобы Rust и UI не разъезжались: Rust пишет префы сам, фронт читает `loadSpeechConfig()`
из своей кэш-копии префов, которая обновляется из ответа команды.

## 7. Frontend: UI (W3 SpeechUI)

Секция `activeSection === 'speech'` в `SettingsView.tsx` заменяется на `<SpeechPanel />`.
Новые компоненты (все под `src/components/speech/`):
`SpeechPanel.tsx` (корень, под-табы), `ModelLibrary.tsx`, `ModelCard.tsx`, `DownloadBar.tsx`,
`PttSettings.tsx`, `HotkeyRecorder.tsx`, `AudioSettings.tsx` (устройство, канал, VAD, уровень),
`DeliverySettings.tsx` (метод вставки, буфер, задержки, пробел, авто-отправка),
`FeedbackSettings.tsx`, `LanguageSettings.tsx`, `CustomWordsSettings.tsx`,
`HistoryPanel.tsx`, `PostProcessSettings.tsx`, `SpeechOnboarding.tsx`, `SpeechDebug.tsx`.
`DictationIndicator.tsx` расширяется: уровень, таймер, режим, живой текст, кнопка отмены;
обязан принимать `variant?: 'pill' | 'overlay'`.

Правила: только существующие токены/CSS-переменные (`--surface`, `--border`, `--text-muted`,
`--elevated`), существующие примитивы из `src/components/ui/`, ключи i18n — в `src/services/i18n.ts`
(обязательны обе локали, `ru` и `en`), никаких новых зависимостей.

### 7.1 Пропсы компонентов (заморожено 2026-09-22, владельцы — §1)

Все секции однотипны — `SettingsView` не знает ничего о внутренностях, кроме `config`/`onChange`:

```ts
export interface SpeechPanelProps {          // корень секции «Speech to Text»
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}
export interface SpeechSectionProps {        // AudioSettings, DeliverySettings, FeedbackSettings,
  config: SpeechConfig;                      // LanguageSettings, CustomWordsSettings,
  onChange: (patch: Partial<SpeechConfig>) => void;  // HistoryPanel, PostProcessSettings, SpeechDebug
  disabled?: boolean;
}
export interface SpeechOnboardingProps {
  open: boolean;
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  onClose: () => void;                       // закрыть без завершения
  onComplete: () => void;                    // пишет onboarded = true
}
```

`SpeechPanel` — единственный владелец под-табов (значения совпадают с ключами i18n
`settingsSpeechTab*`: `models | ptt | audio | delivery | feedback | language | history | postprocess | debug`)
и единственное место, где рендерится `SpeechOnboarding` (открывается при `!config.onboarded`).
`ModelLibrary` уже написан под `{ activeModelId, onSelectModel, disabled }`.
`DictationIndicator` получает `variant?: 'pill' | 'overlay'`, `pollIntervalMs?`, `onStop?`.
Каждый компонент обязан иметь `data-testid` на интерактивных узлах (`data-testid="speech-tab-audio"`,
`"speech-panel"` и т. п.) — на них опираются тесты W3 и ручная приёмка.

## 8. Порядок сборки

- W1-исполнители **не запускают** `cargo check`/`clippy`/тесты: крейт в это время не компилируется
  из-за соседей. Компиляцию и `cargo test` делает W2 Integration (единственный владелец сборки).
- W3-исполнители не запускают `bun run check` целиком; допускается `bunx vitest run <файл>` по своим тестам.
- Финальные прогоны `bun run check:all` и ручной прогон — за оркестратором (W4).
