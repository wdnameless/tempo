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

DDL (полный; миграция `0001_init`, порядок создания таблиц обязателен):

```sql
CREATE TABLE tasks (
  id TEXT PRIMARY KEY, title TEXT NOT NULL, note TEXT, status TEXT NOT NULL DEFAULT 'open',
  list_id TEXT, parent_id TEXT, priority INTEGER DEFAULT 0,
  due_date TEXT, start_at TEXT, planned_minutes INTEGER,
  completed_at TEXT, position REAL NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE lists (id TEXT PRIMARY KEY, name TEXT NOT NULL, color TEXT, position REAL,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE notes (id TEXT PRIMARY KEY, title TEXT, body_md TEXT NOT NULL DEFAULT '',
  pinned INTEGER DEFAULT 0, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE drawings (id TEXT PRIMARY KEY, title TEXT, scene_json TEXT NOT NULL,
  preview_path TEXT, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE recordings (id TEXT PRIMARY KEY, title TEXT,
  kind TEXT NOT NULL,                       -- audio | screen
  file_path TEXT NOT NULL, duration_sec INTEGER, transcript TEXT, transcript_status TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE events (id TEXT PRIMARY KEY, source TEXT NOT NULL,   -- local | google
  google_id TEXT, calendar_id TEXT, title TEXT, start_at TEXT, end_at TEXT,
  all_day INTEGER DEFAULT 0, location TEXT, task_id TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE calendars_meta (calendar_id TEXT PRIMARY KEY, sync_token TEXT, last_sync_at TEXT);
CREATE TABLE sessions (id TEXT PRIMARY KEY, kind TEXT NOT NULL,    -- pomodoro | stopwatch
  started_at TEXT, ended_at TEXT, duration_sec INTEGER, completed INTEGER, task_id TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE links (from_kind TEXT, from_id TEXT, to_kind TEXT, to_id TEXT,
  updated_at TEXT NOT NULL, PRIMARY KEY (from_kind, from_id, to_kind, to_id));
CREATE TABLE alarms (id TEXT PRIMARY KEY, label TEXT, time TEXT, days TEXT, repeat TEXT,
  enabled INTEGER, sound TEXT, voice_prompt TEXT, note TEXT,
  updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE chat_messages (id TEXT PRIMARY KEY, role TEXT NOT NULL, content TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE TABLE preferences (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, row_id TEXT,
  op TEXT, payload TEXT, created_at TEXT NOT NULL);
CREATE VIRTUAL TABLE search_fts USING fts5(kind UNINDEXED, row_id UNINDEXED, title, body,
  tokenize='unicode61');
```

`chat_messages` — сюда переезжает история копилота из `alarmer.json` (R44); `role` — `user` | `assistant`.

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

## 8. Поиск — владелец: Wave 2, наполняют все волны

**Поправка к первому варианту контракта.** Изначально здесь стояла регистрация
`rows()`/`projection()` в JS, чтобы каждая волна отдавала свои строки. От этого пришлось
отказаться: с волны 0 весь SQL живёт в Rust, все сущности лежат в SQLite, и проекция в JS
означала бы второй индексатор, читающий те же таблицы через IPC, — два места, которые
обязаны совпадать и рано или поздно разойдутся. Поэтому:

- **Индексатор один и он в Rust** — `repo::reindex_fts` читает таблицы и наполняет
  `search_fts`. Волна, владеющая сущностью, добавляет свой `kind` одной веткой в этой
  функции и вызывает `reindex(kind)` после изменений. Это ровно тот же принцип, что и
  раньше («волна сама подключает свою сущность»), но проекция не покидает место, где
  живут данные.
- **Реестр в JS отвечает за представление** — как показать результат этого `kind` и что
  делать по нажатию. Палитра по-прежнему не знает ни про один конкретный `kind`.

