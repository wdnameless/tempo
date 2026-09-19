export type ShortcutScope = 'app' | 'global';

export interface ShortcutDef {
  id: string;
  keys: string[];
  scope: ShortcutScope;
  run: () => void;
  description?: string;
  group?: string;
}

// Registry map: id -> ShortcutDef
const registry: Map<string, ShortcutDef> = new Map();

/** Screens that render the registry (the shortcuts screen) subscribe here. */
const registryListeners = new Set<() => void>();

// Input elements tag name lookup table
const INPUT_TAGS: Record<string, true> = {
  INPUT: true,
  TEXTAREA: true,
  SELECT: true,
};

// Modifier keys that should not trigger shortcut evaluation by themselves
const MODIFIER_KEYS: Record<string, true> = {
  Control: true,
  Meta: true,
  Shift: true,
  Alt: true,
};

let isInstalled = false;
let globalListener: ((event: KeyboardEvent) => void) | null = null;

/**
 * Normalizes a key token to a canonical representation.
 */
function normalizeKey(key: string): string {
  const lower = key.toLowerCase().trim();
  switch (lower) {
    case 'cmd':
    case 'command':
    case 'meta':
    case '⌘':
      return 'meta';
    case 'ctrl':
    case 'control':
    case '⌃':
      return 'ctrl';
    case 'shift':
    case '⇧':
      return 'shift';
    case 'alt':
    case 'opt':
    case 'option':
    case '⌥':
      return 'alt';
    case 'esc':
      return 'escape';
    case 'space':
    case 'spacebar':
      return ' ';
    default:
      return lower;
  }
}

/**
 * Checks whether an event matches a shortcut's configured key combo.
 */
function matchesCombo(event: KeyboardEvent, keys: string[]): boolean {
  if (keys.length === 0) return false;

  let wantsMeta = false;
  let wantsCtrl = false;
  let wantsShift = false;
  let wantsAlt = false;
  let primaryKey = '';

  for (const rawKey of keys) {
    const normalized = normalizeKey(rawKey);
    if (normalized === 'meta') {
      wantsMeta = true;
    } else if (normalized === 'ctrl') {
      wantsCtrl = true;
    } else if (normalized === 'shift') {
      wantsShift = true;
    } else if (normalized === 'alt') {
      wantsAlt = true;
    } else {
      primaryKey = normalized;
    }
  }

  const metaPressed = Boolean(event.metaKey);
  const ctrlPressed = Boolean(event.ctrlKey);
  const shiftPressed = Boolean(event.shiftKey);
  const altPressed = Boolean(event.altKey);

  // Meta / Cmd handling
  if (wantsMeta) {
    // If wantsMeta, accept metaKey OR ctrlKey (on non-Mac platforms where Ctrl maps to Cmd)
    const metaMatches = metaPressed || (!wantsCtrl && ctrlPressed);
    if (!metaMatches) return false;
  } else {
    // If doesn't want meta, metaKey must not be pressed
    if (metaPressed) return false;
  }

  // Ctrl handling
  if (wantsCtrl) {
    if (!ctrlPressed) return false;
  } else if (!wantsMeta) {
    // If neither wantsCtrl nor wantsMeta, ctrlKey must not be pressed
    if (ctrlPressed) return false;
  }

  if (wantsShift !== shiftPressed) return false;
  if (wantsAlt !== altPressed) return false;

  if (!primaryKey) {
    return false;
  }

  // Primary key check (event.key)
  const eventKey = (event.key || '').toLowerCase();
  if (eventKey === primaryKey) return true;

  // Handle shift character equivalents (e.g., '?' vs '/')
  if (primaryKey === '?' && event.key === '?') return true;

  return false;
}

/**
 * Determines whether a shortcut has modifiers (Ctrl, Meta/Cmd, Alt).
 * Note: Shift alone might be part of typing characters (like '?'),
 * but Ctrl/Meta/Alt explicitly represent modified navigation/system combos.
 */
function isModifiedShortcut(keys: string[]): boolean {
  for (const rawKey of keys) {
    const normalized = normalizeKey(rawKey);
    if (normalized === 'meta' || normalized === 'ctrl' || normalized === 'alt') {
      return true;
    }
  }
  return false;
}

/**
 * Checks if the target element is an editable input/textarea/select or contenteditable.
 */
function isEditableElement(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }

  if (INPUT_TAGS[target.tagName]) {
    return true;
  }

  // Check if target or any ancestor is contentEditable
  let current: HTMLElement | null = target;
  while (current) {
    if (current.isContentEditable) {
      return true;
    }
    const ce = current.getAttribute('contenteditable');
    if (ce !== null && ce !== 'false') {
      return true;
    }
    current = current.parentElement;
  }

  return false;
}

/**
 * Registers a shortcut in the registry.
 * Returns an unregister function to remove this shortcut.
 */
export function registerShortcut(def: ShortcutDef): () => void {
  registry.set(def.id, def);
  notifyShortcutsChanged();
  return () => {
    // Only delete if the current registration is still this definition
    if (registry.get(def.id) === def) {
      registry.delete(def.id);
      notifyShortcutsChanged();
    }
  };
}

