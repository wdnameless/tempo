# Interfaces: кнопка обновления и проход по интерфейсу (заморожено 2026-09-23)

## 1. Владение файлами

| Срез | Владеет |
|---|---|
| UpdaterButton | `src/components/TitleBar.tsx`, `src/components/UpdateBanner.tsx` (если существует), `src/services/update.ts`, `src/App.tsx`, тесты этих файлов |
| UiPolish | `src/services/i18n.ts`, `src/components/AIChatDrawer.tsx`, `src/components/Alarms.tsx`, `src/components/RecordingsView.tsx`, `src/components/DrawingsView.tsx`, `src/components/StatsView.tsx`, `src/components/ui/*`, тесты этих файлов |

Пересечений нет. Строки добавляет **только** UiPolish (в `i18n.ts`), UpdaterButton их использует.

## 2. Ключи, которые добавляет UiPolish (обе локали, `Translations` без дыр)

Управление окном и меню (сейчас это **зашитые русские строки** в `TitleBar.tsx` и `App.tsx`):

| Ключ | ru | en |
|---|---|---|
| `titleBarMinimize` | Свернуть | Minimize |
| `titleBarMaximize` | Развернуть на весь экран | Maximize |
| `titleBarCloseToTray` | Скрыть в трей (фоновая работа) | Hide to tray (keeps running) |
| `titleBarPin` | Закрепить поверх всех окон | Keep on top |
| `titleBarUnpin` | Открепить | Stop keeping on top |
| `titleBarCompact` | Свернуть в мини-виджет | Collapse to mini widget |
| `sidebarCollapse` | Свернуть меню | Collapse menu |
| `sidebarExit` | Выход из Tempo | Quit Tempo |

Обновление (одна кнопка рядом с версией):

| Ключ | ru | en |
|---|---|---|
| `updateIdle` | Проверить обновления | Check for updates |
| `updateChecking` | Проверяем… | Checking… |
| `updateUpToDate` | Версия актуальна | Up to date |
| `updateAvailable` | Обновить до {version} | Update to {version} |
| `updateDownloading` | Скачивание {percent}% | Downloading {percent}% |
| `updateReady` | Перезапустить | Restart |
| `updateFailed` | Не удалось обновить | Update failed |

Чат и будильники:

| Ключ | ru | en |
|---|---|---|
| `chatNeedKey` | Добавьте ключ в Настройки → ИИ | Add a key in Settings → AI |
| `chatNewChat` | Новый чат | New chat |
| `alarmsQuickIn30` | Через 30 минут | In 30 minutes |
| `alarmsQuickTomorrow8` | Завтра в 8:00 | Tomorrow at 8:00 |
| `alarmsQuickDaily730` | Каждый день в 7:30 | Every day at 7:30 |

## 3. Поведение кнопки обновления (одна кнопка, четыре состояния)

```
idle ──нажатие──▶ checking ──нет обновления──▶ up-to-date (вернуться в idle через ~3 с)
                        └──есть──▶ available ──нажатие──▶ downloading (процент)
                                        └──готово──▶ ready ──нажатие──▶ перезапуск
```

- Кнопка стоит **рядом с версией** в заголовке и показывает состояние текстом (не только иконкой).
- Прогресс скачивания видно на самой кнопке; отмены не требуется.
- Ошибка показывается на кнопке (`updateFailed`) и возвращает её в `idle` после показа.
- Портативный путь и путь установщика уже реализованы в `src/services/update.ts` — кнопка лишь
  ведёт пользователя по шагам; логику не переписывать.
- Старый баннер обновления и отдельная иконка-«крутилка» не остаются рядом: одна кнопка — один путь.

## 4. Что считается доказательством

- `bunx vitest run` по затронутым файлам: состояния кнопки (idle → checking → available → downloading →
  ready → restart) с моками сервиса, вызов проверки/установки, отсутствие старого баннера;
  отсутствие зашитых русских строк в заголовке и меню.
- `bun run check` целиком перед релизом.
- Живой прогон: кнопка видна рядом с версией и проходит состояния; строки интерфейса одного языка.
