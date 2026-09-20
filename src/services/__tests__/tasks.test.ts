import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listTasks,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
  moveTask,
  subtasksOf,
  sortTasks,
  listLists,
  createList,
  renameList,
  deleteList,
  moveListItemToTask,
} from '../tasks';
import type { TaskItem } from '../../types';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('Tasks & Lists domain service (tasks.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Tasks CRUD & toggle', () => {
    it('listTasks maps task rows to TaskItem domain objects', async () => {
      mockInvoke.mockResolvedValueOnce([
        {
          id: 't1',
          title: 'Write tests',
          note: 'Unit tests',
          status: 'open',
          list_id: 'l1',
          parent_id: null,
          priority: 2,
          due_date: '2026-09-21',
          start_at: '2026-09-21T09:00:00.000Z',
          planned_minutes: 45,
          position: 1,
          completed_at: null,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
      ]);

      const tasks = await listTasks();
      expect(mockInvoke).toHaveBeenCalledWith('db_list', { table: 'tasks', includeDeleted: false });
      expect(tasks).toHaveLength(1);
      expect(tasks[0]).toEqual({
        id: 't1',
        title: 'Write tests',
        note: 'Unit tests',
        done: false,
        listId: 'l1',
        parentId: null,
        priority: 2,
        dueDate: '2026-09-21',
        startAt: '2026-09-21T09:00:00.000Z',
        plannedMinutes: 45,
        position: 1,
        createdAt: '2026-09-20T10:00:00.000Z',
        completedAt: null,
      });
    });

    it('createTask calculates next position and triggers reindex("task")', async () => {
      // 1. listTasks called to compute position: existing sibling with position 2
      mockInvoke.mockResolvedValueOnce([
        {
          id: 't1',
          title: 'Existing',
          note: null,
          status: 'open',
          list_id: 'l1',
          parent_id: null,
          priority: 0,
          due_date: null,
          start_at: null,
          planned_minutes: null,
          position: 2,
          completed_at: null,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
      ]);
      // 2. db_insert returns inserted row
      mockInvoke.mockResolvedValueOnce({
        id: 't2',
        title: 'New task',
        note: null,
        status: 'open',
        list_id: 'l1',
        parent_id: null,
        priority: 1,
        due_date: '2026-09-22',
        start_at: null,
        planned_minutes: 30,
        position: 3, // 2 + 1
        completed_at: null,
        updated_at: '2026-09-20T11:00:00.000Z',
        deleted_at: null,
      });
      // 3. db_reindex('task')
      mockInvoke.mockResolvedValueOnce(1);

      const created = await createTask({
        title: 'New task',
        listId: 'l1',
        priority: 1,
        dueDate: '2026-09-22',
        plannedMinutes: 30,
      });

      expect(mockInvoke).toHaveBeenNthCalledWith(1, 'db_list', { table: 'tasks', includeDeleted: false });
      expect(mockInvoke).toHaveBeenNthCalledWith(2, 'db_insert', {
        table: 'tasks',
        row: expect.objectContaining({
          title: 'New task',
          list_id: 'l1',
          parent_id: null,
          priority: 1,
          due_date: '2026-09-22',
          start_at: null,
          planned_minutes: 30,
          position: 3,
        }),
      });
      expect(mockInvoke).toHaveBeenNthCalledWith(3, 'db_reindex', { kind: 'task' });
      expect(created.id).toBe('t2');
      expect(created.position).toBe(3);
    });

    it('toggleTask sets done to true, stamps completedAt, and sets status to done', async () => {
      // 1. db_get current task
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Finish report',
        note: null,
        status: 'open',
        list_id: null,
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      });
      // 2. update: db_get
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Finish report',
        note: null,
        status: 'open',
        list_id: null,
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      });
      // 3. db_update returning updated row
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Finish report',
        note: null,
        status: 'done',
        list_id: null,
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: '2026-09-20T12:00:00.000Z',
        updated_at: '2026-09-20T12:00:00.000Z',
        deleted_at: null,
      });
      // 4. db_reindex
      mockInvoke.mockResolvedValueOnce(1);

      const result = await toggleTask('t1');

      expect(mockInvoke).toHaveBeenCalledWith(
        'db_update',
        expect.objectContaining({
          table: 'tasks',
          id: 't1',
          patch: expect.objectContaining({
            status: 'done',
            completed_at: expect.any(String),
          }),
        }),
      );
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'task' });
      expect(result.done).toBe(true);
      expect(result.completedAt).toBeTruthy();
    });

    it('toggleTask on already completed task clears completedAt and sets status to open', async () => {
      const completedRow = {
        id: 't1',
        title: 'Finish report',
        note: null,
        status: 'done',
        list_id: null,
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: '2026-09-20T12:00:00.000Z',
        updated_at: '2026-09-20T12:00:00.000Z',
        deleted_at: null,
      };
      // 1. toggleTask: byId
      mockInvoke.mockResolvedValueOnce(completedRow);
      // 2. updateTask: byId
      mockInvoke.mockResolvedValueOnce(completedRow);
      // 3. db_update returns open row
      mockInvoke.mockResolvedValueOnce({
        ...completedRow,
        status: 'open',
        completed_at: null,
      });
      // 4. reindex
      mockInvoke.mockResolvedValueOnce(1);

      const result = await toggleTask('t1');

      expect(mockInvoke).toHaveBeenCalledWith(
        'db_update',
        expect.objectContaining({
          table: 'tasks',
          id: 't1',
          patch: expect.objectContaining({
            status: 'open',
            completed_at: null,
          }),
        }),
      );
      expect(result.done).toBe(false);
      expect(result.completedAt).toBeNull();
    });
    it('updateTask applies arbitrary fields to an existing task', async () => {
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Original Title',
        note: null,
        status: 'open',
        list_id: null,
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      });
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Updated Title',
        note: 'Some note',
        status: 'open',
        list_id: null,
        parent_id: null,
        priority: 3,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20T11:00:00.000Z',
        deleted_at: null,
      });
      mockInvoke.mockResolvedValueOnce(1);

      const updated = await updateTask('t1', { title: 'Updated Title', note: 'Some note', priority: 3 });
      expect(updated.title).toBe('Updated Title');
      expect(updated.note).toBe('Some note');
      expect(updated.priority).toBe(3);
    });

    it('deleteTask soft-deletes subtasks along with parent and calls reindex("task")', async () => {
      // 1. listTasks to find subtasks
      mockInvoke.mockResolvedValueOnce([
        {
          id: 'parent1',
          title: 'Parent Task',
          note: null,
          status: 'open',
          list_id: null,
          parent_id: null,
          priority: 0,
          due_date: null,
          start_at: null,
          planned_minutes: null,
          position: 0,
          completed_at: null,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
        {
          id: 'sub1',
          title: 'Subtask 1',
          note: null,
          status: 'open',
          list_id: null,
          parent_id: 'parent1',
          priority: 0,
          due_date: null,
          start_at: null,
          planned_minutes: null,
          position: 0,
          completed_at: null,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
        {
          id: 'sub2',
          title: 'Subtask 2',
          note: null,
          status: 'open',
          list_id: null,
          parent_id: 'parent1',
          priority: 0,
          due_date: null,
          start_at: null,
          planned_minutes: null,
          position: 1,
          completed_at: null,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
      ]);
      // 2. remove sub1
      mockInvoke.mockResolvedValueOnce(undefined);
      // 3. remove sub2
      mockInvoke.mockResolvedValueOnce(undefined);
      // 4. remove parent1
      mockInvoke.mockResolvedValueOnce(undefined);
      // 5. reindex
      mockInvoke.mockResolvedValueOnce(1);

      await deleteTask('parent1');

      expect(mockInvoke).toHaveBeenCalledWith('db_delete', { table: 'tasks', id: 'sub1' });
      expect(mockInvoke).toHaveBeenCalledWith('db_delete', { table: 'tasks', id: 'sub2' });
      expect(mockInvoke).toHaveBeenCalledWith('db_delete', { table: 'tasks', id: 'parent1' });
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'task' });
    });

    it('moveTask updates listId, dueDate, and startAt', async () => {
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Task to move',
        note: null,
        status: 'open',
        list_id: null,
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      });
      mockInvoke.mockResolvedValueOnce({
        id: 't1',
        title: 'Task to move',
        note: null,
        status: 'open',
        list_id: 'l2',
        parent_id: null,
        priority: 0,
        due_date: '2026-09-25',
        start_at: '2026-09-25T14:00:00.000Z',
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20T11:00:00.000Z',
        deleted_at: null,
      });
      mockInvoke.mockResolvedValueOnce(1);

      const moved = await moveTask('t1', {
        listId: 'l2',
        dueDate: '2026-09-25',
        startAt: '2026-09-25T14:00:00.000Z',
      });

      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'tasks',
        id: 't1',
        patch: expect.objectContaining({
          list_id: 'l2',
          due_date: '2026-09-25',
          start_at: '2026-09-25T14:00:00.000Z',
        }),
      });
      expect(moved.listId).toBe('l2');
      expect(moved.dueDate).toBe('2026-09-25');
    });
  });

  describe('subtasksOf', () => {
    it('filters tasks by parentId', () => {
      const items: TaskItem[] = [
        { id: '1', title: 'P1', done: false, priority: 0, position: 0, createdAt: '' },
        { id: '2', title: 'C1', done: false, priority: 0, position: 0, parentId: '1', createdAt: '' },
        { id: '3', title: 'C2', done: false, priority: 0, position: 1, parentId: '1', createdAt: '' },
        { id: '4', title: 'Other', done: false, priority: 0, position: 0, parentId: '99', createdAt: '' },
      ];

      const children = subtasksOf(items, '1');
      expect(children.map((c) => c.id)).toEqual(['2', '3']);
    });
  });

  describe('sortTasks', () => {
    const baseTasks: TaskItem[] = [
      { id: '1', title: 'T1', done: false, priority: 1, dueDate: '2026-09-25', position: 3, createdAt: '' },
      { id: '2', title: 'T2', done: false, priority: 3, dueDate: undefined, position: 1, createdAt: '' },
      { id: '3', title: 'T3', done: false, priority: 2, dueDate: '2026-09-22', position: 2, createdAt: '' },
      { id: '4', title: 'T4', done: false, priority: 3, dueDate: '2026-09-30', position: 0, createdAt: '' },
    ];

    it('sorts by manual (position ascending)', () => {
      const sorted = sortTasks(baseTasks, 'manual');
      expect(sorted.map((t) => t.id)).toEqual(['4', '2', '3', '1']);
    });

    it('sorts by due date ascending with undated last', () => {
      const sorted = sortTasks(baseTasks, 'due');
      expect(sorted.map((t) => t.id)).toEqual(['3', '1', '4', '2']);
    });

    it('sorts by priority descending (3 -> 0), tie-breaking by due date with undated last', () => {
      const sorted = sortTasks(baseTasks, 'priority');
      // Priority 3: T4 (due 2026-09-30) vs T2 (undated) -> T4 first, then T2
      // Priority 2: T3 (due 2026-09-22)
      // Priority 1: T1 (due 2026-09-25)
      expect(sorted.map((t) => t.id)).toEqual(['4', '2', '3', '1']);
    });
  });

  describe('Lists CRUD and item preservation', () => {
    it('listLists returns lists sorted by position', async () => {
      mockInvoke.mockResolvedValueOnce([
        { id: 'l2', name: 'Second', color: '#ff0000', position: 10, updated_at: '2026-09-20', deleted_at: null },
        { id: 'l1', name: 'First', color: null, position: 2, updated_at: '2026-09-20', deleted_at: null },
      ]);

      const lists = await listLists();
      expect(mockInvoke).toHaveBeenCalledWith('db_list', { table: 'lists', includeDeleted: false });
      expect(lists.map((l) => l.name)).toEqual(['First', 'Second']);
      expect(lists[0].id).toBe('l1');
    });

    it('createList sets next position and calls reindex("list")', async () => {
      mockInvoke.mockResolvedValueOnce([
        { id: 'l1', name: 'First', color: null, position: 5, updated_at: '2026-09-20', deleted_at: null },
      ]);
      mockInvoke.mockResolvedValueOnce({
        id: 'l2',
        name: 'Groceries',
        color: '#00ff00',
        position: 6,
        updated_at: '2026-09-20',
        deleted_at: null,
      });
      mockInvoke.mockResolvedValueOnce(1);

      const list = await createList('Groceries', '#00ff00');
      expect(mockInvoke).toHaveBeenCalledWith('db_insert', {
        table: 'lists',
        row: {
          name: 'Groceries',
          color: '#00ff00',
          position: 6,
        },
      });
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'list' });
      expect(list.id).toBe('l2');
      expect(list.position).toBe(6);
    });

    it('renameList updates name and triggers reindex("list")', async () => {
      mockInvoke.mockResolvedValueOnce({
        id: 'l1',
        name: 'Work Projects',
        color: null,
        position: 1,
        updated_at: '2026-09-20',
        deleted_at: null,
      });
      mockInvoke.mockResolvedValueOnce(1);

      const renamed = await renameList('l1', 'Work Projects');
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'lists',
        id: 'l1',
        patch: { name: 'Work Projects' },
      });
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'list' });
      expect(renamed.name).toBe('Work Projects');
    });

    it('deleteList clears list_id on its items instead of deleting them', async () => {
      // 1. listTasks to find all tasks in the list
      mockInvoke.mockResolvedValueOnce([
        {
          id: 'item1',
          title: 'Milk',
          note: null,
          status: 'open',
          list_id: 'groceries-list',
          parent_id: null,
          priority: 0,
          due_date: null,
          start_at: null,
          planned_minutes: null,
          position: 0,
          completed_at: null,
          updated_at: '2026-09-20',
          deleted_at: null,
        },
        {
          id: 'other',
          title: 'Unrelated task',
          note: null,
          status: 'open',
          list_id: 'other-list',
          parent_id: null,
          priority: 0,
          due_date: null,
          start_at: null,
          planned_minutes: null,
          position: 0,
          completed_at: null,
          updated_at: '2026-09-20',
          deleted_at: null,
        },
      ]);
      // 2. clear list_id on item1
      mockInvoke.mockResolvedValueOnce({ id: 'item1', list_id: null });
      // 3. remove list
      mockInvoke.mockResolvedValueOnce(undefined);
      // 4. reindex list
      mockInvoke.mockResolvedValueOnce(1);
      // 5. reindex task
      mockInvoke.mockResolvedValueOnce(1);

      await deleteList('groceries-list');

      // item1 had its list_id cleared
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'tasks',
        id: 'item1',
        patch: { list_id: null },
      });
      // The task was NOT deleted!
      expect(mockInvoke).not.toHaveBeenCalledWith('db_delete', { table: 'tasks', id: 'item1' });
      // The list was deleted
      expect(mockInvoke).toHaveBeenCalledWith('db_delete', { table: 'lists', id: 'groceries-list' });
      // Both kinds reindexed
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'list' });
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'task' });
    });

    it('moveListItemToTask clears listId and applies additional task fields', async () => {
      // 1. byId inside updateTask
      mockInvoke.mockResolvedValueOnce({
        id: 'item1',
        title: 'Apples',
        note: null,
        status: 'open',
        list_id: 'groceries-list',
        parent_id: null,
        priority: 0,
        due_date: null,
        start_at: null,
        planned_minutes: null,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20',
        deleted_at: null,
      });
      // 2. updateTask db_update
      mockInvoke.mockResolvedValueOnce({
        id: 'item1',
        title: 'Apples',
        note: null,
        status: 'open',
        list_id: null,
        parent_id: null,
        priority: 2,
        due_date: '2026-09-23',
        start_at: null,
        planned_minutes: 15,
        position: 0,
        completed_at: null,
        updated_at: '2026-09-20',
        deleted_at: null,
      });
      // 3. reindex task
      mockInvoke.mockResolvedValueOnce(1);

      const task = await moveListItemToTask('item1', {
        dueDate: '2026-09-23',
        priority: 2,
        plannedMinutes: 15,
      });

      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'tasks',
        id: 'item1',
        patch: expect.objectContaining({
          list_id: null,
          due_date: '2026-09-23',
          priority: 2,
          planned_minutes: 15,
        }),
      });
      expect(task.listId).toBeNull();
      expect(task.dueDate).toBe('2026-09-23');
      expect(task.priority).toBe(2);
    });
  });

  describe('rescheduling clears a stale start time', () => {
    const row = (dueDate: string, startAt: string | null) => ({
      id: 't1',
      title: 'Move me',
      note: null,
      status: 'open',
      list_id: null,
      parent_id: null,
      priority: 0,
      due_date: dueDate,
      start_at: startAt,
      planned_minutes: 30,
      position: 0,
      completed_at: null,
      updated_at: '2026-09-20T09:00:00.000Z',
      deleted_at: null,
    });

    const patchSent = () => mockInvoke.mock.calls.find(([cmd]) => cmd === 'db_update')?.[1]?.patch;

    it('drops startAt when the due date moves to another day', async () => {
      mockInvoke.mockResolvedValueOnce(row('2026-09-20', '2026-09-20T10:00:00'));
      mockInvoke.mockResolvedValueOnce(row('2026-09-21', null));

      await updateTask('t1', { dueDate: '2026-09-21' });

      // Without this the task shows on both days: buildDay includes it by its due
      // date AND by the day its start time falls on.
      expect(patchSent()?.start_at).toBeNull();
    });

    it('keeps startAt when the due date stays on the same day', async () => {
      mockInvoke.mockResolvedValueOnce(row('2026-09-20', '2026-09-20T10:00:00'));
      mockInvoke.mockResolvedValueOnce(row('2026-09-20', '2026-09-20T10:00:00'));

      await updateTask('t1', { dueDate: '2026-09-20' });

      expect(patchSent()?.start_at).toBe('2026-09-20T10:00:00');
    });

    it('respects an explicit startAt in the same patch', async () => {
      mockInvoke.mockResolvedValueOnce(row('2026-09-20', '2026-09-20T10:00:00'));
      mockInvoke.mockResolvedValueOnce(row('2026-09-21', '2026-09-21T14:00:00'));

      await updateTask('t1', { dueDate: '2026-09-21', startAt: '2026-09-21T14:00:00' });

      expect(patchSent()?.start_at).toBe('2026-09-21T14:00:00');
    });
  });
});