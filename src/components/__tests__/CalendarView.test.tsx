import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CalendarView } from '../CalendarView';
import * as eventsService from '../../services/events';
import * as tasksService from '../../services/tasks';
import { I18nService } from '../../services/i18n';
import type { CalendarEvent } from '../../services/events';
import type { TaskItem } from '../../types';

vi.mock('../../services/events', () => ({
  listEvents: vi.fn(),
  createLocalEvent: vi.fn(),
  updateLocalEvent: vi.fn(),
  deleteEvent: vi.fn(),
}));

vi.mock('../../services/tasks', () => ({
  listTasks: vi.fn(),
  updateTask: vi.fn(),
}));

describe('CalendarView Component (Wave 8 / R18)', () => {
  const t = I18nService.t();

  const mockEvents: CalendarEvent[] = [
    {
      id: 'evt-1',
      source: 'local',
      title: 'Sprint Planning',
      startAt: '2026-09-20T10:00:00',
      endAt: '2026-09-20T11:00:00',
      allDay: false,
      location: 'Meeting Room A',
      updated_at: '',
      deleted_at: null,
    },
    {
      id: 'evt-2',
      source: 'google',
      title: 'Google Cloud Sync',
      startAt: '2026-09-20T14:00:00',
      endAt: '2026-09-20T15:00:00',
      allDay: false,
      location: null,
      updated_at: '',
      deleted_at: null,
    },
  ];

  const mockTasks: TaskItem[] = [
    {
      id: 'task-1',
      title: 'Review PR #42',
      done: false,
      priority: 2,
      dueDate: '2026-09-20',
      startAt: '2026-09-20T16:00:00',
      plannedMinutes: 30,
      position: 0,
      createdAt: '',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(eventsService.listEvents).mockResolvedValue(mockEvents);
    vi.mocked(tasksService.listTasks).mockResolvedValue(mockTasks);
  });

  it('renders header with navigation, view mode switcher, and new event button', async () => {
    render(<CalendarView />);

    expect(screen.getByRole('button', { name: t.calendarPrevious })).toBeDefined();
    expect(screen.getByRole('button', { name: t.calendarToday })).toBeDefined();
    expect(screen.getByRole('button', { name: t.calendarNext })).toBeDefined();

    expect(screen.getByText(t.calendarMonth)).toBeDefined();
    expect(screen.getByText(t.calendarWeek)).toBeDefined();
    expect(screen.getByText(t.calendarDay)).toBeDefined();

    expect(screen.getByText(t.calendarNewEvent)).toBeDefined();
  });

  it('switches between month, week, and day view modes', async () => {
    render(<CalendarView />);

    // Default is month
    expect(screen.getByText('Пн')).toBeDefined();

    // Switch to week view
    fireEvent.click(screen.getByText(t.calendarWeek));
    await waitFor(() => {
      // 24-hour slots should be visible (e.g. 09:00, 12:00)
      expect(screen.getAllByText('09:00').length).toBeGreaterThan(0);
    });

    // Switch to day view
    fireEvent.click(screen.getByText(t.calendarDay));
    await waitFor(() => {
      expect(screen.getAllByText('12:00').length).toBeGreaterThan(0);
    });
  });

  it('displays local events, Google events, and task events', async () => {
    render(<CalendarView />);

    await waitFor(() => {
      expect(screen.getByText('Sprint Planning')).toBeDefined();
      expect(screen.getByText('Google Cloud Sync')).toBeDefined();
      expect(screen.getByText('Review PR #42')).toBeDefined();
    });
  });

  it('clicking New Event opens modal and submits createLocalEvent', async () => {
    vi.mocked(eventsService.createLocalEvent).mockResolvedValue({
      id: 'new-evt-1',
      source: 'local',
      title: 'New Strategy Discussion',
      startAt: '2026-09-20T09:00:00',
      endAt: '2026-09-20T10:00:00',
      allDay: false,
      updated_at: '',
      deleted_at: null,
    });

    render(<CalendarView />);

    // Click "+ New Event"
    fireEvent.click(screen.getByText(t.calendarNewEvent));

    expect(screen.getByPlaceholderText('e.g. Weekly Strategy Sync')).toBeDefined();

    // Fill form
    const titleInput = screen.getByPlaceholderText('e.g. Weekly Strategy Sync');
    fireEvent.change(titleInput, { target: { value: 'New Strategy Discussion' } });

    // Click Save
    fireEvent.click(screen.getByText(t.calendarSave));

    await waitFor(() => {
      expect(eventsService.createLocalEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'New Strategy Discussion',
        })
      );
    });
  });

  it('toggles task visibility when Show Tasks is clicked', async () => {
    render(<CalendarView />);

    await waitFor(() => {
      expect(screen.getByText('Review PR #42')).toBeDefined();
    });

    // Click show tasks button to hide tasks
    fireEvent.click(screen.getByText(t.calendarShowTasks));

    await waitFor(() => {
      expect(screen.queryByText('Review PR #42')).toBeNull();
      // Events should still be visible
      expect(screen.getByText('Sprint Planning')).toBeDefined();
    });
  });
});
