import { repo, type Table } from './db';

/**
 * SQLite row representation from the backend `sessions` table.
 */
export interface SessionRow {
  id: string;
  kind: string;
  started_at: string;
  ended_at: string | null;
  duration_sec: number;
  completed: number; // 0 or 1 in SQLite
  task_id: string | null;
  updated_at: string;
  deleted_at: string | null;
}

/**
 * Frontend representation of a session stored in SQLite.
 * Matches interfaces §20.
 */
export interface StoredSession {
  id: string;
  kind: string; // pomodoro | stopwatch
  started_at: string; // ISO
  ended_at: string | null;
  duration_sec: number; // Real column, fractional seconds
  completed: boolean; // converted from 0/1 integer
  task_id: string | null;
  mode?: string; // backwards-compatible optional field
}

/**
 * Maps a SQLite session row to StoredSession.
 * - Completed is mapped from integer (0/1) to boolean at the boundary.
 * - Rows with malformed started_at dates return null so callers can skip them
 *   rather than crashing the screen.
 */
function rowToSession(row: SessionRow): StoredSession | null {
  if (!row.started_at) {
    return null;
  }
  const timestamp = Date.parse(row.started_at);
  // A session with a malformed started_at is skipped rather than crashing the screen.
  if (Number.isNaN(timestamp)) {
    return null;
  }

  const raw = row as unknown as Record<string, unknown>;
  const kind = typeof raw.kind === 'string' ? raw.kind : (typeof raw.mode === 'string' ? raw.mode : 'pomodoro');
  const mode = typeof raw.mode === 'string' ? raw.mode : (kind === 'pomodoro' ? 'focus' : kind);

  return {
    id: row.id,
    kind,
    started_at: row.started_at,
    ended_at: row.ended_at ?? null,
    duration_sec: Number(row.duration_sec) || 0,
    completed: Boolean(row.completed),
    task_id: row.task_id ?? null,
    mode,
  };
}

/**
 * Reads all active sessions from the SQLite `sessions` table,
 * sorted ascending by `started_at`.
 */
export async function listSessions(): Promise<StoredSession[]> {
  const sessionsRepo = repo<SessionRow>('sessions' as Table);
  const rows = await sessionsRepo.all();

  const sessions: StoredSession[] = [];
  for (const row of rows) {
    const session = rowToSession(row);
    if (session) {
      sessions.push(session);
    }
  }

  // Order by started_at ascending
  sessions.sort((a, b) => a.started_at.localeCompare(b.started_at));
  return sessions;
}

/**
 * Reads active sessions starting on or after the given ISO timestamp,
 * sorted ascending by `started_at`.
 */
export async function sessionsSince(iso: string): Promise<StoredSession[]> {
  const all = await listSessions();
  return all.filter((s) => s.started_at >= iso);
}
