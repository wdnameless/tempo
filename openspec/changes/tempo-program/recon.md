# Recon — программа Tempo (редизайн + 12 фич)

Проверено на `master` (v0.3.3). Ничего не предполагается: размеры, пути и факты — из
исходников и из двух разведок (`HandyStt`, `GCalAndPwa`).

## 1. Стек и объём

- Tauri 2.11 + React 19 + Vite 8 + Tailwind 4 + TypeScript 6; Rust 2021.
- Frontend `src/**/*.ts(x)` ≈ 17 200 строк (26 файлов тестов внутри), Rust `src-tauri/src` — 3 311 строк.
- Остающиеся Rust-зависимости: `tauri`, `serde`, `chrono`, `reqwest` (rustls/socks/stream), `tokio`,
  `rodio`, `keyring`, `base64`, `zip`, `minisign-verify`, `msedge-tts`,
  `tauri-plugin-{updater,process,store,notification,autostart,global-shortcut,opener}`.

## 2. Инвентаризация и вердикт по каждому модулю

| Файл | Строк | Судьба | Почему |
|---|---|---|---|
| `src/App.tsx` | 878 | REPLACE | шелл (таскбар, два яруса навигации, AI-крыло) → сайдбар референса + роутер + Cmd+K |
| `src/components/SettingsView.tsx` | 924 | REPLACE | 3 таба (Звук/Нейросеть/Данные) → 5 разделов референса |
| `src/components/JournalView.tsx` | 810 | DELETE | журнал уже не смонтирован; направления безхозны |
| `src/services/focusBudget.ts` | 345 | DELETE | потребители — только JournalView и TodayView |
| `src/components/DirectionEditor.tsx` | 305 | DELETE | направления уходят вместе с журналом |
| `src/services/scheduleParser.ts` | 297 | DELETE | офлайн-разбор программ в текст |
| `src/components/BlockPlayer.tsx` | 253 | DELETE | интервальные блоки — часть программ |
| `src/components/SchedulesPanel.tsx` | 230 | DELETE | программы-расписания уходят (R30) |
| `src/services/scheduleEngine.ts` | 225 | DELETE | `expandSchedule`/`buildFirings`/`findNextUp` |
| `src/components/DashboardView.tsx` | 330 | REPLACE | под-табы + доска виджетов → главный экран «Помодоро» + динамический фон |
| `src/components/TodayView.tsx` | 237 | REPLACE | карточка «Далее» и шаги программ → Daily Planning |
| `src/components/Timer.tsx` | 453 | EXTEND | режимы `countdown/flow/block` → `pomodoro/stopwatch` |
| `src/components/RadialDial.tsx` | 461 | EXTEND | уже имеет три стиля часов (digital/classic/sand) — остаётся |
| `src/components/TasksView.tsx` | 410 | EXTEND | SQLite, списки, ссылки, календарь |
| `src/components/NotesView.tsx` | 283 | EXTEND | `[[ссылки]]` + обратные ссылки |
| `src/components/Alarms.tsx` | 559 | KEEP | будильники остаются, уходят только шаги программ |
| `src/components/AIChatDrawer.tsx` + `ai*.ts` | 393+ | KEEP | переориентация на новые сущности (R36) |
| `src/components/MiniOverlay.tsx` | 90 | KEEP | мини-оверлей таймера → помодоро |
| `src/services/store.ts` | 636 | REPLACE | JSON → SQLite + FTS5 (R29) |
| `src/services/stats.ts` | ~90 | REPLACE | метрики под R19 |
| `src/services/update.ts` + `src-tauri/src/portable_update.rs` | 178 + 554 | KEEP | must-not-break: автообновление (R33) |
| `src/services/{sound,edgeTts,music,notification,window,platform,i18n,timer}.ts` | ~900 | KEEP/EXTEND | работают, трогаем по необходимости |
| `src/constants/themes.ts` | ~200 | REPLACE | 6 тем → один стиль + акцент (R02) |
| `src-tauri/src/timer.rs` | 1052 | EXTEND | цикл помодоро/стоп-вотч, запись сессий |
| `src-tauri/src/lib.rs` | 626 | EXTEND | новые команды (БД, STT, запись, OAuth) |
| `src-tauri/src/scheduler.rs` | 605 | SIMPLIFY | убрать раскрытие программ, оставить будильники |
| `src-tauri/src/alarm_sound.rs` | 203 | KEEP | звук будильника в фоне |
| `src-tauri/src/ai.rs` | 178 | KEEP | стриминг ответов |
| `src-tauri/src/credentials.rs` | 87 | KEEP | сюда же refresh-токен Google |

