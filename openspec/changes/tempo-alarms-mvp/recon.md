# Recon: почему «функционал не связан с интерфейсом»

Три параллельные разведки (scout), только чтение. Всё ниже — с точками в коде.

## 1. ИИ → состояние приложения

| Что | Где | Вывод |
|---|---|---|
| Чат-ассистент | `src/components/AIChatDrawer.tsx:36` | `handleSend` (`:64`) → `AICompilerService.compileIntent` (`:76`) → `executeAction` (`:79`) |
| Проп для будильников | `src/components/AIChatDrawer.tsx:31`, `src/App.tsx:628` | **Приходит и выбрасывается**: `AIChatDrawer` не берёт `onApplyAlarms` из пропсов (`:36-53`) |
| Схема интентов | `src/services/aiCompiler.ts:50-80` | `create_task`, `create_list`, `create_note`, `build_plan`, `answer`, `noop`. **`create_alarm` отсутствует** |
| Контракт модели | `src/services/aiCompiler.ts` + `src-tauri/src/ai.rs:65` | Не tools/functions, а `response_format: {"type": "json_object"}` |
| Запись в БД | `aiCompiler.ts:358-450` | Пишет прямо в репозитории (`tasks.ts:111`, `notes.ts:104`), **не уведомляя React** → `App.tsx:195` не перечитывает, `DashboardView` остаётся старым |
| Таймер в чате | `AIChatDrawer.tsx:81-89` | Регексп ловит минуты, но `App.tsx:640-642` игнорирует аргумент (`onSetTimerMinutes={() => setActiveTab('dashboard')}`) |
| Второй ИИ | `src/services/ai.ts` (`generateAlarms`), вызывается только из `Alarms.tsx:158` | Отдельный конвейер генерации будильников, изолированный в модалке `Alarms.tsx:94-172` |
| Мёртвое | `i18n.ts:17` `unrecognizedCommand`, `aiHistory.ts:34` `buildHistoryDigest` | Никем не используются |

## 2. Цепочка будильника

- UI: `src/components/Alarms.tsx` (список/создание/правка), `AlarmCenter.tsx:65` (голова без вида: `sync_alarms`, баннер пропущенных, полноэкранный звонок), `DashboardView.tsx:248` (виджет).
- Поля сегодня: `time` (`Alarms.tsx:309`), `label` (`:317`), `repeat` = `'once' | 'daily' | 'days'` (`:350`), дни недели (`:327`), заметка только после создания (`:433`).
- **Нет**: даты (`'once'` = только `HH:MM`, т.е. ближайшие 24 часа), интервального повтора, настройки снуза/звука на будильник.
- Команды: `sync_alarms`, `snooze_alarm`, `dismiss_alarm`, `stop_alarm_sound`, `ringing_alarm_id`, `set_alarm_audio_prefs` — определены, зарегистрированы и вызываются (сводная таблица в `AlarmChain`). `missed_alarms_today` (`lib.rs:407`) — **зарегистрирована, но не вызывается никем**.
- Календарь будильники не показывает (`CalendarView.tsx`), настройки звука будильника в `SettingsView.tsx` не используются.

## 3. Дизайн-система

- Токены: `src/constants/design.ts` (`SPACE`, `RADII`, `TYPE`, `PALETTE`, `ACCENTS`, `PHASE_COLORS`) + переменные в `src/index.css`; мост `src/constants/themes.ts`.
- Примитивы: `src/components/ui/` — `Row`, `Toggle`, `Segmented`, `Slider`, `SectionHeader`, `Kbd`, `Divider`, `IconButton` (8 штук, экспорт через `index.ts`).
- Экраны используют сырые tailwind-значения вместо токенов вразнобой; карточки/заголовки/пустые состояния у каждого экрана свои.
- i18n: `src/services/i18n.ts` — интерфейс `Translations` + `TRANSLATIONS: Record<Language, Translations>`, обе локали обязательны, полнота проверяется типами.

## Проверка приёмки (что будет считаться доказательством)

1. `cargo test` — новые тесты расписания (дата, интервал, окно) и превью ближайших срабатываний.
2. `bun run check` — tsc + eslint + vitest; новые тесты на превью-карточку ИИ и на обновление состояния после записи.
3. Прогон в собранном приложении: текст расписания → превью → подтверждение → будильники появились в списке **сразу**, без перезахода на экран; будильник на «через 1 минуту» звонит.
