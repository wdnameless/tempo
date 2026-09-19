# Interfaces — Tempo Program

Границы и сигнатуры, под которые пишут все агенты. Владелец указан у каждой зоны;
менять чужую зону — только через `hub` владельцу. Один файл — один писатель.

## 1. Дизайн-система — владелец: Wave 0 (Foundation)

`src/constants/design.ts`:

```ts
export interface Palette {
  bg: string;            // почти чёрный фон окна
  surface: string;       // панель/сайдбар
  elevated: string;      // карточка
  text: string;          // основной
  textMuted: string;     // подписи и описания
  textFaint: string;     // отключённое
  border: string;        // тонкий разделитель
  accent: string;        // выбранный акцент
}
export const ACCENTS: Record<AccentId, string>;   // 8 оттенков
export const SPACE: [0, 4, 8, 12, 16, 24, 32, 48];
export const RADII: { sm: 6; md: 10; lg: 14; xl: 20 };
export const TYPE: { display; title; body; label; caption; mono };
```

`src/components/ui/` — компоненты, все с обязательным `theme` или CSS-переменной:

```ts
Row({ label, description?, control, onPress?, disabled? })
Toggle({ checked, onChange, disabled? })
Segmented<T>({ value, options: {value: T; label: string}[], onChange })
Slider({ value, min, max, step?, onChange, minLabel?, maxLabel? })
SectionHeader({ children })
Kbd({ keys: string[] })        // ⌘ K в прямоугольниках
Divider()
IconButton({ icon, label, onClick, active? })
```

Никакой компонент не рисует цвета напрямую: только токены через CSS-переменные
(`--bg`, `--surface`, `--text`, `--accent`, …). Смена акцента — одна переменная.

## 2. Хранилище — владелец: Wave 0 (Storage)

**Решение (проверено на этой машине): `rusqlite` с фичей `bundled`.** Пользователь выбрал rusqlite;
проба показала, что `rusqlite 0.32 bundled` + `fts5` + `tokenize='unicode61'` собирается за 12 секунд
и находит русский текст. `tauri-plugin-sql`/sqlx тянет тяжёлый async-стек и не даёт ничего сверх этого.

**Весь SQL живёт в Rust.** JS не содержит ни одной SQL-строки: он зовёт типизированные команды,
Rust строит запрос из белого списка таблиц и колонок. Почему так: SQL-ошибки ловятся в `cargo test`
против настоящей БД, а не в подделанном драйвере на стороне JS; и схема имеет одного владельца.

Rust (`src-tauri/src/storage/`):

```rust
// schema.rs — единственный белый список: таблица -> колонки и их типы
pub struct TableSchema { pub name: &'static str, pub columns: &'static [(&'static str, ColType)], pub soft_delete: bool }
pub fn table(name: &str) -> Option<&'static TableSchema>;

// migrations.rs — DDL версионируется, применяется по порядку, идемпотентно
pub fn migrate(conn: &Connection) -> Result<u32, String>;   // возвращает текущую версию

// repo.rs — обобщённый CRUD; имена таблиц и колонок проходят через schema::table()
pub fn list(conn: &Connection, table: &str, include_deleted: bool) -> Result<Vec<serde_json::Value>, String>;
pub fn get(conn: &Connection, table: &str, id: &str) -> Result<Option<serde_json::Value>, String>;
pub fn insert(conn: &Connection, table: &str, data: &serde_json::Value) -> Result<serde_json::Value, String>;
pub fn update(conn: &Connection, table: &str, id: &str, patch: &serde_json::Value) -> Result<serde_json::Value, String>;
pub fn soft_delete(conn: &Connection, table: &str, id: &str) -> Result<(), String>;
pub fn changed_since(conn: &Connection, table: &str, iso: &str) -> Result<Vec<serde_json::Value>, String>;
```

Команды (имена фиксированы, добавляются в `invoke_handler`):

```rust
db_path()            -> String                       // data/tempo.db рядом с exe в portable, иначе app_data_dir
db_ready()           -> u32                          // версия схемы; открывает файл и прогоняет миграции
db_list(table, include_deleted)      -> Vec<Value>
db_get(table, id)                    -> Option<Value>
db_insert(table, data)               -> Value
db_update(table, id, patch)          -> Value
db_delete(table, id)                 -> ()           // мягкое: deleted_at = now
db_changed_since(table, iso)         -> Vec<Value>   // для синка
db_pref_get(key)                     -> Option<String>
db_pref_set(key, value)              -> ()
db_search(q, limit)                  -> Vec<SearchHit>   // FTS5; SearchHit { kind, row_id, title, body, rank }
db_reindex(kind)                     -> u32              // перестроить индекс; kind=None -> всё
```

