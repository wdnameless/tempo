# Interfaces: будильники + ИИ (заморожено 2026-09-22)

## 1. Владение файлами (один писатель на файл)

| Срез | Владеет |
|---|---|
| S1 SchedulerCore | `src-tauri/src/scheduler.rs`, `src-tauri/src/lib.rs`, `src-tauri/src/storage/{repo.rs,schema.rs,migrations.rs,mod.rs}` |
| S2 AlarmUX | `src/components/Alarms.tsx`, `src/components/DashboardView.tsx`, `src/components/AlarmCenter.tsx`, `src/services/store.ts`, `src/services/alarms.ts` (новый), `src/services/i18n.ts`, `src/components/__tests__/Alarms*.test.tsx` |
| S3 AiBridge | `src/components/AIChatDrawer.tsx`, `src/services/aiCompiler.ts`, `src/services/ai.ts`, `src/services/appEvents.ts` (новый), `src/App.tsx`, `src/services/__tests__/aiCompiler*.test.ts`, `src/components/__tests__/AIChatDrawer*.test.tsx` |
| S4 DesignPass | `src/components/ui/*`, `src/components/{TasksView,NotesView,CalendarView,StatsView,RecordingsView}.tsx`, `src/constants/design.ts` |

Никто не правит файлы чужого среза. `i18n.ts` — за S2 (он добавляет все ключи, перечисленные в §6).

## 2. Модель будильника (расширение, Rust + TS)

```rust
#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScheduledAlarm {
    pub id: String,
    pub label: String,
    pub time: String,                 // "HH:MM", локальное время
    pub repeat: String,               // "once" | "daily" | "days" | "date" | "interval"
    pub days: Vec<u8>,                // 0=Пн..6=Вс; для "days"
    pub date: Option<String>,         // "YYYY-MM-DD"; для "date"
    pub interval_minutes: Option<u32>,// для "interval": шаг
    pub window_start: Option<String>, // "HH:MM"; для "interval": начало окна (по умолчанию "00:00")
    pub window_end: Option<String>,   // "HH:MM"; для "interval": конец окна (по умолчанию "23:59")
    pub enabled: bool,
    pub sound: String,
    pub voice_prompt: Option<String>,
}
```

Правила срабатывания (одна правда — Rust):

| `repeat` | Срабатывает |
|---|---|
| `once` | ближайшее `time` в пределах 24 часов (как сейчас) |
| `daily` | каждый день в `time` |
| `days` | в дни из `days` в `time` |
| `date` | один раз в `date` + `time`; после срабатывания будильник выключается |
| `interval` | `window_start + k × interval_minutes`, пока ≤ `window_end`, каждый день; окно может переходить через полночь |

Старые будильники (без новых полей) обязаны читаться и звонить как раньше.

## 3. Команды (S1 регистрирует, S2/S3 вызывают)

Существующие и остаются: `sync_alarms`, `snooze_alarm`, `dismiss_alarm`, `stop_alarm_sound`,
`ringing_alarm_id`, `set_alarm_audio_prefs`.

| Новая команда | Сигнатура | Смысл |
|---|---|---|
| `alarm_preview` | `(alarms: Vec<ScheduledAlarm>, count: Option<usize>) -> Vec<AlarmPreview>` | ближайшие срабатывания (по умолчанию 3) для списка будильников — и для превью ИИ, и для строки «следующее» в списке |

```rust
pub struct AlarmPreview { pub id: String, pub next: Vec<String>, pub disabled: bool } // next — ISO-8601 локального времени
```

`missed_alarms_today` (`lib.rs:407`) — либо используется в `AlarmCenter`, либо удаляется; решает S1.

## 4. Сервисный слой (TS)

```ts
// src/services/alarms.ts (новый, S2) — единственный путь записи будильников из UI
export interface Alarm { /* поля §2 в camelCase */ }
export function listAlarms(): Promise<Alarm[]>;
export function saveAlarm(alarm: Alarm): Promise<void>;      // insert или update + sync_alarms
export function deleteAlarm(id: string): Promise<void>;
export function toggleAlarm(id: string, enabled: boolean): Promise<void>;
export function previewAlarms(alarms: Alarm[], count?: number): Promise<AlarmPreview[]>;
export function applyAlarms(alarms: Alarm[]): Promise<Alarm[]>; // массовое создание (для ИИ), возвращает созданные
```

## 5. Сигнал об изменении данных (S3, ключ к R01)

```ts
// src/services/appEvents.ts (новый)
export type DataTable = 'alarms' | 'tasks' | 'lists' | 'notes' | 'events' | 'drawings' | 'recordings';
export function emitDataChanged(table: DataTable, ids?: string[]): void;
export function onDataChanged(cb: (table: DataTable, ids?: string[]) => void): () => void;
```

`App.tsx` подписывается и перечитывает затронутую сущность; `aiCompiler.executeAction` и
`alarms.ts` эмитят после каждой записи. Никаких «перезайдите на экран, чтобы увидеть».

## 6. ИИ-контракт (S3) и ключи i18n (S2 добавляет все)

Схема ответа модели расширяется действием:

```json
{ "action": "create_alarms",
  "reply": "короткий ответ пользователю",
  "alarms": [ { "label": "Тренировка", "time": "07:30", "repeat": "days", "days": [0,2,4],
                "date": null, "intervalMinutes": null, "windowStart": null, "windowEnd": null } ] }
```

- `create_alarms` возвращается, когда пользователь прислал расписание/план/тренировки.
- Показывается карточка превью (R04): строки «когда — что», кнопки «Создать N будильников» и «Отмена».
- До подтверждения в базу не пишется ничего. После — `applyAlarms` + `emitDataChanged('alarms')`.
- `build_plan` больше не создаёт задачи для расписаний: расписания — будильники, задачи — только явные задачи.

Ключи i18n (обе локали, `src/services/i18n.ts`): `alarmsTitle`, `alarmsNew`, `alarmsEmpty`,
`alarmsNext`, `alarmsRepeatOnce`, `alarmsRepeatDaily`, `alarmsRepeatDays`, `alarmsRepeatDate`,
`alarmsRepeatInterval`, `alarmsDate`, `alarmsTime`, `alarmsLabel`, `alarmsLabelPlaceholder`,
`alarmsIntervalEvery`, `alarmsIntervalMinutes`, `alarmsIntervalHours`, `alarmsWindowFrom`,
`alarmsWindowTo`, `alarmsEnabled`, `alarmsDisabled`, `alarmsDelete`, `alarmsSave`, `alarmsCancel`,
`alarmsToday`, `alarmsTomorrow`, `alarmsNever`, `aiAlarmsPreviewTitle`, `aiAlarmsConfirm`,
`aiAlarmsCancel`, `aiAlarmsCreated`, `aiAlarmsNone`, `unrecognizedCommand` (уже есть),
`alarmsNote`, `alarmsNotePlaceholder`, `alarmsSnooze`, `alarmsSound`, `alarmsSectionUpcoming`,
`alarmsSectionAll`, `alarmsSkipped`, `alarmsNextAt`.

## 7. Приёмка

- S1: `cargo test` — новые тесты расписания; старые будильники не сломаны.
- S2: `bunx vitest run` по своим файлам; создание/правка/превью/удаление.
- S3: тесты компилятора (интент `create_alarms`), карточки превью, применения после подтверждения, обновления состояния.
- S4: `bunx tsc --noEmit`, `bunx eslint` по своим файлам.
- Оркестратор: `bun run check:all`, `bun run tauri build --no-bundle`, ручной прогон сценария «текст → превью → будильники в списке → звонок», oracle.