/**
 * Lists all registered shortcuts in insertion order.
 */
export function listShortcuts(): ShortcutDef[] {
  return Array.from(registry.values());
}

/**
 * Notifies every subscriber that the registry changed.
 *
 * The shortcuts screen renders from the registry rather than a hand-written
 * list, so it needs to hear about a registration made by a screen that mounted
 * later — otherwise the list is correct only until the next wave adds one.
 */
function notifyShortcutsChanged(): void {
  for (const listener of registryListeners) {
    try {
      listener();
    } catch (err) {
      console.error('Error in shortcut registry listener:', err);
    }
  }
}

/** Subscribes to registry changes. Returns an unsubscribe function. */
export function subscribeShortcuts(listener: () => void): () => void {
  registryListeners.add(listener);
  return () => {
    registryListeners.delete(listener);
  };
}

/**
 * Clears all registered shortcuts (useful for testing or full resets).
 */
export function clearShortcuts(): void {
  registry.clear();
}

/**
 * Global keydown event handler.
 */
function handleKeyDown(event: KeyboardEvent): void {
  // Ignore key repeat events
  if (event.repeat) {
    return;
  }

  // Ignore if pressed key is solely a modifier
  if (MODIFIER_KEYS[event.key]) {
    return;
  }

  const inEditable = isEditableElement(event.target);

  for (const def of registry.values()) {
    if (matchesCombo(event, def.keys)) {
      const hasModifier = isModifiedShortcut(def.keys);

      // Suppression rule: single-key shortcuts MUST NOT fire while in an input/textarea/contenteditable.
      // Modified combos (⌘K, ⌘S) still fire there.
      if (inEditable && !hasModifier) {
        continue;
      }

      event.preventDefault();
      event.stopPropagation();
      def.run();
      return;
    }
  }
}

/**
 * Dispatches a navigation request to the shell.
 */
function dispatchNavigate(screen: string): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: screen }));
  }
}

/**
 * Dispatches a toggle sidebar request to the shell.
 */
function dispatchToggleSidebar(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('tempo:toggle-sidebar'));
  }
}

/**
 * Registers the initial set of reference shortcuts whose screens/features exist today.
 */
export function registerDefaultShortcuts(): void {
  // 1. Spotlight Search (⌘K)
  registerShortcut({
    id: 'spotlight',
    keys: ['⌘', 'K'],
    scope: 'app',
    group: 'general',
    description: 'shortcutSpotlight',
    run: () => {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('tempo:spotlight'));
      }
    },
  });

  // 2. Toggle Sidebar (⌘S)
  registerShortcut({
    id: 'toggle-sidebar',
    keys: ['⌘', 'S'],
    scope: 'app',
    group: 'general',
    description: 'shortcutToggleSidebar',
    run: () => dispatchToggleSidebar(),
  });

  // 3. Daily Planning (⌘P)
  registerShortcut({
    id: 'daily-planning',
    keys: ['⌘', 'P'],
    scope: 'app',
    group: 'navigation',
    description: 'shortcutDailyPlanning',
    run: () => dispatchNavigate('daily-planning'),
  });

  // 4. Tasks (T)
  registerShortcut({
    id: 'nav-tasks',
    keys: ['T'],
    scope: 'app',
    group: 'navigation',
    description: 'shortcutNavTasks',
    run: () => dispatchNavigate('tasks'),
  });

  // 5. Notes (N)
  registerShortcut({
    id: 'nav-notes',
    keys: ['N'],
    scope: 'app',
    group: 'navigation',
    description: 'shortcutNavNotes',
    run: () => dispatchNavigate('notes'),
  });

  // 6. Stats (S)
  registerShortcut({
    id: 'nav-stats',
    keys: ['S'],
    scope: 'app',
    group: 'navigation',
    description: 'shortcutNavStats',
    run: () => dispatchNavigate('stats'),
  });

  // 7. Settings (?)
  registerShortcut({
    id: 'nav-settings',
    keys: ['?'],
    scope: 'app',
    group: 'navigation',
    description: 'shortcutNavSettings',
    run: () => dispatchNavigate('settings'),
  });
}

/**
 * Installs the shortcut layer listener on `window`.
 * Idempotent: multiple calls will not attach multiple listeners.
 * Returns a disposer function that removes the listener.
 */
export function installShortcutLayer(): () => void {
  if (!isInstalled && typeof window !== 'undefined') {
    // Installing the layer also seeds the registry: a caller that turns the
    // keyboard on gets a working keyboard, not an empty registry. A later wave
    // only has to call registerShortcut for its own screens.
    registerDefaultShortcuts();
    globalListener = handleKeyDown;
    window.addEventListener('keydown', globalListener, true);
    isInstalled = true;
  }
  return () => {
    if (isInstalled && typeof window !== 'undefined' && globalListener) {
      window.removeEventListener('keydown', globalListener, true);
      globalListener = null;
      isInstalled = false;
    }
  };
}
