import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerDefaultCommands } from '../commands';
import { listCommands } from '../search';
import { TimerService } from '../timer';
import { StoreService } from '../store';
import { getPref, setPref, resetSettingsCacheForTesting } from '../settings';
vi.mock('../timer', () => ({
  TimerService: {
    toggle: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    skipPhase: vi.fn(),
  },
}));

vi.mock('../store', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../store')>();
  return {
    StoreService: {
      ...actual.StoreService,
      getPreference: vi.fn(actual.StoreService.getPreference.bind(actual.StoreService)),
      setPreference: vi.fn(actual.StoreService.setPreference.bind(actual.StoreService)),
    },
  };
});

describe('commands', () => {
  let unregister: (() => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    document.documentElement.removeAttribute('data-tempo-accent');
  });

  afterEach(() => {
    if (unregister) {
      unregister();
      unregister = null;
    }
  });

  it('populates listCommands() with default commands including the navigation set', () => {
    unregister = registerDefaultCommands();
    const commands = listCommands();

    const ids = commands.map((c) => c.id);
    expect(ids).toContain('nav:dashboard');
    expect(ids).toContain('nav:alarms');
    expect(ids).toContain('nav:tasks');
    expect(ids).toContain('nav:notes');
    expect(ids).toContain('nav:stats');
    expect(ids).toContain('nav:settings');
    expect(ids).toContain('shell:toggle-sidebar');
    expect(ids).toContain('appearance:cycle-accent');
    expect(ids).toContain('timer:toggle');
    expect(ids).toContain('timer:pause');
    expect(ids).toContain('timer:reset');
    expect(ids).toContain('timer:skip');
  });

  it('disposer removes all registered default commands', () => {
    unregister = registerDefaultCommands();
    expect(listCommands().length).toBeGreaterThan(0);

    unregister();
    unregister = null;
    expect(listCommands().length).toBe(0);
  });

  it('is idempotent: calling registerDefaultCommands twice leaves one entry per id', () => {
    const unregister1 = registerDefaultCommands();
    unregister1();
    registerDefaultCommands();
    const count1 = listCommands().length;

    const unregister2 = registerDefaultCommands();
    const count2 = listCommands().length;

    expect(count2).toBe(count1);

    const ids = listCommands().map((c) => c.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);

    unregister2();
    expect(listCommands().length).toBe(0);
  });

  it('navigates by dispatching tempo:navigate with screen id', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    unregister = registerDefaultCommands();

    const navTasks = listCommands().find((c) => c.id === 'nav:tasks');
    expect(navTasks).toBeDefined();

    navTasks?.run();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tempo:navigate',
        detail: 'tasks',
      }),
    );
  });

  it('toggles sidebar by dispatching tempo:toggle-sidebar', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    unregister = registerDefaultCommands();

    const sidebarCmd = listCommands().find((c) => c.id === 'shell:toggle-sidebar');
    expect(sidebarCmd).toBeDefined();

    sidebarCmd?.run();

    expect(dispatchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'tempo:toggle-sidebar',
      }),
    );
  });

  it('calls TimerService methods for timer commands', () => {
    unregister = registerDefaultCommands();

    const toggleCmd = listCommands().find((c) => c.id === 'timer:toggle');
    const pauseCmd = listCommands().find((c) => c.id === 'timer:pause');
    const resetCmd = listCommands().find((c) => c.id === 'timer:reset');
    const skipCmd = listCommands().find((c) => c.id === 'timer:skip');

    toggleCmd?.run();
    expect(TimerService.toggle).toHaveBeenCalledTimes(1);

    pauseCmd?.run();
    expect(TimerService.pause).toHaveBeenCalledTimes(1);

    resetCmd?.run();
    expect(TimerService.reset).toHaveBeenCalledTimes(1);

    skipCmd?.run();
    expect(TimerService.skipPhase).toHaveBeenCalledTimes(1);
  });

  it('cycles accent color and persists preference', async () => {
    // The real preference cache, not a stubbed reader: the command reads through
    // the fallback-aware loader, and a mock of the reader would hide that path.
    resetSettingsCacheForTesting();
    await setPref('tempo_accent', 'amber');

    unregister = registerDefaultCommands();

    const cycleCmd = listCommands().find((c) => c.id === 'appearance:cycle-accent');
    expect(cycleCmd).toBeDefined();

    await cycleCmd?.run();

    const accentAfter1 = getPref<string>('tempo_accent', '');
    expect(accentAfter1).not.toBe('amber');
    expect(StoreService.setPreference).toHaveBeenCalledWith('tempo_accent', accentAfter1);

    // Run again to verify it advances
    await cycleCmd?.run();
    expect(getPref<string>('tempo_accent', '')).not.toBe(accentAfter1);
  });
});
