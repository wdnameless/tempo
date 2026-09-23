import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act, within } from '@testing-library/react';
import App from '../../App';
import { StoreService } from '../../services/store';

vi.mock('../../services/sound', () => ({
  soundService: {
    playUiClick: vi.fn(),
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    playBeep: vi.fn(),
  },
}));


vi.mock('../../services/shortcuts', () => ({
  installShortcutLayer: vi.fn(() => () => {}),
  registerShortcut: vi.fn(),
  listShortcuts: vi.fn(() => []),
}));

vi.mock('../../services/update', () => ({
  currentVersion: vi.fn(() => Promise.resolve('0.18.2')),
  detectPortable: vi.fn(() => Promise.resolve(false)),
  checkForUpdate: vi.fn(() => Promise.resolve(null)),
  installUpdate: vi.fn(() => Promise.resolve(undefined)),
}));

// The shell calls a few commands on boot; the media prune is one of them, and a
// blanket `undefined` would make it look like a failure in every test.
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) =>
    Promise.resolve(cmd === 'asset_usage' ? { total: 0, by_kind: {} } : undefined),
  convertFileSrc: (p: string) => p,
}));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    startDragging: vi.fn(),
    minimize: vi.fn(),
    toggleMaximize: vi.fn(),
    close: vi.fn(),
    setAlwaysOnTop: vi.fn(),
    setSize: vi.fn(),
  }),
}));

/**
 * The shell's own contract: a sidebar that names merged sections, a collapse that
 * survives a reload, sub-tabs for multi-screen sections, and window events.
 */
describe('App Shell', () => {
  beforeEach(() => {
    cleanup();
    StoreService.resetCache();
  });

  it('renders a sidebar entry for every section', () => {
    render(<App />);
    for (const label of ['Alarms', 'Tasks', 'Календарь', 'Заметки', 'Записи', 'Статистика', 'Настройки']) {
      expect(screen.getByRole('button', { name: label })).toBeDefined();
    }
  });

  it('toggles sidebar and persists tempo_sidebar_collapsed', () => {
    render(<App />);
    const collapseBtn = screen.getByTestId('sidebar-collapse-button');
    expect(StoreService.getPreference('tempo_sidebar_collapsed', false)).toBe(false);

    fireEvent.click(collapseBtn);
    expect(StoreService.getPreference('tempo_sidebar_collapsed', false)).toBe(true);

    fireEvent.click(collapseBtn);
    expect(StoreService.getPreference('tempo_sidebar_collapsed', false)).toBe(false);
  });

  it('reads initial collapsed state from tempo_sidebar_collapsed', () => {
    StoreService.setPreference('tempo_sidebar_collapsed', true);
    render(<App />);
    expect(screen.getByTestId('sidebar').className).toContain('w-14');
  });

  /** Which screen the shell considers active, read the way a screen reader would. */
  const activeScreen = () => screen.getByRole('button', { current: 'page' }).getAttribute('aria-label');

  it('navigates between sections from the sidebar', () => {
    render(<App />);
    expect(activeScreen()).toBe('Alarms');

    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(activeScreen()).toBe('Настройки');

    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(activeScreen()).toBe('Tasks');
  });

  it('clicking a sidebar entry opens its first sub-tab', () => {
    render(<App />);
    // Navigate to settings first
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(activeScreen()).toBe('Настройки');

    // Click 'Tasks' sidebar section (tabs: ['day', 'tasks', 'lists'])
    fireEvent.click(screen.getByRole('button', { name: 'Tasks' }));
    expect(activeScreen()).toBe('Tasks');
    // First sub-tab ('День') is selected
    const tabs = screen.getByTestId('section-tabs');
    const dayRadio = within(tabs).getByRole('radio', { name: 'День' });
    expect(dayRadio.getAttribute('aria-checked')).toBe('true');
  });

  it('switching a sub-tab renders the other view', () => {
    render(<App />);
    // In Pomodoro section, sub-tabs are [Помодоро, Будильники]
    const tabs = screen.getByTestId('section-tabs');
    const alarmsRadio = within(tabs).getByRole('radio', { name: 'Будильники' });
    expect(alarmsRadio.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(alarmsRadio);
    expect(alarmsRadio.getAttribute('aria-checked')).toBe('true');
    // Active sidebar section remains 'Alarms'
    expect(activeScreen()).toBe('Alarms');
    // Alarms view is rendered
    expect(screen.getByText('Нет будильников')).toBeDefined();

    // Switch back to Pomodoro sub-tab
    const pomodoroRadio = within(tabs).getByRole('radio', { name: 'Помодоро' });
    fireEvent.click(pomodoroRadio);
    expect(pomodoroRadio.getAttribute('aria-checked')).toBe('true');
    expect(screen.queryByText('Нет будильников')).toBeNull();
  });

  it('opens the Alarms section with Alarms sub-tab selected when navigating to alarms from outside', () => {
    render(<App />);
    // Navigate to settings first
    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(activeScreen()).toBe('Настройки');

    act(() => {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'alarms' }));
    });

    // Active sidebar entry should be 'Alarms' (the section owning alarms)
    expect(activeScreen()).toBe('Alarms');
    // Alarms sub-tab should be selected
    const tabs = screen.getByTestId('section-tabs');
    const alarmsRadio = within(tabs).getByRole('radio', { name: 'Будильники' });
    expect(alarmsRadio.getAttribute('aria-checked')).toBe('true');
  });

  it('does not render Tempo branding or version in sidebar', () => {
    render(<App />);
    const sidebar = screen.getByTestId('sidebar');
    expect(within(sidebar).queryByText('Tempo')).toBeNull();
    expect(within(sidebar).queryByText(/0\.18\.2/)).toBeNull();
  });

  it('does not render AI assistant in sidebar, but right-edge AI control opens drawer', () => {
    render(<App />);
    const sidebar = screen.getByTestId('sidebar');
    expect(within(sidebar).queryByRole('button', { name: /AI Ассистент/i })).toBeNull();
    expect(within(sidebar).queryByText('AI Ассистент')).toBeNull();

    // Drawer is closed initially
    expect(screen.queryByText('Tempo Assistant')).toBeNull();

    // Right-edge button opens the drawer
    const rightEdgeButton = screen.getByRole('button', { name: /Раскрыть AI Co-Pilot|AI/i });
    fireEvent.click(rightEdgeButton);
    expect(screen.getByText('Tempo Assistant')).toBeDefined();
  });

  it('handles tempo:toggle-sidebar event on window', () => {
    render(<App />);
    expect(StoreService.getPreference('tempo_sidebar_collapsed', false)).toBe(false);

    act(() => {
      window.dispatchEvent(new CustomEvent('tempo:toggle-sidebar'));
    });
    expect(StoreService.getPreference('tempo_sidebar_collapsed', false)).toBe(true);
  });

  it('handles tempo:navigate event on window', () => {
    render(<App />);
    // The listener sets React state, so the dispatch has to be flushed inside
    // act() before the rendered DOM can be read.
    act(() => {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'settings' }));
    });
    expect(screen.getByRole('button', { current: 'page' }).getAttribute('aria-label')).toBe('Настройки');
  });
});