```ts
// src/services/search.ts
export interface SearchHit { kind: string; row_id: string; title: string; body: string; rank: number }

export interface SearchSource {
  /** Совпадает с колонкой kind в search_fts. */
  kind: string;
  /** Ключ i18n и иконка для группы результатов. */
  labelKey: string;
  icon: LucideIcon;
  /** Куда ведёт результат: переход по экрану и подсветка строки. */
  open(hit: SearchHit): void;
}
export function registerSearchSource(src: SearchSource): () => void;
export function listSearchSources(): SearchSource[];

/** Полнотекстовый поиск. Пустой или пробельный запрос — пустой массив, не ошибка. */
export async function searchAll(q: string, limit?: number): Promise<SearchHit[]>;
/** Перестроить индекс; без аргумента — весь. Вызывается после изменений сущности. */
export async function reindex(kind?: string): Promise<number>;

export interface Command {
  id: string; titleKey: string; hintKey?: string; keys?: string[]; icon: LucideIcon;
  run(): void | Promise<void>;
}
export function registerCommand(cmd: Command): () => void;
export function listCommands(): Command[];
```

Правила:
- Спецсимволы FTS5 (`"`, `*`, `(`, `)`, `-`, `AND`, `:`) MUST NOT ронять запрос: ввод
  санируется на стороне Rust, каждый токен цитируется, последний получает `*` для поиска
  по префиксу. Тест на это обязателен — это первое, что сломает живой пользователь.
- Русский текст ищется тем же запросом: токенизатор `unicode61` уже настроен.
- Пустой результат — это результат: палитра показывает «ничего не найдено», а не молчит.
- `reindex` вызывается один раз при старте (в `dbReady`) и точечно после изменений сущности.

Индексация на этой волне: `alarm` и `session` — единственные сущности, которые существуют
сегодня. Задачи, заметки, события, записи и транскрипты добавляют свой `kind` в своих волнах.

## 15. Палитра — владелец: Wave 2

```ts
// src/components/CommandPalette.tsx
export function CommandPalette(): JSX.Element | null;
```

Монтируется один раз в `App.tsx`. Открывается по ⌘K (событие `tempo:spotlight`, уже
рассылается слоем шорткатов) и по кнопке; закрывается по Esc и по клику вне палитры.

Правила: запрос пустой — показываются только команды; запрос есть — команды, отфильтрованные
по подстроке, и контент из `searchAll`. Навигация стрелками и Enter, активная строка видна.
Совпадение в заголовке результата MUST быть подсвечено. Никакого `dangerouslySetInnerHTML` —
подсветка строится из текста, потому что содержимое приходит из пользовательских данных.

Строки — из `I18nService.t()`; новые ключи объявлены в `Translations` (см. §4 о языках).

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

## 11. Мост темы — владелец: Wave 0 (Shell), удаляется по мере переписывания экранов

Девятнадцать файлов принимают `theme: ThemeColors` и читают из него ~470 значений
(`text`, `subtext`, `accent`, `border`, `cardBg`, …). Переписать их все в волне 0 нельзя —
это и есть работа волн 1–12. Поэтому `ThemeColors` остаётся, но перестаёт быть набором
из шести тем и становится **представлением токенов**:

```ts
// src/constants/themes.ts — REPLACE: шесть тем удалены
export function themeFromTokens(accent: AccentId): ThemeColors;
// bg -> --bg · surface -> --surface · cardBg -> --elevated · border -> --border
// text -> --text · subtext -> --text-muted · accent -> --accent
// accentGlow -> accent при ~30% альфы · ringTrack -> --border · ringProgress -> --accent
// ticks -> --text-faint · id/name сохранены для совместимости
```

Правила:
- `THEMES` (шесть тем) MUST быть удалён: `src/App.tsx`, `MiniOverlay.tsx`, `SettingsView.tsx`
  переходят на `themeFromTokens(accent)`.
- Сохранённое значение `alarmer_theme` MUST игнорироваться без падения (сценарий спеки);
  акцент хранится в `preferences` под ключом `tempo_accent`.
