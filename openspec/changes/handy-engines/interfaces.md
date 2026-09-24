# Interfaces: движки Handy (модели вне whisper) — заморожено 2026-09-24

Запрос: «STT должен быть список из локальных моделей которые есть в handy» + ответ «весь набор handy».

## Что выяснила разведка

| Факт | Значение |
|---|---|
| Движки Handy | не самописные: крейт `transcribe-rs` (фича `onnx`) — Parakeet, Canary, Cohere, Moonshine, SenseVoice, GigaAM |
| Источник моделей | архивы `https://blob.handy.computer/<name>.tar.gz`, внутри папка с ONNX-файлами |
| API загрузки | `ParakeetModel::load(&PathBuf, &Quantization::Int8)` и родственные — путь к **папке** |
| Транскрипция | `transcribe_with(&samples, &Params { .. })` → `result.text`; общий трейт `SpeechModel` |
| Ускоритель | по умолчанию CPU; `set_ort_accelerator(OrtAccelerator::Auto)` — кроме DirectML (его надо просить явно) |
| Размеры | GigaAM v3 151 МБ, SenseVoice 152 МБ, Moonshine base 55 МБ, Parakeet v3 456 МБ |
| Наш ONNX | уже работает: Silero VAD едет на нём с 0.23.4 |

## Поля в нашем каталоге (заморожено)

```ts
// src-services/stt/models.ts (тип ModelInfo) — существующие поля плюс одно:
engine: 'whisper' | 'parakeet' | 'canary' | 'cohere' | 'moonshine' | 'sensevoice' | 'gigaam';
```

Правило: у моделей whisper (наши 13) `engine: 'whisper'`; у новых — свой движок. Поле обязательно,
чтобы интерфейс и бэкенд не угадывали по имени файла.

## Новая запись каталога (пример формы)

```json
{
  "id": "gigaam-v3",
  "name": "GigaAM v3 (русский)",
  "engine": "gigaam",
  "filename": "giga-am-v3-int8",
  "archive": "https://blob.handy.computer/giga-am-v3-int8.tar.gz",
  "bytes": 159235143,
  "languages": ["ru"],
  "speed_score": 0.9,
  "accuracy_score": 0.85,
  "recommended": true
}
```

Загрузка: `{filename}.part` → распаковка в `models/{filename}/` → запись маркера готовности. Распаковка
обязана быть безопасной от «zip-slip»: ни один путь из архива не выходит за папку модели.

## Владение файлами

| Исполнитель | Владеет |
|---|---|
| `EngineBackend` | `src-tauri/src/stt/{models,engine,mod}.rs`, `src-tauri/src/stt/catalog.json`, `src-tauri/Cargo.toml`, `src/services/speechSettings.ts` (только если нужен тип), тесты этих файлов |
| `EngineUi` | `src/components/speech/**`, `src/services/i18n.ts`, тесты этих файлов |

Пересечений нет. Ключи i18n пишет только `EngineUi`.

## Доказательство

- `cargo test` + `cargo clippy -D warnings`: распаковка кладёт файлы в нужную папку; «zip-slip» путь
  отклоняется; повторная загрузка не качает заново; каталог отдаёт движок для каждой модели.
- Транскрипция настоящей моделью: короткий WAV → осмысленный текст, для GigaAM — русский.
- `bunx tsc --noEmit`, `eslint`, `vitest` по затронутым тестам; живой экран: модели Handy в списке
  с языком, размером и движком.
