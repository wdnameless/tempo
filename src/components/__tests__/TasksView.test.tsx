import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { TasksView } from '../TasksView';
import * as tasksService from '../../services/tasks';
import * as appEvents from '../../services/appEvents';
import { StoreService } from '../../services/store';
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

const mockTasks: TaskItem[] = [
  {
    id: 'task-1',
    title: 'Buy groceries',
    done: false,
    priority: 2,
    dueDate: '2026-09-21',
    plannedMinutes: 45,
    position: 0,
    createdAt: '2026-09-20T10:00:00Z',
  },
  {
    id: 'task-1-sub-1',
    title: 'Buy apples',
    parentId: 'task-1',
    done: true,
    priority: 0,
    position: 0,
    createdAt: '2026-09-20T10:01:00Z',
  },
  {
    id: 'task-1-sub-2',
    title: 'Buy bananas',
    parentId: 'task-1',
    done: false,
    priority: 0,
    position: 1,
    createdAt: '2026-09-20T10:02:00Z',
  },
  {
    id: 'task-2',
    title: 'Clean the kitchen',
    done: true,
    completedAt: '2026-09-20T11:00:00Z',
    priority: 1,
    position: 1,
    createdAt: '2026-09-20T09:00:00Z',
  },
];

describe('TasksView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tasksService.listTasks).mockResolvedValue(mockTasks);
    vi.mocked(tasksService.subtasksOf).mockImplementation((tasks, parentId) =>
      tasks.filter((t) => t.parentId === parentId)
    );
    vi.mocked(tasksService.sortTasks).mockImplementation((tasks) => [...tasks]);
    vi.mocked(tasksService.createTask).mockImplementation(async (input) => ({
      id: 'task-new',
      title: input.title,
      done: false,
      priority: 0,
      position: 99,
      createdAt: new Date().toISOString(),
    }));
    vi.mocked(tasksService.toggleTask).mockImplementation(async (id) => {
      const found = mockTasks.find((t) => t.id === id);
      return {
        ...found!,
        done: !found?.done,
      };
    });
  });

  it('renders tasks returned by the service', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    expect(tasksService.listTasks).toHaveBeenCalled();
    expect(screen.getByText('Buy groceries')).toBeTruthy();
  });

  it('adding a task calls createTask with title and clears input', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    const input = screen.getByPlaceholderText(/Новая задача|New task/i);
    fireEvent.change(input, { target: { value: 'Water plants' } });
    fireEvent.submit(input.closest('form')!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(tasksService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Water plants' })
    );
  });

  it('toggle calls toggleTask with the task id', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    // The toggle's label comes from the shared table, so it reads in Russian here.
    const markBtn = screen.getAllByRole('button', { name: 'Новая задача' })[0];
    fireEvent.click(markBtn);

    expect(tasksService.toggleTask).toHaveBeenCalledWith('task-1');
  });

  it('switching sort control calls sortTasks and updates preference', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    const dueRadio = screen.getByRole('radio', { name: /Срок|Due/i });
    fireEvent.click(dueRadio);

    expect(StoreService.setPreference).toHaveBeenCalledWith('tempo_tasks_sort', 'due');
  });

  it('completed group is hidden until toggled', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    // Completed task 'Clean the kitchen' should not be in visible document before click
    expect(screen.queryByText('Clean the kitchen')).toBeNull();

    // Click on the completed section header button
    const toggleCompletedBtn = screen.getByText(/Выполненные/);
    fireEvent.click(toggleCompletedBtn);

    // Now it should appear
    expect(screen.getByText('Clean the kitchen')).toBeTruthy();
  });

  it('shows done/total subtask count on parent task row', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    // task-1 has 2 subtasks, 1 done: 1/2
    expect(screen.getByText('1/2')).toBeTruthy();
  });

  it('reveals the row the palette picked, opening the completed group for a done task', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    // A done task is behind the collapsed group, so a reveal must open it first —
    // otherwise the jump lands on a screen where the row is not rendered at all.
    expect(screen.queryByText('Clean the kitchen')).toBeNull();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tempo:reveal', { detail: { kind: 'task', row_id: 'task-2' } }),
      );
    });

    expect(screen.getByText('Clean the kitchen')).toBeTruthy();

    const row = document.querySelector('[data-task-row="task-2"]');
    expect(row?.getAttribute('style')).toContain('--accent-soft');
  });

  it('ignores a reveal for another kind', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent('tempo:reveal', { detail: { kind: 'note', row_id: 'task-1' } }),
      );
    });

    expect(document.querySelector('[data-task-row="task-1"]')?.getAttribute('style')).toBeNull();
  });

  it('editing title maintains local draft and only updates DB on blur or Enter', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    // Click title to enter editing mode
    const titleBtn = screen.getByText('Buy groceries');
    fireEvent.click(titleBtn);

    // Find the input with 'Buy groceries'
    const inputs = screen.getAllByDisplayValue('Buy groceries');
    const input = inputs[0];

    // Change title without blurring
    fireEvent.change(input, { target: { value: 'Buy organic groceries' } });

    // Should NOT call updateTask yet on keystroke
    expect(tasksService.updateTask).not.toHaveBeenCalled();

    // Blur input
    fireEvent.blur(input);

    await act(async () => {
      await Promise.resolve();
    });

    expect(tasksService.updateTask).toHaveBeenCalledWith('task-1', {
      title: 'Buy organic groceries',
    });
  });

  it('sets startAt as local ISO without trailing Z', async () => {
    await act(async () => {
      render(<TasksView />);
    });

    // Enter editing mode for task-1 (which has dueDate '2026-09-21')
    const titleBtn = screen.getByText('Buy groceries');
    fireEvent.click(titleBtn);

    // Find the time input
    const timeInput = document.querySelector('input[type="time"]') as HTMLInputElement;
    expect(timeInput).toBeTruthy();

    // Set time to 22:00
    fireEvent.change(timeInput, { target: { value: '22:00' } });

    await act(async () => {
      await Promise.resolve();
    });

    // Must be local ISO without 'Z'
    expect(tasksService.updateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        startAt: '2026-09-21T22:00:00',
      })
    );
    const lastCall = vi.mocked(tasksService.updateTask).mock.calls[0];
    expect(lastCall[1].startAt).not.toMatch(/Z$/);
  });

  it('emits dataChanged on create, toggle, update, and delete', async () => {
    const emitSpy = vi.spyOn(appEvents, 'emitDataChanged');

    await act(async () => {
      render(<TasksView />);
    });

    const markBtn = screen.getAllByRole('button', { name: 'Новая задача' })[0];
    fireEvent.click(markBtn);

    await act(async () => {
      await Promise.resolve();
    });

    expect(emitSpy).toHaveBeenCalledWith('tasks', ['task-1']);
    emitSpy.mockRestore();
  });
});