## 3. Сборка, релиз, переименование

- `src-tauri/tauri.conf.json`: `productName` Alarmer→Tempo, `identifier` com.alarmer.smart→app.tempo.desktop,
  окно (min 900×600 под новый лэйаут).
- Исполняемый файл `alarmer.exe` → `tempo.exe`; portable-архив `tempo-v<tag>-portable-windows.zip`;
  ассет `tempo-portable.exe`.
- URL манифеста зашит в **трёх** местах и должен меняться синхронно: `portable_update.rs::MANIFEST_URL`,
  `tauri.conf.json` → `plugins.updater.endpoints`, и сборка `latest.json` в `.github/workflows/release.yml`.
- CI: остаётся только Windows-джоба (R34) — macOS/Linux матрица и portable-сборки для них удаляются.
- Данные: сейчас `data/alarmer.json` рядом с exe (portable) или `%APPDATA%` (установка) →
  `data/tempo.db` + `data/assets/` (рисунки, аудио, скринкасты, превью).

## 4. Разведка: Handy (движок Speech to Text)

- Handy под MIT и переиспользует **свои же опубликованные крейты**: `transcribe-cpp` 0.2.3
  (ggml: Whisper/Parakeet/Voxtral/Qwen3-ASR; Vulkan на Windows/Linux, Metal на macOS) и
  `transcribe-rs` 0.4.0 (ONNX: Moonshine/SenseVoice/GigaAM, только CPU). Свой код движка писать не нужно.
- Захват: `cpal` 0.16 → mono f32 → 16 кГц; VAD (Silero/энергия) с обрезкой тишины; порог ~0.1 с.
- Вставка текста: Windows — `SendInput` (`windows` 0.62); буфер обмена сохраняется и восстанавливается
  через 250–500 мс. Хоткей — крейт `handy-keys` 0.3.4; режимы Toggle / PushToTalk / HoldOrToggle (~300 мс).
- Модели: дефолт Handy — Parakeet EN 0.6B (~661 МБ, CC-BY-4.0, **только английский**);
  Whisper многоязычен и под MIT. Для русского берём Whisper (tiny/base/small/medium).
- Риски: `SendInput` не доставляет текст в окна, запущенные от администратора; Vulkan-бэкенды
  добавляют 30–50 МБ к бинарю; CPU на 4 ядрах — 1.5–3× реального времени.

## 5. Разведка: Google (Calendar + Drive)

- Поток для desktop: loopback `http://127.0.0.1:<порт>` + PKCE S256 (OOB Google отключил).
  `client_secret` для нативных клиентов Google считает публичным.
- `calendar.events` и `calendar.readonly` — **sensitive**: верификация требует домена, политики
  приватности, видео и обоснования. В статусе Testing — ≤100 разрешённых аккаунтов и
  **refresh-токен живёт ровно 7 дней**.
- `drive.file` — non-sensitive (приложение видит только созданные им файлы) → правильный выбор
  для транспорта синка.
- Инкрементальная синхронизация: `syncToken`; при `410 Gone` (`fullSyncRequired`) — полная
  пересинхронизация. Вебхуки (`channels.watch`) для desktop недоступны → только опрос.
- Библиотеки: `yup-oauth2` 12 + `google-calendar3` 6 тянут hyper и генератор; при нашем стеке
  дешевле свой loopback-сервер (~40 строк) + `reqwest` + `keyring`.

## 6. Чем меряем (acceptance)

- `bun run check:all` = tsc + eslint + vitest + покрытие (ratchet) + cargo test + clippy `-D warnings`;
  сейчас зелено: 323 vitest, 62 cargo, покрытие 59.36/55.09/56.1/60.41.
- Релиз: тег → GitHub Actions → NSIS/MSI + portable zip + `latest.json`; автообновление проверяется
  на живой portable-копии (пользователь подтверждает).
- Приёмка каждой волны: независимый @oracle вслепую против манифеста + ручная проверка пользователем.
