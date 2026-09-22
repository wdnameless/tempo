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
