import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  loadSpeechSettings,
  saveSpeechSettings,
  DEFAULT_SPEECH_SETTINGS,
  subscribeSpeechSettings,
  mergeSpeechConfig,
  type SpeechConfig,
} from '../speechSettings';
import { resetSettingsCacheForTesting, getPref, setPref } from '../settings';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
describe('speechSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetSettingsCacheForTesting();
    mockInvoke.mockImplementation((cmd: string, args?: { patch?: Partial<SpeechConfig> }) => {
      if (cmd === 'stt_apply_speech_settings') {
        return Promise.resolve(mergeSpeechConfig(loadSpeechSettings(), args?.patch ?? {}));
      }
      return Promise.resolve(undefined);
    });
  });

  it('loads default speech settings when cache is empty', () => {
    const settings = loadSpeechSettings();
    expect(settings).toEqual(DEFAULT_SPEECH_SETTINGS);
    expect(settings.enabled).toBe(false);
    expect(settings.hotkey).toBe('Ctrl+S');
    expect(settings.dictationWave).toBe(true);
    expect(settings.dictationWaveBars).toBe(24);
    expect(settings.modelId).toBe(null);
    expect(settings).toEqual(DEFAULT_SPEECH_SETTINGS);
  });

  it('falls back to legacy alarmer_speech_* keys when tempo_speech_* keys are absent', async () => {
    await setPref('alarmer_speech_enabled', true);
    await setPref('alarmer_speech_hotkey', 'Ctrl+Shift+S');
    await setPref('alarmer_speech_model_id', 'whisper-base');

    const settings = loadSpeechSettings();
    expect(settings.enabled).toBe(true);
    expect(settings.hotkey).toBe('Ctrl+Shift+S');
    expect(settings.modelId).toBe('whisper-base');
  });

  it('prefers tempo_speech_* keys over legacy keys', async () => {
    await setPref('alarmer_speech_enabled', true);
    await setPref('tempo_speech_enabled', false);
    await setPref('alarmer_speech_hotkey', 'Ctrl+Shift+A');
    await setPref('tempo_speech_hotkey', 'Ctrl+Shift+B');

    const settings = loadSpeechSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.hotkey).toBe('Ctrl+Shift+B');
  });

  it('saves settings to tempo_speech_* keys', async () => {
    await saveSpeechSettings({
      enabled: true,
      hotkey: 'Alt+V',
      modelId: 'whisper-large-v3',
    });

    expect(mockInvoke).toHaveBeenCalledWith('stt_apply_speech_settings', {
      patch: {
        enabled: true,
        hotkey: 'Alt+V',
        modelId: 'whisper-large-v3',
      },
    });
    expect(getPref('tempo_speech_enabled', undefined)).toBe(true);
    expect(getPref('tempo_speech_hotkey', undefined)).toBe('Alt+V');
    expect(getPref('tempo_speech_model_id', undefined)).toBe('whisper-large-v3');

    const settings = loadSpeechSettings();
    expect(settings).toMatchObject({
      enabled: true,
      hotkey: 'Alt+V',
      modelId: 'whisper-large-v3',
    });
  });

  it('handles invalid values gracefully', async () => {
    await setPref('tempo_speech_enabled', 12345);
    await setPref('tempo_speech_hotkey', { invalid: true });
    await setPref('tempo_speech_model_id', 9999);

    const settings = loadSpeechSettings();
    expect(settings.enabled).toBe(false);
    expect(settings.hotkey).toBe(DEFAULT_SPEECH_SETTINGS.hotkey);
    expect(settings.modelId).toBe(null);
  });

  it('supports subscription notifications on changes', async () => {
    let notified = 0;
    const unsubscribe = subscribeSpeechSettings(() => {
      notified += 1;
    });

    await saveSpeechSettings({ enabled: true });
    expect(notified).toBe(1);

    unsubscribe();
    await saveSpeechSettings({ enabled: false });
    expect(notified).toBe(1);
  });

  it('resolves empty or whitespace stored cancel hotkey to Escape', async () => {
    await setPref('tempo_speech_cancel_hotkey', '');
    let settings = loadSpeechSettings();
    expect(settings.cancelHotkey).toBe('Escape');

    await setPref('tempo_speech_cancel_hotkey', '   ');
    settings = loadSpeechSettings();
    expect(settings.cancelHotkey).toBe('Escape');
  });

  it('honors an explicit cancel hotkey', async () => {
    await setPref('tempo_speech_cancel_hotkey', 'F8');
    const settings = loadSpeechSettings();
    expect(settings.cancelHotkey).toBe('F8');
  });

  it('resolves legacy alarmer cancel hotkey to Escape when empty and honors explicit value', async () => {
    await setPref('alarmer_speech_cancel_hotkey', '');
    let settings = loadSpeechSettings();
    expect(settings.cancelHotkey).toBe('Escape');

    await setPref('alarmer_speech_cancel_hotkey', 'Ctrl+Shift+C');
    settings = loadSpeechSettings();
    expect(settings.cancelHotkey).toBe('Ctrl+Shift+C');
  });

  it('normalizes empty cancel hotkey on merge and save', async () => {
    const merged = mergeSpeechConfig(DEFAULT_SPEECH_SETTINGS, { cancelHotkey: '' });
    expect(merged.cancelHotkey).toBe('Escape');

    const mergedExplicit = mergeSpeechConfig(DEFAULT_SPEECH_SETTINGS, { cancelHotkey: 'F8' });
    expect(mergedExplicit.cancelHotkey).toBe('F8');

    await saveSpeechSettings({ cancelHotkey: '' });
    expect(mockInvoke).toHaveBeenCalledWith('stt_apply_speech_settings', {
      patch: {
        cancelHotkey: 'Escape',
      },
    });
    expect(getPref('tempo_speech_cancel_hotkey', undefined)).toBe('Escape');
    expect(loadSpeechSettings().cancelHotkey).toBe('Escape');

    await saveSpeechSettings({ cancelHotkey: 'F8' });
    expect(mockInvoke).toHaveBeenCalledWith('stt_apply_speech_settings', {
      patch: {
        cancelHotkey: 'F8',
      },
    });
    expect(getPref('tempo_speech_cancel_hotkey', undefined)).toBe('F8');
    expect(loadSpeechSettings().cancelHotkey).toBe('F8');
  });
});