JS (`src/services/db.ts`) — тонкая типизированная обёртка, **без SQL**:

```ts
export interface EntityMeta { id: string; updated_at: string; deleted_at: string | null }
export interface Repo<T extends EntityMeta> {
  all(): Promise<T[]>;
  byId(id: string): Promise<T | null>;
  insert(data: Omit<T, keyof EntityMeta>): Promise<T>;
  update(id: string, patch: Partial<Omit<T, keyof EntityMeta>>): Promise<T>;
  remove(id: string): Promise<void>;          // мягкое удаление
  changedSince(iso: string): Promise<T[]>;
}
export function repo<T extends EntityMeta>(table: Table): Repo<T>;
export function dbReady(): Promise<number>;   // вызывается один раз при старте, до первого экрана
export function dbPath(): Promise<string>;
export const SCHEMA_VERSION: number;
```

`src/services/settings.ts` — типизированные настройки поверх `preferences`:
`getPref<T>(key, fallback)`, `setPref<T>(key, value)`, `subscribePrefs(cb)`.

Правила: `id` — UUID v4 (никаких `Date.now()`); `updated_at` ставит Rust при каждой записи;
удаление — только `deleted_at`; любое изменение строки попадает в `sync_outbox` триггером.

## 3. Rust-команды — владелец: Wave 0 (Native)

Существующие остаются. Новые (имена и сигнатуры фиксированы):

```rust
// storage
#[tauri::command] async fn db_path() -> Result<String, String>;
// speech to text (Wave 11)
#[tauri::command] async fn stt_models() -> Result<Vec<ModelInfo>, String>;         // каталог + локальный статус
#[tauri::command] async fn stt_download(app: AppHandle, model_id: String) -> Result<(), String>;  // события stt://progress
#[tauri::command] async fn stt_ready() -> Result<bool, String>;
#[tauri::command] async fn stt_dictate_start(mode: String) -> Result<(), String>;  // "ptt" | "toggle"
#[tauri::command] async fn stt_dictate_stop() -> Result<String, String>;           // текст; вставка через SendInput
#[tauri::command] async fn stt_transcribe_file(path: String) -> Result<String, String>;
// recording (Wave 7)
#[tauri::command] async fn rec_devices() -> Result<RecDevices, String>;            // микрофоны, мониторы, окна
#[tauri::command] async fn rec_start(kind: String, opts: RecOptions) -> Result<String, String>;
#[tauri::command] async fn rec_stop(id: String) -> Result<RecordingMeta, String>;
// google (Waves 3, 12)
#[tauri::command] async fn google_connect(app: AppHandle, scopes: Vec<String>) -> Result<Account, String>;
#[tauri::command] async fn google_status() -> Result<Option<Account>, String>;
#[tauri::command] async fn google_disconnect() -> Result<(), String>;
#[tauri::command] async fn gcal_sync(full: bool) -> Result<SyncReport, String>;
#[tauri::command] async fn gcal_push_task(task_id: String) -> Result<(), String>;
#[tauri::command] async fn drive_sync_now() -> Result<SyncReport, String>;
// assets (Waves 6, 7)
#[tauri::command] async fn asset_save(kind: String, name: String, bytes: Vec<u8>) -> Result<String, String>;
```

## 4. Frontend-сервисы — владельцы по волнам

```ts
// src/services/search.ts            (Wave 2)  — реестр команд + FTS-запросы
export interface Command { id: string; title: string; hint?: string; keys?: string[]; run(): void | Promise<void>; }
export function registerCommand(cmd: Command): () => void;
export async function searchAll(q: string, limit?: number): Promise<SearchResult[]>;

// src/services/pomodoro.ts          (Wave 1)  — состояние цикла поверх Rust-таймера
export interface PomodoroState { phase: 'focus'|'short-rest'|'long-rest'; index: number; running: boolean; remaining: number; }
export function usePomodoro(): PomodoroState & { start(): void; pause(): void; reset(): void; skip(): void };

// src/services/settings.ts          (Wave 0)  — типизированные настройки поверх таблицы preferences
export function getPref<T>(key: PrefKey, fallback: T): T;
export function setPref<T>(key: PrefKey, value: T): Promise<void>;

// src/services/linking.ts           (Wave 5)
export function parseLinks(md: string): { title: string; noteId?: string }[];
export async function backlinksOf(kind: string, id: string): Promise<LinkRef[]>;
export async function upsertLinks(from: LinkRef, to: LinkRef[]): Promise<void>;

// src/services/recorder.ts          (Wave 7)  — обёртка над rec_* + библиотека
// src/services/gcal.ts              (Wave 3)  — статус, sync, push задачи
// src/services/stt.ts               (Wave 11) — модели, диктовка, статусы
// src/services/drive.ts             (Wave 12) — outbox, статус, флаг медиа
```