- Экран, переписанный своей волной, MUST NOT брать цвета из `theme` — только CSS-переменные;
  вместе с этим он перестаёт принимать проп `theme`.
- Когда последний потребитель `themeFromTokens` исчезнет, функция и `ThemeColors` удаляются.
  Волна, снявшая последний проп, обязана это проверить (`grep -rn "ThemeColors" src`).

Почему так: это единственный способ показать новый стиль в волне 0, не переписывая
одновременно девятнадцать экранов, и при этом не тащить шесть тем дальше в программу.

## 12. Помодоро — владелец: Wave 1 (Rust), используют Wave 1 (UI), Wave 9 (статистика)

Режимы таймера: `pomodoro` и `stopwatch` **вместо** `countdown/flow/block`. Фаза: `focus`,
`short_rest`, `long_rest`. Старые имена удаляются целиком, не остаются алиасами.

```rust
pub enum TimerMode { Pomodoro, Stopwatch }          // serde snake_case
pub enum Phase { Focus, ShortRest, LongRest }        // serde snake_case

pub struct TimerSnapshot {
    pub total_secs: u64,        // длина текущей фазы
    pub remaining_secs: u64,    // помодоро: до конца фазы; стоп-вотч: 0
    pub elapsed_secs: u64,      // стоп-вотч: сколько идёт; помодоро: сколько прошло в фазе
    pub running: bool,
    pub mode: TimerMode,
    pub phase: Phase,           // у стоп-вотча всегда Focus
    pub pomodoro_index: u32,    // 1..=4 — место в текущем цикле, что видит пользователь
    pub completed_today: u32,   // завершённые помодоро за сегодня
    pub focus_min: u32, pub short_rest_min: u32, pub long_rest_min: u32,
    pub auto_start: bool,
}
```

Цикл: фокус → `short_rest` → фокус … после **четвёртого** фокуса → `long_rest`, затем
`pomodoro_index` возвращается к 1. Перерыв MUST стартовать сам (R04) — это не настройка.
`auto_start` управляет только тем, стартует ли сам следующий **фокус** после перерыва.

Команды (старые `timer_set_block_settings`/`timer_set_direction` удаляются):

```rust
timer_get_state() -> TimerSnapshot
timer_start() / timer_pause() / timer_reset()
timer_skip_phase()                       // завершить фазу досрочно и перейти к следующей
timer_set_mode(mode)                     // pomodoro | stopwatch
timer_set_duration(secs)                 // длина ФОКУСА, clamp 10..120 мин; пере-взводит, если стоит
timer_shift_minutes(delta)               // то же ±минуты, clamp 10..120
timer_set_pomodoro_settings(focus_min, short_rest_min, long_rest_min, auto_start)
```

Запись сессий (1.3): **Rust пишет в SQLite сам** через `storage::with_db` в тик-цикле, где уже
дренируются `pending_sessions`. Почему не фронтенд: скрытое окно не увидит завершение фазы, а
сессия — факт про часы, которые живут в процессе. Строка `sessions`:

```
kind = 'pomodoro' | 'stopwatch'      started_at/ended_at = ISO local
duration_sec = секунды фазы           completed = 1 если фаза дошла до нуля
task_id = NULL                        id = UUID v4, updated_at = now
```

Записывается только фаза **фокуса**; перерывы в статистику не идут. Сброс и пауза закрывают
сессию как `completed = 0` — «прерванная сессия учитывается отдельно» (сценарий спеки).

## 13. Динамический фон — владелец: Wave 1 (Background)

```ts
// src/components/DynamicBackground.tsx
export function DynamicBackground(): JSX.Element | null;
```

Компонент **сам** подписывается на `TimerService` и сам читает настройку
`tempo_dynamic_background` (по умолчанию `true`), поэтому в `App.tsx` это одна строка
`<DynamicBackground />` без пропсов. Выключен — возвращает `null`, фон остаётся статичным.

