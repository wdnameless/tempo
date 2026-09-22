# Recon: порт функциональности Handy в модуль диктовки Tempo

Дата: 2026-09-22. Референс склонирован в `D:/WORK/.refs/handy` (MIT, Rust+Tauri+React —
тот же стек, код переносится почти дословно).

## Что уже есть у нас (проверено чтением кода)

| Файл | Состояние |
|---|---|
| `src-tauri/src/stt/models.rs` (569) | Каталог из 4 GGUF-моделей (tiny/base/small/medium, Q8_0), URL вида `huggingface.co/handy-computer/whisper-{id}-gguf/resolve/main/{file}`. Скачивание в `.partial` + атомарный rename, прогресс, отмена, удаление, проверка места. **Нет sha256, зеркал, квантов, скорости/ETA, пересканирования, импорта файла.** |
| `src-tauri/src/stt/engine.rs` (154) | transcribe-cpp: ленивая загрузка, сессия, cancel-token, выгрузка по простою 60 с. Работает. |
| `src-tauri/src/stt/capture.rs` (425) | cpal, нативный sample rate → линейный ресемплинг в 16 кГц, энергетический VAD (RMS 0.015), обрезка тишины, `MIN_SPEECH_FRAMES=10`. **Нет выбора устройства/канала, нет нейро-VAD, нет prefill/onset/hangover.** |
| `src-tauri/src/stt/dictation.rs` (386) | Инъекция текста: clipboard + SendInput Ctrl+V + восстановление буфера, проверка elevation, `DictationMode::{PushToTalk,Toggle}` (enum есть, PTT не используется). **Нет прямого набора, Shift+Insert, задержек, авто-Enter, пробела в конце.** |
| `src-tauri/src/stt/mod.rs` (470) | `SttState` + 14 команд (`stt_catalog` … `stt_transcribe_cloud`). `stt_cancel_transcription` определена, но **не зарегистрирована** в `lib.rs`. |
| `src-tauri/src/lib.rs:374` | **Хардкод Ctrl+Shift+D, только toggle.** Release игнорируется, `tempo_speech_hotkey` не подключён ни к чему. |
| `src-tauri/src/stt/cloud.rs` (170) | Облачная транскрипция (OpenAI-совместимая) — оставляем как есть. |
| `src/services/stt.ts` (9.4K) | Типизированные обёртки + `SttError` + `pollDownloadProgress`. |
| `src/services/speechSettings.ts` | Три ключа: `enabled`, `hotkey`, `modelId`. Хоткей нигде не применяется. |
| `src/components/SettingsView.tsx` (86.8K) | Секция `speech`: чекбокс, текстовое поле хоткея, сегмент local/cloud, список моделей с прогрессом. |
| `src/components/DictationIndicator.tsx` (4.5K) | Пилюля с уровнем, polling `stt_dictation_state` каждые 100 мс. |

Швы проекта: префы — SQLite `preferences` + `services/settings.ts` (`getPref/setPref/subscribePrefs`),
Rust читает те же префы через `storage::repo::pref_get/pref_set`; таблицы — белый список в
`storage/schema.rs`, миграции в `storage/migrations.rs`; ИИ — `src-tauri/src/ai.rs` + `services/aiGateway.ts`;
`bun run check:all` = tsc + eslint + vitest + cargo test.

## Что берём из Handy (механизмы, подтверждённые чтением кода референса)

1. **Каталог** — `catalog.json` вкомпилирован (`include_str!`), нормализуется в дескрипторы:
   `files[] { filename, quant, size_bytes, sha256 }`, `default_quant`, `mirrors[]`,
   `speed_score/accuracy_score` (0–100 → 0–1), `recommended`, `revision` (пин коммита HF).
