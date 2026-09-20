import { Bell, CheckSquare, FileText, List, Timer } from 'lucide-react';
import { registerSearchSource, type SearchHit } from './search';
import { registerDefaultCommands } from './commands';
import { soundService } from './sound';

/**
 * Registers everything the palette can act on.
 *
 * The registry is the single source of truth for the palette, so someone has to
 * fill it once at startup — a palette with an empty registry opens and shows
 * nothing, which is exactly what happened before this existed.
 *
 * Each source owns its own `open`: the wave that knows an entity also knows
 * where its results should lead. Nothing here knows what kinds exist.
 */

/** Asks the shell to switch screens; the shell already listens for this event. */
function navigateTo(screen: string): void {
  window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: screen }));
}

let installed = false;

export function installSearchRegistry(): () => void {
  // Idempotent: React StrictMode mounts effects twice in development, and a
  // second registration would show every result twice.
  if (installed) return () => {};
  installed = true;

  const disposers = [
    registerSearchSource({
      kind: 'alarm',
      labelKey: 'searchGroupAlarms',
      icon: Bell,
      open: (hit: SearchHit) => {
        soundService.playUiClick();
        navigateTo('alarms');
        // The alarm screen is rewritten in a later wave; until it can scroll to
        // a row, the hit is announced so that wave has something to hook into.
        window.dispatchEvent(new CustomEvent('tempo:reveal', { detail: hit }));
      },
    }),
    registerSearchSource({
      kind: 'session',
      labelKey: 'searchGroupSessions',
      icon: Timer,
      open: (hit: SearchHit) => {
        soundService.playUiClick();
        navigateTo('stats');
        window.dispatchEvent(new CustomEvent('tempo:reveal', { detail: hit }));
      },
    }),
    registerSearchSource({
      kind: 'task',
      labelKey: 'tabTasks',
      icon: CheckSquare,
      open: (hit: SearchHit) => {
        soundService.playUiClick();
        navigateTo('tasks');
        window.dispatchEvent(new CustomEvent('tempo:reveal', { detail: hit }));
      },
    }),
    registerSearchSource({
      kind: 'list',
      labelKey: 'navLists',
      icon: List,
      open: (hit: SearchHit) => {
        soundService.playUiClick();
        navigateTo('lists');
        window.dispatchEvent(new CustomEvent('tempo:reveal', { detail: hit }));
      },
    }),
    registerSearchSource({
      kind: 'note',
      labelKey: 'navNotes',
      icon: FileText,
      open: (hit: SearchHit) => {
        soundService.playUiClick();
        navigateTo('notes');
        window.dispatchEvent(new CustomEvent('tempo:reveal', { detail: hit }));
      },
    }),
    registerDefaultCommands(),
  ];

  return () => {
    for (const dispose of disposers) dispose();
    installed = false;
  };
}
