import { repo, type EntityMeta } from './db';
import { taskFromRow, taskToRow, type TaskRow } from './store';
import { reindex } from './search';
import type { TaskItem, ListItem } from '../types';

export type TaskSortMode = 'manual' | 'due' | 'priority';
export type SortMode = TaskSortMode;

export interface ListRow extends EntityMeta {
  name: string;
  color: string | null;
  position: number | null;
}

export interface CreateTaskInput {
  title: string;
  note?: string;
  listId?: string | null;
  parentId?: string | null;
  priority?: number;
  dueDate?: string | null;
  startAt?: string | null;
  plannedMinutes?: number | null;
  position?: number;
}

export interface UpdateTaskPatch {
  title?: string;
  note?: string;
  done?: boolean;
  listId?: string | null;
  parentId?: string | null;
  priority?: number;
  dueDate?: string | null;
  startAt?: string | null;
  plannedMinutes?: number | null;
  position?: number;
  completedAt?: string | null;
}

export interface MoveTaskOptions {
  listId?: string | null;
  dueDate?: string | null;
  startAt?: string | null;
}

export interface MoveListItemToTaskPatch {
  title?: string;
  note?: string;
  parentId?: string | null;
  priority?: number;
  dueDate?: string | null;
  startAt?: string | null;
  plannedMinutes?: number | null;
  position?: number;
}
const taskRepo = repo<TaskRow>('tasks');
const listRepo = repo<ListRow>('lists');

function listFromRow(row: ListRow): ListItem {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    position: typeof row.position === 'number' ? row.position : 0,
    createdAt: row.updated_at,
  };
}

/**
 * Returns all active tasks mapped to TaskItem.
 */
export async function listTasks(): Promise<TaskItem[]> {
  const rows = await taskRepo.all();
  return rows.map(taskFromRow);
}

/**
 * Creates a new task.
 * Position defaults to max(position) + 1 within the same parent and list scope.
 */
export async function createTask(input: CreateTaskInput): Promise<TaskItem> {
  const all = await listTasks();
  const targetParent = input.parentId ?? null;
  const targetList = input.listId ?? null;

  let assignedPosition = input.position;
  if (assignedPosition === undefined) {
    const siblings = all.filter(
      (t) => (t.parentId ?? null) === targetParent && (t.listId ?? null) === targetList,
    );
    const maxPos = siblings.reduce((max, t) => Math.max(max, t.position ?? 0), -1);
    assignedPosition = maxPos + 1;
  }

  const rowData: Omit<TaskRow, keyof EntityMeta> = {
    title: input.title,
    note: input.note ?? null,
    status: 'open',
    list_id: targetList,
    parent_id: targetParent,
    priority: input.priority ?? 0,
    due_date: input.dueDate ?? null,
    start_at: input.startAt ?? null,
    planned_minutes: input.plannedMinutes ?? null,
    completed_at: null,
    position: assignedPosition,
  };

  const inserted = await taskRepo.insert(rowData);
  await reindex('task');
  return taskFromRow(inserted);
}

/**
 * Updates a task by id with patch fields.
 * If `done` is set, `completedAt` and status are updated accordingly.
 */
export async function updateTask(id: string, patch: UpdateTaskPatch): Promise<TaskItem> {
  const current = await taskRepo.byId(id);
  if (!current) {
    throw new Error(`Task not found: ${id}`);
  }

  const currentItem = taskFromRow(current);
  const updatedItem: TaskItem = {
    ...currentItem,
    ...patch,
  };

  if (patch.done !== undefined) {
    if (patch.done) {
      updatedItem.done = true;
      updatedItem.completedAt = patch.completedAt ?? new Date().toISOString();
    } else {
      updatedItem.done = false;
      updatedItem.completedAt = null;
    }
  }

  const patchRow = taskToRow(updatedItem);
  // `update` takes the columns without the key: the id is the argument, and a
  // row carrying it back would be a second source of truth for which task this is.
  delete patchRow.id;

  const updated = await taskRepo.update(id, patchRow);
  await reindex('task');
  return taskFromRow(updated);
}

/**
 * Toggles done status of a task.
 */
export async function toggleTask(id: string): Promise<TaskItem> {
  const current = await taskRepo.byId(id);
  if (!current) {
    throw new Error(`Task not found: ${id}`);
  }
  const item = taskFromRow(current);
  return updateTask(id, { done: !item.done });
}

