import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause, RotateCcw } from 'lucide-react';
import { ThemeColors, DynamicUIConfig, Direction, SessionRecord, ClockStyle } from '../types';
import { RadialDial } from './RadialDial';
import { QualityPrompt } from './QualityPrompt';
import { soundService } from '../services/sound';
import { TimerService, type TimerSnapshot, type TimerPhase, MAX_MINUTES, MIN_MINUTES } from '../services/timer';
import { MusicService } from '../services/music';
import { StoreService } from '../services/store';
import confetti from 'canvas-confetti';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from '../services/platform';

interface TimerProps {
  theme: ThemeColors;
  dynamicUi?: DynamicUIConfig;
  initialMinutes?: number;
  onFinish?: () => void;
  directions?: Direction[];
  onRateQuality?: (quality: number) => void;
  sessions?: SessionRecord[];
}

/**
 * Renders the backend countdown, flow, or block timer.
 *
 * The component holds no clock of its own: mount and unmount are free of
 * consequences, so switching sub-tabs no longer resets the timer or freezes
 * the overlay.
 */
export const Timer: React.FC<TimerProps> = ({
  theme,
  dynamicUi,
  initialMinutes,
  onFinish,
  directions,
  onRateQuality,
  sessions,
}) => {
  const [state, setState] = useState<TimerSnapshot | null>(null);
  /** Progress the user is dragging on the dial; null when not dragging. */
  const [dragging, setDragging] = useState<number | null>(null);
  const [clockStyle, setClockStyle] = useState<ClockStyle>(() =>
    StoreService.getPreference<ClockStyle>('alarmer_clock_style', 'digital'),
  );

  const handleSelectClockStyle = (style: ClockStyle) => {
    soundService.playUiClick();
    setClockStyle(style);
    StoreService.setPreference('alarmer_clock_style', style);
  };
  /** Showing the quality prompt after a focus phase finishes in block mode. */
  const [showQualityPrompt, setShowQualityPrompt] = useState(false);
  const [promptDirectionName, setPromptDirectionName] = useState<string | undefined>(undefined);

  // Track previous phase and mode to detect focus -> rest transitions
  const prevPhaseRef = useRef<TimerPhase | undefined>(undefined);
  const prevModeRef = useRef<string | undefined>(undefined);
  const prevStateRef = useRef<TimerSnapshot | null>(null);

  // Adopt the backend state on mount, then follow its broadcast.
  useEffect(() => {
    let active = true;

    // Restore the arming mode, which is a user preference rather than a
    // property of any one countdown.
    const savedMode = StoreService.getPreference<string>('alarmer_timer_mode', 'countdown');
    if (savedMode === 'flow' || savedMode === 'countdown' || savedMode === 'block') {
      void TimerService.setMode(savedMode);
    }

    void TimerService.getState().then((initial) => {
      if (active) {
        setState(initial);
        prevPhaseRef.current = initial.phase;
        prevModeRef.current = initial.mode;
        prevStateRef.current = initial;
      }
    });

    const unsubscribeTick = TimerService.subscribe((next) => {
      if (!active) return;
      setState(next);

      const prevPhase = prevPhaseRef.current;
      const prevMode = prevModeRef.current;

      // When in block mode, transition from focus -> rest triggers the quality prompt
      if (prevMode === 'block' && next.mode === 'block' && prevPhase === 'focus' && next.phase === 'rest') {
        const activeDir = directions?.find((d) => d.id === next.direction_id);
        setPromptDirectionName(activeDir?.name);
        setShowQualityPrompt(true);
      }

      // Music playback tracking in block mode:
      // Focus running -> MusicService.play(), else MusicService.stop()
      if (next.mode === 'block') {
        if (next.running && next.phase === 'focus') {
          void MusicService.play();
        } else {
          void MusicService.stop();
        }
      }

      prevPhaseRef.current = next.phase;
      prevModeRef.current = next.mode;
      prevStateRef.current = next;
    });

    // Also listen to timer session events directly, so the prompt still appears
    // when the phase change lands while this view is mid-render.
    const unsubscribeSession = TimerService.onSession((event) => {
      if (!active) return;
      if (event.phase === 'focus' && event.completed) {
        const activeDir = directions?.find((d) => d.id === event.direction_id);
        setPromptDirectionName(activeDir?.name);
        setShowQualityPrompt(true);
      }
    });

    return () => {
      active = false;
      unsubscribeTick?.();
      unsubscribeSession?.();
      void MusicService.stop();
    };
  }, [directions]);

  // An initial duration handed in from outside (e.g. "timer for 10 minutes" in
  // the chat) arms the backend and stops there.
  useEffect(() => {
    if (typeof initialMinutes === 'number' && Number.isFinite(initialMinutes)) {
      void TimerService.setDuration(Math.max(MIN_MINUTES, initialMinutes));
    }
  }, [initialMinutes]);

  // Ring locally when the backend reports zero, plus confetti for a finished
  // countdown. The backend raises the OS notification when the window is hidden.
  useEffect(() => {
    let unlistenDone: (() => void) | undefined;

    const setup = async () => {
      if (!isTauri()) return;
      unlistenDone = await listen('timer-finished', () => {
        soundService.playFinishAlarm();
        soundService.speak('Таймер завершен');
        void confetti({
          particleCount: 80,
          spread: 70,
          origin: { y: 0.6 },
          colors: [theme.accent, '#ffffff', theme.ringProgress],
        });
        onFinish?.();
      });
    };

    void setup();

    return () => {
      unlistenDone?.();
    };
  }, [onFinish, theme.accent, theme.ringProgress]);

  if (!state) return null;

  const {
    total_secs,
    remaining_secs,
    running,
    overtime,
    overtime_secs,
    mode,
    phase,
    block_index: blockIndex,
    direction_id: directionId,
  } = state;

  const isBlockMode = mode === 'block';
  const isFocusPhase = phase === 'focus';
  const isRestPhase = phase === 'rest';

  // Resolved active direction
  const activeDirection = directionId
    ? directions?.find((d) => d.id === directionId)
    : undefined;

  // Day's completed block count from sessions or blockIndex
  const currentSessions = sessions ?? [];
  const nowDay = new Date();
  const dayBlocksCompleted = currentSessions.filter((s) => {
    const d = new Date(s.startedAt);
    return (
      s.completed &&
      d.getFullYear() === nowDay.getFullYear() &&
      d.getMonth() === nowDay.getMonth() &&
      d.getDate() === nowDay.getDate()
    );
  }).length;
  const displayBlockCount = isBlockMode ? (blockIndex > 0 ? blockIndex : dayBlocksCompleted + 1) : 0;

  const toggleRun = () => {
    soundService.playUiClick();
    void TimerService.toggle();
  };

  const reset = () => {
    soundService.playUiClick();
    void TimerService.reset();
    void MusicService.stop();
  };

  const armMinutes = (minutes: number) => {
    soundService.playUiClick();
    void TimerService.setDuration(minutes);
  };

  const toggleMode = () => {
    soundService.playUiClick();
    const modes: ('countdown' | 'flow' | 'block')[] = ['countdown', 'flow', 'block'];
    const currentIdx = modes.indexOf(mode);
    const nextMode = modes[(currentIdx + 1) % modes.length];
    StoreService.setPreference('alarmer_timer_mode', nextMode);
    void TimerService.setMode(nextMode);
  };

  // Dial progress 0..1 over one hour, so 25 minutes is a little under half.
  const progress = Math.max(0, Math.min(1, remaining_secs / 3600));

  const formatSubDigital = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const formatPrimaryTime = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  /** Live preview while dragging; the backend is only told on release. */
  const handleProgressChange = (newProgress: number) => {
    if (!running && !isBlockMode) setDragging(newProgress);
  };

  // Dial release arms the duration and starts it — the gesture is the intent.
  const handleProgressCommit = (finalProgress: number) => {
    if (isBlockMode) return;
    const minutes = Math.max(
      MIN_MINUTES,
      Math.min(MAX_MINUTES, Math.round(finalProgress * 60)),
    );
    setDragging(null);
    armMinutes(minutes);
    void TimerService.start();
  };

  const handleRateQuality = (quality: number) => {
    setShowQualityPrompt(false);
    onRateQuality?.(quality);
  };

  const handleSkipQuality = () => {
    setShowQualityPrompt(false);
  };

  const btnRounding =
    dynamicUi?.layout?.buttonStyle === 'pill'
      ? 'rounded-full'
      : dynamicUi?.layout?.buttonStyle === 'square'
      ? 'rounded-md'
      : 'rounded-2xl';

  const displayedRemaining = dragging !== null ? Math.round(dragging * 60) : remaining_secs;
  const displayedProgress = dragging !== null ? dragging : progress;
  const totalMinutes = Math.max(MIN_MINUTES, Math.round(total_secs / 60));

  // Accent color overrides for block direction or rest phase
  const ringAccent = isBlockMode
    ? isRestPhase
      ? '#38bdf8' // Sky blue for rest
      : activeDirection?.color || theme.accent
    : theme.accent;

  return (
    <div className={`flex flex-col items-center w-full ${dynamicUi?.layout?.contentAlignment === 'compact' ? 'justify-center my-auto' : ''}`}>
      {/* Block mode header badge: Phase + Block counter + Direction */}
      {isBlockMode && (
        <div className="flex flex-col items-center gap-1.5 mb-2 animate-in fade-in duration-200">
          <div className="flex items-center gap-2">
            <span
              className="px-3 py-1 text-xs font-semibold rounded-full uppercase tracking-wider transition-colors"
              style={{
                backgroundColor: isRestPhase ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 122, 26, 0.15)',
                color: isRestPhase ? '#38bdf8' : (activeDirection?.color || theme.accent),
                border: `1px solid ${isRestPhase ? 'rgba(56, 189, 248, 0.3)' : 'rgba(255, 122, 26, 0.3)'}`,
              }}
            >
              {isFocusPhase ? 'Фокус' : 'Отдых'}
            </span>
            <span
              className="px-2.5 py-1 text-xs font-medium rounded-full text-zinc-400 bg-zinc-800/60 border border-zinc-700/50"
              title="Номер блока сегодня"
            >
              Блок {displayBlockCount}
            </span>
          </div>
          {activeDirection && (
            <div className="flex items-center gap-1.5 text-xs text-zinc-300 font-medium mt-0.5">
              <span
                className="w-2.5 h-2.5 rounded-full inline-block shrink-0"
                style={{ backgroundColor: activeDirection.color }}
              />
              <span>{activeDirection.name}</span>
            </div>
          )}
        </div>
      )}

      {/* Quality rating overlay prompt when a focus block completes */}
      {showQualityPrompt && isBlockMode && (
        <div className="w-full max-w-sm mb-4 px-2">
          <QualityPrompt
            theme={theme}
            directionName={promptDirectionName}
            onRate={handleRateQuality}
            onSkip={handleSkipQuality}
          />
        </div>
      )}

      <RadialDial
        theme={{
          ...theme,
          ringProgress: ringAccent,
          accent: ringAccent,
        }}
        progress={overtime ? 1 : displayedProgress}
        primaryText={overtime
          ? `+${Math.floor(overtime_secs / 60)}:${(overtime_secs % 60).toString().padStart(2, '0')}`
          : formatPrimaryTime(displayedRemaining)}
        secondaryText={overtime ? 'OVERTIME' : isBlockMode ? (isRestPhase ? 'ОТДЫХ' : 'ФОКУС') : formatSubDigital(displayedRemaining)}
        isInteractive={!running && !isBlockMode}
        onProgressChange={handleProgressChange}
        onProgressCommit={handleProgressCommit}
        showTicks={false}
        clockStyle={clockStyle}
        tickLength={dynamicUi?.dial?.tickLength ?? 'normal'}
        fontFamily={dynamicUi?.typography?.fontFamily ?? 'system-ui'}
        timeScale={dynamicUi?.typography?.timeScale ?? 1.0}
        size={dynamicUi?.dial?.size ?? 180}
        stylePreset={dynamicUi?.dial?.stylePreset ?? 'minimal'}
        glowIntensity={dynamicUi?.dial?.glowIntensity ?? 'none'}
      />

      {/* Clock style selector (Digital / Classic / Sand) */}
      <div className="flex items-center gap-1.5 mt-3 p-1 rounded-xl border bg-black/20" style={{ borderColor: theme.border }}>
        {(
          [
            { id: 'digital', label: 'Цифровые' },
            { id: 'classic', label: 'Классика' },
            { id: 'sand', label: 'Песочные' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => handleSelectClockStyle(item.id)}
            className={`px-2.5 py-1 text-xs font-medium rounded-lg transition-all ${
              clockStyle === item.id
                ? 'shadow-sm font-semibold'
                : 'opacity-60 hover:opacity-100'
            }`}
            style={{
              backgroundColor: clockStyle === item.id ? theme.accent : 'transparent',
              color: clockStyle === item.id ? '#000000' : theme.text,
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Arming minutes pill row - only in countdown mode */}
      {!isBlockMode && (
        <div className="flex items-center gap-2 mt-4">
          <button
            onClick={() => armMinutes(Math.max(MIN_MINUTES, totalMinutes - 5))}
            disabled={running || totalMinutes <= MIN_MINUTES}
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-zinc-800/60 hover:bg-zinc-700/60 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all text-zinc-300"
            aria-label="Уменьшить на 5 минут"
          >
            -
          </button>
          <div
            className="px-3 py-1 rounded-full text-sm font-semibold tracking-wide bg-zinc-800/40 border border-zinc-700/40"
            style={{ color: theme.text }}
          >
            {totalMinutes} мин
          </div>
          <button
            onClick={() => armMinutes(Math.min(MAX_MINUTES, totalMinutes + 5))}
            disabled={running || totalMinutes >= MAX_MINUTES}
            className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm bg-zinc-800/60 hover:bg-zinc-700/60 active:scale-95 disabled:opacity-30 disabled:pointer-events-none transition-all text-zinc-300"
            aria-label="Увеличить на 5 минут"
          >
            +
          </button>
        </div>
      )}

      {/* Primary controls */}
      <div className="flex items-center gap-4 mt-6">
        <button
          onClick={reset}
          className={`p-3 bg-zinc-800/60 hover:bg-zinc-700/60 active:scale-95 transition-all text-zinc-300 ${btnRounding}`}
          title="Сброс"
          aria-label="Сбросить таймер"
        >
          <RotateCcw className="w-5 h-5" />
        </button>

        <button
          onClick={toggleRun}
          className={`px-8 py-3 font-semibold text-white active:scale-95 transition-all shadow-lg flex items-center gap-2 ${btnRounding}`}
          style={{
            backgroundColor: ringAccent,
            boxShadow: `0 0 20px ${ringAccent}40`,
          }}
          aria-label={running ? 'Пауза' : 'Старт'}
        >
          {running ? (
            <>
              <Pause className="w-5 h-5 fill-current" />
              <span>Пауза</span>
            </>
          ) : (
            <>
              <Play className="w-5 h-5 fill-current" />
              <span>Старт</span>
            </>
          )}
        </button>

        <button
          onClick={toggleMode}
          className={`px-3 py-2 text-xs font-semibold tracking-wider transition-all border ${btnRounding} ${
            isBlockMode
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : mode === 'flow'
              ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
              : 'bg-zinc-800/40 text-zinc-400 border-zinc-700/40 hover:text-zinc-200'
          }`}
          title="Переключить режим таймера (Таймер / Flow / Блоки)"
        >
          {isBlockMode ? 'БЛОКИ' : mode === 'flow' ? 'FLOW' : 'ТАЙМЕР'}
        </button>
      </div>
    </div>
  );
};
