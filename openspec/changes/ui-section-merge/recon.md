# Recon: слияние разделов, логотип, версия

Запрос пользователя (2026-09-22, с приложенным скриншотом):

- «Удали подчеркивание на логотипе слева сверху»
- «убери название TEMPO справа под версией»
- «Day и Tasks и Lists давай объединим. Notes и Drawinings тоже. Pomodoro и Alarms тоже.»

## Точки правки (проверены чтением)

| Что | Где | Как сейчас |
|---|---|---|
| Подчёркивание под логотипом | `src/components/TitleBar.tsx:46` | `<div className="w-5 h-[2px] bg-white mt-1 rounded-full" />` под надписью `TEMPO` (`:44`) |
| Надпись `TEMPO` справа | `src/components/TitleBar.tsx:80` | `<span …>TEMPO</span>` над версией (`:81`) |
| Версия в заголовке | `src/components/TitleBar.tsx:81` | **зашита строкой** `V.0.16.0` — поэтому на 0.18.2 в окне показывалось 0.16.0 |
| Версия в сайдбаре | `src/App.tsx:474` | **зашита строкой** `v0.16.0`, та же проблема |
| Пункты меню | `src/App.tsx:397-408` | 11 пунктов: dashboard, day, calendar, alarms, tasks, lists, notes, drawings, recordings, stats, settings |
| Отрисовка экрана | `src/App.tsx:556-605` | цепочка `activeTab === '<id>' && <View />` |
| Переход из ассистента | `src/App.tsx:674-675` | `onNavigateToModule('alarms')` → `setActiveTab('alarms')` — после слияния обязан продолжать работать |
| Готовый источник версии | `src/services/update.ts:50-56` | `currentVersion()` — Tauri `getVersion()` с фолбэком |

## Решение по слиянию (без новых ключей i18n)

Пункты меню становятся «разделами», внутри раздела — под-табы на существующем примитиве
`Segmented`, подписи берутся из уже имеющихся ключей `nav*`:

| Раздел в сайдбаре | Под-табы | Ключи |
|---|---|---|
| `dashboard` | Pomodoro, Alarms | `navDashboard`, `navAlarms` |
| `day` | Day, Tasks, Lists | `navDay`, `navTasks`, `navLists` |
| `calendar` | — | `navCalendar` |
| `notes` | Notes, Drawings | `navNotes`, `navDrawings` |
| `recordings`, `stats`, `settings` | — | как есть |

Итого 11 → 8 пунктов. Активный пункт сайдбара вычисляется по текущему `activeTab`:
раздел, которому принадлежит открытый под-таб. Поэтому `setActiveTab('alarms')` из
ассистента продолжает работать и подсвечивает нужный раздел.

## Проверка приёмки

1. `bunx tsc --noEmit`, `bunx eslint src` — чисто.
2. `bunx vitest run` — существующие тесты App/TitleBar обновлены, новые проверяют: клик по пункту открывает его первый под-таб; переключение под-таба меняет экран; `setActiveTab('alarms')` извне открывает раздел Pomodoro с активным под-табом Alarms.
3. В собранном приложении: подчёркивания нет, справа только версия, в сайдбаре 8 пунктов, все прежние экраны доступны.
