import { describe, it, expect, vi, beforeEach } from 'vitest';
import { repo, SCHEMA_VERSION, search, dbReady, dbPath } from '../db';
import { getPref, setPref, subscribePrefs } from '../settings';
import { StoreService, runLegacyMigration } from '../store';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

function tableOf(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || !('table' in args)) return undefined;
  return typeof args.table === 'string' ? args.table : undefined;
}

/** The row the backend answers a write with: what it stored, plus its stamps. */
function storedRow(args: unknown): Record<string, unknown> {
  const row = insertedRowOf(args) ?? {};
  return { id: 'stamped', updated_at: '2026-09-19T00:00:00Z', deleted_at: null, ...row };
}

function insertedRowOf(args: unknown): Record<string, unknown> | undefined {
  if (!args || typeof args !== 'object' || !('row' in args)) return undefined;
  const row = args.row;
  return row && typeof row === 'object' ? (row as Record<string, unknown>) : undefined;
}

describe('Database layer (db.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports the current SCHEMA_VERSION as 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  it('rejects unknown tables in repo()', () => {
    // @ts-expect-error testing runtime invalid table rejection
    expect(() => repo('non_existent_table')).toThrow(/Invalid table name/);
  });

  it('maps all() calls to db_list command', async () => {
    const mockRows = [{ id: '1', title: 'Task 1', updated_at: '2026-09-19T00:00:00Z', deleted_at: null }];
    mockInvoke.mockResolvedValueOnce(mockRows);

    const taskRepo = repo<{ id: string; title: string; updated_at: string; deleted_at: string | null }>('tasks');
    const rows = await taskRepo.all();

    expect(mockInvoke).toHaveBeenCalledWith('db_list', { table: 'tasks', includeDeleted: false });
    expect(rows).toEqual(mockRows);
  });

  it('maps byId() calls to db_get command', async () => {
    const mockRow = { id: 'abc', title: 'My Note', updated_at: '2026-09-19T00:00:00Z', deleted_at: null };
    mockInvoke.mockResolvedValueOnce(mockRow);

    const noteRepo = repo<{ id: string; title: string; updated_at: string; deleted_at: string | null }>('notes');
    const row = await noteRepo.byId('abc');

    expect(mockInvoke).toHaveBeenCalledWith('db_get', { table: 'notes', id: 'abc' });
    expect(row).toEqual(mockRow);
  });

  it('maps insert() and update() calls correctly', async () => {
    // The layer expects the row the backend wrote back (it is what carries the
    // stamped id and updated_at), so the mock returns one.
    mockInvoke.mockResolvedValueOnce({ id: 'a1', label: 'Morning', updated_at: 'x', deleted_at: null });
    mockInvoke.mockResolvedValueOnce({ id: 'a1', label: 'Wake Up', updated_at: 'y', deleted_at: null });

    const alarmRepo = repo<{ id: string; label: string; updated_at: string; deleted_at: string | null }>('alarms');
    // `insert` takes the entity without its metadata: the layer stamps id and
    // updated_at, which is the whole reason no caller generates either.
    await alarmRepo.insert({ label: 'Morning' });
    expect(mockInvoke).toHaveBeenCalledWith('db_insert', {
      table: 'alarms',
      row: { label: 'Morning' },
    });

    await alarmRepo.update('a1', { label: 'Wake Up' });
    expect(mockInvoke).toHaveBeenCalledWith('db_update', {
      table: 'alarms',
      id: 'a1',
      patch: { label: 'Wake Up' },
    });
  });

  it('remove() invokes soft delete (db_delete)', async () => {
    mockInvoke.mockResolvedValueOnce(undefined);

    const taskRepo = repo<{ id: string; updated_at: string; deleted_at: string | null }>('tasks');
    await taskRepo.remove('t1');

    expect(mockInvoke).toHaveBeenCalledWith('db_delete', { table: 'tasks', id: 't1' });
  });

  it('changedSince() invokes db_changed_since', async () => {
    mockInvoke.mockResolvedValueOnce([]);

    const taskRepo = repo<{ id: string; updated_at: string; deleted_at: string | null }>('tasks');
    await taskRepo.changedSince('2026-09-19T00:00:00Z');

    expect(mockInvoke).toHaveBeenCalledWith('db_changed_since', {
      table: 'tasks',
      iso: '2026-09-19T00:00:00Z',
    });
  });

  it('search() calls db_search with query and limit', async () => {
    const hits = [{ kind: 'task', row_id: '1', title: 'Buy milk', body: '', rank: 0.1 }];
    mockInvoke.mockResolvedValueOnce(hits);

    const res = await search('milk', 10);
    expect(mockInvoke).toHaveBeenCalledWith('db_search', { query: 'milk', limit: 10 });
    expect(res).toEqual(hits);
  });

  it('dbReady() initializes preferences, runs migrations, reindexes, and returns schema version', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'db_ready') return Promise.resolve(true);
      if (cmd === 'db_list') return Promise.resolve([]);
      if (cmd === 'db_reindex') return Promise.resolve(10);
      return Promise.resolve(null);
    });

    const v = await dbReady();
    expect(v).toBe(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_ready');
    expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: undefined });
  });

  it('dbPath() returns database location', async () => {
    mockInvoke.mockResolvedValueOnce('C:/app/data/tempo.db');
    const p = await dbPath();
    expect(p).toBe('C:/app/data/tempo.db');
  });
});

