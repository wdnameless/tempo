import { getPref, setPref, subscribePrefs } from './settings';

export interface SpeechSettings {
  enabled: boolean;
  hotkey: string;
  modelId: string | null;
}

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = {
  enabled: false,
  hotkey: '',
  modelId: null,
};

function parseBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return fallback;
}

function parseString(val: unknown, fallback: string): string {
  if (typeof val === 'string') return val;
  return fallback;
}

function parseNullableString(val: unknown, fallback: string | null): string | null {
  if (val === null) return null;
  if (typeof val === 'string') return val;
  return fallback;
}

export function loadSpeechSettings(): SpeechSettings {
  const enabledRaw = getPref<unknown>('tempo_speech_enabled', getPref<unknown>('alarmer_speech_enabled', undefined));
  const hotkeyRaw = getPref<unknown>('tempo_speech_hotkey', getPref<unknown>('alarmer_speech_hotkey', undefined));
  const modelIdRaw = getPref<unknown>('tempo_speech_model_id', getPref<unknown>('alarmer_speech_model_id', undefined));

  return {
    enabled: parseBoolean(enabledRaw, DEFAULT_SPEECH_SETTINGS.enabled),
    hotkey: parseString(hotkeyRaw, DEFAULT_SPEECH_SETTINGS.hotkey),
    modelId: parseNullableString(modelIdRaw, DEFAULT_SPEECH_SETTINGS.modelId),
  };
}

/** Alias matching interfaces.md §21 contract */
export const speechSettings = loadSpeechSettings;

export async function saveSpeechSettings(patch: Partial<SpeechSettings>): Promise<void> {
  const current = loadSpeechSettings();
  const writes: Promise<void>[] = [];

  if (patch.enabled !== undefined) {
    writes.push(setPref('tempo_speech_enabled', parseBoolean(patch.enabled, current.enabled)));
  }
  if (patch.hotkey !== undefined) {
    writes.push(setPref('tempo_speech_hotkey', parseString(patch.hotkey, current.hotkey)));
  }
  if (patch.modelId !== undefined) {
    writes.push(setPref('tempo_speech_model_id', parseNullableString(patch.modelId, current.modelId)));
  }

  await Promise.all(writes);
}

/** Alias matching interfaces.md §21 contract */
export const setSpeechSettings = saveSpeechSettings;

export function subscribeSpeechSettings(callback: (settings: SpeechSettings) => void): () => void {
  return subscribePrefs((key) => {
    if (key.startsWith('tempo_speech_') || key.startsWith('alarmer_speech_')) {
      callback(loadSpeechSettings());
    }
  });
}
