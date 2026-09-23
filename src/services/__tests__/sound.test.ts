import { describe, it, expect, beforeEach, vi } from 'vitest';
import { soundService } from '../sound';
import { StoreService } from '../store';

const speakSpy = vi.fn();
const stopSpy = vi.fn();

// vi.mock is hoisted above the imports, so the static import below receives the stub.
vi.mock('../edgeTts', () => ({
  EdgeTtsService: {
    speak: (text: string, voiceId: string) => speakSpy(text, voiceId),
    stop: () => stopSpy(),
  },
}));

class InMemoryLocalStorage {
  private store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get length(): number {
    return this.store.size;
  }

  key(index: number): string | null {
    return Array.from(this.store.keys())[index] ?? null;
  }
}

describe('SoundService voice gate and sound toggles', () => {
  beforeEach(() => {
    speakSpy.mockClear();
    stopSpy.mockClear();
    StoreService.resetCache();
    StoreService.setPreference('alarmer_voice_id', 'none');
    StoreService.setPreference('alarmer_ui_clicks', true);
    StoreService.setPreference('alarmer_countdown_ticks', true);
    StoreService.setPreference('alarmer_custom_alarm_sound', '');
    Object.defineProperty(globalThis, 'localStorage', {
      value: new InMemoryLocalStorage(),
      writable: true,
      configurable: true,
    });
  });
  it('exports soundService and its public methods are functions', () => {
    expect(soundService).toBeDefined();
    expect(typeof soundService.playBeep).toBe('function');
    expect(typeof soundService.playHourglassFlip).toBe('function');
    expect(typeof soundService.playFlip).toBe('function');
    expect(typeof soundService.playClockTick).toBe('function');
    expect(typeof soundService.playCountdownTick).toBe('function');
    expect(typeof soundService.playFinishAlarm).toBe('function');
    expect(typeof soundService.speak).toBe('function');
    expect(typeof soundService.stopSpeaking).toBe('function');
  });


  it('does not synthesise speech when the voice is set to none', () => {
    StoreService.setPreference('alarmer_voice_id', 'none');

    soundService.speak('Время вышло!');

    expect(speakSpy).not.toHaveBeenCalled();
  });

  it('synthesises speech with the configured voice when a voice is selected', () => {
    StoreService.setPreference('alarmer_voice_id', 'ru-RU-DmitryNeural');

    soundService.speak('Время вышло!');

    expect(speakSpy).toHaveBeenCalledWith('Время вышло!', 'ru-RU-DmitryNeural');
  });

  it('prefers an explicitly passed voice over the stored one', () => {
    StoreService.setPreference('alarmer_voice_id', 'ru-RU-DmitryNeural');

    soundService.speak('Тест', 'en-US-JennyNeural');

    expect(speakSpy).toHaveBeenCalledWith('Тест', 'en-US-JennyNeural');
  });

  it('does not throw when playing countdown ticks', () => {
    StoreService.setPreference('alarmer_countdown_ticks', false);
    expect(() => soundService.playCountdownTick()).not.toThrow();
    StoreService.setPreference('alarmer_countdown_ticks', true);
    expect(() => soundService.playCountdownTick()).not.toThrow();
  });

  it('plays hourglass flip cue without throwing', () => {
    StoreService.setPreference('alarmer_click_volume', 0.5);
    expect(() => soundService.playHourglassFlip()).not.toThrow();
    expect(() => soundService.playFlip()).not.toThrow();
  });

  it('does not throw when playing alarm sounds outside a browser audio context', () => {
    StoreService.setPreference('alarmer_custom_alarm_sound', '');

    expect(() => soundService.playFinishAlarm()).not.toThrow();
    expect(() => soundService.playClockTick()).not.toThrow();
    expect(() => soundService.playBeep()).not.toThrow();
  });

  it('survives corrupt volume values without throwing', () => {
    StoreService.setPreference('alarmer_alarm_volume', Number.NaN);
    StoreService.setPreference('alarmer_click_volume', 0);
    StoreService.setPreference('alarmer_sound_profile', 'mechanical');

    expect(() => soundService.playFinishAlarm()).not.toThrow();
    expect(() => soundService.playHourglassFlip()).not.toThrow();
  });

  it('stops speech through the edge TTS service', () => {
    soundService.stopSpeaking();

    expect(stopSpy).toHaveBeenCalledTimes(1);
  });
});
