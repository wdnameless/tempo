import { repo, type EntityMeta, type Table } from './db';
import { reindex } from './search';

export interface CalendarEvent extends EntityMeta {
  source: 'google' | 'local';
  googleId?: string | null;
  calendarId?: string | null;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location?: string | null;
  taskId?: string | null;
}

export interface EventRow {
  id: string;
  source: string;
  google_id?: string | null;
  calendar_id?: string | null;
  title: string;
  start_at: string;
  end_at: string;
  all_day: number;
  location?: string | null;
  task_id?: string | null;
  updated_at: string;
  deleted_at: string | null;
}

export interface CreateLocalEventInput {
  title: string;
  startAt: string;
  endAt: string;
  allDay?: boolean;
  location?: string | null;
  taskId?: string | null;
  calendarId?: string | null;
}

export function eventFromRow(row: EventRow): CalendarEvent {
  return {
    id: row.id,
    source: row.source === 'google' ? 'google' : 'local',
    googleId: row.google_id ?? null,
    calendarId: row.calendar_id ?? null,
    title: row.title ?? '',
    startAt: row.start_at ?? '',
    endAt: row.end_at ?? '',
    allDay: Boolean(row.all_day),
    location: row.location ?? null,
    taskId: row.task_id ?? null,
    updated_at: row.updated_at,
    deleted_at: row.deleted_at ?? null,
  };
}

export function eventToRow(event: Omit<CalendarEvent, keyof EntityMeta>): Omit<EventRow, keyof EntityMeta> {
  return {
    source: event.source,
    google_id: event.googleId ?? null,
    calendar_id: event.calendarId ?? null,
    title: event.title,
    start_at: event.startAt,
    end_at: event.endAt,
    all_day: event.allDay ? 1 : 0,
    location: event.location ?? null,
    task_id: event.taskId ?? null,
  };
}

/**
 * Lists all active calendar events from the local SQLite storage.
 */
export async function listEvents(): Promise<CalendarEvent[]> {
  const eventsRepo = repo<EventRow>('events' as Table);
  const rows = await eventsRepo.all();
  return rows.map(eventFromRow);
}

/**
 * Creates a new local calendar event.
 */
export async function createLocalEvent(input: CreateLocalEventInput): Promise<CalendarEvent> {
  const rowData: Omit<EventRow, keyof EntityMeta> = {
    source: 'local',
    google_id: null,
    calendar_id: input.calendarId ?? null,
    title: input.title,
    start_at: input.startAt,
    end_at: input.endAt,
    all_day: input.allDay ? 1 : 0,
    location: input.location ?? null,
    task_id: input.taskId ?? null,
  };

  const eventsRepo = repo<EventRow>('events' as Table);
  const inserted = await eventsRepo.insert(rowData);
  await reindex('event');
  return eventFromRow(inserted);
}

/**
 * Updates an existing local calendar event.
 * Refuses to update events sourced from Google.
 */
export async function updateLocalEvent(
  id: string,
  patch: Partial<CreateLocalEventInput>,
): Promise<CalendarEvent> {
  const eventsRepo = repo<EventRow>('events' as Table);
  const existing = await eventsRepo.byId(id);
  if (!existing) {
    throw new Error(`Event not found: ${id}`);
  }

  if (existing.source === 'google') {
    throw new Error(`Cannot update Google event '${id}': Google events are managed in Google Calendar and synced`);
  }

  const patchRow: Partial<Omit<EventRow, keyof EntityMeta>> = {};
  if (patch.title !== undefined) patchRow.title = patch.title;
  if (patch.startAt !== undefined) patchRow.start_at = patch.startAt;
  if (patch.endAt !== undefined) patchRow.end_at = patch.endAt;
  if (patch.allDay !== undefined) patchRow.all_day = patch.allDay ? 1 : 0;
  if (patch.location !== undefined) patchRow.location = patch.location;
  if (patch.taskId !== undefined) patchRow.task_id = patch.taskId;
  if (patch.calendarId !== undefined) patchRow.calendar_id = patch.calendarId;

  const updated = await eventsRepo.update(id, patchRow);
  await reindex('event');
  return eventFromRow(updated);
}

/**
 * Soft-deletes a calendar event.
 * Refuses to delete events sourced from Google.
 */
export async function deleteEvent(id: string): Promise<void> {
  const eventsRepo = repo<EventRow>('events' as Table);
  const existing = await eventsRepo.byId(id);
  if (!existing) {
    return;
  }

  if (existing.source === 'google') {
    throw new Error(`Cannot delete Google event '${id}': Google events are managed in Google Calendar and synced`);
  }

  await eventsRepo.remove(id);
  await reindex('event');
}
