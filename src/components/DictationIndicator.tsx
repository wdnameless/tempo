// src/components/DictationIndicator.tsx
// Speech to Text (R21): unobtrusive indicator appearing only while dictating.
// Shows live mic audio level, dictation mode, elapsed recording timer, cancel and stop buttons.
// Supports both floating 'pill' (default) and full 'overlay' (for mini-overlay window) variants.
// Must not steal focus from previous active window.

import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Square, Mic, X, Loader2 } from 'lucide-react';
import { dictationState, stopDictation, cancelDictation } from '../services/stt';

/** Shape of the dictation snapshot this indicator renders. Declared here, not in
 *  the service: a test that mocks the service would otherwise erase the type the
 *  component depends on, and a state updater would blow up on an undefined
 *  `prev` — which is exactly what it did. */
export interface DictationState {
  recording: boolean;
  level: number;
  since: number | null;
}
import { onSttEvent } from '../services/sttEvents';
import { loadSpeechConfig, subscribeSpeechConfig } from '../services/speechSettings';
import { I18nService } from '../services/i18n';

export function usePrefersReducedMotion(): boolean {
  const [reducedMotion, setReducedMotion] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
    const handler = (e: MediaQueryListEvent) => setReducedMotion(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return reducedMotion;
}
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
  const [isProcessing, setIsProcessing] = useState(false);
  const exitTimerRef = useRef<number | null>(null);
  const [overlayEnabled, setOverlayEnabled] = useState<boolean>(() => {
    try {
      return loadSpeechConfig().overlayEnabled;
    } catch {
      return true;
    }
  });
  const [waveEnabled, setWaveEnabled] = useState<boolean>(() => {
    try {
      const cfg = loadSpeechConfig();
      return cfg.dictationWave ?? true;
    } catch {
      return true;
    }
  });
  const [waveBarsCount, setWaveBarsCount] = useState<number>(() => {
    try {
      const cfg = loadSpeechConfig();
      return cfg.dictationWaveBars ?? 24;
    } catch {
      return 24;
    }
  });

  // Fade out state: keep rendering while exiting
  const [isExiting, setIsExiting] = useState(false);
  const prefersReducedMotion = usePrefersReducedMotion();
  const levelNormalized = Math.max(0, Math.min(1, state.level));
  const levelPercent = Math.round(levelNormalized * 100);

  // Calculate wave bar heights (must be called unconditionally before early returns)
  const bars = useMemo(() => {
    const count = Math.max(4, Math.min(64, waveBarsCount || 24));
    const mid = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) => {
      const distFromCenter = Math.abs(i - mid) / (mid || 1);
      const envelope = Math.cos(distFromCenter * (Math.PI / 2.2));
      const clampedEnvelope = Math.max(0.2, envelope);

      if (prefersReducedMotion) {
        const heightPct = Math.round(15 + levelNormalized * clampedEnvelope * 85);
        return { heightPct, opacity: 0.8 + 0.2 * clampedEnvelope };
      }

      const phase = Math.sin((i / count) * Math.PI * 4);
      const dynamicLevel = Math.max(0, levelNormalized + (levelNormalized > 0.05 ? phase * 0.15 * levelNormalized : 0));
      const heightPct = Math.round(Math.min(100, Math.max(12, dynamicLevel * clampedEnvelope * 100)));
      const opacity = 0.5 + 0.5 * clampedEnvelope;
      return { heightPct, opacity };
    });
  }, [waveBarsCount, levelNormalized, prefersReducedMotion]);
  const t = I18nService.t();
  // Track overlayEnabled preference
  useEffect(() => {
    try {
      return subscribeSpeechConfig((cfg) => {
        setOverlayEnabled(cfg.overlayEnabled);
        if (typeof cfg.dictationWave === 'boolean') {
          setWaveEnabled(cfg.dictationWave);
        }
        if (typeof cfg.dictationWaveBars === 'number') {
          setWaveBarsCount(cfg.dictationWaveBars);
        }
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

  // Auto-reset if processing hangs unexpectedly
  useEffect(() => {
    if (!isProcessing) return;
    const timeout = window.setTimeout(() => {
      setIsProcessing(false);
      setState({ recording: false, level: 0, since: null });
    }, 60000);
    return () => window.clearTimeout(timeout);
  }, [isProcessing]);

  // Primary: subscribe to real-time STT events
  useEffect(() => {
    const unsubscribe = onSttEvent((e) => {
      if (e.type === 'dictation-started') {
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        setIsExiting(false);
        setIsProcessing(false);
        if (e.mode) setMode(e.mode);
        const start = Date.now();
        setNow(start);
        setState((prev) => ({
          ...prev,
          recording: true,
          since: prev.since ?? start,
        }));
      } else if (e.type === 'dictation-level') {
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        setIsExiting(false);
        setIsProcessing(false);
        setState((prev) => ({
          ...prev,
          recording: true,
          level: e.level,
          since: prev.since ?? Date.now(),
        }));
      } else if (e.type === 'dictation-stopped' || e.type === 'dictation-cancelled' || e.type === 'speech-error') {
        if (exitTimerRef.current !== null) {
          window.clearTimeout(exitTimerRef.current);
          exitTimerRef.current = null;
        }
        if (prefersReducedMotion) {
          setIsProcessing(false);
          setState({ recording: false, level: 0, since: null });
          setIsExiting(false);
        } else {
          setIsExiting(true);
          exitTimerRef.current = window.setTimeout(() => {
            setIsProcessing(false);
            setState({ recording: false, level: 0, since: null });
            setIsExiting(false);
            exitTimerRef.current = null;
          }, 200);
        }
        if (e.type === 'dictation-stopped') {
          onStop?.();
        }
      }
    });

    return () => {
      unsubscribe();
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
        exitTimerRef.current = null;
      }
    };
  }, [onStop, prefersReducedMotion]);
  // Fallback: poll dictationState()
  useEffect(() => {
    let mounted = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const current = await dictationState();
        if (!mounted) return;
        // A backend reply that is missing its shape must not take the indicator
        // down with it: treat it as "no news" and keep what we already show.
        if (!current || typeof current !== 'object' || typeof current.recording !== 'boolean') {
          return;
        }
        if (current.recording) {
          if (exitTimerRef.current !== null) {
            window.clearTimeout(exitTimerRef.current);
            exitTimerRef.current = null;
          }
          setIsProcessing(false);
          setIsExiting(false);
          setState((prev) => {
            const since = current.since ?? (prev.recording ? prev.since ?? Date.now() : Date.now());
            return {
              recording: true,
              level: current.level,
              since,
            };
          });
        } else {
          // current.recording is false
          setState((prev) => {
            if (prev.recording) {
              // Transition from recording to processing
              setIsProcessing(true);
              setNow(Date.now());
              return {
                recording: false,
                level: 0,
                since: prev.since,
              };
            }
            return prev;
          });
        }
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

  // Gate indicator when disabled by user preference (governs both pill and overlay variants)
  if (!overlayEnabled) {
    return null;
  }

  // If not recording, not processing, and not exiting, render nothing
  if (!state.recording && !isProcessing && !isExiting) {
    return null;
  }
  const elapsedSeconds = state.since && now > 0
    ? Math.max(0, Math.floor((now - state.since) / 1000))
    : 0;
  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  const formattedTimer = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  const renderVisualizer = (isMini: boolean) => {
    if (waveEnabled) {
      return (
        <div
          data-testid="dictation-wave"
          className={`flex items-center justify-between gap-[2px] w-full ${isMini ? 'h-4' : 'h-6 px-1'}`}
        >
          {bars.map((bar, idx) => (
            <div
              key={idx}
              data-testid="dictation-wave-bar"
              data-index={idx}
              className="flex-1 rounded-full transition-all duration-75"
              style={{
                height: `${bar.heightPct}%`,
                minHeight: isMini ? '2px' : '3px',
                maxHeight: '100%',
                backgroundColor: 'var(--accent)',
                opacity: bar.opacity,
                boxShadow: bar.heightPct > (isMini ? 40 : 30) ? `0 0 ${isMini ? 4 : 6}px var(--accent)` : 'none',
              }}
            />
          ))}
        </div>
      );
    }

    return (
      <div
        className={`${isMini ? 'h-1.5' : 'h-2'} w-full rounded-full overflow-hidden`}
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
    );
  };
  const handleStop = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isStopping || isCancelling || isProcessing) return;

    setIsStopping(true);
    setIsProcessing(true);
    setState((prev) => ({ ...prev, recording: false, level: 0 }));
    setNow(Date.now());
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
        aria-label={isProcessing ? (t.dictationIndicatorTranscribing || 'Распознаём…') : (t.dictationIndicatorRecording || t.settingsSpeechHotkey)}
        className={`absolute inset-0 z-50 flex flex-col justify-between p-3 select-none backdrop-blur-md transition-all duration-200 ${
          isExiting ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
        }`}
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Top bar: Mode, pulsing dot, timer */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {isProcessing ? (
              <Loader2
                data-testid="dictation-processing-spinner"
                className={`w-3.5 h-3.5 text-[var(--accent)] ${prefersReducedMotion ? '' : 'animate-spin'}`}
              />
            ) : (
              <>
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                </span>
                <Mic className="w-3.5 h-3.5 text-[var(--accent)] animate-pulse" />
              </>
            )}
            <span
              data-testid="dictation-status-text"
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: 'var(--text)' }}
            >
              {isProcessing
                ? (t.dictationIndicatorTranscribing || 'Распознаём…')
                : (t.dictationIndicatorRecording || 'Recording')}
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

        {/* Middle: Live level wave / bar visualizer */}
        <div className="py-1">
          {renderVisualizer(false)}
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
            disabled={isStopping || isCancelling || isProcessing}
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
      aria-label={isProcessing ? (t.dictationIndicatorTranscribing || 'Распознаём…') : (t.dictationIndicatorRecording || t.settingsSpeechHotkey)}
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full border shadow-xl backdrop-blur-md transition-all duration-200 select-none pointer-events-auto ${
        isExiting ? 'opacity-0 scale-95 pointer-events-none' : 'opacity-100 scale-100'
      }`}
      style={{
        outline: 'none',
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        color: 'var(--text)',
      }}
    >
      <div className="flex items-center gap-2">
        {isProcessing ? (
          <Loader2
            data-testid="dictation-processing-spinner"
            className={`w-4 h-4 text-[var(--accent)] ${prefersReducedMotion ? '' : 'animate-spin'}`}
          />
        ) : (
          <>
            <span className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
            </span>
            <Mic className="w-4 h-4 text-[var(--accent)] animate-pulse" />
          </>
        )}
        <span
          data-testid="dictation-status-text"
          className="text-xs font-semibold tracking-wide uppercase"
          style={{ color: isProcessing ? 'var(--text)' : 'var(--text-muted)' }}
        >
          {isProcessing
            ? (t.dictationIndicatorTranscribing || 'Распознаём…')
            : t.settingsSpeechHotkey}
        </span>
      </div>

      {/* Live Level Bar / Wave Indicator & Timer */}
      <div className="flex flex-col min-w-[120px]">
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
        <div className="mt-1">
          {renderVisualizer(true)}
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
          disabled={isStopping || isCancelling || isProcessing}
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
