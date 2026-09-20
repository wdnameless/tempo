import {
  LayoutDashboard,
  Bell,
  CheckSquare,
  FileText,
  BarChart2,
  Settings,
  PanelLeft,
  Play,
  Pause,
  RotateCcw,
  SkipForward,
  Palette,
} from 'lucide-react';
import { ACCENTS, applyAccent, type AccentId } from '../constants/design';
import { loadAccent } from './generalSettings';
import { StoreService } from './store';
import { TimerService } from './timer';
import { registerCommand, type Command } from './search';

/**
 * Screen identifiers supported by the shell's navigation handler.
 */
type ScreenId = 'dashboard' | 'alarms' | 'tasks' | 'notes' | 'stats' | 'settings';

function dispatchNavigate(screen: ScreenId): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: screen }));
  }
}

function dispatchToggleSidebar(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tempo:toggle-sidebar'));
  }
}

/**
 * Cycle through available accents, apply immediately, and persist to user preferences.
 */
async function cycleAccent(): Promise<void> {
  const currentAccent = loadAccent();

  const accentKeys = Object.keys(ACCENTS) as AccentId[];
  const currentIndex = accentKeys.indexOf(currentAccent);
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % accentKeys.length : 0;
  const nextAccent = accentKeys[nextIndex];

  applyAccent(nextAccent);
  await StoreService.setPreference('tempo_accent', nextAccent);
}

/**
 * Create list of default application commands.
 */
function createDefaultCommands(): Command[] {
  return [
    // Navigation commands
    {
      id: 'nav:dashboard',
      titleKey: 'navDashboard',
      icon: LayoutDashboard,
      run: () => dispatchNavigate('dashboard'),
    },
    {
      id: 'nav:alarms',
      titleKey: 'navAlarms',
      icon: Bell,
      run: () => dispatchNavigate('alarms'),
    },
    {
      id: 'nav:tasks',
      titleKey: 'navTasks',
      icon: CheckSquare,
      run: () => dispatchNavigate('tasks'),
    },
    {
      id: 'nav:notes',
      titleKey: 'navNotes',
      icon: FileText,
      run: () => dispatchNavigate('notes'),
    },
    {
      id: 'nav:stats',
      titleKey: 'navStats',
      icon: BarChart2,
      run: () => dispatchNavigate('stats'),
    },
    {
      id: 'nav:settings',
      titleKey: 'navSettings',
      icon: Settings,
      run: () => dispatchNavigate('settings'),
    },

    // Shell & appearance actions
    {
      id: 'shell:toggle-sidebar',
      titleKey: 'toggleSidebar',
      icon: PanelLeft,
      run: () => dispatchToggleSidebar(),
    },
    {
      id: 'appearance:cycle-accent',
      titleKey: 'changeAccent',
      icon: Palette,
      run: () => cycleAccent(),
    },

    // Timer actions
    {
      id: 'timer:toggle',
      titleKey: 'pomodoroStart',
      icon: Play,
      run: () => TimerService.toggle(),
    },
    {
      id: 'timer:pause',
      titleKey: 'pomodoroPause',
      icon: Pause,
      run: () => TimerService.pause(),
    },
    {
      id: 'timer:reset',
      titleKey: 'pomodoroReset',
      icon: RotateCcw,
      run: () => TimerService.reset(),
    },
    {
      id: 'timer:skip',
      titleKey: 'pomodoroSkip',
      icon: SkipForward,
      run: () => TimerService.skipPhase(),
    },
  ];
}

/**
 * Registry of disposers for default commands to ensure idempotency.
 * If called multiple times, previously registered default commands are unregistered first.
 */
let defaultDisposers: (() => void)[] = [];

/**
 * Registers default application commands into the command registry.
 * Idempotent: re-calling clears prior default registrations before re-adding.
 * Returns a disposer function that unregisters all default commands.
 */
export function registerDefaultCommands(): () => void {
  // Dispose prior default commands if any
  if (defaultDisposers.length > 0) {
    for (const dispose of defaultDisposers) {
      dispose();
    }
    defaultDisposers = [];
  }

  const commands = createDefaultCommands();
  for (const cmd of commands) {
    const dispose = registerCommand(cmd);
    defaultDisposers.push(dispose);
  }

  return () => {
    for (const dispose of defaultDisposers) {
      dispose();
    }
    defaultDisposers = [];
  };
}