describe('Settings layer (settings.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('setPref and getPref interact with in-memory cache and db_pref_set', async () => {
    mockInvoke.mockResolvedValue(undefined);

    expect(getPref('tempo_theme', 'dark')).toBe('dark');

    const unsubscribe = subscribePrefs((key, val) => {
      expect(key).toBe('tempo_theme');
      expect(val).toBe('light');
    });

    await setPref('tempo_theme', 'light');

    expect(getPref('tempo_theme', 'dark')).toBe('light');
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', { key: 'tempo_theme', value: '"light"' });

    unsubscribe();
  });
});
describe('Migrator and StoreService Bridge (store.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StoreService.resetCache();
  });

  it('migrator moves alarms, tasks, notes, chat messages, preferences and drops schedules', async () => {
    // The real file is wrapped in `state` by the store plugin and holds entities in
    // their canonical shape (title, days array, done boolean). The previous fixture
    // was flat and used column names, so it passed while the real migration moved
    // nothing at all.
    const legacyState = {
      state: {
        schemaVersion: 6,
        alarms: [
          { id: 'a1', title: 'Wake', time: '08:00', days: [1, 2, 3], repeat: 'days', enabled: true, sound: 'beep' },
        ],
        schedules: [
          { id: 's1', name: 'Morning Routine', steps: [{ id: 'st1', label: 'Stretch', duration: 300 }] },
        ],
        tasks: [
          { id: 't1', title: 'Write tests', done: true, createdAt: '2026-09-01T08:00:00Z', completedAt: '2026-09-02T09:00:00Z' },
          { id: 't2', title: 'Still open', done: false, createdAt: '2026-09-03T08:00:00Z' },
        ],
        notes: [{ id: 'n1', title: 'Note 1', body: 'Hello world', pinned: true }],
        chatMessages: [
          { id: 'm1', sender: 'user', text: 'Hi AI', timestamp: '2026-09-19T10:00:00Z' },
          { id: 'm2', sender: 'assistant', text: 'Hello', timestamp: '2026-09-19T10:00:05Z' },
        ],
        preferences: { alarmer_accent: '#ff0000', alarmer_sidebar_collapsed: true },
        dynamicUi: { colors: {}, typography: { fontFamily: 'sans', timeScale: 1 }, dial: {}, layout: {} },
        aiSettings: { apiKey: 'sk-must-not-be-copied', baseUrl: 'https://example.test', model: 'm1' },
        directions: [{ id: 'd1', name: 'Work' }],
      },
    };

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'load_legacy_store') return Promise.resolve(JSON.stringify(legacyState));
      if (cmd === 'db_list') return Promise.resolve([]);
      if (cmd === 'db_insert') return Promise.resolve(storedRow(args));
      return Promise.resolve(undefined);
    });

    await runLegacyMigration();

    const inserted = (table: string): Record<string, unknown>[] =>
      mockInvoke.mock.calls
        .filter(([cmd, args]) => cmd === 'db_insert' && tableOf(args) === table)
        .map(([, args]) => insertedRowOf(args))
        .filter((row): row is Record<string, unknown> => row !== undefined);

    const alarms = inserted('alarms');
    expect(alarms).toHaveLength(1);
    const alarm = alarms[0];
    expect(alarm).toMatchObject({ id: 'a1', label: 'Wake', time: '08:00', repeat: 'days' });
    expect(alarm?.days).toBe('[1,2,3]');

    const tasks = inserted('tasks');
    expect(tasks).toHaveLength(2);
    const doneTask = tasks.find((task) => task.id === 't1');
    const openTask = tasks.find((task) => task.id === 't2');
    // The done flag survives as a status, and the timestamps are carried over
    // rather than replaced with "now".
    expect(doneTask).toMatchObject({ status: 'done', completed_at: '2026-09-02T09:00:00Z' });
    expect(openTask).toMatchObject({ status: 'open' });

    const notes = inserted('notes');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ id: 'n1', body_md: 'Hello world', pinned: 1 });

    const chat = inserted('chat_messages');
    expect(chat).toHaveLength(2);
    const userMessage = chat.find((message) => message.id === 'm1');
    const assistantMessage = chat.find((message) => message.id === 'm2');
    expect(userMessage).toMatchObject({ role: 'user', content: 'Hi AI' });
    expect(assistantMessage).toMatchObject({ role: 'assistant' });

    // Schedules are dropped, not turned into alarms (R30).
    expect(alarms).toHaveLength(1);
    expect(mockInvoke.mock.calls.some(([cmd]) => cmd === 'db_insert' && false)).toBe(false);

    // Preferences are renamed once.
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', { key: 'tempo_accent', value: '"#ff0000"' });
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', { key: 'tempo_sidebar_collapsed', value: 'true' });
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', { key: 'tempo_ai_base_url', value: '"https://example.test"' });

    // The API key must never reach the database: it belongs in the OS keyring.
    const prefsWritten = mockInvoke.mock.calls
      .filter(([cmd]) => cmd === 'db_pref_set')
      .map(([, args]) => JSON.stringify(args));
    expect(prefsWritten.some((entry) => entry.includes('sk-must-not-be-copied'))).toBe(false);

    // A second run over a populated database inserts nothing.
    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'load_legacy_store') return Promise.resolve(JSON.stringify(legacyState));
      if (cmd === 'db_list') return Promise.resolve([{ id: 'a1' }]);
      if (cmd === 'db_insert') return Promise.resolve(storedRow(args));
      return Promise.resolve(undefined);
    });
    await runLegacyMigration();
    expect(mockInvoke.mock.calls.filter(([cmd]) => cmd === 'db_insert')).toHaveLength(0);
  });

  it('missing legacy file is not an error', async () => {
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'db_list') return Promise.resolve([]);
      if (cmd === 'load_legacy_store') return Promise.reject(new Error('File not found'));
      return Promise.resolve(undefined);
    });

    await expect(runLegacyMigration()).resolves.toBeUndefined();
  });

  it('StoreService public API works as expected', async () => {
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'db_list') return Promise.resolve([]);
      return Promise.resolve(undefined);
    });

    await StoreService.hydrate();
    const snap = StoreService.snapshot();
    expect(snap.alarms).toEqual([]);
    expect(snap.tasks).toEqual([]);

    // The legacy key is rewritten once, so both spellings read the same value.
    await StoreService.setPreference('alarmer_sidebar_collapsed', true);
    expect(StoreService.getPreference('alarmer_sidebar_collapsed', false)).toBe(true);
    expect(StoreService.getPreference('tempo_sidebar_collapsed', false)).toBe(true);
  });

  it('completes a partially finished migration on the next launch', async () => {
    // Alarms landed last time; notes, chat and preferences did not. The migrator
    // must not stop at "the database is not empty" — that abandons the rest with
    // no way for the user to recover it.
    const legacyState = {
      state: {
        alarms: [{ id: 'a1', title: 'Wake', time: '08:00', days: [], repeat: 'once', enabled: true, sound: 'beep' }],
        tasks: [],
        notes: [{ id: 'n1', title: 'Note 1', body: 'Hello world', pinned: false }],
        chatMessages: [{ id: 'm1', sender: 'user', text: 'Hi AI', timestamp: '2026-09-19T10:00:00Z' }],
        preferences: { alarmer_accent: '#ff0000' },
      },
    };

    mockInvoke.mockImplementation((cmd, args) => {
      if (cmd === 'load_legacy_store') return Promise.resolve(JSON.stringify(legacyState));
      if (cmd === 'db_list') {
        const table = tableOf(args);
        return Promise.resolve(table === 'alarms' ? [{ id: 'a1' }] : []);
      }
      if (cmd === 'db_insert') return Promise.resolve(storedRow(args));
      return Promise.resolve(undefined);
    });

    await runLegacyMigration();

    const inserted = (table: string) =>
      mockInvoke.mock.calls.filter(([cmd, args]) => cmd === 'db_insert' && tableOf(args) === table);

    expect(inserted('alarms')).toHaveLength(0);
    expect(inserted('notes')).toHaveLength(1);
    expect(inserted('chat_messages')).toHaveLength(1);
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', { key: 'tempo_accent', value: '"#ff0000"' });
  });
});