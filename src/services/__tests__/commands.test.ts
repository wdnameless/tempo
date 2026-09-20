import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { registerDefaultCommands } from '../commands';
import { listCommands } from '../search';
import { TimerService } from '../timer';
import { StoreService } from '../store';
vi.mock('../timer', () => ({
  TimerService: {
    toggle: vi.fn(),
    pause: vi.fn(),
    reset: vi.fn(),
    skipPhase: vi.fn(),
  },
}));

vi.mock('../store', () => ({
  StoreService: {
    getPreference: vi.fn(),
    setPreference: vi.fn().mockResolvedValue(undefined),
  },
}));

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
    let currentSaved: string = 'amber';
    vi.mocked(StoreService.getPreference).mockImplementation(<T>(key: string, defaultVal: T): T => {
      if (key === 'tempo_accent') return currentSaved as unknown as T;
      return defaultVal;
    });
    vi.mocked(StoreService.setPreference).mockImplementation(async <T>(key: string, val: T): Promise<void> => {
      if (key === 'tempo_accent' && typeof val === 'string') currentSaved = val;
    });

    unregister = registerDefaultCommands();

    const cycleCmd = listCommands().find((c) => c.id === 'appearance:cycle-accent');
    expect(cycleCmd).toBeDefined();

    // Default accent before cycle is amber
    await cycleCmd?.run();

    expect(currentSaved).not.toBe('amber');
    expect(StoreService.setPreference).toHaveBeenCalledWith('tempo_accent', currentSaved);

    const accentAfter1 = currentSaved;
    // Run again to verify it advances
    await cycleCmd?.run();
    expect(currentSaved).not.toBe(accentAfter1);
    expect(StoreService.setPreference).toHaveBeenCalledWith('tempo_accent', currentSaved);
  });
});
