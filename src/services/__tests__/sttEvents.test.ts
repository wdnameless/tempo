import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as eventApi from '@tauri-apps/api/event';
import { onSttEvent, resetSttEventsForTesting, type SttEvent } from '../sttEvents';

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(),
}));

describe('sttEvents service', () => {
  const registeredListeners = new Map<string, (e: { payload: unknown }) => void>();

  beforeEach(() => {
    resetSttEventsForTesting();
    registeredListeners.clear();
    vi.clearAllMocks();

    // Mock Tauri environment
    const tauriWindow = window as unknown as Record<string, unknown>;
    tauriWindow.__TAURI_INTERNALS__ = {};
    vi.mocked(eventApi.listen).mockImplementation(async (eventName, handler) => {
      registeredListeners.set(eventName, handler as (e: { payload: unknown }) => void);
      return () => {
        registeredListeners.delete(eventName);
      };
    });
  });

  afterEach(() => {
    resetSttEventsForTesting();
    const tauriWindow = window as unknown as Record<string, unknown>;
    delete tauriWindow.__TAURI_INTERNALS__;
  });

  it('subscribes to stt://hotkey-error and forwards typed event', async () => {
    const received: SttEvent[] = [];
    const unsub = onSttEvent((e) => received.push(e));

    // Wait microtask for listen promises to resolve
    await Promise.resolve();

    const handler = registeredListeners.get('stt://hotkey-error');
    expect(handler).toBeDefined();

    handler?.({
      payload: { hotkey: 'Ctrl+Shift+D', message: 'Shortcut already taken' },
    });

    expect(received).toEqual([
      {
        type: 'hotkey-error',
        hotkey: 'Ctrl+Shift+D',
        message: 'Shortcut already taken',
      },
    ]);

    unsub();
  });

  it('subscribes to stt://vad-fallback and forwards typed event', async () => {
    const received: SttEvent[] = [];
    const unsub = onSttEvent((e) => received.push(e));

    await Promise.resolve();

    const handler = registeredListeners.get('stt://vad-fallback');
    expect(handler).toBeDefined();

    handler?.({
      payload: { backend: 'energy', reason: 'Silero model failed to load' },
    });

    expect(received).toEqual([
      {
        type: 'vad-fallback',
        backend: 'energy',
        reason: 'Silero model failed to load',
      },
    ]);

    unsub();
  });

  it('forwards default values when payload fields are missing', async () => {
    const received: SttEvent[] = [];
    const unsub = onSttEvent((e) => received.push(e));

    await Promise.resolve();

    registeredListeners.get('stt://hotkey-error')?.({ payload: {} });
    registeredListeners.get('stt://vad-fallback')?.({ payload: {} });

    expect(received).toEqual([
      {
        type: 'hotkey-error',
        hotkey: '',
        message: 'Hotkey registration failed',
      },
      {
        type: 'vad-fallback',
        backend: 'energy',
        reason: 'VAD fallback',
      },
    ]);

    unsub();
  });
});
