import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DashboardView } from '../DashboardView';
import { TimerService } from '../../services/timer';
import { toggleTask, createTask } from '../../services/tasks';
import { themeFromTokens } from '../../constants/themes';
import { DEFAULT_ACCENT } from '../../constants/design';
import { DEFAULT_DYNAMIC_UI, TaskItem, NoteItem, AlarmItem, AISettings } from '../../types';

vi.mock('../WinterCanvas', () => ({
  WinterCanvas: ({ className }: { className?: string }) => (
    <div data-testid="winter-canvas" className={className} />
  ),
}));

vi.mock('../../services/sound', () => ({
  soundService: {
    playUiClick: vi.fn(),
  },
}));

vi.mock('../../services/timer', () => ({
  TimerService: {
    getState: vi.fn(() =>
      Promise.resolve({
        running: false,
        remaining_secs: 1500,
        total_secs: 1500,
        elapsed_secs: 0,
        pomodoro_index: 0,
        phase: 'focus' as const,
        mode: 'pomodoro' as const,
        focus_min: 25,
        short_rest_min: 5,
        long_rest_min: 15,
        auto_start: false,
        completed_today: 0,
      }),
    ),
    subscribe: vi.fn(() => () => {}),
    start: vi.fn(() => Promise.resolve()),
    pause: vi.fn(() => Promise.resolve()),
    reset: vi.fn(() => Promise.resolve()),
    setDuration: vi.fn(() => Promise.resolve()),
    shiftMinutes: vi.fn(() => Promise.resolve()),
    skipPhase: vi.fn(() => Promise.resolve()),
    setMode: vi.fn(() => Promise.resolve()),
  },
}));

vi.mock('../../services/tasks', () => ({
  toggleTask: vi.fn((id: string) =>
    Promise.resolve({
      id,
      title: 'Mock task',
      done: true,
      priority: 0,
      position: 0,
      createdAt: new Date().toISOString(),
    }),
  ),
  createTask: vi.fn((input: { title: string }) =>
    Promise.resolve({
      id: 'new-task-1',
      title: input.title,
      done: false,
      priority: 0,
      position: 0,
      createdAt: new Date().toISOString(),
    }),
  ),
}));

vi.mock('../../services/alarms', () => ({
  listAlarms: vi.fn(() => Promise.resolve([])),
}));

vi.mock('../../services/focusAudio', () => ({
  startFocusAudio: vi.fn(),
  stopFocusAudio: vi.fn(),
  currentFocusSound: vi.fn(() => 'none'),
  setFocusAudioVolume: vi.fn(),
  getFocusAudioVolume: vi.fn(() => 0.25),
}));

const mockTheme = themeFromTokens(DEFAULT_ACCENT);

const mockAiSettings: AISettings = {
  apiKey: '',
  baseUrl: '',
  model: 'gpt-4',
  enabled: false,
};

const sampleTasks: TaskItem[] = [
  {
    id: 'task-1',
    title: 'Подготовить отчёт',
    done: false,
    priority: 1,
    position: 0,
    createdAt: '2026-09-23T10:00:00Z',
    dueDate: '2026-09-24',
  },
  {
    id: 'task-2',
    title: 'Проверить тесты',
    done: true,
    priority: 0,
    position: 1,
    createdAt: '2026-09-23T09:00:00Z',
  },
];

const sampleNotes: NoteItem[] = [
  {
    id: 'note-1',
    title: 'Заметка о дизайне',
    body: 'Текст заметки о дизайне интерфейсов',
    updatedAt: '2026-09-23T11:00:00Z',
    createdAt: '2026-09-23T11:00:00Z',
    pinned: true,
  },
  {
    id: 'note-2',
    title: 'Идеи для фич',
    body: 'Сделать песочные часы более плавными',
    updatedAt: '2026-09-22T15:00:00Z',
    createdAt: '2026-09-22T15:00:00Z',
    pinned: false,
  },
];

const sampleAlarms: AlarmItem[] = [
  {
    id: 'alarm-1',
    label: 'Утренний подъём',
    title: 'Утренний подъём',
    time: '08:30',
    enabled: true,
    repeat: 'daily',
    days: [0, 1, 2, 3, 4],
    sound: 'bell',
  },
];

