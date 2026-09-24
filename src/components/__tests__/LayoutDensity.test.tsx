import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import App from '../../App';
import { SettingsView } from '../SettingsView';
import { SpeechPanel } from '../speech/SpeechPanel';
import { Card } from '../ui/Card';
import { StoreService } from '../../services/store';
import { DEFAULT_SPEECH_CONFIG } from '../../services/speechSettings';

vi.mock('../../services/sound', () => ({
  soundService: {
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    playBeep: vi.fn(),
  },
}));

vi.mock('../../services/shortcuts', () => ({
  installShortcutLayer: vi.fn(() => () => {}),
  registerShortcut: vi.fn(),
  listShortcuts: vi.fn(() => []),
  formatKeyToken: vi.fn((k: string) => k),
}));

vi.mock('../../services/update', () => ({
  currentVersion: vi.fn(() => Promise.resolve('0.18.2')),
  detectPortable: vi.fn(() => Promise.resolve(false)),
  checkForUpdate: vi.fn(() => Promise.resolve(null)),
  installUpdate: vi.fn(() => Promise.resolve(undefined)),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string) =>
    Promise.resolve(
      cmd === 'asset_usage'
        ? { total: 0, by_kind: {} }
        : cmd === 'stt_list_models'
        ? []
        : undefined,
    ),
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
vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(() => () => {}),
}));

describe('Layout Density and Spacing Contract', () => {
  describe('Card primitive', () => {
    it('applies rounded-xl surface rounding to provide softer corners', () => {
      render(<Card data-testid="test-card">Content</Card>);
      const card = screen.getByText('Content');
      expect(card.className).toContain('rounded-xl');
      expect(card.className).not.toContain('rounded-lg');
      expect(card.className).not.toContain('rounded-[14px]');
    });
  });

  describe('App shell sidebar', () => {
    it('uses w-44 for expanded sidebar and w-12 for collapsed sidebar', () => {
      StoreService.setPreference('tempo_sidebar_collapsed', false);
      const { unmount } = render(<App />);
      const sidebar = screen.getByTestId('sidebar');
      expect(sidebar.className).toContain('w-44');
      expect(sidebar.className).not.toContain('w-52');
      unmount();

      StoreService.setPreference('tempo_sidebar_collapsed', true);
      render(<App />);
      const collapsedSidebar = screen.getByTestId('sidebar');
      expect(collapsedSidebar.className).toContain('w-12');
      expect(collapsedSidebar.className).not.toContain('w-14');
    });
  });

  describe('SpeechPanel sub-section column and content panel', () => {
    it('uses w-48 for the sub-section navigation column and p-7 / space-y-7 for content', () => {
      render(
        <SpeechPanel
          config={DEFAULT_SPEECH_CONFIG}
          onChange={vi.fn()}
        />,
      );

      const tablist = screen.getByRole('tablist');
      expect(tablist.className).toContain('w-48');
      expect(tablist.className).not.toContain('w-60');

      const contentPane = tablist.parentElement?.querySelector('.overflow-y-auto.p-7');
      expect(contentPane).not.toBeNull();
      expect(contentPane?.className).toContain('p-7');
      expect(contentPane?.className).toContain('space-y-7');
      expect(contentPane?.className).not.toContain('p-6');
      expect(contentPane?.className).not.toContain('space-y-6');
    });
  });

  describe('SettingsView sub-section column and content panel', () => {
    it('uses w-48 for the sub-section navigation column and p-7 / space-y-7 for content', () => {
      render(<SettingsView />);

      const tablist = screen.getByRole('tablist');
      expect(tablist.className).toContain('w-48');
      expect(tablist.className).not.toContain('w-60');

      const contentScrollContainer = tablist.parentElement?.querySelector('.overflow-y-auto.p-7');
      expect(contentScrollContainer).not.toBeNull();
      expect(contentScrollContainer?.className).toContain('p-7');
      expect(contentScrollContainer?.className).not.toContain('p-6');

      const contentMaxW = contentScrollContainer?.querySelector('.max-w-4xl');
      expect(contentMaxW?.className).toContain('space-y-7');
      expect(contentMaxW?.className).not.toContain('space-y-6');
    });
  });
});
