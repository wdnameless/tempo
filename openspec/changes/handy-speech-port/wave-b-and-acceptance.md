# Wave B + приёмка (план оркестратора)

Волна A (три исполнителя, идут параллельно): `RustSpeechCore` (catalog.json + catalog.rs +
models.rs + mod.rs + lib.rs), `SpeechPanelShell` (SpeechPanel + AudioSettings + FeedbackSettings +
SettingsView), `SpeechDataSections` (Delivery/Language/CustomWords/History/PostProcess/Debug/
Onboarding + DictationIndicator + App.tsx).

## Wave B — один исполнитель, после волны A

Почему отдельно: файлы `src/services/stt.ts`, `src/services/speechSettings.ts` и
`src/components/speech/SpeechPanel.tsx` в волне A принадлежат другим исполнителям, поэтому
надстройка над `AcceleratorInfo` (interfaces.md §5a, команда `stt_accelerators`) делается
после их выхода — иначе два писателя на один файл.

- [ ] `src/services/speechSettings.ts`: `SpeechConfig` += `accelerator: string`,
      `gpuDevice: string | null`, `modelUnloadSecs: number`; ключи префов
      `tempo_speech_accelerator`, `tempo_speech_gpu_device`, `tempo_speech_model_unload_secs`
      в `FIELD_TO_PREF`; значения по умолчанию `auto` / `null` / `60`.
- [ ] `src/services/stt.ts`: `accelerators(): Promise<AcceleratorInfo[]>`, тип `AcceleratorInfo`
      (§5a), и проброс в маппер ошибок при необходимости.
- [ ] `src/components/speech/AdvancedSettings.tsx` (новый): выбор ускорителя (auto/cpu/gpu +
      устройство из `accelerators()`), выбор таймаута выгрузки модели (никогда / 2 / 5 / 10 / 15 мин),
      плюс уже существующий тумблер оверлея, если он окажется здесь уместнее `SpeechDebug`.
- [ ] `SpeechPanel.tsx`: под-таб `advanced` (ключ i18n `settingsSpeechTabAdvanced`) или секция
      внутри `debug` — решает исполнитель, но без дублей: один компонент, одно место.
- [ ] Тест на новый сервис + тест на секцию; `bunx vitest run` по своим файлам.

## Приёмка (W4, оркестратор)

1. `cd src-tauri && cargo test` — зелёный, включая перенесённые из Handy тесты автомата
   активации (`ptt.rs`: автоповтор = одна запись, отпускание внутри grace, тап-фиксация,
   нажатие во время распознавания, два тапа = no-op, отмена) и VAD (`vad.rs`).
2. `bun run check` — tsc + eslint + vitest.
3. `bun run test:coverage` — пороги 53/50/50/54 не просели.
4. `bun run tauri build --no-bundle` — линковка новых зависимостей (`earshot`, `rodio`, `sha2`).
5. Ручной прогон в собранном приложении (`bun run tauri dev` или portable-сборка):
   - каталог: ≥13 карточек моделей, у каждой ≥2 кванта, поиск/фильтры работают;
   - скачивание: прогресс в процентах, МБ/с и ETA, отмена, повторный запуск продолжает с места,
     после скачивания файл попадает в папку моделей и карточка помечается «установлена»;
   - **зажать хоткей → наговорить → отпустить** → текст появляется в стороннем окне;
   - короткий тап фиксирует запись до следующего нажатия (hold-or-toggle);
   - автоповтор клавиши не рвёт запись; Esc во время записи отменяет и ничего не вставляет;
   - тап во время распознавания ставит запись в очередь (второй тап — no-op);
   - индикатор показывает уровень и время, кнопка отмены работает; звук на старте/стопе играет;
   - история: запись появляется, «сохранить» защищает от чистки, повтор распознавания работает;
   - после перезапуска приложения хоткей и все настройки на месте и работают при скрытом окне.
6. Слепая приёмка `oracle` по `manifest.md` (R01–R25) и этому файлу — oracle не видит наш diff-план,
   только требования и репозиторий.
7. `node 'D:/ohmypi/tools/archmap.mjs' scan --root .` — дельта архитектуры одной строкой.
