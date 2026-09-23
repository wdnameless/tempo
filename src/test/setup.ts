import '@testing-library/dom';
import { vi } from 'vitest';

/**
 * Browser APIs jsdom does not implement.
 *
 * Component tests exercise real render/lifecycle behaviour, so the gaps that
 * jsdom leaves in the platform (canvas, media queries, observers, Tauri IPC)
 * are stubbed once here instead of in every suite.
 */

// canvas-confetti draws to a 2D context jsdom does not provide.
vi.mock('canvas-confetti', () => ({ default: vi.fn() }));
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: vi.fn(),
}));

if (!HTMLCanvasElement.prototype.getContext) {
  HTMLCanvasElement.prototype.getContext = (() => null) as never;
}

if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as never;
}

class NoopObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
  takeRecords(): [] {
    return [];
  }
}

if (!('ResizeObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).ResizeObserver = NoopObserver;
}
if (!('IntersectionObserver' in globalThis)) {
  (globalThis as Record<string, unknown>).IntersectionObserver = NoopObserver;
}

// jsdom has no media pipeline; audio playback must not throw during tests.
if (!HTMLMediaElement.prototype.play) {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
}
HTMLMediaElement.prototype.play = () => Promise.resolve();
HTMLMediaElement.prototype.pause = () => {};

// jsdom does not implement scrollIntoView, which the chat feed calls on every
// message. A no-op keeps those paths testable.
Element.prototype.scrollIntoView = () => {};

/**
 * Tauri runtime environment stub.
 *
 * The production app runs inside the Tauri webview shell where `isTauri()` is
 * always true. Tauri internals (invoke, callback transformation, event listening)
 * are stubbed here so tests run Tauri-shaped by default.
 */
let nextCallbackId = 1;
const tauriCallbacks = new Map<number, (data: unknown) => unknown>();

Object.defineProperty(window, '__TAURI_INTERNALS__', {
  value: {
    invoke: (cmd: string) => {
      if (cmd === 'plugin:event|listen') return Promise.resolve(nextCallbackId++);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(undefined);
      if (cmd === 'db_list') return Promise.resolve([]);
      return Promise.resolve(undefined);
    },
    transformCallback: (callback?: (data: unknown) => unknown, once = false) => {
      const id = nextCallbackId++;
      if (callback) {
        tauriCallbacks.set(id, (data: unknown) => {
          if (once) tauriCallbacks.delete(id);
          return callback(data);
        });
      }
      return id;
    },
    unregisterCallback: (id: number) => {
      tauriCallbacks.delete(id);
    },
    runCallback: (id: number, data: unknown) => {
      tauriCallbacks.get(id)?.(data);
    },
    convertFileSrc: (filePath: string) => filePath,
    callbacks: tauriCallbacks,
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { windowLabel: 'main', label: 'main' },
    },
  },
  writable: true,
  configurable: true,
});

Object.defineProperty(window, '__TAURI_EVENT_PLUGIN_INTERNALS__', {
  value: {
    unregisterListener: (_event: string, id: number) => {
      tauriCallbacks.delete(id);
    },
  },
  writable: true,
  configurable: true,
});

// Testing Library waits one second by default for `waitFor`/`findBy*`. Several
// suites render the whole application shell and then wait for a service chain to
// resolve; with v8 coverage instrumenting every module that second is not enough,
// and those tests failed only in the coverage run, never alone. Five seconds is
// still a ceiling — a genuinely hung render keeps failing.
import { configure } from '@testing-library/dom';
configure({ asyncUtilTimeout: 5000 });