Правила: оттенок выбирается по фазе (`focus` / `short_rest` / `long_rest` / простой) и по часу
суток; переход — CSS-`transition` на 2 секунды. **Никакого JS-цикла анимации**: покой должен
укладываться в ≤2% CPU (R46), а `requestAnimationFrame` этого не даёт. `prefers-reduced-motion`
MUST отключать переход.

## 14. Focus Audio — владелец: Wave 1 (FocusAudio)

```ts
// src/services/focusAudio.ts
export type FocusSoundId = 'none' | 'brown' | 'white' | 'rain' | 'cafe';
export interface FocusSound { id: FocusSoundId; label: string }
export const FOCUS_SOUNDS: readonly FocusSound[];
export function startFocusAudio(id: FocusSoundId): void;   // идемпотентно; 'none' останавливает
export function stopFocusAudio(): void;
export function currentFocusSound(): FocusSoundId;          // читает tempo_focus_sound
```

Звуки **генерируются** в WebAudio (шумовые буферы с фильтрами), а не скачиваются: ноль
лицензионных вопросов и ноль веса в сборке (решение пользователя). Существующая ссылка на
YouTube остаётся отдельной строкой и играет через `MusicService`, как сейчас. Apple Music
отсутствует (R21). Настройка `tempo_focus_sound` сохраняется между запусками.

## 16. День, события и перенос задач — владелец: Wave 4

### События и задачи в дне

```ts
// src/services/day.ts
export interface DaySlot { startMin: number; endMin: number }
/** Ключ дня — локальная дата "YYYY-MM-DD", не UTC. */
export function dayKey(date: Date): string;

/** Всё, что попадает в день: задачи со сроком/началом и события. */
export interface DayItem {
  kind: 'task' | 'event';
  id: string;
  title: string;
  /** Минуты от полуночи; null у задачи без времени и у события «весь день». */
  startMin: number | null;
  endMin: number | null;
  allDay: boolean;
  done: boolean;
  /** google | local — у событий; у задач null. */
  source: 'google' | 'local' | null;
  ref: TaskItem | CalendarEvent;
}
export function buildDay(input: {
  date: Date; tasks: TaskItem[]; events: CalendarEvent[];
}): DayItem[];
/** Пересечения задач и событий — их показывают пользователю (сценарий спеки). */
export function findConflicts(items: DayItem[]): Array<{ a: DayItem; b: DayItem }>;
```

`CalendarEvent` читается из таблицы `events`; `source` в ней `google` или `local`.
Событие с `source = 'google'` в дне **не редактируется** — правка идёт в Google,
изменение приезжает синхронизацией (спека, сценарий пересечения).

### Перенос задач (R40)

```ts
// src/services/rollover.ts
export interface RolloverSettings { enabled: boolean; afterHour: number }
export function rolloverSettings(): RolloverSettings;      // tempo_rollover_enabled / tempo_rollover_hour
export async function setRolloverSettings(next: Partial<RolloverSettings>): Promise<void>;
/** Локальный часовой пояс пользователя строкой — показывается рядом с настройкой. */
export function localTimeZone(): string;
/** Один проход переноса. Идемпотентен: повторный вызов в тот же день ничего не меняет. */
export async function runRollover(now?: Date): Promise<{ moved: number; cleared: number }>;
```

Правила (спека daily-planning):
- **Выключено по умолчанию** и при выключенном переносе данные MUST NOT меняться.
- Включён: после `afterHour` незавершённые задачи с `dueDate` **раньше сегодня** получают
  `dueDate = сегодня`, а их устаревший `startAt` очищается (задача появляется в дне).
- Идемпотентность: задача, уже перенесённая сегодня, не переносится повторно — иначе
  пропущенный запуск задвоит историю.
- Граница суток и смена пояса: день считается по **локальной** дате, поэтому смена пояса
  сама по себе не создаёт и не теряет задачи; перенос — это смена `dueDate`, а не копия.
- Запускается один раз при старте (`dbReady`) и при открытии экрана дня.
