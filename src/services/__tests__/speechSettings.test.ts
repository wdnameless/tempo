import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadSpeechSettings,
  saveSpeechSettings,
  DEFAULT_SPEECH_SETTINGS,
  subscribeSpeechSettings,
} from '../speechSettings';
import { resetSettingsCacheForTesting, getPref, setPref } from '../settings';

describe('speechSettings', () => {
  beforeEach(() => {
    resetSettingsCacheForTesting();
  });

  it('loads default speech settings when cache is empty', () => {
    const settings = loadSpeechSettings();
    expect(settings).toEqual(DEFAULT_SPEECH_SETTINGS);
    expect(settings.enabled).toBe(false);
    expect(settings.hotkey).toBe('');
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
});
