import { useEffect, useState } from 'react';
import { Row, Slider, Toggle, Segmented, SectionHeader, Divider } from './ui';
import { I18nService } from '../services/i18n';
import { TimerService, MIN_MINUTES, MAX_MINUTES } from '../services/timer';
import {
  currentFocusSound,
  startFocusAudio,
  FOCUS_SOUNDS,
  FocusSoundId,
} from '../services/focusAudio';

export interface PomodoroSettingsProps {
  className?: string;
}

export const MIN_SHORT_REST = 1;
export const MAX_SHORT_REST = 30;
export const MIN_LONG_REST = 5;
export const MAX_LONG_REST = 60;

export function PomodoroSettings({ className }: PomodoroSettingsProps) {
  const t = I18nService.t();

  const [focusMin, setFocusMin] = useState<number>(25);
  const [shortRestMin, setShortRestMin] = useState<number>(5);
  const [longRestMin, setLongRestMin] = useState<number>(15);
  const [autoStart, setAutoStart] = useState<boolean>(false);
  const [selectedAudio, setSelectedAudio] = useState<FocusSoundId>(() => currentFocusSound());

  useEffect(() => {
    let mounted = true;

    async function loadState() {
      try {
        const state = await TimerService.getState();
        if (mounted && state) {
          setFocusMin(state.focus_min);
          setShortRestMin(state.short_rest_min);
          setLongRestMin(state.long_rest_min);
          setAutoStart(state.auto_start);
        }
      } catch {
        // Degrades gracefully when timer state is not available
      }
    }

    void loadState();
    return () => {
      mounted = false;
    };
  }, []);

  const handleFocusChange = (val: number) => {
    const clamped = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.round(val)));
    setFocusMin(clamped);
    void TimerService.setPomodoroSettings(clamped, shortRestMin, longRestMin, autoStart);
  };

  const handleShortRestChange = (val: number) => {
    const clamped = Math.max(MIN_SHORT_REST, Math.min(MAX_SHORT_REST, Math.round(val)));
    setShortRestMin(clamped);
    void TimerService.setPomodoroSettings(focusMin, clamped, longRestMin, autoStart);
  };

  const handleLongRestChange = (val: number) => {
    const clamped = Math.max(MIN_LONG_REST, Math.min(MAX_LONG_REST, Math.round(val)));
    setLongRestMin(clamped);
    void TimerService.setPomodoroSettings(focusMin, shortRestMin, clamped, autoStart);
  };

  const handleAutoStartChange = (checked: boolean) => {
    setAutoStart(checked);
    void TimerService.setPomodoroSettings(focusMin, shortRestMin, longRestMin, checked);
  };

  const handleAudioChange = (val: string) => {
    const soundId = val as FocusSoundId;
    setSelectedAudio(soundId);
    startFocusAudio(soundId);
  };

  const audioOptions = FOCUS_SOUNDS.map((s) => {
    let label = s.label;
    if (s.id === 'none') label = t.focusSoundNone;
    else if (s.id === 'brown') label = t.focusSoundBrown;
    else if (s.id === 'white') label = t.focusSoundWhite;
    else if (s.id === 'rain') label = t.focusSoundRain;
    else if (s.id === 'cafe') label = t.focusSoundCafe;
    return {
      value: s.id,
      label,
    };
  });

  return (
    <div className={`flex flex-col gap-2 select-none ${className || ''}`}>
      <SectionHeader>{t.pomodoroSettings}</SectionHeader>

      <Row
        label={t.pomodoroFocusLength}
        control={
          <Slider
            min={MIN_MINUTES}
            max={MAX_MINUTES}
            step={1}
            value={focusMin}
            onChange={handleFocusChange}
            minLabel={`${MIN_MINUTES} ${t.minutesShort}`}
            maxLabel={`${MAX_MINUTES} ${t.minutesShort}`}
          />
        }
      />

      <Row
        label={t.pomodoroShortRestLength}
        control={
          <Slider
            min={MIN_SHORT_REST}
            max={MAX_SHORT_REST}
            step={1}
            value={shortRestMin}
            onChange={handleShortRestChange}
            minLabel={`${MIN_SHORT_REST} ${t.minutesShort}`}
            maxLabel={`${MAX_SHORT_REST} ${t.minutesShort}`}
          />
        }
      />

      <Row
        label={t.pomodoroLongRestLength}
        control={
          <Slider
            min={MIN_LONG_REST}
            max={MAX_LONG_REST}
            step={1}
            value={longRestMin}
            onChange={handleLongRestChange}
            minLabel={`${MIN_LONG_REST} ${t.minutesShort}`}
            maxLabel={`${MAX_LONG_REST} ${t.minutesShort}`}
          />
        }
      />

      <Row
        label={t.pomodoroAutoStart}
        description={`${t.pomodoroAutoStartHint} ${t.pomodoroCycleHint}`}
        control={
          <Toggle
            checked={autoStart}
            onChange={handleAutoStartChange}
            aria-label={t.pomodoroAutoStart}
          />
        }
      />

      <Divider />

      <Row
        label={t.focusAudio}
        description={t.focusAudioHint}
        control={
          <Segmented
            options={audioOptions}
            value={selectedAudio}
            onChange={handleAudioChange}
          />
        }
      />
    </div>
  );
}
