import { invoke } from '@tauri-apps/api/core';

export const SCHEMA_VERSION = 1;

export type Table =
  | 'tasks'
  | 'lists'
  | 'notes'
  | 'drawings'
  | 'recordings'
  | 'alarms'
  | 'chat_messages'
  | 'preferences'
  | 'sync_outbox';

const VALID_TABLES: ReadonlySet<string> = new Set<Table>([
  'tasks',
  'lists',
  'notes',
  'drawings',
  'recordings',
  'alarms',
  'chat_messages',
  'preferences',
  'sync_outbox',
]);

function assertValidTable(table: string): asserts table is Table {
  if (!VALID_TABLES.has(table)) {
    throw new Error(`Invalid table name: ${table}`);
  }
}

export interface EntityMeta {
  id: string;
  updated_at: string;
  deleted_at: string | null;
}

export interface SearchHit {
  kind: string;
  row_id: string;
  title: string;
  body: string;
  rank: number;
}

export interface Repo<T extends EntityMeta> {
  all(): Promise<T[]>;
  byId(id: string): Promise<T | null>;
  insert(data: Omit<T, keyof EntityMeta>): Promise<T>;
  update(id: string, patch: Partial<Omit<T, keyof EntityMeta>>): Promise<T>;
  remove(id: string): Promise<void>; // soft delete via db_delete
  changedSince(iso: string): Promise<T[]>;
}

export function repo<T extends EntityMeta>(table: Table): Repo<T> {
  assertValidTable(table);

  return {
    // `invoke` resolves to `undefined` when the command is not registered — in a
    // browser preview, in a test without the IPC mock, or when the backend is
    // older than the frontend. Treat that as "no rows" rather than letting a
    // missing backend take the whole hydrate path down with a TypeError.
    async all(): Promise<T[]> {
      const rows = await invoke<T[] | undefined>('db_list', { table, includeDeleted: false });
      return rows ?? [];
    },

    async byId(id: string): Promise<T | null> {
      const row = await invoke<T | null | undefined>('db_get', { table, id });
      return row ?? null;
    },

    async insert(data: Omit<T, keyof EntityMeta>): Promise<T> {
      const row = await invoke<T | undefined>('db_insert', { table, row: data });
      if (!row) throw new Error(`db_insert returned no row for ${table}`);
      return row;
    },

    async update(id: string, patch: Partial<Omit<T, keyof EntityMeta>>): Promise<T> {
      const row = await invoke<T | undefined>('db_update', { table, id, patch });
      if (!row) throw new Error(`db_update returned no row for ${table}`);
      return row;
    },

    async remove(id: string): Promise<void> {
      await invoke<void>('db_delete', { table, id });
    },

    async changedSince(iso: string): Promise<T[]> {
      const rows = await invoke<T[] | undefined>('db_changed_since', { table, iso });
      return rows ?? [];
    },
  };
}

let readyPromise: Promise<number> | null = null;

export async function dbReady(): Promise<number> {
  if (!readyPromise) {
    readyPromise = (async () => {
      // Invoke db_ready command in rust backend
      await invoke<boolean>('db_ready');
      // Run JSON migration once if DB is empty
      const { runLegacyMigration } = await import('./store');
      await runLegacyMigration();
      // Hydrate settings cache
      const { initSettingsCache } = await import('./settings');
      await initSettingsCache();
      // Populate full-text search index after migrations
      const { reindex } = await import('./search');
      await reindex();
      return SCHEMA_VERSION;
    })();
  }
  return readyPromise;
}

export async function dbPath(): Promise<string> {
  return await invoke<string>('db_path');
}

export async function search(query: string, limit?: number): Promise<SearchHit[]> {
  // Same reason as `repo().all()`: an unregistered command resolves to
  // `undefined`, and a search that returns "nothing" is the right answer then.
  const hits = await invoke<SearchHit[] | undefined>('db_search', { query, limit });
  return hits ?? [];
}
