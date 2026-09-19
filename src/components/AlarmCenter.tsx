import React, { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Bell, BellOff } from 'lucide-react';
import type { AlarmItem, ThemeColors } from '../types';
import { soundService } from '../services/sound';
import { StoreService } from '../services/store';
import { isTauri } from '../services/platform';

/** "на 12 мин позже" — how far past its own time a missed alarm was noticed. */
function formatLate(minutes: number): string {
  if (minutes < 60) return `на ${minutes} мин позже`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `на ${hours} ч позже` : `на ${hours} ч ${rest} мин позже`;
}

/** What the backend reports when an alarm rings. */
interface FiredPayload {
  id: string;
  label: string;
  time: string;
  voice_prompt: string | null;
  snoozed_for: number;
  late_by_minutes: number;
  consumed: boolean;
}

interface AlarmCenterProps {
  theme: ThemeColors;
  /** Every firing the backend should enforce, schedules already expanded. */
  firings: AlarmItem[];
  /** Alarm volume 0..1, mirrored to the backend ringer. */
  alarmVolume: number;
  /** Whether alarms make a sound at all; muting passes volume 0. */
  alarmEnabled: boolean;
  /** A one-shot alarm switched itself off after ringing. */
  onDisableAlarm?: (id: string) => void;
  /** Alarms whose moment passed without ringing, so they can be shown. */
  missed: MissedAlarm[];
  /** Acknowledges the missed list. */
  onDismissMissed: () => void;
  /** False until the stored schedule has been read. */
  hydrated: boolean;
  children: React.ReactNode;
}

/** An alarm whose moment passed while nothing was listening. */
export interface MissedAlarm {
  id: string;
  label: string;
  time: string;
  late_by_minutes: number;
}

/**
 * Owns alarm firing for the whole application.
 *
 * Firing used to live inside the Alarms sub-tab, which meant the schedule was
 * never pushed to the backend and the ringing UI was never mounted unless the
 * user happened to be looking at that tab — the app's own default screen had a
 * silent alarm clock. Both the sync and the ringing surface now sit above the
 * tabs, so they run whatever is on screen.
 */
