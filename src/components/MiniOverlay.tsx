import { X } from 'lucide-react';
import { WindowService } from '../services/window';
import { useEffect, useState } from 'react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { themeFromTokens } from '../constants/themes';
import { TimerService, type TimerSnapshot } from '../services/timer';

/**
 * Compact always-on-top overlay showing the remaining timer time.
 *
 * Rendered in its own transparent, frameless window (`?window=mini-overlay`).
 * It reads the backend timer, the same source the main window renders, so it
 * shows the real countdown even when the main window has never opened the Timer
 * sub-tab — and it stays correct when the main window is hidden.
 */
export function MiniOverlay() {
  const [state, setState] = useState<TimerSnapshot | null>(null);

  const theme = themeFromTokens('amber');

  useEffect(() => {
    let active = true;
    void TimerService.getState().then((initial) => {
      if (active) setState(initial);
    });
    const unsubscribe = TimerService.subscribe((next) => setState(next));
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);

  if (!state) return null;

  const remaining = state.overtime ? state.overtime_secs : state.remaining_secs;
  const progress = state.total_secs > 0
    ? Math.max(0, Math.min(1, remaining / state.total_secs))
    : 0;

  const mm = Math.floor(state.remaining_secs / 60).toString().padStart(2, '0');
  const ss = Math.floor(state.remaining_secs % 60).toString().padStart(2, '0');

  return (
    <div
      data-tauri-drag-region
      onPointerDown={(e) => {
        if ((e.target as HTMLElement).closest('button')) return;
        WindowService.startDragging();
      }}
      className="w-screen h-screen flex items-center justify-center select-none cursor-move"
      style={{ background: 'transparent' }}
    >
      <div
        className="relative flex flex-col items-center justify-center rounded-2xl border px-4 py-2 shadow-2xl group"
        style={{
          backgroundColor: `${theme.bg}E6`,
          borderColor: theme.border,
          backdropFilter: 'blur(12px)',
        }}
      >
        <button
          onClick={(e) => {
            e.stopPropagation();
            void getCurrentWindow().close();
          }}
          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-500/80 hover:bg-red-500 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md z-50 cursor-pointer"
          title="Закрыть виджет"
        >
          <X size={11} />
        </button>
        {/* Hairline progress rail */}
        <div
          className="absolute left-2 right-2 bottom-1.5 h-[2px] rounded-full overflow-hidden"
          style={{ backgroundColor: theme.ringTrack }}
        >
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${progress * 100}%`, backgroundColor: theme.accent }}
          />
        </div>

        <span
          className="text-2xl font-mono font-bold tabular-nums leading-none"
          style={{ color: theme.text }}
        >
          {state.overtime ? `+${mm}:${ss}` : `${mm}:${ss}`}
        </span>

        <span className="text-[9px] uppercase tracking-widest mt-1" style={{ color: theme.subtext }}>
          {state.overtime ? 'поток' : state.running ? 'идёт' : 'пауза'}
        </span>
      </div>
    </div>
  );
}

/** Closes the overlay window when the user double-clicks it. */
export function useOverlayDismiss() {
  useEffect(() => {
    const handler = () => {
      void getCurrentWindow().close();
    };
    window.addEventListener('dblclick', handler);
    return () => window.removeEventListener('dblclick', handler);
  }, []);
}