## 5. Границы волн (кто что может трогать)

| Зона файлов | Владелец | Другие волны |
|---|---|---|
| `src/constants/design.ts`, `src/components/ui/**` | Wave 0 | только чтение |
| `src/services/db.ts`, миграции | Wave 0 | только чтение; новая таблица — через `hub` владельцу |
| `src/App.tsx`, `src/components/Shell/**` | Wave 0 | добавление экрана — регистрация в роутере (одна строка), согласовать |
| `src-tauri/src/*` | по фиче | одна волна за раз в одном файле |
| `src/components/<module>/**`, `src/services/<module>.ts` | своя волна | не трогать после релиза без причины |

## 6. Правила для параллельных агентов

- Один файл — один писатель. Пересечение зон → задача сериализуется, не «договаривается на лету».
- Работающие агенты изолированы (`isolated: true`), результат применяется в основной checkout.
- Контракт возврата каждого субагента: `STATUS · FILES(пути) · TESTS(было→стало) · INTERFACES ·
  REQUIREMENTS(R##) · CONCERNS`, ≤25 строк.
- Секреты (client secret, API-ключи, токены) никогда не попадают в файлы, логи и отчёты.

## 7. Слой горячих клавиш — владелец: Wave 0

```ts
export interface ShortcutDef {
  id: string;
  /** Отображается на экране Shortcuts: например ['Cmd','K'] или ['N']. */
  keys: string[];
  /** global — работает при скрытом окне (только через Rust), app — только внутри окна. */
  scope: 'app' | 'global';
  run(): void | Promise<void>;
}
export function registerShortcut(def: ShortcutDef): () => void;
```

Правила, обязательные для всех экранов:
- Односложная клавиша MUST NOT срабатывать, когда фокус в `input`, `textarea` или `[contenteditable]`:
  проверка живёт в слое, а не в каждом обработчике.
- Шорткат MUST NOT перехватывать системные сочетания и MUST отключаться в модальных окнах,
  где Esc/Tab заняты диалогом.
- Экран Shortcuts (раздел настроек) строится **из реестра**, а не из рукописного списка:
  новый экран, зарегистрировавший шорткат, обязан появиться в списке сам.

## 8. Реестр источников поиска — владелец: Wave 2, наполняют все волны

```ts
export interface SearchSource<T> {
  /** Значение колонки kind в search_fts. */
  kind: string;
  /** Проекция строки в индексируемый текст. */
  projection(row: T): { title: string; body: string };
  /** Откуда брать строки: владелец источника отдаёт их сам. */
  rows(): Promise<T[]>;
}
export function registerSearchSource<T>(src: SearchSource<T>): () => void;
export function reindex(kind?: string): Promise<number>;
```

Почему так: порядок пользователя ставит поиск (волна 2) раньше задач (3), заметок (5), записей (7).
Реестр превращает это из «переписывать поиск на каждой волне» в «волна регистрирует одну функцию».
Волна, владеющая сущностью, обязана: зарегистрировать источник, наполнить индекс при старте и
поддерживать его через триггеры БД.

## 9. Жизненный цикл медиа — владелец: Wave 0 (Storage), используют волны 6, 7

```ts
export interface AssetRef { kind: 'drawing' | 'audio' | 'screen' | 'preview'; path: string; bytes: number; }
export async function assetSave(kind: AssetRef['kind'], name: string, bytes: Uint8Array): Promise<AssetRef>;
export async function assetDelete(ref: AssetRef | string): Promise<void>;
export async function assetUsage(): Promise<{ total: number; byKind: Record<string, number> }>;
export async function assetPrune(limitBytes: number): Promise<{ removed: number; freed: number }>;
```

Правила: файл MUST удаляться вместе с записью (мягкое удаление строки — исключение: файл живёт
до фактической очистки); `assetUsage` показывается в настройках; `assetPrune` вызывается при
старте, если занято больше потолка, и сначала убирает корзину, потом самые старые медиа.

## 10. Бюджеты производительности — владелец: каждая фича, проверяет @oracle

| Что | Порог | Как замеряется |
|-----|-------|----------------|
| Динамический фон (R46) | ≤2% CPU в покое на целевой машине | замер процесса при простое 60 с, скриншот задачи |
| Бесконечный холст (R46) | 60 к/с при 500 штрихах | замер в тесте рисования, порог в assertion |
| Запись экрана (R46) | ≤15% CPU суммарно | замер во время 60-секундной записи |
| Старт приложения | ≤2 с до интерактивного главного экрана | замер по логу старта |
| Поиск Cmd+K | ≤100 мс на выдачу при 10 000 объектов | замер запроса в тесте |
