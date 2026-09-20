import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
  StoreService,
  taskFromRow,
  taskToRow,
  alarmFromRow,
  alarmToRow,
  noteFromRow,
  noteToRow,
  chatMessageFromRow,
  chatMessageToRow,
} from '../store';
import type { TaskItem, AlarmItem } from '../../types';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));


/**
 * The row the fake backend answers a write with.
 *
 * The layer reads the id and `updated_at` back from this row — that is how it
 * learns what it stamped — so a mock that resolves `undefined` makes every
 * write fail. The IPC argument arrives as `unknown`, so it is narrowed here
 * instead of cast: the test then fails loudly if the argument shape changes.
 */
function tableOf(args: unknown): string | undefined {
  if (!args || typeof args !== 'object' || !('table' in args)) return undefined;
  return typeof args.table === 'string' ? args.table : undefined;
}

function writtenRow(args: unknown): Record<string, unknown> {
  const empty: Record<string, unknown> = {};
  if (!args || typeof args !== 'object') return empty;
  const written = 'row' in args ? args.row : 'patch' in args ? args.patch : undefined;
  if (!written || typeof written !== 'object') return empty;
  return { id: 'gen-1', updated_at: '2026-09-19T00:00:00Z', deleted_at: null, ...written };
}

describe('StoreService and Row Mappers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    StoreService.resetCache();
  });

  describe('Pure entity ↔ row mapping', () => {
    it('maps taskFromRow and taskToRow bidirectional', () => {
      const dbRow = {
        id: 't-123',
        title: 'Complete task',
        note: 'Some notes',
        status: 'done',
        priority: 2,
        due_date: '2026-09-20',
        start_at: '2026-09-19',
        planned_minutes: 45,
        updated_at: '2026-09-19T12:00:00Z',
        deleted_at: null,
      };

      const entity = taskFromRow(dbRow);
      expect(entity.id).toBe('t-123');
      expect(entity.title).toBe('Complete task');
      expect(entity.note).toBe('Some notes');
      expect(entity.done).toBe(true);
      expect(entity.createdAt).toBe('2026-09-19T12:00:00Z');
      expect(entity).not.toHaveProperty('priority');
      expect(entity).not.toHaveProperty('dueDate');
      expect(entity).not.toHaveProperty('plannedMinutes');

      const convertedRow = taskToRow(entity);
      expect(convertedRow.title).toBe('Complete task');
      expect(convertedRow.note).toBe('Some notes');
      expect(convertedRow.status).toBe('done');
      expect(convertedRow.priority).toBe(0);
      expect(convertedRow.due_date).toBeNull();
    });

    it('maps alarmFromRow and alarmToRow bidirectional', () => {
      const dbRow = {
        id: 'a-123',
        label: 'Wake up',
        time: '07:30',
        days: '[1,2,3,4,5]',
        repeat: 'days',
        enabled: 1,
        sound: 'gentle',
        voice_prompt: 'Time to get up',
        duration_minutes: 15,
        updated_at: '2026-09-19T00:00:00Z',
        deleted_at: null,
      };

      const entity = alarmFromRow(dbRow);
      expect(entity.id).toBe('a-123');
      expect(entity.title).toBe('Wake up');
      expect(entity.label).toBe('Wake up');
      expect(entity.time).toBe('07:30');
      expect(entity.days).toEqual([1, 2, 3, 4, 5]);
      expect(entity.repeat).toBe('days');
      expect(entity.enabled).toBe(true);
      expect(entity.sound).toBe('gentle');
      expect(entity.voicePrompt).toBe('Time to get up');
      expect(entity).not.toHaveProperty('durationMinutes');

      const convertedRow = alarmToRow(entity);
      expect(convertedRow.label).toBe('Wake up');
      expect(convertedRow.time).toBe('07:30');
      expect(convertedRow.days).toBe('[1,2,3,4,5]');
      expect(convertedRow.repeat).toBe('days');
      expect(convertedRow.enabled).toBe(1);
      expect(convertedRow.sound).toBe('gentle');
      expect(convertedRow.voice_prompt).toBe('Time to get up');
    });

    it('maps noteFromRow and noteToRow bidirectional', () => {
      const dbRow = {
        id: 'n-123',
        title: 'Meeting Notes',
        body_md: '# Notes\nContent here',
        pinned: 1,
        updated_at: '2026-09-19T10:00:00Z',
        created_at: '2026-09-19T09:00:00Z',
        deleted_at: null,
      };

      const entity = noteFromRow(dbRow);
      expect(entity.id).toBe('n-123');
      expect(entity.title).toBe('Meeting Notes');
      expect(entity.body).toBe('# Notes\nContent here');
      expect(entity.pinned).toBe(true);
      expect(entity.createdAt).toBe('2026-09-19T09:00:00Z');
      expect(entity.updatedAt).toBe('2026-09-19T10:00:00Z');

      const convertedRow = noteToRow(entity);
      expect(convertedRow.title).toBe('Meeting Notes');
      expect(convertedRow.body_md).toBe('# Notes\nContent here');
      expect(convertedRow.pinned).toBe(1);
    });

    it('maps chatMessageFromRow and chatMessageToRow', () => {
      const dbRow = {
        id: 'msg-1',
        role: 'user',
        content: 'Hello assistant',
        created_at: '2026-09-19T10:00:00Z',
        updated_at: '2026-09-19T10:00:00Z',
        deleted_at: null,
      };

      const entity = chatMessageFromRow(dbRow);
      expect(entity.id).toBe('msg-1');
      expect(entity.sender).toBe('user');
      expect(entity.text).toBe('Hello assistant');
      expect(entity.timestamp).toBe('2026-09-19T10:00:00Z');

      const convertedRow = chatMessageToRow(entity);
      expect(convertedRow.role).toBe('user');
      expect(convertedRow.content).toBe('Hello assistant');
    });
  });

  describe('Hydrate and Persist', () => {
    it('hydrate loads DB rows and maps them to canonical entities', async () => {
      mockInvoke.mockImplementation((cmd, args) => {
        if (cmd === 'db_insert' || cmd === 'db_update') return Promise.resolve(writtenRow(args));
        if (cmd === 'db_list') {
          const table = tableOf(args);
          if (table === 'alarms') {
            return Promise.resolve([
              {
                id: 'a1',
                label: 'Test Alarm',
                time: '08:00',
                days: '[]',
                repeat: 'once',
                enabled: 1,
                sound: 'gentle',
                updated_at: '2026-09-19T00:00:00Z',
                deleted_at: null,
              },
            ]);
          }
          if (table === 'tasks') {
            return Promise.resolve([
              {
                id: 't1',
                title: 'Test Task',
                status: 'open',
                updated_at: '2026-09-19T00:00:00Z',
                deleted_at: null,
              },
            ]);
          }
          if (table === 'notes') {
            return Promise.resolve([
              {
                id: 'n1',
                title: 'Note',
                body_md: 'Body',
                pinned: 0,
                updated_at: '2026-09-19T00:00:00Z',
                deleted_at: null,
              },
            ]);
          }
          if (table === 'chat_messages') {
            return Promise.resolve([
              {
                id: 'c1',
                role: 'assistant',
                content: 'Hello!',
                created_at: '2026-09-19T00:00:00Z',
                updated_at: '2026-09-19T00:00:00Z',
                deleted_at: null,
              },
            ]);
          }
          return Promise.resolve([]);
        }
        return Promise.resolve(undefined);
      });

      const state = await StoreService.hydrate();
      expect(state.alarms).toHaveLength(1);
      expect(state.alarms[0]?.id).toBe('a1');
      expect(state.alarms[0]?.title).toBe('Test Alarm');

      expect(state.tasks).toHaveLength(1);
      expect(state.tasks[0]?.id).toBe('t1');
      expect(state.tasks[0]?.done).toBe(false);

      expect(state.notes).toHaveLength(1);
      expect(state.notes[0]?.body).toBe('Body');

      expect(state.chatMessages).toHaveLength(1);
      expect(state.chatMessages[0]?.sender).toBe('assistant');
      expect(state.chatMessages[0]?.text).toBe('Hello!');
      expect(state.aiSettings.apiKey).toBe('');
    });

    it('persist writes canonical entities back to DB rows', async () => {
      mockInvoke.mockImplementation((cmd, args) => {
        if (cmd === 'db_list') return Promise.resolve([]);
        if (cmd === 'db_insert' || cmd === 'db_update') return Promise.resolve(writtenRow(args));
        return Promise.resolve(undefined);
      });

      const sampleTask: TaskItem = {
        id: 't2',
        title: 'New Task',
        done: true,
        priority: 0,
        position: 0,
        createdAt: '2026-09-19T01:00:00Z',
      };

      const sampleAlarm: AlarmItem = {
        id: 'a2',
        title: 'Alarm 2',
        label: 'Alarm 2',
        time: '09:00',
        days: [0, 6],
        repeat: 'days',
        enabled: true,
        sound: 'soft',
      };

      await StoreService.persist({
        tasks: [sampleTask],
        alarms: [sampleAlarm],
      });

      expect(mockInvoke).toHaveBeenCalledWith(
        'db_insert',
        expect.objectContaining({
          table: 'tasks',
          row: expect.objectContaining({
            title: 'New Task',
            status: 'done',
          }),
        })
      );

      expect(mockInvoke).toHaveBeenCalledWith(
        'db_insert',
        expect.objectContaining({
          table: 'alarms',
          row: expect.objectContaining({
            label: 'Alarm 2',
            time: '09:00',
            days: '[0,6]',
            repeat: 'days',
            enabled: 1,
          }),
        })
      );
    });

    it('preference alarmer_* to tempo_* rename happens correctly', async () => {
      StoreService.setPreference('alarmer_theme', 'dark');
      expect(mockInvoke).toHaveBeenCalledWith('db_pref_set', {
        key: 'tempo_theme',
        value: '"dark"',
      });

      expect(StoreService.getPreference('alarmer_theme', 'system')).toBe('dark');
      expect(StoreService.getPreference('tempo_theme', 'system')).toBe('dark');
    });

    it('exportJson strips apiKey', async () => {
      mockInvoke.mockResolvedValue(undefined);
      const json = await StoreService.exportJson();
      const parsed = JSON.parse(json) as { aiSettings?: { apiKey?: string } };
      expect(parsed.aiSettings?.apiKey).toBe('');
    });

    it('importJson accepts valid backup and rejects invalid JSON', async () => {
      await expect(StoreService.importJson('{ invalid')).rejects.toThrow(/не является корректным JSON/);
      await expect(StoreService.importJson('{"random": 123}')).rejects.toThrow(/не похож на резервную копию/);

      mockInvoke.mockImplementation((cmd, args) => {
        if (cmd === 'db_list') return Promise.resolve([]);
        if (cmd === 'db_insert') return Promise.resolve(writtenRow(args));
        return Promise.resolve(undefined);
      });

      const validBackup = JSON.stringify({
        alarms: [{ id: 'a3', label: 'Imported', time: '10:00', days: [], repeat: 'once', enabled: 1 }],
        tasks: [{ id: 't3', title: 'Imported task', status: 'open' }],
      });

      const imported = await StoreService.importJson(validBackup);
      expect(imported.alarms.some((a) => a.id === 'a3')).toBe(true);
      expect(imported.tasks.some((t) => t.id === 't3')).toBe(true);
    });
  });
});
