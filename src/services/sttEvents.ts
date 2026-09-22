// src/services/sttEvents.ts
// Unified event subscription bridge between Tauri STT events and frontend components.

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { isTauri } from './platform';
import {
  type DownloadProgress,
  type DictationResult,
  type SttErrorCode,
  mapSttError,
} from './stt';

export type SttEvent =
  | { type: 'model-progress'; progress: DownloadProgress }
  | { type: 'model-complete'; modelId: string }
  | { type: 'model-failed'; modelId: string; error: string }
  | { type: 'models-updated' }
  | { type: 'dictation-started'; mode: string }
  | { type: 'dictation-stopped'; result: DictationResult }
  | { type: 'dictation-cancelled' }
  | { type: 'dictation-level'; level: number }
  | { type: 'speech-error'; code: SttErrorCode; message: string };

export type SttEventHandler = (e: SttEvent) => void;

let activeSessionId = 0;
let teardownListeners: (() => void) | null = null;
const subscribers = new Set<SttEventHandler>();

function setupTauriListeners(): void {
  const sessionId = ++activeSessionId;
  const unlistenFns: UnlistenFn[] = [];
  let isCancelled = false;

  const dispatch = (event: SttEvent) => {
    for (const handler of subscribers) {
      try {
        handler(event);
      } catch (err) {
        console.error('Error in STT event listener:', err);
      }
    }
  };

  const bind = <T>(eventName: string, transform: (payload: T) => SttEvent) => {
    void listen<T>(eventName, (e) => {
      if (!isCancelled && subscribers.size > 0) {
        dispatch(transform(e.payload));
      }
    }).then((unlisten) => {
      if (isCancelled || sessionId !== activeSessionId) {
        unlisten();
      } else {
        unlistenFns.push(unlisten);
      }
    });
  };

  bind<DownloadProgress>('stt://model-progress', (p) => ({
    type: 'model-progress',
    progress: p,
  }));

  bind<{ modelId?: string; model_id?: string }>('stt://model-complete', (p) => ({
    type: 'model-complete',
    modelId: p?.modelId ?? p?.model_id ?? '',
  }));

  bind<{ modelId?: string; model_id?: string; error?: string }>('stt://model-failed', (p) => ({
    type: 'model-failed',
    modelId: p?.modelId ?? p?.model_id ?? '',
    error: p?.error ?? '',
  }));

  bind<void>('stt://models-updated', () => ({
    type: 'models-updated',
  }));

  bind<{ mode?: string }>('stt://dictation-started', (p) => ({
    type: 'dictation-started',
    mode: p?.mode ?? 'insert',
  }));

  bind<DictationResult>('stt://dictation-stopped', (p) => ({
    type: 'dictation-stopped',
    result: p,
  }));

  bind<void>('stt://dictation-cancelled', () => ({
    type: 'dictation-cancelled',
  }));

  bind<{ level?: number } | number>('stt://dictation-level', (p) => ({
    type: 'dictation-level',
    level: typeof p === 'number' ? p : p?.level ?? 0,
  }));

  bind<{ code?: string; message?: string }>('stt://speech-error', (p) => ({
    type: 'speech-error',
    code: mapSttError(p?.code ?? p?.message ?? 'unknown').code,
    message: p?.message ?? (typeof p?.code === 'string' ? p.code : 'Speech recognition error'),
  }));

  teardownListeners = () => {
    isCancelled = true;
    for (const unlisten of unlistenFns) {
      try {
        unlisten();
      } catch {
        // Ignore unlisten errors during teardown
      }
    }
    unlistenFns.length = 0;
  };
}

/**
 * Subscribes to backend STT events.
 *
 * Multiplexes underlying Tauri listeners across all active subscribers to avoid leaks
 * when mounted multiple times. Returns a working unsubscribe function.
 * Is a safe no-op outside Tauri.
 */
export function onSttEvent(handler: SttEventHandler): () => void {
  if (!isTauri()) {
    return () => {};
  }

  subscribers.add(handler);
  if (subscribers.size === 1) {
    setupTauriListeners();
  }

  return () => {
    subscribers.delete(handler);
    if (subscribers.size === 0 && teardownListeners) {
      teardownListeners();
      teardownListeners = null;
    }
  };
}

/**
 * Resets internal event subscription state for unit testing.
 */
export function resetSttEventsForTesting(): void {
  if (teardownListeners) {
    teardownListeners();
    teardownListeners = null;
  }
  subscribers.clear();
  activeSessionId = 0;
}