/**
 * Deletes a task by id.
 * Deleting a parent MUST delete its subtasks (soft delete each) — an orphaned subtask
 * is invisible in every view and would leak forever.
 */
export async function deleteTask(id: string): Promise<void> {
  const all = await listTasks();
  const subtasks = subtasksOf(all, id);

  for (const sub of subtasks) {
    await taskRepo.remove(sub.id);
  }
  await taskRepo.remove(id);
  await reindex('task');
}

/**
 * Moves a task to a list, due date, or start timestamp.
 */
export async function moveTask(id: string, options: MoveTaskOptions): Promise<TaskItem> {
  const patch: UpdateTaskPatch = {};
  if (options.listId !== undefined) {
    patch.listId = options.listId;
  }
  if (options.dueDate !== undefined) {
    patch.dueDate = options.dueDate;
  }
  if (options.startAt !== undefined) {
    patch.startAt = options.startAt;
  }
  return updateTask(id, patch);
}

/**
 * Returns immediate subtasks of the given parent task id.
 */
export function subtasksOf(tasks: TaskItem[], parentId: string): TaskItem[] {
  return tasks.filter((t) => t.parentId === parentId);
}

/**
 * Sorts tasks according to the chosen mode.
 * - `manual`: by `position` ascending.
 * - `due`: by `dueDate` ascending, undated tasks last.
 * - `priority`: highest priority first (3 -> 0), then by `dueDate` ascending (undated last).
 */
export function sortTasks(tasks: TaskItem[], mode: TaskSortMode): TaskItem[] {
  const copy = [...tasks];
  switch (mode) {
    case 'manual':
      return copy.sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
    case 'due':
      return copy.sort((a, b) => {
        if (!a.dueDate && !b.dueDate) return (a.position ?? 0) - (b.position ?? 0);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        if (a.dueDate !== b.dueDate) return a.dueDate.localeCompare(b.dueDate);
        return (a.position ?? 0) - (b.position ?? 0);
      });
    case 'priority':
      return copy.sort((a, b) => {
        const pA = a.priority ?? 0;
        const pB = b.priority ?? 0;
        if (pA !== pB) return pB - pA;
        if (!a.dueDate && !b.dueDate) return (a.position ?? 0) - (b.position ?? 0);
        if (!a.dueDate) return 1;
        if (!b.dueDate) return -1;
        return a.dueDate.localeCompare(b.dueDate);
      });
    default:
      return copy;
  }
}

/**
 * Returns all lists.
 */
export async function listLists(): Promise<ListItem[]> {
  const rows = await listRepo.all();
  return rows.map(listFromRow).sort((a, b) => a.position - b.position);
}

/**
 * Creates a new list with the given name.
 */
export async function createList(name: string, color?: string | null): Promise<ListItem> {
  const existing = await listLists();
  const maxPos = existing.reduce((max, l) => Math.max(max, l.position), -1);

  const rowData: Omit<ListRow, keyof EntityMeta> = {
    name,
    color: color ?? null,
    position: maxPos + 1,
  };

  const inserted = await listRepo.insert(rowData);
  await reindex('list');
  return listFromRow(inserted);
}

/**
 * Renames an existing list.
 */
export async function renameList(id: string, name: string): Promise<ListItem> {
  const updated = await listRepo.update(id, { name });
  await reindex('list');
  return listFromRow(updated);
}

/**
 * Deletes a list by id.
 * Deleting a list MUST NOT delete its items silently: it clears their `list_id` so
 * they survive as ordinary tasks.
 */
export async function deleteList(id: string): Promise<void> {
  const allTasks = await listTasks();
  const itemsInList = allTasks.filter((t) => t.listId === id);

  for (const item of itemsInList) {
    await taskRepo.update(item.id, { list_id: null });
  }

  await listRepo.remove(id);
  await reindex('list');
  await reindex('task');
}

/**
 * Moves an item out of a list into ordinary tasks (R08 "перенос пункта в задачу").
 * Clears listId and applies additional task fields provided by the caller.
 */
export async function moveListItemToTask(
  itemId: string,
  patch?: MoveListItemToTaskPatch,
): Promise<TaskItem> {
  return updateTask(itemId, {
    ...(patch ?? {}),
    listId: null,
  });
}
