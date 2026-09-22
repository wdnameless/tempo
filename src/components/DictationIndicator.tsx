// src/components/DictationIndicator.tsx
// Speech to Text (R21): unobtrusive indicator appearing only while dictating.
// Shows live mic audio level, dictation mode, elapsed recording timer, cancel and stop buttons.
// Supports both floating 'pill' (default) and full 'overlay' (for mini-overlay window) variants.
// Must not steal focus from previous active window.

import React, { useEffect, useState } from 'react';
import { Square, Mic, X } from 'lucide-react';
import {
  dictationState,
  stopDictation,
  cancelDictation,
  type DictationState,
} from '../services/stt';
import { onSttEvent } from '../services/sttEvents';
import { loadSpeechConfig, subscribeSpeechConfig } from '../services/speechSettings';
import { I18nService } from '../services/i18n';

export interface DictationIndicatorProps {
  /** Optional override for polling interval in ms (default 100ms) */
  pollIntervalMs?: number;
  /** Optional callback fired when dictation stops */
  onStop?: () => void;
  /** Mode display ('insert' | 'copy') */
  defaultMode?: 'insert' | 'copy';
  /** Visual variant: 'pill' (floating pill, default) or 'overlay' (for mini-overlay window) */
  variant?: 'pill' | 'overlay';
}

