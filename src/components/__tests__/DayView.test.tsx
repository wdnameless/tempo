import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DayView } from '../DayView';
import { I18nService } from '../../services/i18n';
import type { TaskItem } from '../../types';
import type { CalendarEvent } from '../../services/events';
import type { DayItem } from '../../services/day';

// Mock services
vi.mock('../../services/tasks', () => ({
  listTasks: vi.fn(),
  updateTask: vi.fn(),
  moveTask: vi.fn(),
}));

vi.mock('../../services/events', () => ({
  listEvents: vi.fn(),
  createLocalEvent: vi.fn(),
}));

vi.mock('../../services/day', () => ({
  buildDay: vi.fn(),
  findConflicts: vi.fn(),
  dayKey: vi.fn((date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }),
}));

import { listTasks, updateTask, moveTask } from '../../services/tasks';
import { listEvents, createLocalEvent } from '../../services/events';
import { buildDay, findConflicts } from '../../services/day';

describe('DayView component', () => {
  const t = I18nService.t();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty day view when there are no items', async () => {
    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([]);
    vi.mocked(findConflicts).mockReturnValue([]);

    render(<DayView />);

    await waitFor(() => {
      // Empty day message should appear
      expect(screen.getByText(t.dayEmpty)).toBeDefined();
      expect(screen.getByText(t.dayEmptyHint)).toBeDefined();
    });

    // Timeline rail should NOT be rendered when day is empty
    expect(screen.queryByTestId('timeline-item')).toBeNull();
    expect(screen.queryByTestId('all-day-strip')).toBeNull();
  });

  it('renders timed tasks and events at their slots on the timeline', async () => {
    const mockTimedTask: DayItem = {
      kind: 'task',
      id: 'task-1',
      title: 'Deep work session',
      startMin: 600, // 10:00
      endMin: 660, // 11:00
      allDay: false,
      done: false,
      source: null,
      ref: {} as TaskItem,
    };

    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([mockTimedTask]);
    vi.mocked(findConflicts).mockReturnValue([]);

    render(<DayView />);

    await waitFor(() => {
      expect(screen.getByText('Deep work session')).toBeDefined();
      expect(screen.getByText('10:00 – 11:00')).toBeDefined();
    });

    const items = screen.getAllByTestId('timeline-item');
    expect(items.length).toBe(1);
  });

  it('renders all-day events in the all-day strip', async () => {
    const mockAllDayEvent: DayItem = {
      kind: 'event',
      id: 'event-all-day',
      title: 'Company Hackathon',
      startMin: null,
      endMin: null,
      allDay: true,
      done: false,
      source: 'local',
      ref: {} as CalendarEvent,
    };

    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([mockAllDayEvent]);
    vi.mocked(findConflicts).mockReturnValue([]);

    render(<DayView />);

    await waitFor(() => {
      expect(screen.getByTestId('all-day-strip')).toBeDefined();
      expect(screen.getByText('Company Hackathon')).toBeDefined();
    });
  });

  it('marks Google events with dayFromGoogle marker', async () => {
    const mockGoogleEvent: DayItem = {
      kind: 'event',
      id: 'google-sync-1',
      title: 'Product Sync Call',
      startMin: 840, // 14:00
      endMin: 870, // 14:30
      allDay: false,
      done: false,
      source: 'google',
      ref: {} as CalendarEvent,
    };

    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([mockGoogleEvent]);
    vi.mocked(findConflicts).mockReturnValue([]);

    render(<DayView />);

    await waitFor(() => {
      expect(screen.getByText('Product Sync Call')).toBeDefined();
      // Google marker text
      expect(screen.getByText(t.dayFromGoogle)).toBeDefined();
    });
  });

  it('surfaces conflicts when two items overlap', async () => {
    const itemA: DayItem = {
      kind: 'event',
      id: 'evt-1',
      title: 'Team Standup',
      startMin: 600,
      endMin: 630,
      allDay: false,
      done: false,
      source: 'local',
      ref: {} as CalendarEvent,
    };

    const itemB: DayItem = {
      kind: 'task',
      id: 'tsk-1',
      title: 'Priority bug fixing',
      startMin: 615,
      endMin: 675,
      allDay: false,
      done: false,
      source: null,
      ref: {} as TaskItem,
    };

    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([itemA, itemB]);
    vi.mocked(findConflicts).mockReturnValue([{ a: itemA, b: itemB }]);

    render(<DayView />);

    await waitFor(() => {
      const indicators = screen.getAllByTestId('conflict-indicator');
      expect(indicators.length).toBe(2);
      expect(screen.getAllByText(t.dayConflict).length).toBeGreaterThan(0);
    });
  });

  it('switches steps: plan, execute, review and shows correct content', async () => {
    const doneTask: DayItem = {
      kind: 'task',
      id: 'done-1',
      title: 'Shipped feature',
      startMin: 600,
      endMin: 660,
      allDay: false,
      done: true,
      source: null,
      ref: {} as TaskItem,
    };

    const unfinishedTask: DayItem = {
      kind: 'task',
      id: 'unf-1',
      title: 'Refactor database models',
      startMin: 700,
      endMin: 760,
      allDay: false,
      done: false,
      source: null,
      ref: {} as TaskItem,
    };

    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([doneTask, unfinishedTask]);
    vi.mocked(findConflicts).mockReturnValue([]);

    render(<DayView />);

    // Initially on Plan step: segmented buttons exist
    const planBtn = screen.getByRole('radio', { name: t.dayStepPlan });
    const executeBtn = screen.getByRole('radio', { name: t.dayStepExecute });
    const reviewBtn = screen.getByRole('radio', { name: t.dayStepReview });

    expect(planBtn).toBeDefined();
    expect(executeBtn).toBeDefined();
    expect(reviewBtn).toBeDefined();

    // Switch to Review step
    fireEvent.click(reviewBtn);

    await waitFor(() => {
      // Completed and unfinished groups
      expect(screen.getByText(t.dayDone)).toBeDefined();
      expect(screen.getByText(t.dayUnfinished)).toBeDefined();
      expect(screen.getByText('Shipped feature')).toBeDefined();
      expect(screen.getByText('Refactor database models')).toBeDefined();
      expect(screen.getByText(t.dayCarryOver)).toBeDefined();
    });

    // Clicking carry-over calls moveTask with tomorrow's date
    const carryOverBtn = screen.getByText(t.dayCarryOver);
    fireEvent.click(carryOverBtn);

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const expectedTomorrow = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;

    await waitFor(() => {
      expect(moveTask).toHaveBeenCalledWith('unf-1', {
        dueDate: expectedTomorrow,
        startAt: null,
      });
    });
  });

  it('allows creating a local event in Plan step', async () => {
    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([]);
    vi.mocked(findConflicts).mockReturnValue([]);
    vi.mocked(createLocalEvent).mockResolvedValue({
      id: 'evt-new-1',
      source: 'local',
      googleId: null,
      calendarId: null,
      title: 'Quick Planning Sync',
      startAt: '2026-09-20T10:00:00.000',
      endAt: '2026-09-20T11:00:00.000',
      allDay: false,
      location: null,
      updated_at: '2026-09-20T10:00:00.000Z',
      deleted_at: null,
    });

    const dummyTask: DayItem = {
      kind: 'task',
      id: 'task-p1',
      title: 'Existing Task',
      startMin: null,
      endMin: null,
      allDay: false,
      done: false,
      source: null,
      ref: {} as TaskItem,
    };
    vi.mocked(buildDay).mockReturnValue([dummyTask]);

    render(<DayView />);

    await waitFor(() => {
      expect(screen.getAllByText(t.dayPickMain).length).toBeGreaterThan(0);
    });

    const openEventFormBtn = screen.getByRole('button', { name: t.dayNewEvent });
    fireEvent.click(openEventFormBtn);

    const titleInput = screen.getByPlaceholderText(t.dayEventTitle);
    fireEvent.change(titleInput, { target: { value: 'Quick Planning Sync' } });

    const submitBtn = screen.getByText(t.commonAdd);
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(createLocalEvent).toHaveBeenCalledWith(expect.objectContaining({
        title: 'Quick Planning Sync',
      }));
    });
  });

  it('allows completing a task in place on Execute step', async () => {
    const timedTask: DayItem = {
      kind: 'task',
      id: 'task-exec-1',
      title: 'Actionable item',
      startMin: 600,
      endMin: 660,
      allDay: false,
      done: false,
      source: null,
      ref: {} as TaskItem,
    };

    vi.mocked(listTasks).mockResolvedValue([]);
    vi.mocked(listEvents).mockResolvedValue([]);
    vi.mocked(buildDay).mockReturnValue([timedTask]);
    vi.mocked(findConflicts).mockReturnValue([]);
    vi.mocked(updateTask).mockResolvedValue({} as TaskItem);

    render(<DayView />);

    const executeBtn = screen.getByRole('radio', { name: t.dayStepExecute });
    fireEvent.click(executeBtn);

    await waitFor(() => {
      expect(screen.getByText('Actionable item')).toBeDefined();
    });

    const toggleBtn = screen.getByRole('button', { name: /Mark as completed/i });
    fireEvent.click(toggleBtn);

    await waitFor(() => {
      expect(updateTask).toHaveBeenCalledWith('task-exec-1', {
        done: true,
      });
    });
  });
});