export const AlarmCenter: React.FC<AlarmCenterProps> = ({
  theme,
  firings,
  alarmVolume,
  alarmEnabled,
  onDisableAlarm,
  missed,
  onDismissMissed,
  hydrated,
  children,
}) => {
  const [ringing, setRinging] = useState<AlarmItem | null>(null);

  // Push the effective schedule down whenever it changes.
  //
  // Gated on hydration: before the store has been read, `firings` is the empty
  // default set, and syncing that first would burn the backend's one-time
  // catch-up chance on nothing — the restored alarms that arrived in the next
  // sync would then look newly created and be silently suppressed.
  useEffect(() => {
    if (!isTauri() || !hydrated) return;
    void invoke('sync_alarms', {
      alarms: firings.map((a) => ({
        id: a.id,
        label: a.label || a.title,
        time: a.time,
        days: a.days ?? [],
        repeat: a.repeat,
        enabled: a.enabled,
        sound: a.sound,
        voice_prompt: a.voicePrompt ?? null,
      })),
    }).catch((e) => console.warn('Failed to sync alarms to scheduler:', e));
  }, [firings, hydrated]);

  // Keep the backend's own ringer at the user's volume, so an alarm that rings
  // while the window is hidden is as loud as one that rings on screen.
  useEffect(() => {
    if (!isTauri()) return;
    const volume = StoreService.getPreference('alarmer_alarm_volume', 0.8);
    const enabled = StoreService.getPreference('alarmer_alarm_enabled', true);
    void invoke('set_alarm_audio_prefs', { volume: enabled ? volume : 0, enabled }).catch(() => {});
  }, [alarmVolume, alarmEnabled]);

  // Ring when the backend says it is time.
  useEffect(() => {
    if (!isTauri()) return;

    let unlisten: (() => void) | undefined;
    let cancelled = false;

    void listen<FiredPayload>('alarm://fired', (event) => {
      const payload = event.payload;
      const alarm = firings.find((a) => a.id === payload.id) ?? {
        id: payload.id,
        title: payload.label,
        label: payload.label,
        time: payload.time,
        days: [],
        repeat: 'days' as const,
        enabled: true,
        sound: 'gentle',
        voicePrompt: payload.voice_prompt ?? undefined,
      };

      // Whoever can play owns the sound. The backend only starts its own ringer
      // when the window is hidden — and it reveals the window right after, at
      // which point this listener fires. Silencing the backend *before* starting
      // the webview ramp is what stops the alarm sounding twice: once through
      // the OS device and once through the webview, out of phase.
      void invoke('stop_alarm_sound')
        .catch(() => {})
        .then(() => {
          if (payload.consumed) onDisableAlarm?.(payload.id);

          setRinging(alarm);
          soundService.startAlarmRamp(alarm.sound, alarm.id);
          soundService.speak(payload.voice_prompt || `Внимание! Будильник: ${payload.label}`);
        });
    }).then((fn) => {
      if (cancelled) fn();
      else unlisten = fn;
    });

    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [firings, onDisableAlarm]);

  // An alarm that started ringing while the window was hidden is still ringing.
  // Without this, opening the window mid-ring shows a silent, calm app while the
  // backend keeps sounding the alarm.
  useEffect(() => {
    if (!isTauri()) return;
    void invoke<string | null>('ringing_alarm_id')
      .then((id) => {
        if (!id) return;
        const alarm = firings.find((a) => a.id === id);
        if (!alarm) return;

        // The window has just become visible, so the webview can play from here
        // on; letting the backend keep going would sound the alarm twice.
        void invoke('stop_alarm_sound').catch(() => {});
        setRinging(alarm);
        soundService.startAlarmRamp(alarm.sound, alarm.id);
      })
      .catch(() => {});
    // Deliberately keyed on mount only: this is a start-up reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stopRinging = useCallback(() => {
    soundService.stopAlarmRamp();
    soundService.stopSpeaking();
    setRinging(null);
  }, []);

  const dismiss = () => {
    soundService.playCountdownTick();
    if (isTauri() && ringing) {
      void invoke('dismiss_alarm', { id: ringing.id }).catch(() => {});
    }
    stopRinging();
  };

  const snooze = (minutes: number) => {
    soundService.playCountdownTick();
    if (isTauri() && ringing) {
      void invoke('snooze_alarm', { id: ringing.id, minutes }).catch(() => {});
    }
    stopRinging();
  };

  return (
    <>
      {children}

      {/* An alarm that never rang is worse than one that did: the user believed
          something would remind them. The backend reports it, so it is said out
          loud rather than left in a list only the backend can see. */}
      {missed.length > 0 && !ringing && (
        <div
          className="fixed top-3 left-1/2 -translate-x-1/2 z-[65] max-w-[340px] w-[calc(100%-24px)] rounded-2xl border backdrop-blur-2xl px-3.5 py-2.5"
          style={{
            backgroundColor: 'rgba(20,20,20,0.92)',
            borderColor: 'rgba(255,255,255,0.16)',
            boxShadow: '0 18px 48px rgba(0,0,0,0.55)',
          }}
        >
          <div className="flex items-start gap-2">
            <BellOff size={13} className="mt-0.5 shrink-0" style={{ color: theme.subtext }} />
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[11px] font-semibold" style={{ color: theme.text }}>
                Пропущено сегодня: {missed.length}
              </span>
              {missed.slice(0, 3).map((alarm) => (
                <span key={alarm.id} className="text-[10px] truncate" style={{ color: theme.subtext }}>
                  {alarm.time} · {alarm.label} · {formatLate(alarm.late_by_minutes)}
                </span>
              ))}
              {missed.length > 3 && (
                <span className="text-[10px]" style={{ color: theme.subtext }}>
                  и ещё {missed.length - 3}
                </span>
              )}
            </div>
            <button
              onClick={onDismissMissed}
              className="text-[10px] px-1.5 py-0.5 rounded-lg shrink-0 transition-colors hover:bg-white/10"
              style={{ color: theme.subtext }}
              title="Скрыть"
              aria-label="Скрыть список пропущенных"
            >
              Скрыть
            </button>
          </div>
        </div>
      )}


      {ringing && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center p-5"
          style={{ backgroundColor: theme.accent }}
        >
          <style>{`
            @keyframes alarmer-pulse { 0%,100% { opacity: 1 } 50% { opacity: .55 } }
            @media (prefers-reduced-motion: reduce) {
              .alarmer-pulse { animation: none !important; }
            }
            .alarmer-pulse { animation: alarmer-pulse 1.4s ease-in-out infinite; }
          `}</style>

          <Bell size={30} color="#0a0a0a" className="alarmer-pulse mb-5" />

          {/* Dark-on-warm: the measured contrast here is 7.59:1, where white on
              the warm surface is only 2.61:1. */}
          <span className="text-[52px] font-bold leading-none tabular-nums" style={{ color: '#0a0a0a' }}>
            {ringing.time}
          </span>

          <span
            className="mt-2 text-sm font-semibold text-center max-w-[280px]"
            style={{ color: 'rgba(10,10,10,0.82)' }}
          >
            {ringing.label || ringing.title}
          </span>

          {ringing.voicePrompt && (
            <span
              className="mt-3 text-[11px] text-center max-w-[280px] leading-relaxed"
              style={{ color: 'rgba(10,10,10,0.62)' }}
            >
              {ringing.voicePrompt}
            </span>
          )}

          {ringing.note && (
            <span
              className="mt-1.5 text-[11px] text-center max-w-[280px] leading-relaxed font-medium"
              style={{ color: 'rgba(10,10,10,0.72)' }}
            >
              {ringing.note}
            </span>
          )}


          <div className="flex items-center space-x-2 mt-4">
            {[5, 10, 15].map((mins) => (
              <button
                key={mins}
                onClick={() => snooze(mins)}
                className="px-4 py-2.5 rounded-lg text-xs font-semibold active:scale-95 transition-transform"
                style={{ color: '#0a0a0a', border: '1px solid rgba(10,10,10,0.28)' }}
                title={`Отложить на ${mins} минут`}
              >
                +{mins} мин
              </button>
            ))}
          </div>

          <button
            onClick={dismiss}
            className="mt-3 w-full max-w-[280px] py-3.5 rounded-lg text-xs font-bold uppercase tracking-widest active:scale-[0.97] transition-transform"
            style={{ backgroundColor: '#0a0a0a', color: theme.accent }}
          >
            Остановить
          </button>
        </div>
      )}
    </>
  );
};
