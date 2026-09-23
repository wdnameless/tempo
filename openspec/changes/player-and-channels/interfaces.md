# Interfaces: без кликов, свой плеер, моно/стерео (заморожено 2026-09-23)

Запрос: «Убери звуки кликов по интерфейсу. сделай нормальный плеер и добавь возможность
переключать настройки микрофона (моно\стерео)».

## 1. Владение файлами

| Срез | Владеет |
|---|---|
| NoClicks | `src/services/sound.ts`, `src/services/searchRegistry.ts`, `src/App.tsx`, `src/components/{Alarms,DashboardView,Timer,WinterBottomPlayer}.tsx`, тесты этих файлов |
| PlayerAndChannels | `src/components/RecordingsView.tsx`, `src/components/AudioPlayer.tsx` (новый), `src/services/i18n.ts`, тесты этих файлов |
| RecorderChannels | `src-tauri/src/recording/*`, `src/services/recorder.ts`, тесты этих файлов |

Пересечений нет. `RecordingsView.tsx` **не** вызывает `playUiClick` — проверено.

## 2. Что убираем (NoClicks)

- Все вызовы `soundService.playUiClick()` в коде — их 8 файлов; поведение «звук на каждое
  нажатие» уходит полностью, а не глушится флагом.
- Сама функция в `sound.ts` удаляется, если после чистки у неё не остаётся вызовов (сейчас она
  вызывается ещё и внутри `sound.ts` — этот внутренний вызов тоже уходит).
- **Остаются**: звук будильника, сигнал переворота часов, озвучка фокуса — их не трогать.
- Преф громкости кликов (`alarmer_click_volume`) **не удалять**: им пользуется сигнал переворота.
- В тестах убрать моки и утверждения про клик-звук; тест `sound.test.ts` — обновить, а не удалить.

## 3. Плеер (PlayerAndChannels)

Заменяет нативный `<audio controls>` (`RecordingsView.tsx:847`) на свой компонент:

```ts
export interface AudioPlayerProps {
  src: string;            // media-protocol URL, как сейчас
  title?: string;
  className?: string;
}
```

- Кнопка play/pause, время «0:07 / 1:32», полоса перемотки (клик и перетаскивание), регулятор
  громкости, и всё это на токенах и примитивах проекта. Никакого нативного меню-«кебаба».
- Перемотка работает и с клавиатуры (стрелки), позиция видна.
- Состояние (играет/пауза, позиция) переживает перерисовку списка.

## 4. Моно/стерео (RecorderChannels + PlayerAndChannels)

Контракт сервиса, который замораживается сейчас:

```ts
// src/services/recorder.ts
export type RecorderChannels = 1 | 2;
export function recorderChannels(): Promise<RecorderChannels>;
export function setRecorderChannels(channels: RecorderChannels): Promise<void>;
```

- Преф `tempo_recording_channels` (1 или 2), по умолчанию 2 — текущее поведение не меняется.
- Rust: `TARGET_CHANNELS` перестаёт быть константой и берётся из настройки; WAV пишется с этим
  числом каналов, буферная арифметика и преобразование каналов следуют за ним.
- UI: переключатель **Моно / Стерео** в разделе Audio экрана «Записи», рядом с выбором устройства.
  Ключи i18n добавляет PlayerAndChannels.

## 5. Что считается доказательством

- `bunx vitest run` по затронутым файлам: клик-звук больше не вызывается (мок не дёргается),
  плеер играет/пауза/перематывает, переключатель каналов пишет преф.
- `cargo test` + `cargo clippy --all-targets -- -D warnings`: запись в моно и в стерео даёт WAV
  с нужным числом каналов и корректной длительностью.
- `bun run check:all` перед релизом; живой прогон — плеер и переключатель на экране.
