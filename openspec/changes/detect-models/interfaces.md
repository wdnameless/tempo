# Interfaces: обнаружение чужих моделей и запуск GGUF (заморожено 2026-09-24)

Запрос: «я хочу, чтобы мы автоматически детектили загружены в данный момент модели, к примеру
сейчас у нас загружена nemotron через хенди. Так же я хочу интерфейс выбора моделей такой»
(со скриншотами экрана Handy: разделы «Downloaded models» / «Available to download», поиск,
полосы accuracy/speed, чипы языка и Streaming, размер, кнопка Delete).

## Что выяснила разведка

| Факт | Значение |
|---|---|
| Модели Handy | качает не в свою папку, а в кэш HuggingFace: `models--handy-computer--<name>/snapshots/<rev>/<file>.gguf` |
| На диске сейчас | **три** модели Handy в кэше: `nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf` (716 МБ, русский), `parakeet-tdt-0.6b-v2-Q8_0.gguf`, `parakeet-tdt-0.6b-v3-Q8_0.gguf`; плюс `Systran/faster-whisper-small` |
| Два кэша | `C:\Users\Administrator\.cache\huggingface\hub` и `D:\npm-global\.cache\huggingface\hub` — оба надо смотреть, дубликаты схлопывать по пути |
| Своя папка Handy | `%APPDATA%\com.pais.handy\models` — пуста (не источник) |
| Чем запускать | `transcribe-cpp` (ggml): архитектура определяется по метаданным GGUF — Whisper, Parakeet, Nemotron, Voxtral, Qwen3-ASR |
| Наш каталог | уже 24 модели; `engine` у каждой |

## Замороженные поля `ModelInfo`

```ts
source: 'catalog' | 'custom' | 'detected';   // 'detected' — найденное на диске чужое
origin?: string;                              // человекочитаемо: 'Handy' | 'HuggingFace cache' | 'Tempo'
deletable?: boolean;                          // false у чужого — удалять его мы не имеем права
engine: 'whisper' | 'parakeet' | 'canary' | 'cohere' | 'moonshine' | 'sensevoice' | 'gigaam' | 'transcribecpp';
```

- `path` у найденной модели — абсолютный путь к файлу **на месте** (никакого копирования).
- `engine: 'transcribecpp'` — для GGUF-моделей, чью архитектуру определяет transcribe-cpp.
- Найденное показывается как установленное и **готовое к выбору**, а не как «скачайте ещё раз».

## Где ищем (порядок обхода, только чтение)

1. Своя папка Tempo (`models/`) — как сейчас.
2. Своя папка пользователя (`%HF_HOME%`, `%HUGGINGFACE_HUB_CACHE%`, `%USERPROFILE%\.cache\huggingface\hub`) — репозитории `handy-computer/*`, файлы `*.gguf`, `*.onnx` с рядом лежащим `config.json`/`vocab.txt`.
3. `%APPDATA%\com.pais.handy\models` — на случай, если Handy туда что-то положит.

Скан не должен занимать больше пары секунд на пустом диске и не должен падать, если каталога нет.
Дубликаты по одинаковому пути схлопываются; уже известные каталогу файлы не показываются дважды.

## Владение файлами

| Исполнитель | Владеет |
|---|---|
| `DetectModels` | `src-tauri/src/stt/models.rs`, `src/services/stt.ts` (тип), тесты этих файлов |
| `GgufEngine` | `src-tauri/src/stt/engine.rs`, `src-tauri/Cargo.toml`, тесты |
| `ModelListUi` | `src/components/speech/**`, `src/services/i18n.ts`, тесты |

Пересечений нет. Ключи i18n пишет только `ModelListUi`.

## Доказательство

- `cargo test` + `clippy -D warnings`: найден nemotron-подобный файл в поддельном кэше HF; дубликат не
  показывается дважды; отсутствующий каталог не роняет скан; чужое помечено `deletable: false`.
- Настоящий запуск: `nemotron-3.5-asr-streaming-0.6b-Q8_0.gguf` с диска → текст (русский/английский).
- `bunx tsc --noEmit`, `eslint`, `vitest`; живой экран: разделы «Загруженные» / «Доступные»,
  поиск, полосы точности и скорости, размер, удаление только у своих.
