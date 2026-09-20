import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ListsView } from '../ListsView';
import * as tasksService from '../../services/tasks';
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

const mockLists: ListItem[] = [
  { id: 'list-1', name: 'Groceries', position: 0, createdAt: '2026-09-20T10:00:00Z' },
  { id: 'list-2', name: 'Packing', position: 1, createdAt: '2026-09-20T11:00:00Z' },
];

const mockItems: TaskItem[] = [
  {
    id: 'item-1',
    listId: 'list-1',
    title: 'Milk',
    done: false,
    priority: 0,
    position: 0,
    createdAt: '2026-09-20T10:05:00Z',
  },
  {
    id: 'item-2',
    listId: 'list-1',
    title: 'Bread',
    done: true,
    priority: 0,
    position: 1,
    createdAt: '2026-09-20T10:06:00Z',
  },
];

describe('ListsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(tasksService.listLists).mockResolvedValue(mockLists);
    vi.mocked(tasksService.listTasks).mockResolvedValue(mockItems);
    vi.mocked(tasksService.createTask).mockImplementation(async (input) => ({
      id: 'item-new',
      title: input.title,
      listId: input.listId,
      done: false,
      priority: 0,
      position: 99,
      createdAt: new Date().toISOString(),
    }));
    vi.mocked(tasksService.moveListItemToTask).mockResolvedValue({
      id: 'item-1',
      title: 'Milk',
      done: false,
      priority: 0,
      position: 0,
      createdAt: '2026-09-20T10:05:00Z',
    });
    vi.mocked(tasksService.deleteList).mockResolvedValue(undefined);
  });

  it('renders lists and items of the selected list', async () => {
    await act(async () => {
      render(<ListsView />);
    });

    expect(tasksService.listLists).toHaveBeenCalled();
    const groceryElements = screen.getAllByText('Groceries');
    expect(groceryElements.length).toBeGreaterThan(0);
    expect(screen.getByText('Packing')).toBeTruthy();
    // Default selected list is first one (Groceries), should show its items
    expect(screen.getByText('Milk')).toBeTruthy();
    expect(screen.getByText('Bread')).toBeTruthy();
  });

  it('adding an item to current list calls createTask with listId', async () => {
    await act(async () => {
      render(<ListsView />);
    });

    const itemInput = screen.getByPlaceholderText(/Новая задача|New task/i);
    fireEvent.change(itemInput, { target: { value: 'Eggs' } });
    fireEvent.submit(itemInput.closest('form')!);

    await act(async () => {
      await Promise.resolve();
    });

    expect(tasksService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Eggs',
        listId: 'list-1',
      })
    );
  });

  it('clicking move to task button calls moveListItemToTask', async () => {
    await act(async () => {
      render(<ListsView />);
    });

    const toTaskButtons = screen.getAllByText(/В задачу|To task/i);
    expect(toTaskButtons.length).toBeGreaterThan(0);
    fireEvent.click(toTaskButtons[0]);

    expect(tasksService.moveListItemToTask).toHaveBeenCalledWith('item-1');
  });

  it('delete list calls deleteList', async () => {
    await act(async () => {
      render(<ListsView />);
    });

    // Both sidebar and main header have delete list icon buttons with aria-label="Удалить список"
    const deleteButtons = screen.getAllByRole('button', { name: /Удалить список|Delete list/i });
    expect(deleteButtons.length).toBeGreaterThan(0);
    fireEvent.click(deleteButtons[0]);

    expect(tasksService.deleteList).toHaveBeenCalledWith('list-1');
  });
});
