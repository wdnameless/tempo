import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  registerShortcut,
  listShortcuts,
  installShortcutLayer,
  clearShortcuts,
  registerDefaultShortcuts,
} from '../shortcuts';

describe('shortcuts service', () => {
  let uninstall: (() => void) | null = null;

  beforeEach(() => {
    clearShortcuts();
    if (uninstall) {
      uninstall();
      uninstall = null;
    }
  });

  /**
   * Installs the layer with an empty registry.
   *
   * `installShortcutLayer` seeds the reference shortcuts, which is right for the
   * app and wrong for these tests: each one registers its own handler for a key
   * the defaults also use, and the first registration wins.
   */
  function installIsolated(): () => void {
    const dispose = installShortcutLayer();
    clearShortcuts();
    return dispose;
  }

  afterEach(() => {
    if (uninstall) {
      uninstall();
      uninstall = null;
    }
    clearShortcuts();
  });

  it('registers and unregisters shortcuts in listShortcuts()', () => {
    expect(listShortcuts()).toHaveLength(0);

    const runA = vi.fn();
    const unregisterA = registerShortcut({
      id: 'test-a',
      keys: ['A'],
      scope: 'app',
      run: runA,
    });

    expect(listShortcuts()).toHaveLength(1);
    expect(listShortcuts()[0].id).toBe('test-a');

    const runB = vi.fn();
    const unregisterB = registerShortcut({
      id: 'test-b',
      keys: ['B'],
      scope: 'app',
      run: runB,
    });

    expect(listShortcuts()).toHaveLength(2);

    unregisterA();
    expect(listShortcuts()).toHaveLength(1);
    expect(listShortcuts()[0].id).toBe('test-b');

    unregisterB();
    expect(listShortcuts()).toHaveLength(0);
  });

  it('fires a single-key shortcut on document.body', () => {
    uninstall = installIsolated();

    const runT = vi.fn();
    registerShortcut({
      id: 'task-test',
      keys: ['T'],
      scope: 'app',
      run: runT,
    });

    const event = new KeyboardEvent('keydown', {
      key: 't',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    expect(runT).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('does NOT fire a single-key shortcut when the event target is an input', () => {
    uninstall = installIsolated();

    const runT = vi.fn();
    registerShortcut({
      id: 'task-test',
      keys: ['T'],
      scope: 'app',
      run: runT,
    });

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', {
      key: 't',
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(runT).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(input);
  });

  it('does NOT fire a single-key shortcut when the event target is a textarea', () => {
    uninstall = installIsolated();

    const runN = vi.fn();
    registerShortcut({
      id: 'note-test',
      keys: ['N'],
      scope: 'app',
      run: runN,
    });

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const event = new KeyboardEvent('keydown', {
      key: 'n',
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(runN).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(textarea);
  });

  it('does NOT fire a single-key shortcut when inside contenteditable', () => {
    uninstall = installIsolated();

    const runD = vi.fn();
    registerShortcut({
      id: 'drawing-test',
      keys: ['D'],
      scope: 'app',
      run: runD,
    });

    const editableDiv = document.createElement('div');
    editableDiv.setAttribute('contenteditable', 'true');
    const spanInside = document.createElement('span');
    editableDiv.appendChild(spanInside);
    document.body.appendChild(editableDiv);

    const event = new KeyboardEvent('keydown', {
      key: 'd',
      bubbles: true,
      cancelable: true,
    });
    spanInside.dispatchEvent(event);

    expect(runD).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);

    document.body.removeChild(editableDiv);
  });

  it('fires a ⌘-combo shortcut even from an input', () => {
    uninstall = installIsolated();

    const runCmdK = vi.fn();
    registerShortcut({
      id: 'spotlight-test',
      keys: ['⌘', 'K'],
      scope: 'app',
      run: runCmdK,
    });

    const input = document.createElement('input');
    document.body.appendChild(input);

    const event = new KeyboardEvent('keydown', {
      key: 'k',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    input.dispatchEvent(event);

    expect(runCmdK).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    document.body.removeChild(input);
  });

  it('fires a Ctrl-combo shortcut even from an input when requested with Cmd', () => {
    uninstall = installIsolated();

    const runCmdS = vi.fn();
    registerShortcut({
      id: 'save-test',
      keys: ['Cmd', 'S'],
      scope: 'app',
      run: runCmdS,
    });

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    const event = new KeyboardEvent('keydown', {
      key: 's',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    textarea.dispatchEvent(event);

    expect(runCmdS).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);

    document.body.removeChild(textarea);
  });

  it('does NOT fire on key repeat', () => {
    uninstall = installIsolated();

    const runT = vi.fn();
    registerShortcut({
      id: 'task-test',
      keys: ['T'],
      scope: 'app',
      run: runT,
    });

    const repeatEvent = new KeyboardEvent('keydown', {
      key: 't',
      repeat: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(repeatEvent);

    expect(runT).not.toHaveBeenCalled();
  });

  it('does NOT fire on modifier-only keystrokes', () => {
    uninstall = installIsolated();

    const runAny = vi.fn();
    registerShortcut({
      id: 'cmd-k',
      keys: ['⌘', 'K'],
      scope: 'app',
      run: runAny,
    });

    const metaOnlyEvent = new KeyboardEvent('keydown', {
      key: 'Meta',
      metaKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(metaOnlyEvent);

    expect(runAny).not.toHaveBeenCalled();
  });

  it('is idempotent when calling installShortcutLayer twice', () => {
    const runT = vi.fn();
    registerShortcut({
      id: 'task-test',
      keys: ['T'],
      scope: 'app',
      run: runT,
    });

    const disposer1 = installShortcutLayer();
    const disposer2 = installShortcutLayer();

    const event = new KeyboardEvent('keydown', {
      key: 't',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(event);

    // Only fired once, not twice!
    expect(runT).toHaveBeenCalledTimes(1);

    // Disposer removes listener
    disposer2();
    disposer1();

    const eventAfterDispose = new KeyboardEvent('keydown', {
      key: 't',
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(eventAfterDispose);

    expect(runT).toHaveBeenCalledTimes(1);

    uninstall = null;
  });

  it('registers default shortcuts via registerDefaultShortcuts()', () => {
    expect(listShortcuts()).toHaveLength(0);

    registerDefaultShortcuts();

    const shortcuts = listShortcuts();
    expect(shortcuts.length).toBeGreaterThanOrEqual(6);

    const ids = shortcuts.map((s) => s.id);
    expect(ids).toContain('spotlight');
    expect(ids).toContain('toggle-sidebar');
    expect(ids).toContain('daily-planning');
    expect(ids).toContain('nav-tasks');
    expect(ids).toContain('nav-notes');
    expect(ids).toContain('nav-stats');
    expect(ids).toContain('nav-settings');
  });

  it('dispatches custom events for default navigation and actions', () => {
    // This test exercises the reference shortcuts, so it installs the layer the
    // way the app does — with the defaults in place.
    uninstall = installShortcutLayer();

    const navigateSpy = vi.fn();
    const toggleSidebarSpy = vi.fn();
    const spotlightSpy = vi.fn();

    window.addEventListener('tempo:navigate', navigateSpy);
    window.addEventListener('tempo:toggle-sidebar', toggleSidebarSpy);
    window.addEventListener('tempo:spotlight', spotlightSpy);

    // 1. T -> navigate tasks
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 't', bubbles: true, cancelable: true }));
    expect(navigateSpy).toHaveBeenCalledWith(expect.objectContaining({ detail: 'tasks' }));

    // 2. ⌘S -> toggle sidebar
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', metaKey: true, bubbles: true, cancelable: true }));
    expect(toggleSidebarSpy).toHaveBeenCalled();

    // 3. ⌘K -> spotlight
    document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true, cancelable: true }));
    expect(spotlightSpy).toHaveBeenCalled();

    window.removeEventListener('tempo:navigate', navigateSpy);
    window.removeEventListener('tempo:toggle-sidebar', toggleSidebarSpy);
    window.removeEventListener('tempo:spotlight', spotlightSpy);
  });
});
