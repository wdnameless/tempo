import React, { useState, useEffect, useRef } from 'react';
import { Minus, X, Maximize2, Minimize2, Pin, PinOff, PictureInPicture2, Globe, RefreshCw, Download, RotateCw, AlertCircle } from 'lucide-react';
import type { ThemeColors } from '../types';
import { WindowService } from '../services/window';
import { currentVersion, checkForUpdate, installUpdate, type UpdateInfo } from '../services/update';
import { I18nService } from '../services/i18n';

export type UpdateButtonState =
  | { stage: 'idle' }
  | { stage: 'checking' }
  | { stage: 'up_to_date' }
  | { stage: 'available'; info: UpdateInfo }
  | { stage: 'downloading'; info: UpdateInfo; percent: number }
  | { stage: 'ready'; info: UpdateInfo }
  | { stage: 'failed' };

export interface TitleBarProps {
  theme?: ThemeColors;
  isCompact: boolean;
  isPinned: boolean;
  onToggleCompact: () => void;
  onTogglePin: () => void;
  onToggleOverlay?: () => void;
  currentLang?: string;
  onToggleLang?: () => void;
  initialUpdateInfo?: UpdateInfo | null;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  isCompact,
  isPinned,
  onToggleCompact,
  onTogglePin,
  onToggleOverlay,
  currentLang,
  onToggleLang,
  initialUpdateInfo,
}) => {
  const [version, setVersion] = useState<string | null>(null);
  const [updateState, setUpdateState] = useState<UpdateButtonState>({ stage: 'idle' });
  const resetTimerRef = useRef<number | undefined>(undefined);

  const t = I18nService.t();

  useEffect(() => {
    let active = true;
    void currentVersion()
      .then((v) => {
        if (!active) return;
        const trimmed = v?.trim();
        if (trimmed && trimmed !== 'dev' && trimmed !== 'unknown') {
          setVersion(trimmed);
        }
      })
      .catch(() => {
        // Fallback: show nothing if resolution fails
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (resetTimerRef.current) {
        window.clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  // An update reported from outside counts as available until the user acts on
  // it. Derived rather than copied into state: an effect that mirrors a prop is
  // both a lint error here and a source of stale-state bugs.
  const effectiveUpdateState: UpdateButtonState =
    updateState.stage === 'idle' && initialUpdateInfo
      ? { stage: 'available', info: initialUpdateInfo }
      : updateState;

  const triggerFailed = () => {
    setUpdateState({ stage: 'failed' });
    resetTimerRef.current = window.setTimeout(() => {
      setUpdateState({ stage: 'idle' });
    }, 3000);
  };

  const handleUpdateClick = async (e: React.MouseEvent) => {
    e.stopPropagation();

    if (effectiveUpdateState.stage === 'idle') {
      setUpdateState({ stage: 'checking' });
      try {
        const res = await checkForUpdate();
        if (res.status === 'update') {
          setUpdateState({ stage: 'available', info: res.info });
        } else if (res.status === 'current') {
          setUpdateState({ stage: 'up_to_date' });
          resetTimerRef.current = window.setTimeout(() => {
            setUpdateState({ stage: 'idle' });
          }, 3000);
        } else {
          triggerFailed();
        }
      } catch {
        triggerFailed();
      }
      return;
    }

    if (effectiveUpdateState.stage === 'available') {
      const info = effectiveUpdateState.info;
      setUpdateState({ stage: 'downloading', info, percent: 0 });
      try {
        const result = await installUpdate(info, (downloaded, total) => {
          const pct = total > 0 ? Math.min(100, Math.round((downloaded / total) * 100)) : 0;
          setUpdateState({ stage: 'downloading', info, percent: pct });
        });
        if (result && !result.ok) {
          triggerFailed();
        } else {
          setUpdateState({ stage: 'ready', info });
        }
      } catch {
        triggerFailed();
      }
      return;
    }

    if (effectiveUpdateState.stage === 'ready') {
      try {
        await installUpdate(effectiveUpdateState.info);
      } catch {
        triggerFailed();
      }
    }
  };

  const displayVersion = version
    ? version.startsWith('v') || version.startsWith('V')
      ? version
      : `v${version}`
    : null;

  const renderUpdateButton = () => {
    switch (effectiveUpdateState.stage) {
      case 'idle':
        return (
          <button
            type="button"
            data-testid="update-button"
            onClick={handleUpdateClick}
            title={t.updateIdle}
            aria-label={t.updateIdle}
            className="h-6 px-2 rounded-lg flex items-center space-x-1.5 bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors text-[10px] font-medium"
          >
            <RefreshCw size={11} />
            <span>{t.updateIdle}</span>
          </button>
        );
      case 'checking':
        return (
          <button
            type="button"
            data-testid="update-button"
            disabled
            title={t.updateChecking}
            aria-label={t.updateChecking}
            className="h-6 px-2 rounded-lg flex items-center space-x-1.5 bg-white/5 text-[var(--text-muted)] opacity-80 cursor-wait text-[10px] font-medium"
          >
            <RefreshCw size={11} className="animate-spin text-[var(--accent)]" />
            <span>{t.updateChecking}</span>
          </button>
        );
      case 'up_to_date':
        return (
          <button
            type="button"
            data-testid="update-button"
            disabled
            title={t.updateUpToDate}
            aria-label={t.updateUpToDate}
            className="h-6 px-2 rounded-lg flex items-center space-x-1.5 bg-white/5 text-emerald-400 text-[10px] font-medium"
          >
            <RefreshCw size={11} />
            <span>{t.updateUpToDate}</span>
          </button>
        );
      case 'available': {
        const label = t.updateAvailable.replace('{version}', effectiveUpdateState.info.version);
        return (
          <button
            type="button"
            data-testid="update-button"
            onClick={handleUpdateClick}
            title={label}
            aria-label={label}
            className="h-6 px-2.5 rounded-lg flex items-center space-x-1.5 bg-[var(--accent)] text-black font-semibold hover:brightness-110 active:scale-95 transition-all text-[10px]"
          >
            <Download size={11} />
            <span>{label}</span>
          </button>
        );
      }
      case 'downloading': {
        const label = t.updateDownloading.replace('{percent}', String(effectiveUpdateState.percent));
        return (
          <button
            type="button"
            data-testid="update-button"
            disabled
            title={label}
            aria-label={label}
            className="h-6 px-2.5 rounded-lg flex items-center space-x-1.5 bg-[var(--accent)]/80 text-black font-semibold text-[10px] cursor-wait"
          >
            <Download size={11} className="animate-pulse" />
            <span>{label}</span>
          </button>
        );
      }
      case 'ready':
        return (
          <button
            type="button"
            data-testid="update-button"
            onClick={handleUpdateClick}
            title={t.updateReady}
            aria-label={t.updateReady}
            className="h-6 px-2.5 rounded-lg flex items-center space-x-1.5 bg-emerald-500 text-black font-semibold hover:bg-emerald-400 active:scale-95 transition-all text-[10px]"
          >
            <RotateCw size={11} />
            <span>{t.updateReady}</span>
          </button>
        );
      case 'failed':
        return (
          <button
            type="button"
            data-testid="update-button"
            disabled
            title={t.updateFailed}
            aria-label={t.updateFailed}
            className="h-6 px-2 rounded-lg flex items-center space-x-1.5 bg-red-500/20 text-red-400 text-[10px] font-medium"
          >
            <AlertCircle size={11} />
            <span>{t.updateFailed}</span>
          </button>
        );
    }
  };

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
          <div className="flex flex-col select-none pt-0.5">
            <span className="text-sm font-black tracking-[0.25em] uppercase text-white font-sans leading-none">
              TEMPO
            </span>
          </div>
        )}
        {isCompact && (
          <div className="flex items-center space-x-1">
            <button
              type="button"
              data-testid="compact-expand-button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleCompact();
              }}
              title={t.titleBarMaximize}
              aria-label={t.titleBarMaximize}
            >
              <Maximize2 size={12} />
            </button>

            <button
              type="button"
              data-testid="compact-overlay-button"
              onClick={(e) => {
                e.stopPropagation();
                onToggleOverlay?.();
              }}
              title={t.titleBarCompact}
              aria-label={t.titleBarCompact}
            >
              <PictureInPicture2 size={12} />
            </button>
          </div>
        )}
      </div>

      <div className="flex items-center space-x-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
        {displayVersion && (
          <div className="h-7 flex items-center select-none leading-none opacity-60 hover:opacity-90 transition-opacity">
            <span className="text-[9px] font-mono text-white/50 tracking-wider">
              {displayVersion}
            </span>
          </div>
        )}

        {/* Unified Update button right next to the version */}
        {renderUpdateButton()}

        {/* Language switch RU/EN */}
        {onToggleLang && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleLang();
            }}
            title="RU / EN"
            aria-label="RU / EN"
            className="h-7 px-1.5 rounded-lg flex items-center justify-center space-x-1 bg-white/5 hover:bg-white/10 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          >
            <Globe size={11} />
            <span className="text-[10px] font-bold tracking-wider uppercase">
              {currentLang ?? 'RU'}
            </span>
          </button>
        )}

        {!isCompact && (
          <>
            {/* Always on top toggle */}
            <button
              onClick={onTogglePin}
              title={isPinned ? t.titleBarUnpin : t.titleBarPin}
              aria-label={isPinned ? t.titleBarUnpin : t.titleBarPin}
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
              style={{ color: isPinned ? 'var(--text)' : undefined }}
            >
              {isPinned ? <Pin size={13} /> : <PinOff size={13} />}
            </button>

            {/* Toggle Compact mode */}
            <button
              onClick={onToggleCompact}
              title={t.titleBarCompact}
              aria-label={t.titleBarCompact}
              className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 transition-colors text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              <Minimize2 size={13} />
            </button>
          </>
        )}

        {/* Minimize (matches reference —) */}
        <button
          onClick={() => WindowService.minimize()}
          title={t.titleBarMinimize}
          aria-label={t.titleBarMinimize}
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-95 transition-all text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <Minus size={15} strokeWidth={2.5} />
        </button>

        {/* Maximize / Restore to full screen */}
        <button
          onClick={() => WindowService.toggleMaximize()}
          title={t.titleBarMaximize}
          aria-label={t.titleBarMaximize}
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/15 active:scale-95 transition-all text-[var(--text-muted)] hover:text-[var(--text)]"
        >
          <Maximize2 size={13} strokeWidth={2.2} />
        </button>
        {/* Close (matches reference ✕) */}
        <button
          onClick={async () => {
            await WindowService.close();
          }}
          title={t.titleBarCloseToTray}
          aria-label={t.titleBarCloseToTray}
          className="w-7 h-7 rounded-lg flex items-center justify-center bg-white/5 hover:bg-red-500/80 hover:text-white active:scale-95 transition-all text-[var(--text-muted)]"
        >
          <X size={15} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
};
