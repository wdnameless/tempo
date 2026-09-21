import React from 'react';
import { Minus, X, Maximize2, Minimize2, Pin, PinOff, PictureInPicture2, Globe, RefreshCw } from 'lucide-react';
import { ThemeColors } from '../types';
import { WindowService } from '../services/window';

interface TitleBarProps {
  theme?: ThemeColors;
  isCompact: boolean;
  isPinned: boolean;
  onToggleCompact: () => void;
  onTogglePin: () => void;
  onToggleOverlay?: () => void;
  currentLang?: string;
  onToggleLang?: () => void;
  updateStatus?: 'idle' | 'checking' | 'available' | 'up_to_date';
  onCheckUpdate?: () => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isCompact,
  isPinned,
  onToggleCompact,
  onTogglePin,
  onToggleOverlay,
  currentLang,
  onToggleLang,
  updateStatus,
  onCheckUpdate,
}) => {
  return (
    <div
      data-tauri-drag-region
      onPointerDown={(e) => {
        // Only drag if clicking the background, not buttons
        if ((e.target as HTMLElement).closest('button')) return;
        WindowService.startDragging();
      }}
      className="w-full flex items-center justify-between px-4 py-2.5 select-none cursor-move transition-colors bg-black/60 backdrop-blur-md border-b border-white/5"
    >
      <div className="flex items-center space-x-1.5 cursor-pointer" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {!isCompact && (
          <div className="flex flex-col select-none">
            <span className="text-sm font-extrabold tracking-[0.2em] uppercase text-white font-sans leading-tight">
              WINTER
            </span>
            <div className="w-5 h-[2px] bg-white mt-0.5 rounded-full" />
          </div>
        )}
        {isCompact && (
          <div className="flex items-center space-x-1">
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCompact();
              }}
              title="Развернуть окно"
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <Maximize2 size={12} />
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleOverlay?.();
              }}
              title="Мини-оверлей поверх всех окон"
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <PictureInPicture2 size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        <div className="flex flex-col items-end mr-2 select-none leading-none opacity-60 hover:opacity-90 transition-opacity">
          <span className="text-[11px] font-mono tracking-widest font-bold text-white">IOIO</span>
          <span className="text-[9px] font-mono text-white/50 tracking-wider mt-0.5">V.0.0.31</span>
        </div>
        {/* Language switch RU/EN */}
        {onToggleLang && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLang();
            }}
            title="Сменить язык (RU / EN)"
            className="h-7 px-1.5 rounded-lg flex items-center justify-center space-x-1 bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <Globe size={11} />
            <span className="text-[10px] font-bold tracking-wider uppercase">
              {currentLang ?? 'RU'}
            </span>
          </button>
        )}

        {/* Check update button */}
        {onCheckUpdate && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCheckUpdate();
            }}
            title="Проверить обновления Tempo"
            className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <RefreshCw
              size={11}
              className={updateStatus === 'checking' ? 'animate-spin text-[var(--accent)]' : ''}
              style={{ color: updateStatus === 'up_to_date' ? '#22c55e' : undefined }}
            />
          </button>
        )}

        {!isCompact && (
          <>
            {/* Always on top toggle */}
            <button
              onClick={onTogglePin}
              title={isPinned ? 'Открепить поверх всех окон' : 'Закрепить поверх всех окон'}
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
              style={{ color: isPinned ? 'var(--text)' : undefined }}
            >
              {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>

            {/* Toggle Compact mode */}
            <button
              onClick={onToggleCompact}
              title="Свернуть в мини-виджет"
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <Minimize2 size={13} />
            </button>
          </>
        )}

        {/* Minimize (matches reference —) */}
        <button
          onClick={() => WindowService.minimize()}
          title="Свернуть"
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-95 transition-all text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <Minus size={15} strokeWidth={2.5} />
        </button>

        {/* Maximize / Restore to full screen */}
        <button
          onClick={() => WindowService.toggleMaximize()}
          title="Развернуть на весь экран"
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-95 transition-all text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <Maximize2 size={13} strokeWidth={2.2} />
        </button>
        {/* Close (matches reference ✕) */}
        <button
          onClick={async () => {
            await WindowService.close();
          }}
          title="Скрыть в трей (фоновая работа)"
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-red-500/80 hover:text-white active:scale-95 transition-all text-[var(--text-muted)]"
        >
          <X size={15} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};
