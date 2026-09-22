import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { ListsView } from '../ListsView';
import * as tasksService from '../../services/tasks';
import { emitDataChanged } from '../../services/appEvents';
import type { ListItem, TaskItem } from '../../types';

vi.mock('../../services/tasks', () => ({
  listLists: vi.fn(),
  createList: vi.fn(),
  renameList: vi.fn(),
  deleteList: vi.fn(),
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  toggleTask: vi.fn(),
  deleteTask: vi.fn(),
  moveListItemToTask: vi.fn(),
}));

describe('ListsView Live Data Sync', () => {
  const initialList: ListItem = {
    id: 'list-1',
    name: 'Personal',
    position: 0,
    createdAt: '2026-09-20T10:00:00Z',
  };

  const assistantList: ListItem = {
    id: 'list-assistant',
    name: 'Assistant Shopping List',
    position: 1,
    createdAt: '2026-09-22T12:00:00Z',
  };

  const initialItem: TaskItem = {
    id: 'item-1',
    listId: 'list-1',
    title: 'Existing Item',
    done: false,
    priority: 0,
    position: 0,
    createdAt: '2026-09-20T10:05:00Z',
  };

  const assistantItem: TaskItem = {
    id: 'item-assistant',
    listId: 'list-1',
    title: 'Assistant Added Item',
    done: false,
    priority: 0,
    position: 1,
    createdAt: '2026-09-22T12:05:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('re-reads and renders assistant-created list on emitDataChanged("lists") without remounting', async () => {
    let currentLists = [initialList];
    const currentTasks = [initialItem];

    vi.mocked(tasksService.listLists).mockImplementation(async () => currentLists);
    vi.mocked(tasksService.listTasks).mockImplementation(async () => currentTasks);

    render(<ListsView />);

    await waitFor(() => {
      expect(screen.getAllByText('Personal').length).toBeGreaterThanOrEqual(1);
    });
    expect(screen.queryByText('Assistant Shopping List')).toBeNull();

    // Assistant creates a list in SQLite and fires data-changed
    currentLists = [initialList, assistantList];
    emitDataChanged('lists', [assistantList.id]);

    await waitFor(() => {
      expect(screen.getByText('Assistant Shopping List')).toBeDefined();
    });
    expect(screen.getAllByText('Personal').length).toBeGreaterThanOrEqual(1);
    expect(tasksService.listLists).toHaveBeenCalledTimes(2);
  });

  it('re-reads and renders assistant-created task item on emitDataChanged("tasks")', async () => {
    const currentLists = [initialList];
    let currentTasks = [initialItem];

    vi.mocked(tasksService.listLists).mockImplementation(async () => currentLists);
    vi.mocked(tasksService.listTasks).mockImplementation(async () => currentTasks);

    render(<ListsView />);

    await waitFor(() => {
      expect(screen.getByText('Existing Item')).toBeDefined();
    });
    expect(screen.queryByText('Assistant Added Item')).toBeNull();

    // Assistant adds an item to the list
    currentTasks = [initialItem, assistantItem];
    emitDataChanged('tasks', [assistantItem.id]);

    await waitFor(() => {
      expect(screen.getByText('Assistant Added Item')).toBeDefined();
    });
    expect(screen.getByText('Existing Item')).toBeDefined();
  });

  it('ignores data changes for unrelated tables', async () => {
    const currentLists = [initialList];
    const currentTasks = [initialItem];

    vi.mocked(tasksService.listLists).mockImplementation(async () => currentLists);
    vi.mocked(tasksService.listTasks).mockImplementation(async () => currentTasks);

    render(<ListsView />);

    await waitFor(() => {
      expect(screen.getAllByText('Personal').length).toBeGreaterThanOrEqual(1);
    });

    emitDataChanged('notes', ['note-1']);
    emitDataChanged('alarms', ['alarm-1']);

    expect(tasksService.listLists).toHaveBeenCalledTimes(1);
    expect(tasksService.listTasks).toHaveBeenCalledTimes(1);
  });
});
