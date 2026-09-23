# Interfaces: один язык интерфейса — заморозка ключей (2026-09-23)

Разведка `LanguageSweep` нашла 15 файлов, где русский пользователь читает английский.
Файл переводов один (`src/services/i18n.ts`) — его пишет **ровно один** исполнитель,
поэтому имена ключей заморожены здесь, до начала работы.

## Правила

- Имена ключей — **точно как в таблицах ниже**. Не переименовывать, не выдумывать синоним.
- Ключи добавляет только `I18nMerge` (владелец `src/services/i18n.ts`). Компоненты ключи не добавляют.
- Если в вашем файле нашлась английская строка, которой нет в таблице: **оставьте её как есть**
  и перечислите в отчёте (строка, файл:строка, предлагаемый ключ). Их добавит один финальный проход.
  Так каждая правка остаётся компилируемой.
- Значения: ru — русский текст в стиле остального интерфейса, en — прежний английский.
- Плейсхолдеры значений (`0 B`, `1.0 GB`, число дней) — параметры, а не текст внутри ключа.

## Статистика (`StatsView.tsx`)

| Ключ | ru | en |
|---|---|---|
| `statsLoading` | Загружаем статистику… | Loading statistics... |
| `statsFocusActivity` | Активность фокуса | Focus Activity |
| `statsCurrentStreak` | Текущая серия | Current Streak |
| `statsLongest` | Рекорд: {n} | Longest: {n} |
| `statsDays` | дней | days |
| `statsFocusedTime` | Время в фокусе | Focused Time |
| `statsLast14Days` | ПОСЛЕДНИЕ 14 ДНЕЙ | LAST 14 DAYS |
| `statsLast12Weeks` | ПОСЛЕДНИЕ 12 НЕДЕЛЬ | LAST 12 WEEKS |

Плюс: буквы дней недели берутся из локали приложения, а не из `'en-US'`.

## Речь (`src/components/speech/`)

| Ключ | ru | en |
|---|---|---|
| `speechOverlayIndicator` | Показывать индикатор записи | Show recording overlay indicator |
| `speechOverlayIndicatorHint` | Уровень, режим и таймер во время диктовки (оверлей и пилюля) | Display visual level meter, mode and timer while dictating (overlay and pill) |
| `speechRerunSetupHint` | Сбросить состояние знакомства и запустить начальный мастер из 4 шагов | Reset onboarding state to launch the initial 4-step setup wizard |
| `speechRerunSetup` | Пройти мастер заново | Rerun Setup |
| `speechClearLog` | Очистить журнал | Clear log |
| `speechClearAllWords` | Удалить все слова | Clear all words |
| `speechClear` | Очистить | Clear |
| `speechAdd` | Добавить | Add |
| `speechModelMultilingual` | Многоязычные (99+) | Multilingual (99+) |
| `speechModelEnglishOnly` | Только английский | English only |
| `speechSaved` | Сохранённые | Saved |
| `speechReady` | Готово | Ready |
| `speechStopTestRecording` | Остановить пробную запись | Stop test recording |
| `speechClearShortcut` | Сбросить сочетание | Clear shortcut |

## Нижний плеер (`WinterBottomPlayer.tsx`)

| Ключ | ru | en |
|---|---|---|
| `playerToggleMenu` | Меню навигации | Toggle navigation menu |
| `playerPhaseSelector` | Выбор фазы | Phase selector |
| `playerTimerPresets` | Наборы времени | Timer presets |
| `playerStartTimer` | Запустить таймер | Start timer |
| `playerPauseTimer` | Пауза | Pause timer |
| `playerResetTimer` | Сбросить таймер | Reset timer |
| `playerSkipPhase` | Пропустить фазу | Skip phase |
| `playerFocusAudio` | Звук фокуса | Focus audio |
| `playerFocusAudioActive` | Звук фокуса включён | Focus audio active |

## День, календарь, списки, задачи, заметки, записи, оверлей, таймер, палитра

| Ключ | ru | en | Где |
|---|---|---|---|
| `dayPreviousDay` | Предыдущий день | Previous day | DayView.tsx:307 |
| `dayNextDay` | Следующий день | Next day | DayView.tsx:326 |
| `dayMarkTaskDone` | Отметить задачу выполненной | Mark task done | DayView.tsx:703 |
| `dayMarkAsActive` | Вернуть в работу | Mark as active | DayView.tsx:886 |
| `dayMarkAsCompleted` | Отметить выполненной | Mark as completed | DayView.tsx:886 |
| `dayToggleTask` | Переключить задачу | Toggle task | DayView.tsx:967 |
| `calendarPrevious` | Предыдущий месяц | Previous | CalendarView.tsx:275 |
| `calendarToday` | Сегодня | Today | CalendarView.tsx:283 |
| `calendarNext` | Следующий месяц | Next | CalendarView.tsx:291 |
| `calendarAddEvent` | Добавить событие | Add event | CalendarView.tsx:421 |
| `listsRenameList` | Переименовать список | Rename list | ListsView.tsx:255 |
| `listsRenameItem` | Переименовать пункт | Rename item | ListsView.tsx:360 |
| `tasksMinutesPlaceholder` | мин | min | TasksView.tsx:393 |
| `notesTaskCompleted` | Задача выполнена | Completed task | NotesEditor.tsx:42 |
| `notesTaskIncomplete` | Задача не выполнена | Incomplete task | NotesEditor.tsx:42 |
| `recordingsPreviewAlt` | Превью записи экрана | Preview | RecordingsView.tsx:604 |
| `overlayClose` | Закрыть оверлей | Close overlay | MiniOverlay.tsx:105 |
| `timerPomodoroMode` | Режим «Помодоро» | Pomodoro mode | Timer.tsx:206 |
| `timerStopwatchMode` | Режим секундомера | Stopwatch mode | Timer.tsx:220 |
| `paletteDialogLabel` | Командная палитра | Command Palette | CommandPalette.tsx:348 |

## Владение файлами (без пересечений)

| Исполнитель | Файлы |
|---|---|
| `I18nMerge` | `src/services/i18n.ts`, `src/services/__tests__/i18n.test.ts` |
| `StatsLang` | `src/components/StatsView.tsx`, его тесты |
| `SpeechLang` | `src/components/speech/*.tsx`, их тесты |
| `ViewsLangA` | `WinterBottomPlayer.tsx`, `ListsView.tsx`, `DayView.tsx`, `CalendarView.tsx` + тесты |
| `ViewsLangB` | `TasksView.tsx`, `NotesEditor.tsx`, `RecordingsView.tsx`, `MiniOverlay.tsx`, `Timer.tsx`, `CommandPalette.tsx` + тесты |

`SettingsView.tsx` уже правит `SettingsLanguage` — в этот список не входит.

## Доказательство

- `bunx tsc --noEmit` чисто (после того как ключи добавлены), `bunx eslint` чисто.
- `bunx vitest run` по затронутым тестам зелёный; тесты, искавшие английские строки, переведены на те же
  видимые строки через ключи, а не удалены.
- Живой экран: «Статистика» и «Настройки» на русском, без английских вкраплений.