2. **Загрузчик** — `managers/model/download.rs`: возобновляемый HTTP (`Range`, проверка
   `Content-Range`, 416/200-обработка), `HTTP_CONNECT_TIMEOUT=15s`, `DOWNLOAD_STALL_TIMEOUT=60s`,
   sha256 в 64 КБ чанках на blocking-пуле, удаление битого партиала, прогресс ≤10 Гц,
   зеркало как недоверенный транспорт с хэшем как якорем доверия.
3. **Автомат активации** — `transcription_coordinator.rs`: `ShortcutActivation::{Toggle,PushToTalk,HoldOrToggle}`,
   `DEBOUNCE=30ms`, `RELEASE_GRACE=50ms`, порог удержания 300 мс, `HoldOrToggle` (тап фиксирует запись),
   подавление автоповтора через отложенный release, `pending_press` на время `Stage::Processing`.
   Чистое ядро (`CoordinatorState` без Tauri) + тесты — переносится целиком.
4. **Захват** — cpal, нативный rate/формат (F32>I16>I32), кольцевой буфер 2 с, дренаж 50 мс
   каждые 10 мс, ресемплер чанками 1024, выбор канала или усреднение.
5. **VAD** — `SmoothedVad`: prefill 450 мс (пре-ролл), onset 60 мс, hangover offline 450 мс /
   streaming 1650 мс; бэкенды Silero (ONNX, 30 мс/480 сэмплов, порог 0.3) и Earshot
   (чистый Rust, 16 мс/256 сэмплов, порог 0.5).
6. **Вставка** — методы `CtrlV | CtrlShiftV | ShiftInsert | Direct(enigo) | ExternalScript`,
   сохранение/восстановление буфера, задержки до/после (60 мс), авто-Enter (50 мс), пробел в конце.
7. **Фидбек** — звуки start/stop (rodio), том, тема, кастомные звуки; оверлей со шкалой уровня 30 FPS.
8. **История** — записи с аудио, лимит, срок хранения, повторное распознавание, «сохранить».
9. **Пост-обработка** — LLM по транскрипту (у нас — через существующий `ai.rs`/`aiGateway`, а не второй клиент).

## Решения по отклонениям (согласованы объёмом «всё как в Handy», но с поправкой на наш стек)

- **Движок только Whisper/GGUF** (выбор пользователя) → каталог = семейство Whisper с квантами;
  Parakeet/Nemotron/SenseVoice из каталога Handy не берём (нужен ONNX-рантайм).
- **Silero VAD (ONNX)** — `vad-rs` в Handy подключён git-форком и тянет ONNX Runtime (~десятки МБ в
  установщик). Берём два других бэкенда: Energy (наш) + Earshot (чистый Rust, тоже фича Handy).
  `defer: Silero ONNX backend | ceiling: energy + earshot | upgrade: добавить ort при бюджете размера`.
- **Второй бэкенд клавиатуры Handy (`handy-keys`, обход системных хоткеев)** — на Windows хватает
  `tauri-plugin-global-shortcut`; отдельный низкоуровневый хук не берём (нет macOS-кейса `fn`-клавиши).
- **Оверлей отдельным окном** — у нас уже есть `MiniOverlay` и внутриоконная пилюля; расширяем
  индикатор (уровень, таймер, режим, отмена, живой текст) вместо второго webview-окна.
- **LLM пост-обработка** идёт через наш `ai.rs` (Base URL + ключ из keyring), а не через копию
  `llm_client.rs` — иначе в приложении станет два пути к модели.

## Приёмка

1. `bun run check:all` — зелёный (tsc, eslint, vitest, cargo test), включая новые модульные тесты автомата.
2. Ручной прогон в собранном приложении: скачать модель из каталога (прогресс, скорость, отмена,
   проверка хэша), зажать хоткей → запись → отпустить → текст в стороннем окне; короткий тап
   фиксирует запись; автоповтор клавиши не рвёт запись.
3. Каталог: ≥20 позиций, виден размер/квант/языки/скорость/точность, есть удаление и пересканирование.
