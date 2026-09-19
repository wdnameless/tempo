import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ShortcutsSection } from '../ShortcutsSection';
import { clearShortcuts, registerDefaultShortcuts, registerShortcut } from '../../services/shortcuts';

describe('ShortcutsSection component', () => {
  beforeEach(() => {
    clearShortcuts();
  });

  it('renders section title and empty container when no shortcuts are registered', () => {
    render(<ShortcutsSection />);
    expect(screen.getByText('Горячие клавиши')).toBeTruthy();
  });

  it('renders registered shortcuts dynamically from registry', () => {
    registerShortcut({
      id: 'custom-one',
      keys: ['⌘', 'K'],
      scope: 'app',
      group: 'general',
      description: 'Test Custom Spotlight',
      run: () => {},
    });

    render(<ShortcutsSection />);
    expect(screen.getByText('Test Custom Spotlight')).toBeTruthy();
    expect(screen.getByText('⌘')).toBeTruthy();
    expect(screen.getByText('K')).toBeTruthy();
  });

  it('renders default shortcuts with translations and groups', () => {
    registerDefaultShortcuts();

    render(<ShortcutsSection />);
    const cmdKeys = screen.getAllByText('⌘');
    expect(cmdKeys.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('K')).toBeTruthy();
    expect(screen.getByText('Быстрый поиск (Spotlight)')).toBeTruthy();
    expect(screen.getByText('Открыть задачи')).toBeTruthy();
  });
});
