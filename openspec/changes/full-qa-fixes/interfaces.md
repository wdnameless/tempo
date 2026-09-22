# Interfaces: починка дефектов (заморожено 2026-09-22)

## 1. Владение файлами (один писатель на файл)

| Срез | Владеет |
|---|---|
| FixAlarmCore | `src-tauri/src/scheduler.rs`, `timer.rs`, `hourglass.rs`, `alarm_sound.rs` |
| FixDictationCore | `src-tauri/src/stt/mod.rs`, `stt/engine.rs`, `stt/ptt.rs` |
| FixVault | `src/components/NotesView.tsx`, `NotesTree.tsx`, `src/services/notes.ts`, `src-tauri/src/vault.rs` |
| FixAssistant | `src/services/aiCompiler.ts`, `ai.ts`, `db.ts`, `alarms.ts`, `src/components/AIChatDrawer.tsx`, `src/App.tsx` |
| FixPlanning | `src/components/TasksView.tsx`, `ListsView.tsx`, `DayView.tsx`, `src/services/calendar.ts`, `tasks.ts` |
| FixMediaSettings | `src/components/RecordingsView.tsx`, `DrawingsView.tsx`, `StatsView.tsx`, `SettingsView.tsx`, `src-tauri/src/storage/assets.rs`, `src-tauri/src/recording/mod.rs` |
| FixDictationUi | `src/components/speech/AudioSettings.tsx`, `src/components/DictationIndicator.tsx`, `src/services/stt.ts` |

## 2. Сквозные контракты (нарушение любого = дефект)

1. **Дни недели: 0 = воскресенье** — везде. Так уже считают `scheduler.rs` (`num_days_from_sunday`)
   и `Alarms.tsx` (`WEEKDAY_LABELS`). Компилятор ассистента и всё, что он создаёт, обязано
   приводиться к этому: `Пн, Ср, Пт → [1, 3, 5]`.
2. **Ключ ассистента живёт в системном хранилище**, не в настройках: проверять наличие ключа
   нужно у `AIGateway`, а не у `settings.apiKey` (который намеренно пуст).
3. **Время — локальное.** Задачи, будильники, события хранят местное время; `toISOString()`
   с `Z` для пользовательских значений не используется.
4. **Любая запись публикует сигнал**: после изменения данных вызывается `emitDataChanged(<таблица>)`,
   иначе экран-наблюдатель остаётся со старыми данными.
5. **IPC только через `isTauri()`** (конвенция `src/services/platform.ts`): вызов `invoke` без
   проверки — дефект, потому что `bun run dev` работает в браузере.
6. **Уничтожение данных спрашивает подтверждение** — удаление записи, рисунка, заметки.
7. **`stt_stop_dictation` останавливает запись в любом режиме активации**, а не только в PTT.

## 3. Что считается доказательством правки

- Регрессионный тест, который падает на старом коде и проходит на новом.
- Rust-срезы: `cargo test` **и** `cargo clippy --all-targets -- -D warnings` (CI гоняет оба).
- Frontend-срезы: `bunx tsc --noEmit`, `bunx eslint`, `bunx vitest run` по своим файлам.
- Оркестратор после волны: `bun run check:all`, `tauri build --no-bundle`, запуск собранного
  приложения, повторная слепая приёмка по реестру `D01–D51`.
