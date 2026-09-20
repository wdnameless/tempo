import type { StoredSession } from './sessionStore';

/**
 * Session utilities for statistics and display.
 * Note: Session recording is owned by the Rust backend timer (which inserts into
 * the SQLite `sessions` table). SessionBuilder and trimSessions have been removed
 * as dead code following the backend migration.
 */

/** Most recent sessions, newest first, capped for display. */
export function recentSessions(sessions: StoredSession[], limit = 20): StoredSession[] {
  return [...sessions]
    .sort((a, b) => {
      const timeA = a.ended_at ?? a.started_at;
      const timeB = b.ended_at ?? b.started_at;
      return timeB.localeCompare(timeA);
    })
    .slice(0, limit);
}
