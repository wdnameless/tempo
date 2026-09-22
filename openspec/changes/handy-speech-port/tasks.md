# Tasks: Handy → Tempo speech module

Пять волн. Владельцы файлов — в `interfaces.md`. Внутри волны исполнители не пересекаются.

## W1 — Rust core (параллельно, 5 исполнителей)

- [ ] **ModelsBackend**: `stt/catalog.rs` + `stt/catalog.json` (≥20 позиций Whisper: tiny/base/small/medium/large-v3/large-v3-turbo × кванты Q5_K_M/Q8_0, sha256, размеры, языки, speed/accuracy 0–1, recommended, `repo_id` + `revision`, зеркала) — R04.
- [ ] **ModelsBackend**: `stt/models.rs` — `ModelManager` (каталог ∪ локальные ∪ кастомные), возобновляемая загрузка (`Range`, разбор `Content-Range`, обработка 200/206/416), stall-timeout 60 с, sha256-верификация в 64 КБ чанках, скорость и ETA, отмена, удаление, `rescan`, `import_file`, свободное место, зеркала как fallback — R02, R03, R05.
- [ ] **PttBackend**: `stt/ptt.rs` — чистый `CoordinatorState` (три режима, DEBOUNCE 30 мс, RELEASE_GRACE 50 мс, порог 300 мс, `pending_press` на время распознавания, фиксация по тапу, отмена) + `TranscriptionCoordinator` на своём потоке + юнит-тесты, перенесённые из Handy — R06, R07, R10, R11, R12.
- [ ] **PttBackend**: `stt/shortcuts.rs` — разбор акселератора, регистрация/снятие/приостановка биндингов, `validate` с причиной отказа, обработчик press/release → координатор — R09.
- [ ] **AudioBackend**: `stt/vad.rs` — трейт VAD + Energy + Earshot + `SmoothedVad` (prefill 450 / onset 60 / hangover 450 мс) — R13, R14.
- [ ] **AudioBackend**: `stt/capture.rs` — нативный rate + ресемплинг, выбор устройства и канала, VAD-политика, уровень — R13.
- [ ] **AudioBackend**: `stt/feedback.rs` — звуки старт/стоп/отмена/ошибка, темы, громкость (rodio) — R18.
- [ ] **HistoryBackend**: `stt/history.rs` + таблица `stt_history` в `storage/schema.rs` и `migrations.rs` (лимит, срок хранения, повтор, удаление, «сохранить») — R19.
- [ ] **HistoryBackend**: `stt/postprocess.rs` — пост-обработка транскрипта через конфиг нашего AI-шва — R20.
- [ ] **InjectionBackend**: `stt/dictation.rs` — методы вставки (Ctrl+V / Shift+Insert / прямой набор), поведение буфера, задержки, пробел в конце, авто-отправка — R17.

## W2 — Integration (после W1, один исполнитель)

- [ ] Собрать `stt/mod.rs`: `SttState` со всеми подсистемами, 20+ команд по таблице `interfaces.md §3`, `SttErrorCode`-совместимые ошибки.
- [ ] Собрать `lib.rs`: лишние импорты/модули, `generate_handler!`, регистрация хоткеев на старте **из префов SQLite** (до открытия окна), `stt_cancel_transcription` в списке команд, события §4, запись истории после распознавания, пост-обработка, звуки, аппенд-пробел/авто-отправка.
- [ ] `cargo test` зелёный; `cargo check` без предупреждений в новых модулях; тесты автомата и VAD проходят.

## W3 — Frontend (параллельно с W2, 2 исполнителя)

- [ ] **FrontendServices**: `services/stt.ts` (полный набор обёрток §6), `services/sttEvents.ts` (единая подписка), `services/speechSettings.ts` (полный `SpeechConfig`, миграция с трёх старых ключей), ключи i18n для обеих локалей, тесты сервисов — R02, R03, R25.
- [ ] **SpeechUI**: `components/speech/*` (§7) — библиотека моделей с поиском/фильтрами/квантами и прогрессом, захват хоткея, режимы и порог, аудио (устройство/канал/VAD/уровень), вставка, звуки, язык, словарь, история, пост-обработка, онбординг, диагностика; замена секции в `SettingsView.tsx`; расширенный `DictationIndicator.tsx` — R01–R03, R06, R08, R09, R13, R15–R18, R21–R23.

## W4 — Acceptance (после W2+W3)

- [ ] `bun run check:all` — tsc, eslint, vitest, cargo test, покрытие выше порогов.
- [ ] `bun run tauri build --no-bundle` — сборка проходит (проверка, что новые зависимости не ломают линковку).
- [ ] Ручной прогон в собранном приложении: скачать модель (прогресс/отмена/хэш), зажать хоткей → текст в стороннем окне, тап фиксирует, автоповтор не рвёт запись, Esc отменяет, история пишется, звук играет.
- [ ] Oracle: слепая приёмка diff против этого брифа + `manifest.md`.
- [ ] `node tools/archmap.mjs scan` и одна строка про дельту архитектуры.
