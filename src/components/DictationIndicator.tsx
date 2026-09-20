// src/components/DictationIndicator.tsx
// Wave 11 - Speech to Text (R24): unobtrusive pill appearing only while dictating.
// Shows live mic audio level, dictation mode, and stop button.
// Must not steal focus from previous active window.

import React, { useEffect, useState } from 'react';
import { Square, Mic } from 'lucide-react';
import { dictationState, stopDictation, type DictationState } from '../services/stt';
import { I18nService } from '../services/i18n';

export interface DictationIndicatorProps {
  /** Optional override for polling interval in ms (default 100ms) */
  pollIntervalMs?: number;
  /** Optional callback fired when dictation stops */
  onStop?: () => void;
  /** Mode display ('insert' | 'copy') */
  defaultMode?: 'insert' | 'copy';
}

export const DictationIndicator: React.FC<DictationIndicatorProps> = ({
  pollIntervalMs = 100,
  onStop,
  defaultMode = 'insert',
}) => {
  const [mode] = useState<'insert' | 'copy'>(defaultMode);
  const [state, setState] = useState<DictationState>({
    recording: false,
    level: 0,
    since: null,
  });
  const [isStopping, setIsStopping] = useState(false);
  const t = I18nService.t();

  useEffect(() => {
    let mounted = true;
    let timer: number | null = null;

    const poll = async () => {
      try {
        const current = await dictationState();
        if (!mounted) return;
        setState(current);
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
  // Audio level normalized between 0 and 1
  // If not recording, render nothing
  if (!state.recording) {
    return null;
  }

  // Audio level normalized between 0 and 1
  const levelNormalized = Math.max(0, Math.min(1, state.level));
  const levelPercent = Math.round(levelNormalized * 100);

  const handleStop = async (e: React.MouseEvent) => {
    // Prevent stealing focus
    e.preventDefault();
    e.stopPropagation();
    if (isStopping) return;

    setIsStopping(true);
    try {
      await stopDictation();
      onStop?.();
    } catch {
      // Error handled by caller / service
    } finally {
      setIsStopping(false);
    }
  };

  return (
    <div
      data-testid="dictation-indicator"
      role="status"
      aria-label={t.settingsSpeechHotkey}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-3 px-4 py-2.5 rounded-full border shadow-lg backdrop-blur-md transition-all duration-200 select-none pointer-events-auto bg-surface/95 border-primary/40 text-foreground"
      style={{ outline: 'none' }}
    >
      <div className="flex items-center gap-2">
        <span className="relative flex h-3 w-3">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 bg-red-400" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
        </span>
        <Mic className="w-4 h-4 text-primary animate-pulse" />
        <span className="text-xs font-semibold tracking-wide uppercase text-muted-foreground">
          {t.settingsSpeechHotkey}
        </span>
      </div>

      {/* Live Level Bar Indicator */}
      <div className="flex flex-col min-w-[70px]">
        <div className="flex items-center justify-between gap-2 text-xs font-medium">
          <span className="text-muted-foreground">{t.settingsSpeechHotkey}</span>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80 px-1 py-0.2 rounded bg-muted">
            {mode}
          </span>
        </div>
        <div className="h-1.5 w-full bg-muted/60 rounded-full overflow-hidden mt-1">
          <div
            data-testid="dictation-level-bar"
            className="h-full bg-primary transition-all duration-75 rounded-full"
            style={{ width: `${levelPercent}%` }}
          />
        </div>
      </div>

      {/* Stop button - tabIndex -1 so it doesn't participate in tab ring and steal focus */}
      <button
        type="button"
        tabIndex={-1}
        onClick={handleStop}
        disabled={isStopping}
        aria-label={t.recStop}
        title={t.recStop}
        className="p-1 rounded-full hover:bg-muted text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
      >
        <Square className="w-3.5 h-3.5 fill-current" />
      </button>
    </div>
  );
};
export default DictationIndicator;
