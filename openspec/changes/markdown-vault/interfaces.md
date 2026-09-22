# Interfaces: markdown-vault (заморожено 2026-09-22)

## 1. Владение файлами (один писатель на файл)

| Срез | Владеет |
|---|---|
| S1 VaultCore | `src-tauri/src/vault.rs` (новый), `src-tauri/src/lib.rs`, `src-tauri/src/storage/{schema.rs,migrations.rs,repo.rs,mod.rs}`, `src-tauri/Cargo.toml` (+`tauri-plugin-dialog`), `src-tauri/capabilities/*.json`, `src/services/vault.ts` (новый) |
| S2 Editor | `src/components/NotesEditor.tsx` (новый), `src/components/__tests__/NotesEditor.test.tsx` (новый), `package.json` (зависимости CodeMirror) |
| S3 VaultUi | `src/components/NotesView.tsx`, `src/components/NotesTree.tsx` (новый), `src/services/notes.ts`, `src/components/__tests__/NotesView*.test.tsx`, `src/components/DashboardView.tsx` (только если потребуется) |
| оркестратор | `src/services/i18n.ts` (ключи добавляю сам, см. §5) |

## 2. Vault (Rust + `src/services/vault.ts`)

```ts
export interface VaultEntry { path: string; name: string; isDir: boolean; children: VaultEntry[] }

export function vaultRoot(): Promise<string>;
export function setVaultRoot(path: string): Promise<string>;      // создаёт папку, если нет; возвращает нормализованный путь
export function pickVaultFolder(): Promise<string | null>;         // системный диалог, null = отмена
export function listVault(): Promise<VaultEntry[]>;                // рекурсивно, только .md и папки
export function readNoteFile(path: string): Promise<string>;
export function writeNoteFile(path: string, content: string): Promise<void>;
export function createNoteFile(path: string, content?: string): Promise<void>;   // ошибка, если файл есть
export function renameNoteFile(from: string, to: string): Promise<void>;         // и файл, и папку
export function deleteNoteFile(path: string): Promise<void>;
export function createVaultFolder(path: string): Promise<void>;
export function dailyNotePath(dateIso: string): string;            // "Journal/YYYY/MM/YYYY-MM-DD.md"
export function ensureDailyNote(dateIso: string): Promise<string>;  // создаёт из шаблона, если нет
export function openVaultInExplorer(): Promise<void>;
```

Rust-команды: `vault_root`, `vault_set_root`, `vault_pick_folder`, `vault_list`, `vault_read`,
`vault_write`, `vault_create`, `vault_rename`, `vault_delete`, `vault_mkdir`, `vault_daily`,
`vault_open`. Преф: `tempo_vault_root` (пусто = `<data_dir>/vault`).

Правила: все пути — **относительные внутри корня**; попытка выйти за корень (`..`, абсолютный
путь) отклоняется с внятной ошибкой; запись атомарная (временный файл + переименование).

## 3. Индекс (R2/R9): база — не хранилище, а индекс файлов

- В `notes` добавляется колонка `path TEXT` (миграция v5) — путь относительно корня.
- `id` заметки остаётся строкой; для файла, найденного на диске, id выводится из пути
  (`file:<path>`) — так ссылки, бэклинки и синхронизация продолжают работать.
- `src/services/notes.ts` получает:
  ```ts
  export function reindexVault(): Promise<{ files: number; notes: number }>;  // обход vault → upsert строк → links → FTS
  export function migrateNotesToFiles(): Promise<{ exported: number }>;        // одноразово, R9
  export function noteByPath(path: string): Promise<NoteItem | null>;
  ```
- Порядок при переиндексации: файлы → строки `notes` (title = первая `# ` или имя файла,
  body_md = содержимое) → `syncOutgoingLinks` (уже есть, `notes.ts:24-47`) → `reindex('note')`.

## 4. Редактор (`NotesEditor`, S2)

```ts
export interface NotesEditorProps {
  value: string;
  onChange: (markdown: string) => void;   // на каждое изменение
  onSave?: (markdown: string) => void;    // Ctrl+S и blur
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}
```

Зависимости: `@codemirror/state`, `@codemirror/view`, `@codemirror/language`,
`@codemirror/lang-markdown`, `@codemirror/commands`, `@codemirror/search`, `@lezer/highlight`.

Live-preview (R5): заголовки — крупнее и жирнее; `**жирный**`, `*курсив*`, `` `код` ``
отрисованы, маркеры приглушены; списки и цитаты со своими маркерами; `- [ ]` / `- [x]`
кликабельны и меняют текст; блоки кода с фоном. Строка под курсором показывает разметку
как есть (чтобы можно было править). Редактор обязан включить `user-select: text` (R11).

## 5. Ключи i18n (добавляет оркестратор)

`vaultTitle`, `vaultFolder`, `vaultChangeFolder`, `vaultOpenFolder`, `vaultRefresh`,
`vaultToday`, `vaultNewNote`, `vaultNewFolder`, `vaultRename`, `vaultDelete`, `vaultConfirmDelete`,
`vaultExternalChanged`, `vaultReload`, `vaultKeepMine`, `vaultEmptyTree`, `vaultMigrationDone`,
`notesUnsaved`, `editorPlaceholder`, `notesFilesHint`.

## 6. Приёмка

- S1: `cargo test` — пути и защита от выхода за корень, листинг, чтение/запись/переименование,
  ежедневная заметка идемпотентна, шаблон подставляется.
- S2: `bunx vitest run` по редактору — ввод меняет markdown, чек-бокс переключается,
  заголовок оформляется, `Ctrl+S` вызывает `onSave`.
- S3: тесты дерева и заметок — создание/переименование/удаление меняют файлы, «Обновить»
  подхватывает внешнюю правку, миграция выгружает все заметки.
- Оркестратор: `bun run check:all`, `bun run tauri build --no-bundle`, ручной прогон
  (файл на диске ↔ редактор ↔ ссылки ↔ поиск), oracle.
