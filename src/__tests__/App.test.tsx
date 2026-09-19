import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import App from '../App';
import { StoreService } from '../services/store';

vi.mock('../services/sound', () => ({
  soundService: {
    playUiClick: vi.fn(),
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    playBeep: vi.fn(),
  },
}));

vi.mock('../services/platform', () => ({
  isTauri: () => false,
}));

vi.mock('../services/shortcuts', () => ({
  installShortcutLayer: vi.fn(() => () => {}),
  registerShortcut: vi.fn(),
  listShortcuts: vi.fn(() => []),
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(undefined) }));
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
 * The shell's own contract: a sidebar that names every screen, a collapse that
 * survives a reload, and the two window events other modules drive navigation
 * with. Screen content is asserted through `aria-label` on the nav buttons,
 * because a screen's visible title is also the name of its sidebar item.
 */
describe('App Shell', () => {
  beforeEach(() => {
    cleanup();
    StoreService.resetCache();
  });

  it('renders a sidebar entry for every screen', () => {
    render(<App />);
    for (const label of ['Таймер', 'Будильники', 'Задачи', 'Заметки', 'Статистика', 'Настройки']) {
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

  it('navigates between screens from the sidebar', () => {
    render(<App />);
    expect(activeScreen()).toBe('Таймер');

    fireEvent.click(screen.getByRole('button', { name: 'Настройки' }));
    expect(activeScreen()).toBe('Настройки');

    fireEvent.click(screen.getByRole('button', { name: 'Задачи' }));
    expect(activeScreen()).toBe('Задачи');
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