describe('DashboardView Component (ambient cleanup)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('completely removes the old widget board and its controls from the DOM', () => {
    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={vi.fn()}
        notes={sampleNotes}
      />,
    );

    // Old widget board elements must not be present anywhere in the DOM
    expect(screen.queryByText('Доска виджетов')).toBeNull();
    expect(screen.queryByText('Настроить виджеты')).toBeNull();
    expect(screen.queryByText('Скрыть виджет')).toBeNull();
    expect(screen.queryByLabelText('Виджеты')).toBeNull();
    expect(screen.queryByText('✦ Эмбиент')).toBeNull();

    // The ambient canvas and bottom player must be rendered
    expect(screen.getByTestId('winter-canvas')).toBeDefined();
    expect(screen.getByTestId('winter-bottom-player')).toBeDefined();
  });

  it('navigates to alarms when next alarm pill is clicked', () => {
    const navigateSpy = vi.fn();
    window.addEventListener('tempo:navigate', navigateSpy);

    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={vi.fn()}
        notes={sampleNotes}
      />,
    );

    const alarmPill = screen.getByTestId('ambient-next-alarm');
    expect(alarmPill.textContent).toContain('08:30');
    expect(alarmPill.textContent).toContain('Утренний подъём');

    fireEvent.click(alarmPill);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    const event = navigateSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toBe('alarms');

    window.removeEventListener('tempo:navigate', navigateSpy);
  });

  it('renders next alarm pill with fallback text when no alarms are active', () => {
    const navigateSpy = vi.fn();
    window.addEventListener('tempo:navigate', navigateSpy);

    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={[]}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={vi.fn()}
        notes={sampleNotes}
      />,
    );

    const alarmPill = screen.getByTestId('ambient-next-alarm');
    expect(alarmPill.textContent).toContain('Нет активных будильников');

    fireEvent.click(alarmPill);
    expect(navigateSpy).toHaveBeenCalled();
    const event = navigateSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toBe('alarms');

    window.removeEventListener('tempo:navigate', navigateSpy);
  });

  it('toggles task completion and calls the task service', async () => {
    const onUpdateTasks = vi.fn();

    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={onUpdateTasks}
        notes={sampleNotes}
      />,
    );

    // open task toggle button
    const toggleBtn = screen.getByTestId('task-toggle-task-1');
    fireEvent.click(toggleBtn);

    expect(toggleTask).toHaveBeenCalledWith('task-1');
    await waitFor(() => {
      expect(onUpdateTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'task-1', done: true }),
        ]),
      );
    });
  });

  it('adds a quick task and calls the task service', async () => {
    const onUpdateTasks = vi.fn();

    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={onUpdateTasks}
        notes={sampleNotes}
      />,
    );

    const input = screen.getByTestId('quick-add-task-input');
    const submitBtn = screen.getByTestId('quick-add-task-submit');

    fireEvent.change(input, { target: { value: 'Купить кофе' } });
    fireEvent.click(submitBtn);

    expect(createTask).toHaveBeenCalledWith({ title: 'Купить кофе' });
    await waitFor(() => {
      expect(onUpdateTasks).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({ id: 'new-task-1', title: 'Купить кофе' }),
        ]),
      );
    });
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('navigates to tasks when clicking All Tasks button', () => {
    const navigateSpy = vi.fn();
    window.addEventListener('tempo:navigate', navigateSpy);

    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={vi.fn()}
        notes={sampleNotes}
      />,
    );

    fireEvent.click(screen.getByTestId('ambient-tasks-all'));
    expect(navigateSpy).toHaveBeenCalled();
    const event = navigateSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toBe('tasks');

    window.removeEventListener('tempo:navigate', navigateSpy);
  });

  it('navigates to notes when clicking a note item or All Notes button', () => {
    const navigateSpy = vi.fn();
    window.addEventListener('tempo:navigate', navigateSpy);

    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={vi.fn()}
        notes={sampleNotes}
      />,
    );

    // Click note item
    const noteBtn = screen.getByTestId('ambient-note-note-1');
    expect(noteBtn.textContent).toContain('Заметка о дизайне');
    fireEvent.click(noteBtn);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    let event = navigateSpy.mock.calls[0][0] as CustomEvent;
    expect(event.detail).toBe('notes');

    // Click all notes button
    fireEvent.click(screen.getByTestId('ambient-notes-all'));
    expect(navigateSpy).toHaveBeenCalledTimes(2);
    event = navigateSpy.mock.calls[1][0] as CustomEvent;
    expect(event.detail).toBe('notes');

    window.removeEventListener('tempo:navigate', navigateSpy);
  });

  it('timer controls in bottom dock call the timer service', async () => {
    render(
      <DashboardView
        theme={mockTheme}
        dynamicUi={DEFAULT_DYNAMIC_UI}
        alarms={sampleAlarms}
        aiSettings={mockAiSettings}
        onUpdateAlarms={vi.fn()}
        onOpenAISettings={vi.fn()}
        tasks={sampleTasks}
        onUpdateTasks={vi.fn()}
        notes={sampleNotes}
      />,
    );

    // Toggle start/pause
    fireEvent.click(screen.getByTestId('bottom-player-toggle'));
    expect(TimerService.start).toHaveBeenCalled();

    // Mode switch (pomodoro / stopwatch)
    fireEvent.click(screen.getByTestId('bottom-player-mode'));
    expect(TimerService.setMode).toHaveBeenCalledWith('stopwatch');

    // Reset timer
    fireEvent.click(screen.getByTestId('bottom-player-reset'));
    expect(TimerService.reset).toHaveBeenCalled();

    // Skip phase
    fireEvent.click(screen.getByTestId('bottom-player-skip'));
    expect(TimerService.skipPhase).toHaveBeenCalled();

    // Duration preset
    fireEvent.click(screen.getByTestId('bottom-player-time'));
    expect(screen.getByTestId('preset-25')).toBeDefined();
    fireEvent.click(screen.getByTestId('preset-25'));
    expect(TimerService.setDuration).toHaveBeenCalledWith(25);
  });
});
