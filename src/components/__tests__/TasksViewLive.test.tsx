import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { TasksView } from '../TasksView';
import * as tasksService from '../../services/tasks';
import { emitDataChanged } from '../../services/appEvents';
import type { TaskItem } from '../../types';

vi.mock('../../services/tasks', () => ({
  listTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  toggleTask: vi.fn(),
  deleteTask: vi.fn(),
  moveTask: vi.fn(),
  subtasksOf: vi.fn(),
  sortTasks: vi.fn(),
}));

vi.mock('../../services/store', () => ({
  StoreService: {
    getPreference: vi.fn().mockReturnValue('manual'),
    setPreference: vi.fn().mockResolvedValue(undefined),
  },
}));

describe('TasksView Live Data Sync', () => {
  const initialTask: TaskItem = {
    id: 'task-1',
    title: 'Initial Task',
    done: false,
    priority: 0,
    position: 0,
    createdAt: '2026-09-20T10:00:00Z',
  };

  const assistantTask: TaskItem = {
    id: 'task-assistant',
    title: 'Assistant Created Task',
    done: false,
    priority: 1,
    position: 1,
    createdAt: '2026-09-22T12:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tasksService.subtasksOf).mockImplementation((tasks, parentId) =>
      tasks.filter((t) => t.parentId === parentId)
    );
    vi.mocked(tasksService.sortTasks).mockImplementation((tasks) => [...tasks]);
  });

  it('re-reads and renders assistant-created task on emitDataChanged("tasks") without remounting', async () => {
    let currentTasks = [initialTask];
    vi.mocked(tasksService.listTasks).mockImplementation(async () => currentTasks);

    render(<TasksView />);

    await waitFor(() => {
      expect(screen.getByText('Initial Task')).toBeDefined();
    });
    expect(screen.queryByText('Assistant Created Task')).toBeNull();

    // Assistant writes a task and emits the data-changed signal
    currentTasks = [initialTask, assistantTask];
    emitDataChanged('tasks', [assistantTask.id]);

    await waitFor(() => {
      expect(screen.getByText('Assistant Created Task')).toBeDefined();
    });
    expect(screen.getByText('Initial Task')).toBeDefined();
    expect(tasksService.listTasks).toHaveBeenCalledTimes(2);
  });

  it('ignores data changes for unrelated tables', async () => {
    const currentTasks = [initialTask];
    vi.mocked(tasksService.listTasks).mockImplementation(async () => currentTasks);

    render(<TasksView />);

    await waitFor(() => {
      expect(screen.getByText('Initial Task')).toBeDefined();
    });

    emitDataChanged('notes', ['note-1']);
    emitDataChanged('alarms', ['alarm-1']);

    expect(tasksService.listTasks).toHaveBeenCalledTimes(1);
  });
});
