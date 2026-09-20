import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CommandPalette, HighlightMatch } from '../CommandPalette';
import * as searchService from '../../services/search';
import { I18nService } from '../../services/i18n';
import { Clock, Calendar, CheckSquare } from 'lucide-react';

describe('HighlightMatch', () => {
  it('renders untouched text if query is empty or only whitespace', () => {
    const { container } = render(<HighlightMatch text="Focus Session" query="   " />);
    expect(container.textContent).toBe('Focus Session');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('renders untouched text when query does not match', () => {
    const { container } = render(<HighlightMatch text="Morning Alarm" query="xyz" />);
    expect(container.textContent).toBe('Morning Alarm');
    expect(container.querySelector('mark')).toBeNull();
  });

  it('highlights substring matches case-insensitively using mark tags', () => {
    const { container } = render(<HighlightMatch text="Morning Alarm" query="alarm" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('Alarm');
    expect(marks[0].style.color).toBe('var(--accent)');
  });

  it('safely handles special regex characters in query without throwing', () => {
    const { container } = render(<HighlightMatch text="Special [test]* title" query="[test]*" />);
    const marks = container.querySelectorAll('mark');
    expect(marks.length).toBe(1);
    expect(marks[0].textContent).toBe('[test]*');
  });

  it('splits title around match and preserves untouched text in surrounding spans', () => {
    const { container } = render(<HighlightMatch text="Deep Work Session" query="Work" />);
    const mark = container.querySelector('mark');
    expect(mark?.textContent).toBe('Work');
    expect(container.textContent).toBe('Deep Work Session');
  });
});

describe('CommandPalette', () => {
  const dummyCommands: searchService.Command[] = [
    {
      id: 'toggle-timer',
      titleKey: 'startTimer',
      keys: ['Space'],
      icon: Clock,
      run: vi.fn(),
    },
    {
      id: 'nav:alarms',
      titleKey: 'titleAlarms',
      keys: ['⌘', '1'],
      icon: Calendar,
      run: vi.fn(),
    },
  ];

  const dummySources: searchService.SearchSource[] = [
    {
      kind: 'alarm',
      labelKey: 'searchGroupAlarms',
      icon: Clock,
      open: vi.fn(),
    },
    {
      kind: 'session',
      labelKey: 'searchGroupSessions',
      icon: Calendar,
      open: vi.fn(),
    },
    {
      kind: 'task',
      labelKey: 'titleTasks',
      icon: CheckSquare,
      open: vi.fn(),
    },
  ];

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(searchService, 'listCommands').mockReturnValue(dummyCommands);
    vi.spyOn(searchService, 'listSearchSources').mockReturnValue(dummySources);
    vi.spyOn(searchService, 'searchAll').mockResolvedValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is initially closed and opens on tempo:spotlight event', () => {
    render(<CommandPalette />);
    expect(screen.queryByTestId('command-palette-dialog')).toBeNull();

    fireEvent(window, new CustomEvent('tempo:spotlight'));
    expect(screen.getByTestId('command-palette-dialog')).toBeDefined();
  });

  it('closes on Escape key', () => {
    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));
    expect(screen.getByTestId('command-palette-dialog')).toBeDefined();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByTestId('command-palette-dialog')).toBeNull();
  });

  it('closes on backdrop click', () => {
    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));
    expect(screen.getByTestId('command-palette-dialog')).toBeDefined();

    const backdrop = screen.getByTestId('command-palette-backdrop');
    fireEvent.click(backdrop);
    expect(screen.queryByTestId('command-palette-dialog')).toBeNull();
  });

  it('empty query shows commands and does not call searchAll', () => {
    const t = I18nService.t();
    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));

    // Commands rendered by translated title
    const expectedAlarmTitle = (t as unknown as Record<string, string>)['titleAlarms'] || 'titleAlarms';
    expect(screen.getByText('startTimer')).toBeDefined();
    expect(screen.getByText(expectedAlarmTitle)).toBeDefined();
    expect(searchService.searchAll).not.toHaveBeenCalled();
  });

  it('typing calls searchAll and renders content groups with results', async () => {
    const t = I18nService.t();
    const hits: searchService.SearchHit[] = [
      {
        row_id: '1',
        kind: 'alarm',
        title: 'Morning Wakeup',
        body: 'Alarm at 7am',
        rank: -1,
      },
      {
        row_id: '2',
        kind: 'session',
        title: 'Deep Work Session',
        body: 'Pomodoro focus 25m',
        rank: -2,
      },
    ];
    vi.spyOn(searchService, 'searchAll').mockResolvedValue(hits);

    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'work' } });

    await waitFor(() => {
      expect(searchService.searchAll).toHaveBeenCalledWith('work');
    });

    await waitFor(() => {
      const results = screen.getByTestId('command-palette-results');
      expect(results.textContent).toContain('Deep Work Session');
    });

    // Content group headers for alarm and session from I18nService
    expect(screen.getByText(t.searchGroupAlarms)).toBeDefined();
    expect(screen.getByText(t.searchGroupSessions)).toBeDefined();
  });

  it('a group with no hits is absent from the rendered palette', async () => {
    const t = I18nService.t();
    const hits: searchService.SearchHit[] = [
      {
        row_id: '10',
        kind: 'alarm',
        title: 'Night Alarm',
        body: '',
        rank: -1,
      },
    ];
    vi.spyOn(searchService, 'searchAll').mockResolvedValue(hits);

    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Night' } });

    await waitFor(() => {
      const results = screen.getByTestId('command-palette-results');
      expect(results.textContent).toContain('Night Alarm');
    });

    // 'alarm' group is present, but 'session' and 'task' groups have no hits and should NOT appear
    expect(screen.getByText(t.searchGroupAlarms)).toBeDefined();
    expect(screen.queryByText(t.searchGroupSessions)).toBeNull();
    expect(screen.queryByText('titleTasks')).toBeNull();
  });

  it('keyboard navigation with ArrowDown and Enter executes active command', () => {
    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));

    const input = screen.getByRole('combobox');
    // First command is active by default (index 0)
    // Press ArrowDown to move to second command (nav:alarms)
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(dummyCommands[1].run).toHaveBeenCalledTimes(1);
    // After execution, palette closes
    expect(screen.queryByTestId('command-palette-dialog')).toBeNull();
  });

  it('clicking a content hit triggers source.open and closes palette', async () => {
    const hits: searchService.SearchHit[] = [
      {
        row_id: '42',
        kind: 'alarm',
        title: 'Clickable Alarm',
        body: '',
        rank: -1,
      },
    ];
    vi.spyOn(searchService, 'searchAll').mockResolvedValue(hits);

    render(<CommandPalette />);
    fireEvent(window, new CustomEvent('tempo:spotlight'));

    const input = screen.getByRole('combobox');
    fireEvent.change(input, { target: { value: 'Clickable' } });

    await waitFor(() => {
      const results = screen.getByTestId('command-palette-results');
      expect(results.textContent).toContain('Clickable Alarm');
    });

    const mark = screen.getByText('Clickable');
    const hitRow = mark.closest('[role="option"]');
    expect(hitRow).not.toBeNull();
    fireEvent.click(hitRow!);

    expect(dummySources[0].open).toHaveBeenCalledWith(hits[0]);
    expect(screen.queryByTestId('command-palette-dialog')).toBeNull();
  });
});
