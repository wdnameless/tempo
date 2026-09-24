// src/components/SttNotices.tsx
// Global toast/banner surface for Speech to Text notices and errors.
// Listens for speech-error, hotkey-error, vad-fallback, and model-failed.
// Floats above every screen without stealing focus from active external windows.
// Dismisses on click and automatically after 8 seconds.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { AlertCircle, AlertTriangle, X } from 'lucide-react';
import { onSttEvent, type SttEvent } from '../services/sttEvents';
import { sttErrorKey } from '../services/stt';
import { I18nService, type Translations } from '../services/i18n';

export interface SttNoticeItem {
  id: string;
  type: 'speech-error' | 'hotkey-error' | 'vad-fallback' | 'model-failed';
  text: string;
  severity: 'error' | 'warning';
}
type TimerHandle = number;


export interface SttNoticesProps {
  /** Auto-dismiss timeout in ms (default 8000ms / 8s) */
  autoDismissMs?: number;
}

function resolveNoticeText(e: SttEvent, t: Translations): { text: string; severity: 'error' | 'warning' } | null {
  switch (e.type) {
    case 'speech-error': {
      const key = sttErrorKey(e.code);
      // SAFETY: sttErrorKey maps to Translations keys which are all strings
      const translated = (t as unknown as Record<string, string>)[key];
      const text = translated || e.message || t.voiceActionFailed;
      return { text, severity: 'error' };
    }
    case 'hotkey-error': {
      let text: string;
      if (e.hotkey && e.message) {
        text = t.sttNoticeHotkeyErrorWithReason
          .replace('{hotkey}', e.hotkey)
          .replace('{reason}', e.message);
      } else if (e.hotkey) {
        text = t.sttNoticeHotkeyError.replace('{hotkey}', e.hotkey);
      } else if (e.message) {
        text = e.message;
      } else {
        text = t.sttErrorHotkeyInvalid;
      }
      return { text, severity: 'error' };
    }
    case 'vad-fallback': {
      const backend = e.backend || 'energy';
      const text = e.reason
        ? t.sttNoticeVadFallbackWithReason
            .replace('{backend}', backend)
            .replace('{reason}', e.reason)
        : t.sttNoticeVadFallback.replace('{backend}', backend);
      return { text, severity: 'warning' };
    }
    case 'model-failed': {
      const errorKey = sttErrorKey(e.error);
      // SAFETY: sttErrorKey maps to Translations keys which are all strings
      const reason = (t as unknown as Record<string, string>)[errorKey] || e.error;
      const text = reason
        ? t.sttNoticeModelFailedWithReason
            .replace('{modelId}', e.modelId)
            .replace('{reason}', reason)
        : t.sttNoticeModelFailed.replace('{modelId}', e.modelId);
      return { text, severity: 'error' };
    }
    default:
      // Unknown or non-notice event: ignore safely without crashing
      return null;
  }
}

export const SttNotices: React.FC<SttNoticesProps> = ({ autoDismissMs = 8000 }) => {
  const [notices, setNotices] = useState<SttNoticeItem[]>([]);
  const [t, setT] = useState<Translations>(() => I18nService.t());
  const timersRef = useRef<Map<string, TimerHandle>>(new Map());

  // Subscribe to locale changes
  useEffect(() => {
    return I18nService.subscribe(() => {
      setT(I18nService.t());
    });
  }, []);

  const dismiss = useCallback((id: string) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setNotices((prev) => prev.filter((n) => n.id !== id));
  }, []);

  // Subscribe to STT events
  useEffect(() => {
    const timers = timersRef.current;
    const unsubscribe = onSttEvent((e) => {
      const resolved = resolveNoticeText(e, I18nService.t());
      if (!resolved) return;

      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const newItem: SttNoticeItem = {
        id,
        type: e.type as SttNoticeItem['type'],
        text: resolved.text,
        severity: resolved.severity,
      };

      setNotices((prev) => [...prev, newItem]);

      if (autoDismissMs > 0) {
        const timer = setTimeout(() => {
          dismiss(id);
        }, autoDismissMs);
        timers.set(id, timer);
      }
    });

    return () => {
      unsubscribe();
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, [autoDismissMs, dismiss]);

  if (notices.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="stt-notices"
      role="region"
      aria-label="STT Notices"
      tabIndex={-1}
      className="fixed top-4 right-4 z-[9999] flex flex-col gap-2 max-w-sm w-full pointer-events-none select-none"
    >
      {notices.map((notice) => (
        <div
          key={notice.id}
          data-testid="stt-notice-item"
          data-type={notice.type}
          data-severity={notice.severity}
          role={notice.severity === 'error' ? 'alert' : 'status'}
          aria-live="polite"
          tabIndex={-1}
          onClick={() => dismiss(notice.id)}
          className={`pointer-events-auto flex items-start gap-3 p-3.5 rounded-xl border shadow-xl backdrop-blur-md cursor-pointer outline-none transition-all duration-150 active:scale-[0.99] ${
            notice.severity === 'error'
              ? 'bg-red-500/10 border-red-500/30 text-red-300'
              : 'bg-amber-500/10 border-amber-500/30 text-amber-300'
          }`}
        >
          {notice.severity === 'error' ? (
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-400" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-400" />
          )}

          <div className="flex-1 min-w-0 text-xs font-medium leading-relaxed break-words">
            {notice.text}
          </div>

          <button
            type="button"
            tabIndex={-1}
            data-testid="stt-notice-dismiss"
            aria-label={t.sttNoticeDismiss || 'Dismiss'}
            onClick={(ev) => {
              ev.stopPropagation();
              dismiss(notice.id);
            }}
            className="shrink-0 p-0.5 -mr-1 rounded hover:bg-white/10 opacity-70 hover:opacity-100 transition-opacity cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};

export default SttNotices;
