# Recon: markdown-vault и редактор

Две разведки (scout), только чтение. Всё с точками в коде.

## Что есть сегодня

| Слой | Где | Состояние |
|---|---|---|
| Хранение заметок | `storage/schema.rs:44-51`, `migrations.rs:66-67` | таблица `notes(id, title, body_md, pinned, updated_at, deleted_at)`, триггеры пишут в `sync_outbox` |
| Сервис | `services/notes.ts:13` (`repo<NoteRow>('notes')`), `store.ts:177-203` | CRUD + `syncOutgoingLinks` (`notes.ts:24-47`) |
| Редактор | `components/NotesView.tsx:515-537` | **обычный `<textarea>`** + переключатель превью; сохранение **только по blur** (`:226-242`), автосейва нет |
| Рендер markdown | `services/markdown.tsx:58-202` | самописный парсер на регулярках: заголовки, цитаты, списки, код, инлайн. **Нет таблиц, нет чек-боксов** |
| Библиотеки редактора | `package.json` | **нет ни одной**: ни TipTap/ProseMirror, ни CodeMirror, ни Slate/Lexical, ни marked/remark |
| Ссылки `[[...]]` | `services/linking.ts:19-35` (разбор), `:40-49` (`links_set`), `repo.rs:756-784` | таблица `links`, переписывание при переименовании (`notes.ts:120-137`) |
| Бэклинки | `NotesView.tsx:137`, `repo.rs:786-815` | запрос по таблице `links` с join на `notes` |
| Поиск | `services/search.ts:66-72`, `repo.rs:511-532` | FTS5 `search_fts(kind,row_id,title,body)` из `notes` |
| Файловый ввод-вывод | `storage/assets.rs`, `recording/*` | запись/чтение файлов есть, **диалога выбора папки нет** (`tauri-plugin-dialog` отсутствует) |
| Глобальные хоткеи | `stt/shortcuts.rs` + `services/shortcuts.ts` | регистрируются на старте приложения — редактор не должен с ними конфликтовать |
| CSS-ловушка | `src/index.css:32-38` | `html, body, #root { user-select: none }` — **сломает выделение в contenteditable/CodeMirror без явного `user-select: text`** |

## Все, кто читает или пишет заметки (нельзя потерять)

`NotesView.tsx` (редактор, бэклинки, автокомплит ссылок), `services/notes.ts`, `store.ts`
(`loadState`/`saveState`/`exportState`/`importState`/`runLegacyMigration`), `App.tsx:207,290,328`
(состояние + вкладка), `DashboardView.tsx:301-316` (список заметок), `aiCompiler.ts:490,654,742`
(контекст для модели + интент `create_note`), `searchRegistry.ts:71-78` (переход к заметке),
`repo.rs` (FTS, ссылки, бэклинки), синхронизация через `sync_outbox`.

## Решения пользователя (Wave 0)

1. Редактор — **live-preview поверх markdown** (как Obsidian), не блочный WYSIWYG.
2. **Файлы — источник правды**, база становится индексом (ссылки, бэклинки, поиск пересчитываются из файлов).
3. Своя папка хранилища **с дефолтом** внутри данных приложения.
4. Ежедневные заметки — `Journal/YYYY/MM/YYYY-MM-DD.md`.
5. Правки снаружи — читаем файл при открытии, есть кнопка «Обновить», живого слежения нет.

## Проверка приёмки

1. `cargo test` — новые тесты vault (пути, листинг, запись/чтение, ежедневная заметка, защита от выхода за пределы корня).
2. `bun run check` — tsc/eslint/vitest; новые тесты редактора и дерева.
3. Ручной прогон в собранном приложении: заметка создаётся → файл появляется на диске → правка в блокноте видна после «Обновить» → ссылка `[[...]]` и бэклинк работают → поиск находит текст из файла.
