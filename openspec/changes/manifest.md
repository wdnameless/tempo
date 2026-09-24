# Requirements Manifest — Alarms UI redesign + AI schedule intake

Date: 2026-09-24. Program T3, slices: `alarms-ui-redesign`, `alarms-ai-schedule`.

| ID | Requirement | Verbatim source | Status |
|----|-------------|-----------------|--------|
| R01 | Переделать «ужасный» интерфейс будильников | «во первых у нас ужасный интерфейс» | done |
| R02 | ИИ-ассистент настраивает будильник: вставляешь программу (напр. тренировок) на день → будильник на каждую задачу | «я хочу чтобы будильник мог настривать ИИ ассистент. К примеру я кидаю ему свою программу тренировок на день и он ставит будильник на каждую задачу» | done |
| R03 | Повторение каждый час или любой заданный интервал | «если нужно ставить повторение каждый час или любое заданное время» | done |
| R04 | Scope редизайна: вкладка Alarms + экран звонка (AlarmCenter), AlarmAudio, next-alarm виджет | interview: «Alarms + экран звонка» | done |
| R05 | Стиль: чистый минимализм — список будильников главный экран, создание в модальном sheet, звук в настройках будильника | interview: «Чистый минимализм: список + модальное создание» | done |
| R06 | ИИ интегрирован во вкладку Alarms: поле «Вставь расписание — я расставлю будильники», карточка подтверждения перед созданием; переиспользовать aiCompiler | interview: «Довести до ума существующее: встроить в Alarms» | done |
| R07 | Провайдер ИИ: существующий BYOK OpenAI-compatible, офлайн-парсер без ключа | interview: «Текущий BYOK OpenAI-compatible» | done |
| R08 | Не ломать: Rust scheduler, 5 repeat modes, тесты alarms/aiCompiler | ANALYZE-FIRST + recon (scheduler.rs, Alarms.test.tsx, aiCompiler.test.ts) | done |

## Verification (runtime, browser @ vite dev :1420)
- Alarms tab: list-first, compact sound row, no NEW ALARM form, AI intake card — screenshots .tmp/alarms-redesign2.png
- Intake: pasted «08:00 подъём, 09:00 зарядка, ... пить воду каждый час с 9 до 18, ... 22:30 сон» → 6 drafts; «Пить воду» = repeat `interval`, intervalMinutes 60 — .tmp/intake-drafts.png
- Apply → drafts cleared, onApplied(count=6); persistence to SQLite requires Tauri IPC (browser preview no-op by design) — unexercised link.

## Slice mapping
- `alarms-ui-redesign`: R01, R04, R05, R08
- `alarms-ai-schedule`: R02, R03, R06, R07, R08