export const DictationIndicator: React.FC<DictationIndicatorProps> = ({
  pollIntervalMs = 100,
  onStop,
  defaultMode = 'insert',
  variant = 'pill',
}) => {
  const [mode, setMode] = useState<'insert' | 'copy' | string>(defaultMode);
  const [state, setState] = useState<DictationState>({
    recording: false,
    level: 0,
    since: null,
  });
  const [now, setNow] = useState<number>(0);
  const [isStopping, setIsStopping] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [overlayEnabled, setOverlayEnabled] = useState<boolean>(() => {
    try {
      return loadSpeechConfig().overlayEnabled;
    } catch {
      return true;
    }
  });

  const t = I18nService.t();
  // Track overlayEnabled preference
  useEffect(() => {
    try {
      return subscribeSpeechConfig((cfg) => {
        setOverlayEnabled(cfg.overlayEnabled);
      });
    } catch {
      return undefined;
    }
  }, []);

  // Timer ticker while recording
  useEffect(() => {
    if (!state.recording) return;
    const interval = window.setInterval(() => {
      setNow(Date.now());
    }, 250);
    return () => window.clearInterval(interval);
  }, [state.recording]);

  // Primary: subscribe to real-time STT events
  useEffect(() => {
    const unsubscribe = onSttEvent((e) => {
      if (e.type === 'dictation-started') {
        if (e.mode) setMode(e.mode);
        setState((prev) => ({
          ...prev,
          recording: true,
          since: prev.since ?? Date.now(),
        }));
      } else if (e.type === 'dictation-level') {
        setState((prev) => ({
          ...prev,
          recording: true,
          level: e.level,
          since: prev.since ?? Date.now(),
        }));
      } else if (e.type === 'dictation-stopped') {
        setState({
          recording: false,
          level: 0,
          since: null,
        });
        onStop?.();
      } else if (e.type === 'dictation-cancelled') {
        setState({
          recording: false,
          level: 0,
          since: null,
        });
      }
    });

    return () => unsubscribe();
  }, [onStop]);

  // Fallback: poll dictationState()
  useEffect(() => {
    let mounted = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const current = await dictationState();
        if (!mounted) return;
        setState((prev) => {
          // If already marked recording by event, preserve since timestamp if poll lacks it
          const since = current.since ?? (current.recording ? prev.since ?? Date.now() : null);
          return {
            recording: current.recording,
            level: current.level,
            since,
          };
        });
      } catch {
        // Silently tolerate state polling failures
      } finally {
        if (mounted) {
          timer = window.setTimeout(poll, pollIntervalMs);
        }
      }
    };

    poll();

    return () => {
      mounted = false;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [pollIntervalMs]);

  // Gate overlay variant when disabled by user preference
  if (variant === 'overlay' && !overlayEnabled) {
    return null;
  }

  // If not recording, render nothing
  if (!state.recording) {
    return null;
  }

  // Calculate audio level & timer
  const levelNormalized = Math.max(0, Math.min(1, state.level));
  const levelPercent = Math.round(levelNormalized * 100);

  const elapsedSeconds = state.since && now > 0
    ? Math.max(0, Math.floor((now - state.since) / 1000))
    : 0;
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const formattedTimer = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;

  const handleStop = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isStopping || isCancelling) return;

    setIsStopping(true);
    try {
      await stopDictation();
      onStop?.();
    } catch {
      // Error handled by service
    } finally {
      setIsStopping(false);
    }
  };

  const handleCancel = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isStopping || isCancelling) return;

    setIsCancelling(true);
    try {
      await cancelDictation();
    } catch {
      // Error handled by service
    } finally {
      setIsCancelling(false);
    }
  };

  // OVERLAY VARIANT (renders inside the mini-overlay window)
  if (variant === 'overlay') {
    return (
      <div
        data-testid="dictation-indicator"
        data-variant="overlay"
        role="status"
        aria-label={t.dictationIndicatorRecording || t.settingsSpeechHotkey}
        className="absolute inset-0 z-50 flex flex-col justify-between p-3 select-none backdrop-blur-md transition-all duration-200"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Top bar: Mode, pulsing dot, timer */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
            </span>
            <Mic className="w-3.5 h-3.5 text-[var(--accent)] animate-pulse" />
            <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text)' }}>
              {t.dictationIndicatorRecording || 'Recording'}
            </span>
            <span
              data-testid="dictation-mode"
              className="text-[10px] uppercase font-mono px-1.5 py-0.2 rounded font-medium"
              style={{ backgroundColor: 'var(--elevated)', color: 'var(--text-muted)' }}
            >
              {mode}
            </span>
          </div>

          <div
            data-testid="dictation-timer"
            className="font-mono text-xs tabular-nums font-semibold"
            style={{ color: 'var(--text)' }}
          >
            {formattedTimer}
          </div>
        </div>

        {/* Middle: Live level visualizer */}
        <div className="py-1">
          <div
            className="h-2 w-full rounded-full overflow-hidden"
            style={{ backgroundColor: 'var(--elevated)' }}
          >
            <div
              data-testid="dictation-level-bar"
              className="h-full transition-all duration-75 rounded-full"
              style={{
                width: `${levelPercent}%`,
                backgroundColor: 'var(--accent)',
              }}
            />
          </div>
        </div>

        {/* Bottom controls: Cancel and Stop */}
        <div className="flex items-center justify-end gap-2 pt-1">
          <button
            type="button"
            tabIndex={-1}
            data-testid="dictation-cancel-button"
            onClick={handleCancel}
            disabled={isCancelling || isStopping}
            aria-label={t.dictationIndicatorCancel || 'Cancel'}
            title={t.dictationIndicatorCancel || 'Cancel'}
            className="flex items-center gap-1 px-2.5 py-1 rounded-[6px] text-xs font-medium border hover:bg-[var(--elevated)] transition-colors cursor-pointer text-red-400 hover:text-red-300"
            style={{ borderColor: 'var(--border)' }}
          >
            <X className="w-3.5 h-3.5" />
            <span>{t.dictationIndicatorCancel || 'Cancel'}</span>
          </button>

          <button
            type="button"
            tabIndex={-1}
            data-testid="dictation-stop-button"
            onClick={handleStop}
            disabled={isStopping || isCancelling}
            aria-label={t.dictationIndicatorStop || t.recStop}
            title={t.dictationIndicatorStop || t.recStop}
            className="flex items-center gap-1 px-3 py-1 rounded-[6px] text-xs font-medium transition-colors cursor-pointer shadow-sm"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--bg)',
            }}
          >
            <Square className="w-3 h-3 fill-current" />
            <span>{t.dictationIndicatorStop || 'Stop'}</span>
          </button>
        </div>
      </div>
    );
  }

  // PILL VARIANT (floating in main window bottom-right)
  return (
    <div
      data-testid="dictation-indicator"
      data-variant="pill"
      role="status"
      aria-label={t.dictationIndicatorRecording || t.settingsSpeechHotkey}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all duration-200 select-none pointer-events-auto"
      style={{
        outline: 'none',
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text)',
      }}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
        <Mic className="w-4 h-4 text-[var(--accent)] animate-pulse" />
        <span className="text-xs font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
          {t.settingsSpeechHotkey}
        </span>
      </div>

      {/* Live Level Bar Indicator & Timer */}
      <div className="flex flex-col min-w-[84px]">
        <div className="flex items-center justify-between gap-2 text-xs font-medium">
          <span
            data-testid="dictation-mode"
            className="text-[10px] uppercase tracking-wider px-1 py-0.2 rounded"
            style={{ backgroundColor: 'var(--elevated)', color: 'var(--text-muted)' }}
          >
            {mode}
          </span>
          <span
            data-testid="dictation-timer"
            className="text-[11px] font-mono tabular-nums"
            style={{ color: 'var(--text)' }}
          >
            {formattedTimer}
          </span>
        </div>
        <div
          className="h-1.5 w-full rounded-full overflow-hidden mt-1"
          style={{ backgroundColor: 'var(--elevated)' }}
        >
          <div
            data-testid="dictation-level-bar"
            className="h-full transition-all duration-75 rounded-full"
            style={{
              width: `${levelPercent}%`,
              backgroundColor: 'var(--accent)',
            }}
          />
        </div>
      </div>

      {/* Action buttons: Cancel and Stop */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          tabIndex={-1}
          data-testid="dictation-cancel-button"
          onClick={handleCancel}
          disabled={isCancelling || isStopping}
          aria-label={t.dictationIndicatorCancel || 'Cancel'}
          title={t.dictationIndicatorCancel || 'Cancel'}
          className="p-1 rounded-full hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-red-400 transition-colors disabled:opacity-50 cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>

        <button
          type="button"
          tabIndex={-1}
          data-testid="dictation-stop-button"
          onClick={handleStop}
          disabled={isStopping || isCancelling}
          aria-label={t.dictationIndicatorStop || t.recStop}
          title={t.dictationIndicatorStop || t.recStop}
          className="p-1 rounded-full hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors disabled:opacity-50 cursor-pointer"
        >
          <Square className="w-3.5 h-3.5 fill-current" />
        </button>
      </div>
    </div>
  );
};

export default DictationIndicator;
