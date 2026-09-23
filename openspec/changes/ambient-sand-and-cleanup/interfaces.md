# Interfaces: песок, переименования, снос доски (заморожено 2026-09-23)

## 1. Владение файлами (один писатель на файл)

| Срез | Владеет |
|---|---|
| SandHourglass | `src/components/WinterCanvas.tsx`, `src/components/__tests__/WinterCanvas.test.tsx` |
| AmbientCleanup | `src/components/DashboardView.tsx`, `WinterBottomPlayer.tsx`, `Timer.tsx` (если контролы переезжают), `src/App.tsx`, `src/services/i18n.ts`, тесты этих файлов |

## 2. Контракт часов (R01–R03)

```ts
export const CYCLE_DURATION_MS = 60000;   // полный цикл: пересыпание + переворот
export const DRAIN_DURATION_MS = 58800;   // сколько сыпется песок
export const FLIP_DURATION_MS  = 1200;    // сколько длится переворот
export function calculateSandLevel(elapsedMs: number): number;   // 1 → 0 за пересыпание
export function calculateHourglassAngle(elapsedMs: number, running: boolean): number; // 0 → π
```

Правила: при `running: false` уровень заморожен, угол 0; переворот начинается, когда песок
закончился; цикл повторяется. Обе функции чистые и покрыты тестами.

## 3. Контракт экрана (R04–R07)

- `DashboardView` рендерит **только** эмбиент-экран: canvas + панели + док. Режима виджетов,
  пикера и префа `alarmer_dashboard_widgets` не существует.
- Док (`WinterBottomPlayer`) несёт полный набор управления таймером: режим (помодоро/секундомер),
  пресеты и ±5 мин, старт/пауза, сброс, пропуск фазы, звук.
- Панели: ближайший будильник (переход в раздел будильников), задачи (отметка + быстрое
  добавление + «все»), недавние заметки (открыть).
- Подписи меню: ключи `sidebarAlarms` и `sidebarTasks` в обеих локалях.

## 4. Что считается доказательством

- `bunx vitest run` по затронутым файлам — включая тест «контролов старой доски нет в DOM».
- Живой прогон: подписи меню, отсутствие доски, видимый песок, работающие кнопки навигации.
- `bun run check` целиком перед релизом.
