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
    const legacyState = {
      schemaVersion: 1,
      alarms: [
        { id: 'a1', time: '08:00', label: 'Wake', days: [1, 2, 3], repeat: 'daily', enabled: true, sound: 'beep' }
      ],
      schedules: [
        { id: 's1', name: 'Morning Routine', steps: [{ id: 'st1', label: 'Stretch', duration: 300 }] }
      ],
      tasks: [
        { id: 't1', title: 'Write tests', completed: false }
      ],
      notes: [
        { id: 'n1', title: 'Note 1', body: 'Hello world' }
      ],
      chatMessages: [
        { id: 'm1', role: 'user', content: 'Hi AI', timestamp: '2026-09-19T10:00:00Z' }
      ],
      preferences: {
        alarmer_accent: '#ff0000',
        alarmer_sidebar_collapsed: true,
      },
      directions: [
        { id: 'd1', name: 'Work' }
      ]
    };

    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'load_legacy_store') {
        return Promise.resolve(JSON.stringify(legacyState));
      }
      if (cmd === 'db_list') {
        return Promise.resolve([]);
      }
      return Promise.resolve(undefined);
    });

    await runLegacyMigration();

    // Check alarms inserted
    expect(mockInvoke).toHaveBeenCalledWith('db_insert', expect.objectContaining({
      table: 'alarms',
      row: expect.objectContaining({ id: 'a1', time: '08:00', label: 'Wake' })
    }));

    // Check tasks inserted
    expect(mockInvoke).toHaveBeenCalledWith('db_insert', expect.objectContaining({
      table: 'tasks',
      row: expect.objectContaining({ id: 't1', title: 'Write tests', status: 'open' })
    }));
    // Check notes inserted
    expect(mockInvoke).toHaveBeenCalledWith('db_insert', expect.objectContaining({
      table: 'notes',
      row: expect.objectContaining({ id: 'n1', title: 'Note 1', body_md: 'Hello world' })
    }));

    // Check chat message inserted into chat_messages with role user
    expect(mockInvoke).toHaveBeenCalledWith('db_insert', expect.objectContaining({
      table: 'chat_messages',
      row: expect.objectContaining({ role: 'user', content: 'Hi AI' })
    }));

    // Check preferences renamed alarmer_* -> tempo_*
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', {
      key: 'tempo_accent',
      value: '"#ff0000"',
    });
    expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', {
      key: 'tempo_sidebar_collapsed',
      value: 'true',
    });

    // Check schedules were NOT inserted into alarms (no alarms for steps)
    const insertedAlarms = mockInvoke.mock.calls
      .filter(([cmd, args]) => cmd === 'db_insert' && tableOf(args) === 'alarms')
      .map(([, args]) => insertedRowOf(args));
    expect(insertedAlarms.length).toBe(1);
    expect(insertedAlarms[0]?.id).toBe('a1');

    // Running twice does not duplicate rows because migrator checks if db is already populated or file already migrated
    mockInvoke.mockClear();
    mockInvoke.mockImplementation((cmd) => {
      if (cmd === 'load_legacy_store') return Promise.resolve(JSON.stringify(legacyState));
      if (cmd === 'db_list') return Promise.resolve([{ id: 'a1' }]); // DB now has rows
      return Promise.resolve(undefined);
    });

    await runLegacyMigration();
    // Since DB already has alarms, it skips migration
    const secondInserts = mockInvoke.mock.calls.filter(([cmd]) => cmd === 'db_insert');
    expect(secondInserts.length).toBe(0);
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
});
