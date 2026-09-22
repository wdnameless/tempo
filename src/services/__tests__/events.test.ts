import { describe, expect, it, vi, beforeEach } from 'vitest';
import {

  listEvents,
  createLocalEvent,
  updateLocalEvent,
  deleteEvent,
  eventFromRow,
  eventToRow,
  type EventRow,
} from '../events';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('events service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('row mapping (pure)', () => {
    it('round-trips a local event between domain entity and database row', () => {
      const row: EventRow = {
        id: 'evt-1',
        source: 'local',
        google_id: null,
        calendar_id: 'cal-primary',
        title: 'Team sync',
        start_at: '2026-09-20T10:00:00.000Z',
        end_at: '2026-09-20T11:00:00.000Z',
        all_day: 0,
        location: 'Room 101',
        task_id: 'task-99',
        updated_at: '2026-09-20T08:00:00.000Z',
        deleted_at: null,
      };

      const entity = eventFromRow(row);
      expect(entity).toEqual({
        id: 'evt-1',
        source: 'local',
        googleId: null,
        calendarId: 'cal-primary',
        title: 'Team sync',
        startAt: '2026-09-20T10:00:00.000Z',
        endAt: '2026-09-20T11:00:00.000Z',
        allDay: false,
        location: 'Room 101',
        taskId: 'task-99',
        updated_at: '2026-09-20T08:00:00.000Z',
        deleted_at: null,
      });

      // The row writer takes the entity WITHOUT its metadata: the layer stamps the
      // id and updated_at, and a row carrying them back would be a second source.
      const withoutMeta: Omit<typeof entity, 'id' | 'updated_at' | 'deleted_at'> = {
        source: entity.source,
        googleId: entity.googleId,
        calendarId: entity.calendarId,
        title: entity.title,
        startAt: entity.startAt,
        endAt: entity.endAt,
        allDay: entity.allDay,
        location: entity.location,
        taskId: entity.taskId,
      };
      const backToRow = eventToRow(withoutMeta);
      expect(backToRow).toEqual({
        source: 'local',
        google_id: null,
        calendar_id: 'cal-primary',
        title: 'Team sync',
        start_at: '2026-09-20T10:00:00.000Z',
        end_at: '2026-09-20T11:00:00.000Z',
        all_day: 0,
        location: 'Room 101',
        task_id: 'task-99',
      });
    });

    it('correctly maps allDay boolean to integer 1 and 0', () => {
      const allDayRow: EventRow = {
        id: 'evt-2',
        source: 'local',
        google_id: null,
        calendar_id: null,
        title: 'Holiday',
        start_at: '2026-09-20',
        end_at: '2026-09-20',
        all_day: 1,
        location: null,
        task_id: null,
        updated_at: '2026-09-20T00:00:00.000Z',
        deleted_at: null,
      };

      const entity = eventFromRow(allDayRow);
      expect(entity.allDay).toBe(true);

      const rowOut = eventToRow(entity);
      expect(rowOut.all_day).toBe(1);
    });
  });

  describe('CRUD operations and Google sync invariants', () => {
    it('lists all active events via repo', async () => {
      const fakeRows: EventRow[] = [
        {
          id: 'evt-1',
          source: 'local',
          google_id: null,
          calendar_id: null,
          title: 'Design Review',
          start_at: '2026-09-20T14:00:00.000Z',
          end_at: '2026-09-20T15:00:00.000Z',
          all_day: 0,
          location: null,
          task_id: null,
          updated_at: '2026-09-20T12:00:00.000Z',
          deleted_at: null,
        },
      ];

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'db_list') return Promise.resolve(fakeRows);
        return Promise.resolve();
      });

      const events = await listEvents();
      expect(events).toHaveLength(1);
      expect(events[0].title).toBe('Design Review');
      expect(events[0].source).toBe('local');
    });

    it('creates a local event, persists to repo, and triggers search reindex', async () => {
      mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_insert') {
          const row = args.row as Record<string, unknown>;
          return Promise.resolve({
            id: 'evt-new-1',
            updated_at: '2026-09-20T10:00:00.000Z',
            deleted_at: null,
            ...row,
          });
        }
        if (cmd === 'db_reindex') {
          return Promise.resolve(1);
        }
        return Promise.resolve();
      });

      const created = await createLocalEvent({
        title: 'Coffee chat',
        startAt: '2026-09-20T10:00:00.000Z',
        endAt: '2026-09-20T10:30:00.000Z',
      });

      expect(created.id).toBe('evt-new-1');
      expect(created.title).toBe('Coffee chat');
      expect(created.source).toBe('local');
      expect(created.allDay).toBe(false);

      // Verify reindex was called with 'event'
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'event' });
    });

    it('updates an existing local event and triggers search reindex', async () => {
      const existingRow: EventRow = {
        id: 'evt-local-1',
        source: 'local',
        google_id: null,
        calendar_id: null,
        title: 'Initial Title',
        start_at: '2026-09-20T10:00:00.000Z',
        end_at: '2026-09-20T11:00:00.000Z',
        all_day: 0,
        location: null,
        task_id: null,
        updated_at: '2026-09-20T08:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation((cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get') return Promise.resolve(existingRow);
        if (cmd === 'db_update') {
          const patch = args.patch as Record<string, unknown>;
          return Promise.resolve({
            ...existingRow,
            ...patch,
            updated_at: '2026-09-20T09:00:00.000Z',
          });
        }
        if (cmd === 'db_reindex') return Promise.resolve(1);
        return Promise.resolve();
      });

      const updated = await updateLocalEvent('evt-local-1', {
        title: 'Updated Title',
        location: 'Meeting Room 2',
      });

      expect(updated.title).toBe('Updated Title');
      expect(updated.location).toBe('Meeting Room 2');
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'event' });
    });

    it('refuses to update a Google event and throws an error', async () => {
      const googleRow: EventRow = {
        id: 'evt-google-1',
        source: 'google',
        google_id: 'g-12345',
        calendar_id: 'primary',
        title: 'Google Calendar Event',
        start_at: '2026-09-20T15:00:00.000Z',
        end_at: '2026-09-20T16:00:00.000Z',
        all_day: 0,
        location: null,
        task_id: null,
        updated_at: '2026-09-20T14:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'db_get') return Promise.resolve(googleRow);
        return Promise.resolve();
      });

      await expect(
        updateLocalEvent('evt-google-1', { title: 'Hacked Title' }),
      ).rejects.toThrow(/Cannot update Google event/);

      expect(mockInvoke).not.toHaveBeenCalledWith('db_update', expect.anything());
    });

    it('refuses to delete a Google event and throws an error', async () => {
      const googleRow: EventRow = {
        id: 'evt-google-2',
        source: 'google',
        google_id: 'g-67890',
        calendar_id: 'primary',
        title: 'Google All Hands',
        start_at: '2026-09-20T17:00:00.000Z',
        end_at: '2026-09-20T18:00:00.000Z',
        all_day: 0,
        location: null,
        task_id: null,
        updated_at: '2026-09-20T16:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'db_get') return Promise.resolve(googleRow);
        return Promise.resolve();
      });

      await expect(deleteEvent('evt-google-2')).rejects.toThrow(/Cannot delete Google event/);
      expect(mockInvoke).not.toHaveBeenCalledWith('db_delete', expect.anything());
    });

    it('soft deletes a local event and calls reindex', async () => {
      const localRow: EventRow = {
        id: 'evt-local-del',
        source: 'local',
        google_id: null,
        calendar_id: null,
        title: 'Local Meeting',
        start_at: '2026-09-20T11:00:00.000Z',
        end_at: '2026-09-20T12:00:00.000Z',
        all_day: 0,
        location: null,
        task_id: null,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation((cmd: string) => {
        if (cmd === 'db_get') return Promise.resolve(localRow);
        if (cmd === 'db_delete') return Promise.resolve();
        if (cmd === 'db_reindex') return Promise.resolve(1);
        return Promise.resolve();
      });

      await deleteEvent('evt-local-del');

      expect(mockInvoke).toHaveBeenCalledWith('db_delete', { table: 'events', id: 'evt-local-del' });
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'event' });
    });
  });
});
