import React, { useEffect, useState } from 'react';
import { Menu, Play, Pause, Volume2, VolumeX, Circle } from 'lucide-react';
import { TimerService, type TimerSnapshot } from '../services/timer';
import { soundService } from '../services/sound';

interface WinterBottomPlayerProps {
  onToggleSidebar?: () => void;
  soundEnabled?: boolean;
  onToggleSound?: () => void;
}

export function WinterBottomPlayer({
  onToggleSidebar,
  soundEnabled = true,
  onToggleSound,
}: WinterBottomPlayerProps): React.ReactElement {
  const [snapshot, setSnapshot] = useState<TimerSnapshot | null>(null);

  useEffect(() => {
    // Initial state
    void TimerService.getState().then(setSnapshot);
    // Subscription
    return TimerService.subscribe(setSnapshot);
  }, []);

  const running = snapshot?.running ?? false;
  const remainingSec = snapshot?.remaining_secs ?? 1500;

  const mins = Math.floor(remainingSec / 60);
  const secs = remainingSec % 60;
  // Format as "MM : SS" with spaces matching trywinter reference
  const timeFormatted = `${String(mins).padStart(2, '0')} : ${String(secs).padStart(2, '0')}`;

  const handleToggleTimer = (e: React.MouseEvent) => {
    e.stopPropagation();
    soundService.playUiClick();
    if (running) {
      void TimerService.pause();
    } else {
      void TimerService.start();
    }
  };

  const handleToggleSound = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleSound?.();
  };

  return (
    <div
      data-testid="winter-bottom-player"
      className="fixed bottom-7 left-1/2 -translate-x-1/2 z-40 flex items-center px-4 py-2 rounded-2xl border bg-[#0a0a0c]/90 border-white/10 backdrop-blur-xl shadow-2xl text-xs gap-3 select-none transition-all duration-200 hover:border-white/20"
      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      {/* 1. Menu hamburger button */}
      <button
        type="button"
        aria-label="Toggle navigation menu"
        data-testid="bottom-player-menu"
        onClick={onToggleSidebar}
        className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        <Menu className="w-4 h-4" />
      </button>

      {/* Vertical separator */}
      <div className="h-3.5 w-[1px] bg-white/15" />

      {/* 2. Timer readout */}
      <div className="flex items-center gap-2 font-mono text-sm tracking-widest text-white/95 font-medium px-1">
        <Circle
          className={`w-2 h-2 text-white fill-white transition-opacity ${
            running ? 'animate-pulse opacity-100' : 'opacity-40'
          }`}
        />
        <span className="tabular">{timeFormatted}</span>
      </div>

      {/* Vertical separator */}
      <div className="h-3.5 w-[1px] bg-white/15" />

      {/* 3. Play / Pause */}
      <button
        type="button"
        aria-label={running ? 'Pause timer' : 'Start timer'}
        data-testid="bottom-player-toggle"
        onClick={handleToggleTimer}
        className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        {running ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
      </button>

      {/* 4. Sound toggle */}
      <button
        type="button"
        aria-label={soundEnabled ? 'Mute sound' : 'Unmute sound'}
        data-testid="bottom-player-sound"
        onClick={handleToggleSound}
        className="p-1 rounded-md text-white/70 hover:text-white hover:bg-white/10 transition-colors"
      >
        {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
      </button>
    </div>
  );
}
