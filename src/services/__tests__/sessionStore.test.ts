import { describe, it, expect, vi, beforeEach } from 'vitest';
import { listSessions } from '../sessionStore';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('sessionStore', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reads the sessions table through repo and maps rows to StoredSession', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: { table: string }) => {
      if (cmd === 'db_list' && args.table === 'sessions') {
        return [
          {
            id: 'sess-2',
            task_id: 'task-1',
            mode: 'focus',
            duration_sec: 1500,
            completed: 1,
            started_at: '2026-09-20T10:00:00Z',
            ended_at: '2026-09-20T10:25:00Z',
            updated_at: '2026-09-20T10:25:00Z',
          },
          {
            id: 'sess-1',
            task_id: null,
            mode: 'short_break',
            duration_sec: 300,
            completed: 0,
            started_at: '2026-09-20T09:00:00Z',
            ended_at: '2026-09-20T09:05:00Z',
            updated_at: '2026-09-20T09:05:00Z',
          },
        ];
      }
      return [];
    });

    const sessions = await listSessions();

    expect(sessions).toHaveLength(2);
    // Ordered by started_at ascending
    expect(sessions[0].id).toBe('sess-1');
    expect(sessions[0].completed).toBe(false);
    expect(sessions[0].mode).toBe('short_break');
    expect(sessions[0].duration_sec).toBe(300);

    expect(sessions[1].id).toBe('sess-2');
    expect(sessions[1].completed).toBe(true);
    expect(sessions[1].task_id).toBe('task-1');
  });

  it('maps completed: 1 to true and completed: 0 to false', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: { table: string }) => {
      if (cmd === 'db_list' && args.table === 'sessions') {
        return [
          {
            id: 'sess-1',
            mode: 'focus',
            duration_sec: 1200,
            completed: 1,
            started_at: '2026-09-20T12:00:00Z',
            updated_at: '2026-09-20T12:20:00Z',
          },
          {
            id: 'sess-2',
            mode: 'focus',
            duration_sec: 600,
            completed: 0,
            started_at: '2026-09-20T13:00:00Z',
            updated_at: '2026-09-20T13:10:00Z',
          },
        ];
      }
      return [];
    });

    const sessions = await listSessions();
    expect(sessions[0].completed).toBe(true);
    expect(sessions[1].completed).toBe(false);
  });

  it('skips a row with an unparsable or malformed started_at date', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: { table: string }) => {
      if (cmd === 'db_list' && args.table === 'sessions') {
        return [
          {
            id: 'sess-bad-1',
            mode: 'focus',
            duration_sec: 1000,
            completed: 1,
            started_at: 'not-a-valid-date',
            updated_at: '2026-09-20T10:00:00Z',
          },
          {
            id: 'sess-bad-2',
            mode: 'focus',
            duration_sec: 1000,
            completed: 1,
            started_at: '',
            updated_at: '2026-09-20T10:00:00Z',
          },
          {
            id: 'sess-good',
            mode: 'focus',
            duration_sec: 1500,
            completed: 1,
            started_at: '2026-09-20T14:00:00Z',
            updated_at: '2026-09-20T14:25:00Z',
          },
        ];
      }
      return [];
    });

    const sessions = await listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe('sess-good');
  });

  it('orders sessions by started_at ascending', async () => {
    mockInvoke.mockImplementation(async (cmd: string, args: { table: string }) => {
      if (cmd === 'db_list' && args.table === 'sessions') {
        return [
          {
            id: 'sess-3',
            mode: 'focus',
            duration_sec: 100,
            completed: 1,
            started_at: '2026-09-20T18:00:00Z',
            updated_at: '2026-09-20T18:00:00Z',
          },
          {
            id: 'sess-1',
            mode: 'focus',
            duration_sec: 100,
            completed: 1,
            started_at: '2026-09-20T08:00:00Z',
            updated_at: '2026-09-20T08:00:00Z',
          },
          {
            id: 'sess-2',
            mode: 'focus',
            duration_sec: 100,
            completed: 1,
            started_at: '2026-09-20T12:00:00Z',
            updated_at: '2026-09-20T12:00:00Z',
          },
        ];
      }
      return [];
    });

    const sessions = await listSessions();
    expect(sessions.map((s) => s.id)).toEqual(['sess-1', 'sess-2', 'sess-3']);
  });
});
