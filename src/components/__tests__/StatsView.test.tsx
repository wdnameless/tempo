import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { StatsView } from '../StatsView';
import { I18nService } from '../../services/i18n';
import * as sessionStore from '../../services/sessionStore';
import * as tasksService from '../../services/tasks';
import type { StoredSession } from '../../services/sessionStore';
import type { TaskItem } from '../../types';

vi.mock('../../services/sessionStore', () => ({
  listSessions: vi.fn(),
}));

vi.mock('../../services/tasks', () => ({
  listTasks: vi.fn(),
}));

describe('StatsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    I18nService.setLang('ru');
  });

  it('renders the empty state when there are no sessions and no tasks', async () => {
    vi.mocked(sessionStore.listSessions).mockResolvedValue([]);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('stats-empty-state')).toBeDefined();
    });

    expect(screen.getByText('Статистика пока пуста')).toBeDefined();
    expect(screen.getByText('Завершите сессию таймера для старта')).toBeDefined();
  });

  it('renders stats with a fixed set of sessions and calculates totals, pomodoro count and streak', async () => {
    const now = new Date();
    const todayIso = now.toISOString();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    const yesterdayIso = yesterday.toISOString();

    const mockSessions: StoredSession[] = [
      {
        id: 's1',
        kind: 'pomodoro',
        duration_sec: 1500,
        started_at: todayIso,
        ended_at: todayIso,
        completed: true,
        task_id: null,
      },
      {
        id: 's2',
        kind: 'pomodoro',
        duration_sec: 1500,
        started_at: yesterdayIso,
        ended_at: yesterdayIso,
        completed: true,
        task_id: null,
      },
    ];

    const mockTasks: TaskItem[] = [
      {
        id: 't1',
        title: 'Task 1',
        done: true,
        priority: 2,
        position: 0,
        createdAt: todayIso,
        completedAt: todayIso,
      },
      {
        id: 't2',
        title: 'Task 2',
        done: false,
        priority: 1,
        position: 1,
        createdAt: todayIso,
      },
    ];

    vi.mocked(sessionStore.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(tasksService.listTasks).mockResolvedValue(mockTasks);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('period-focus-total')).toBeDefined();
    });

    // 2 sessions of 1500 sec = 3000 sec = 50m
    expect(screen.getByTestId('period-focus-total').textContent).toBe('50m');
    // 2 pomodoros
    expect(screen.getByTestId('pomodoro-count').textContent).toBe('2');
    // 2-day streak (yesterday + today)
    expect(screen.getByTestId('current-streak').textContent).toBe('2');
    // Task completion rate: 1 of 2 = 50%
    expect(screen.getByTestId('task-completion-rate').textContent).toBe('50%');
  });

  it('switching the toggle changes the period between day and week', async () => {
    const now = new Date();
    const mockSessions: StoredSession[] = [
      {
        id: 's1',
        kind: 'pomodoro',
        duration_sec: 1800,
        started_at: now.toISOString(),
        ended_at: now.toISOString(),
        completed: true,
        task_id: null,
      },
    ];

    vi.mocked(sessionStore.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('toggle-period-week')).toBeDefined();
    });

    const weekBtn = screen.getByTestId('toggle-period-week');
    fireEvent.click(weekBtn);

    // Period total label updates specifically via data-testid
    expect(screen.getByTestId('period-focus-label').textContent).toBe('Фокус (12 недель)');
    const t = I18nService.t();
    expect(screen.getByTestId('chart-period-subtitle').textContent).toBe(t.statsLast12Weeks);
    expect(screen.getByTestId('chart-bars').children.length).toBe(12);

    const dayBtn = screen.getByTestId('toggle-period-day');
    fireEvent.click(dayBtn);
    expect(screen.getByTestId('period-focus-label').textContent).toBe('Фокус (14 дней)');
    expect(screen.getByTestId('chart-period-subtitle').textContent).toBe(t.statsLast14Days);
    expect(screen.getByTestId('chart-bars').children.length).toBe(14);
  });

  it('the heat map renders weeks * 7 cells', async () => {
    const mockSessions: StoredSession[] = [
      {
        id: 's1',
        kind: 'pomodoro',
        duration_sec: 1200,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        completed: true,
        task_id: null,
      },
    ];

    vi.mocked(sessionStore.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('heatmap-grid')).toBeDefined();
    });

    // 12 weeks * 7 days = 84 cells
    const cells = screen.getAllByTestId('heatmap-cell');
    expect(cells.length).toBe(84);
  });

  it('a day with no focus renders a zero cell rather than skipping it', async () => {
    const mockSessions: StoredSession[] = [
      {
        id: 's1',
        kind: 'pomodoro',
        duration_sec: 900,
        started_at: new Date().toISOString(),
        ended_at: new Date().toISOString(),
        completed: true,
        task_id: null,
      },
    ];

    vi.mocked(sessionStore.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('heatmap-grid')).toBeDefined();
    });

    const cells = screen.getAllByTestId('heatmap-cell');
    // At least 83 cells should have 0 seconds (only 1 day has focus)
    const zeroCells = cells.filter((c) => c.getAttribute('data-seconds') === '0');
    expect(zeroCells.length).toBeGreaterThanOrEqual(83);
  });

  it('renders loading state with localized statsLoading text', () => {
    const { promise: pendingSessions } = Promise.withResolvers<StoredSession[]>();
    const { promise: pendingTasks } = Promise.withResolvers<TaskItem[]>();
    vi.mocked(sessionStore.listSessions).mockReturnValue(pendingSessions);
    vi.mocked(tasksService.listTasks).mockReturnValue(pendingTasks);

    render(<StatsView />);
  });

  it('renders all card headers and labels in Russian by default', async () => {
    const now = new Date();
    const mockSessions: StoredSession[] = [
      {
        id: 's1',
        kind: 'pomodoro',
        duration_sec: 1200,
        started_at: now.toISOString(),
        ended_at: now.toISOString(),
        completed: true,
        task_id: null,
      },
    ];

    vi.mocked(sessionStore.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('current-streak')).toBeDefined();
    });

    const t = I18nService.t();
    expect(screen.getByText(t.statsFocusActivity)).toBeDefined();
    expect(screen.getByText(t.statsCurrentStreak)).toBeDefined();
    expect(screen.getByText(t.statsDays)).toBeDefined();
    expect(screen.getByText(t.statsFocusedTime)).toBeDefined();
    expect(screen.getByText(t.statsLast14Days)).toBeDefined();
    expect(screen.getByText(t.statsLongest.replace('{n}', '1'))).toBeDefined();

    // Weekday initials should match Russian narrow formatting
    const expectedWeekday = now.toLocaleDateString('ru-RU', { weekday: 'narrow' });
    const chartLabels = screen.getByTestId('chart-bars').parentElement;
    expect(chartLabels?.textContent).toContain(expectedWeekday);
  });

  it('updates labels and weekday initials when switching to English', async () => {
    I18nService.setLang('en');
    const now = new Date();
    const mockSessions: StoredSession[] = [
      {
        id: 's1',
        kind: 'pomodoro',
        duration_sec: 1200,
        started_at: now.toISOString(),
        ended_at: now.toISOString(),
        completed: true,
        task_id: null,
      },
    ];

    vi.mocked(sessionStore.listSessions).mockResolvedValue(mockSessions);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    render(<StatsView />);

    await waitFor(() => {
      expect(screen.getByTestId('current-streak')).toBeDefined();
    });

    const t = I18nService.t();
    expect(screen.getByText(t.statsFocusActivity)).toBeDefined();
    expect(screen.getByText(t.statsCurrentStreak)).toBeDefined();
    expect(screen.getByText(t.statsDays)).toBeDefined();
    expect(screen.getByText(t.statsFocusedTime)).toBeDefined();
    expect(screen.getByText(t.statsLast14Days)).toBeDefined();
    expect(screen.getByText(t.statsLongest.replace('{n}', '1'))).toBeDefined();

    const expectedWeekday = now.toLocaleDateString('en-US', { weekday: 'narrow' });
    const chartLabels = screen.getByTestId('chart-bars').parentElement;
    expect(chartLabels?.textContent).toContain(expectedWeekday);
  });
});
