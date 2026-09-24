// src/services/speechSettings.ts
// Speech configuration service backing settings and synchronizing with Rust backend.

import { getPref, setPref, subscribePrefs } from './settings';
import { isTauri } from './platform';
import { applySpeechConfig } from './stt';

export type ShortcutActivation = 'toggle' | 'push_to_talk' | 'hold_or_toggle';
export type VadBackend = 'energy' | 'earshot' | 'silero';
export type PasteMethod = 'ctrl_v' | 'shift_insert' | 'direct';
export type ClipboardBehavior = 'restore' | 'keep';
export type SoundTheme = 'default' | 'soft' | 'mechanical' | string;

export interface SpeechConfig {
  enabled: boolean;
  activation: ShortcutActivation;
  hotkey: string;
  cancelHotkey: string;
  holdThresholdMs: number;
  engine: string;
  modelId: string | null;
  device: string | null;
  channel: number | null;
  vadBackend: VadBackend | string;
  vadEnergyThreshold: number;
  vadFallbackReason?: string | null;
  language: string | null;
  translateToEnglish: boolean;
  customWords: string[];
  removeFillerWords: boolean;
  pasteMethod: PasteMethod | string;
  clipboardBehavior: ClipboardBehavior | string;
  pasteDelayMs: number;
  pasteDelayAfterMs: number;
  appendSpace: boolean;
  autoSubmit: boolean;
  feedbackEnabled: boolean;
  feedbackVolume: number;
  soundTheme: SoundTheme;
  historyEnabled: boolean;
  historyLimit: number;
  retentionDays: number;
  postprocessEnabled: boolean;
  postprocessPrompt: string;
  overlayEnabled: boolean;
  onboarded: boolean;
  accelerator: string;
  gpuDevice: string | null;
  modelUnloadSecs: number;
  denoise_highpass: boolean;
  denoise_highpass_hz: number;
  denoise_gate: boolean;
  denoise_gate_db: number;
  denoise_rnnoise: boolean;
  denoise_agc: boolean;
  denoise_agc_target_db: number;
  dictationWave: boolean;
  dictationWaveBars: number;
}

export type SpeechSettings = SpeechConfig;

export const DEFAULT_SPEECH_CONFIG: SpeechConfig = {
  enabled: false,
  activation: 'hold_or_toggle',
  hotkey: 'Ctrl+S',
  cancelHotkey: 'Escape',
  holdThresholdMs: 300,
  engine: 'local',
  modelId: null,
  device: null,
  channel: null,
  vadBackend: 'earshot',
  vadEnergyThreshold: 0.015,
  language: null,
  vadFallbackReason: null,
  translateToEnglish: false,
  customWords: [],
  removeFillerWords: false,
  pasteMethod: 'ctrl_v',
  clipboardBehavior: 'restore',
  pasteDelayMs: 60,
  pasteDelayAfterMs: 60,
  appendSpace: false,
  autoSubmit: false,
  feedbackEnabled: false,
  feedbackVolume: 0.5,
  soundTheme: 'default',
  historyEnabled: true,
  historyLimit: 100,
  retentionDays: 30,
  postprocessEnabled: false,
  postprocessPrompt: '',
  overlayEnabled: true,
  onboarded: false,
  accelerator: 'auto',
  gpuDevice: null,
  modelUnloadSecs: 60,
  denoise_highpass: true,
  denoise_highpass_hz: 80,
  denoise_gate: true,
  denoise_gate_db: -45,
  denoise_rnnoise: false,
  denoise_agc: false,
  denoise_agc_target_db: -20,
  dictationWave: true,
  dictationWaveBars: 24,
};

export const DEFAULT_SPEECH_SETTINGS: SpeechSettings = DEFAULT_SPEECH_CONFIG;

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

function parseNumber(val: unknown, fallback: number): number {
  if (typeof val === 'number' && !Number.isNaN(val)) return val;
  if (typeof val === 'string') {
    const parsed = Number(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return fallback;
}

function parseNullableNumber(val: unknown, fallback: number | null): number | null {
  if (val === null) return null;
  return parseNumber(val, fallback ?? 0);
}

function parseStringArray(val: unknown, fallback: string[]): string[] {
  if (Array.isArray(val)) {
    return val.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof val === 'string') {
    if (val.trim().startsWith('[') && val.trim().endsWith(']')) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          return parsed.map((x) => String(x).trim()).filter(Boolean);
        }
      } catch {
        // Fall back to delimited split
      }
    }
    return val.split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean);
  }
  return fallback;
}

function parseActivation(val: unknown, fallback: ShortcutActivation): ShortcutActivation {
  if (val === 'toggle' || val === 'push_to_talk' || val === 'hold_or_toggle') {
    return val;
  }
  return fallback;
}

function parseVadBackend(val: unknown, fallback: VadBackend): VadBackend {
  if (val === 'energy' || val === 'earshot' || val === 'silero') {
    return val;
  }
  return fallback;
}

function parsePasteMethod(val: unknown, fallback: PasteMethod): PasteMethod {
  if (val === 'ctrl_v' || val === 'shift_insert' || val === 'direct') {
    return val;
  }
  return fallback;
}

function parseClipboardBehavior(val: unknown, fallback: ClipboardBehavior): ClipboardBehavior {
  if (val === 'restore' || val === 'keep') {
    return val;
  }
  return fallback;
}

function getSpeechPref<T>(name: string, fallback: T): T {
  const tempoKey = `tempo_speech_${name}`;
  const alarmerKey = `alarmer_speech_${name}`;
  const tempoVal = getPref<T | undefined>(tempoKey, undefined);
  if (tempoVal !== undefined) {
    return tempoVal;
  }
  return getPref<T>(alarmerKey, fallback);
}

export function loadSpeechConfig(): SpeechConfig {
  return {
    enabled: parseBoolean(getSpeechPref('enabled', DEFAULT_SPEECH_CONFIG.enabled), DEFAULT_SPEECH_CONFIG.enabled),
    activation: parseActivation(
      getSpeechPref('activation', DEFAULT_SPEECH_CONFIG.activation),
      DEFAULT_SPEECH_CONFIG.activation,
    ),
    hotkey: parseString(getSpeechPref('hotkey', DEFAULT_SPEECH_CONFIG.hotkey), DEFAULT_SPEECH_CONFIG.hotkey),
    cancelHotkey: parseString(
      getSpeechPref('cancel_hotkey', DEFAULT_SPEECH_CONFIG.cancelHotkey),
      DEFAULT_SPEECH_CONFIG.cancelHotkey,
    ),
    holdThresholdMs: parseNumber(
      getSpeechPref('hold_threshold_ms', DEFAULT_SPEECH_CONFIG.holdThresholdMs),
      DEFAULT_SPEECH_CONFIG.holdThresholdMs,
    ),
    engine: parseString(getSpeechPref('engine', DEFAULT_SPEECH_CONFIG.engine), DEFAULT_SPEECH_CONFIG.engine),
    modelId: parseNullableString(getSpeechPref('model_id', DEFAULT_SPEECH_CONFIG.modelId), DEFAULT_SPEECH_CONFIG.modelId),
    device: parseNullableString(getSpeechPref('device', DEFAULT_SPEECH_CONFIG.device), DEFAULT_SPEECH_CONFIG.device),
    channel: parseNullableNumber(getSpeechPref('channel', DEFAULT_SPEECH_CONFIG.channel), DEFAULT_SPEECH_CONFIG.channel),
    vadBackend: parseVadBackend(
      getSpeechPref('vad_backend', DEFAULT_SPEECH_CONFIG.vadBackend),
      DEFAULT_SPEECH_CONFIG.vadBackend as VadBackend,
    ),
    vadEnergyThreshold: parseNumber(
      getSpeechPref('vad_energy_threshold', DEFAULT_SPEECH_CONFIG.vadEnergyThreshold),
      DEFAULT_SPEECH_CONFIG.vadEnergyThreshold,
    ),
    vadFallbackReason: parseNullableString(getSpeechPref('vad_fallback_reason', DEFAULT_SPEECH_CONFIG.vadFallbackReason ?? null), DEFAULT_SPEECH_CONFIG.vadFallbackReason ?? null),
    language: parseNullableString(getSpeechPref('language', DEFAULT_SPEECH_CONFIG.language), DEFAULT_SPEECH_CONFIG.language),
    translateToEnglish: parseBoolean(
      getSpeechPref('translate_to_english', DEFAULT_SPEECH_CONFIG.translateToEnglish),
      DEFAULT_SPEECH_CONFIG.translateToEnglish,
    ),
    customWords: parseStringArray(
      getSpeechPref('custom_words', DEFAULT_SPEECH_CONFIG.customWords),
      DEFAULT_SPEECH_CONFIG.customWords,
    ),
    removeFillerWords: parseBoolean(
      getSpeechPref('remove_filler_words', DEFAULT_SPEECH_CONFIG.removeFillerWords),
      DEFAULT_SPEECH_CONFIG.removeFillerWords,
    ),
    pasteMethod: parsePasteMethod(
      getSpeechPref('paste_method', DEFAULT_SPEECH_CONFIG.pasteMethod),
      DEFAULT_SPEECH_CONFIG.pasteMethod as PasteMethod,
    ),
    clipboardBehavior: parseClipboardBehavior(
      getSpeechPref('clipboard_behavior', DEFAULT_SPEECH_CONFIG.clipboardBehavior),
      DEFAULT_SPEECH_CONFIG.clipboardBehavior as ClipboardBehavior,
    ),
    pasteDelayMs: parseNumber(
      getSpeechPref('paste_delay_ms', DEFAULT_SPEECH_CONFIG.pasteDelayMs),
      DEFAULT_SPEECH_CONFIG.pasteDelayMs,
    ),
    pasteDelayAfterMs: parseNumber(
      getSpeechPref('paste_delay_after_ms', DEFAULT_SPEECH_CONFIG.pasteDelayAfterMs),
      DEFAULT_SPEECH_CONFIG.pasteDelayAfterMs,
    ),
    appendSpace: parseBoolean(
      getSpeechPref('append_space', DEFAULT_SPEECH_CONFIG.appendSpace),
      DEFAULT_SPEECH_CONFIG.appendSpace,
    ),
    autoSubmit: parseBoolean(
      getSpeechPref('auto_submit', DEFAULT_SPEECH_CONFIG.autoSubmit),
      DEFAULT_SPEECH_CONFIG.autoSubmit,
    ),
    feedbackEnabled: parseBoolean(
      getSpeechPref('feedback_enabled', DEFAULT_SPEECH_CONFIG.feedbackEnabled),
      DEFAULT_SPEECH_CONFIG.feedbackEnabled,
    ),
    feedbackVolume: parseNumber(
      getSpeechPref('feedback_volume', DEFAULT_SPEECH_CONFIG.feedbackVolume),
      DEFAULT_SPEECH_CONFIG.feedbackVolume,
    ),
    soundTheme: parseString(
      getSpeechPref('sound_theme', DEFAULT_SPEECH_CONFIG.soundTheme),
      DEFAULT_SPEECH_CONFIG.soundTheme,
    ),
    historyEnabled: parseBoolean(
      getSpeechPref('history_enabled', DEFAULT_SPEECH_CONFIG.historyEnabled),
      DEFAULT_SPEECH_CONFIG.historyEnabled,
    ),
    historyLimit: parseNumber(
      getSpeechPref('history_limit', DEFAULT_SPEECH_CONFIG.historyLimit),
      DEFAULT_SPEECH_CONFIG.historyLimit,
    ),
    retentionDays: parseNumber(
      getSpeechPref('retention_days', DEFAULT_SPEECH_CONFIG.retentionDays),
      DEFAULT_SPEECH_CONFIG.retentionDays,
    ),
    postprocessEnabled: parseBoolean(
      getSpeechPref('postprocess_enabled', DEFAULT_SPEECH_CONFIG.postprocessEnabled),
      DEFAULT_SPEECH_CONFIG.postprocessEnabled,
    ),
    postprocessPrompt: parseString(
      getSpeechPref('postprocess_prompt', DEFAULT_SPEECH_CONFIG.postprocessPrompt),
      DEFAULT_SPEECH_CONFIG.postprocessPrompt,
    ),
    overlayEnabled: parseBoolean(
      getSpeechPref('overlay_enabled', DEFAULT_SPEECH_CONFIG.overlayEnabled),
      DEFAULT_SPEECH_CONFIG.overlayEnabled,
    ),
    onboarded: parseBoolean(
      getSpeechPref('onboarded', DEFAULT_SPEECH_CONFIG.onboarded),
      DEFAULT_SPEECH_CONFIG.onboarded,
    ),
    accelerator: parseString(
      getSpeechPref('accelerator', DEFAULT_SPEECH_CONFIG.accelerator),
      DEFAULT_SPEECH_CONFIG.accelerator,
    ),
    gpuDevice: parseNullableString(
      getSpeechPref('gpu_device', DEFAULT_SPEECH_CONFIG.gpuDevice),
      DEFAULT_SPEECH_CONFIG.gpuDevice,
    ),
    modelUnloadSecs: parseNumber(
      getSpeechPref('model_unload_secs', DEFAULT_SPEECH_CONFIG.modelUnloadSecs),
      DEFAULT_SPEECH_CONFIG.modelUnloadSecs,
    ),
    denoise_highpass: parseBoolean(
      getSpeechPref('denoise_highpass', DEFAULT_SPEECH_CONFIG.denoise_highpass),
      DEFAULT_SPEECH_CONFIG.denoise_highpass,
    ),
    denoise_highpass_hz: parseNumber(
      getSpeechPref('denoise_highpass_hz', DEFAULT_SPEECH_CONFIG.denoise_highpass_hz),
      DEFAULT_SPEECH_CONFIG.denoise_highpass_hz,
    ),
    denoise_gate: parseBoolean(
      getSpeechPref('denoise_gate', DEFAULT_SPEECH_CONFIG.denoise_gate),
      DEFAULT_SPEECH_CONFIG.denoise_gate,
    ),
    denoise_gate_db: parseNumber(
      getSpeechPref('denoise_gate_db', DEFAULT_SPEECH_CONFIG.denoise_gate_db),
      DEFAULT_SPEECH_CONFIG.denoise_gate_db,
    ),
    denoise_rnnoise: parseBoolean(
      getSpeechPref('denoise_rnnoise', DEFAULT_SPEECH_CONFIG.denoise_rnnoise),
      DEFAULT_SPEECH_CONFIG.denoise_rnnoise,
    ),
    denoise_agc: parseBoolean(
      getSpeechPref('denoise_agc', DEFAULT_SPEECH_CONFIG.denoise_agc),
      DEFAULT_SPEECH_CONFIG.denoise_agc,
    ),
    denoise_agc_target_db: parseNumber(
      getSpeechPref('denoise_agc_target_db', DEFAULT_SPEECH_CONFIG.denoise_agc_target_db),
      DEFAULT_SPEECH_CONFIG.denoise_agc_target_db,
    ),
    dictationWave: parseBoolean(
      getSpeechPref('dictation_wave', DEFAULT_SPEECH_CONFIG.dictationWave),
      DEFAULT_SPEECH_CONFIG.dictationWave,
    ),
    dictationWaveBars: parseNumber(
      getSpeechPref('dictation_wave_bars', DEFAULT_SPEECH_CONFIG.dictationWaveBars),
      DEFAULT_SPEECH_CONFIG.dictationWaveBars,
    ),
  };
}

export const loadSpeechSettings = loadSpeechConfig;
export const speechSettings = loadSpeechConfig;

export function mergeSpeechConfig(base: SpeechConfig, patch: Partial<SpeechConfig>): SpeechConfig {
  return {
    enabled: patch.enabled !== undefined ? parseBoolean(patch.enabled, base.enabled) : base.enabled,
    activation: patch.activation !== undefined ? parseActivation(patch.activation, base.activation) : base.activation,
    hotkey: patch.hotkey !== undefined ? parseString(patch.hotkey, base.hotkey) : base.hotkey,
    cancelHotkey: patch.cancelHotkey !== undefined ? parseString(patch.cancelHotkey, base.cancelHotkey) : base.cancelHotkey,
    holdThresholdMs:
      patch.holdThresholdMs !== undefined ? parseNumber(patch.holdThresholdMs, base.holdThresholdMs) : base.holdThresholdMs,
    engine: patch.engine !== undefined ? parseString(patch.engine, base.engine) : base.engine,
    modelId: patch.modelId !== undefined ? parseNullableString(patch.modelId, base.modelId) : base.modelId,
    device: patch.device !== undefined ? parseNullableString(patch.device, base.device) : base.device,
    channel: patch.channel !== undefined ? parseNullableNumber(patch.channel, base.channel) : base.channel,
    vadBackend: patch.vadBackend !== undefined ? parseVadBackend(patch.vadBackend, base.vadBackend as VadBackend) : base.vadBackend,
    vadEnergyThreshold:
      patch.vadEnergyThreshold !== undefined
        ? parseNumber(patch.vadEnergyThreshold, base.vadEnergyThreshold)
        : base.vadEnergyThreshold,
    vadFallbackReason:
      patch.vadFallbackReason !== undefined
        ? parseNullableString(patch.vadFallbackReason, base.vadFallbackReason ?? null)
        : base.vadFallbackReason,
    language: patch.language !== undefined ? parseNullableString(patch.language, base.language) : base.language,
    translateToEnglish:
      patch.translateToEnglish !== undefined
        ? parseBoolean(patch.translateToEnglish, base.translateToEnglish)
        : base.translateToEnglish,
    customWords: patch.customWords !== undefined ? parseStringArray(patch.customWords, base.customWords) : base.customWords,
    removeFillerWords:
      patch.removeFillerWords !== undefined
        ? parseBoolean(patch.removeFillerWords, base.removeFillerWords)
        : base.removeFillerWords,
    pasteMethod:
      patch.pasteMethod !== undefined ? parsePasteMethod(patch.pasteMethod, base.pasteMethod as PasteMethod) : base.pasteMethod,
    clipboardBehavior:
      patch.clipboardBehavior !== undefined
        ? parseClipboardBehavior(patch.clipboardBehavior, base.clipboardBehavior as ClipboardBehavior)
        : base.clipboardBehavior,
    pasteDelayMs: patch.pasteDelayMs !== undefined ? parseNumber(patch.pasteDelayMs, base.pasteDelayMs) : base.pasteDelayMs,
    pasteDelayAfterMs:
      patch.pasteDelayAfterMs !== undefined
        ? parseNumber(patch.pasteDelayAfterMs, base.pasteDelayAfterMs)
        : base.pasteDelayAfterMs,
    appendSpace: patch.appendSpace !== undefined ? parseBoolean(patch.appendSpace, base.appendSpace) : base.appendSpace,
    autoSubmit: patch.autoSubmit !== undefined ? parseBoolean(patch.autoSubmit, base.autoSubmit) : base.autoSubmit,
    feedbackEnabled:
      patch.feedbackEnabled !== undefined
        ? parseBoolean(patch.feedbackEnabled, base.feedbackEnabled)
        : base.feedbackEnabled,
    feedbackVolume:
      patch.feedbackVolume !== undefined ? parseNumber(patch.feedbackVolume, base.feedbackVolume) : base.feedbackVolume,
    soundTheme: patch.soundTheme !== undefined ? parseString(patch.soundTheme, base.soundTheme) : base.soundTheme,
    historyEnabled:
      patch.historyEnabled !== undefined ? parseBoolean(patch.historyEnabled, base.historyEnabled) : base.historyEnabled,
    historyLimit:
      patch.historyLimit !== undefined ? parseNumber(patch.historyLimit, base.historyLimit) : base.historyLimit,
    retentionDays:
      patch.retentionDays !== undefined ? parseNumber(patch.retentionDays, base.retentionDays) : base.retentionDays,
    postprocessEnabled:
      patch.postprocessEnabled !== undefined
        ? parseBoolean(patch.postprocessEnabled, base.postprocessEnabled)
        : base.postprocessEnabled,
    postprocessPrompt:
      patch.postprocessPrompt !== undefined
        ? parseString(patch.postprocessPrompt, base.postprocessPrompt)
        : base.postprocessPrompt,
    overlayEnabled:
      patch.overlayEnabled !== undefined ? parseBoolean(patch.overlayEnabled, base.overlayEnabled) : base.overlayEnabled,
    onboarded: patch.onboarded !== undefined ? parseBoolean(patch.onboarded, base.onboarded) : base.onboarded,
    accelerator: patch.accelerator !== undefined ? parseString(patch.accelerator, base.accelerator) : base.accelerator,
    gpuDevice: patch.gpuDevice !== undefined ? parseNullableString(patch.gpuDevice, base.gpuDevice) : base.gpuDevice,
    modelUnloadSecs:
      patch.modelUnloadSecs !== undefined
        ? parseNumber(patch.modelUnloadSecs, base.modelUnloadSecs)
        : base.modelUnloadSecs,
    denoise_highpass:
      patch.denoise_highpass !== undefined
        ? parseBoolean(patch.denoise_highpass, base.denoise_highpass)
        : base.denoise_highpass,
    denoise_highpass_hz:
      patch.denoise_highpass_hz !== undefined
        ? parseNumber(patch.denoise_highpass_hz, base.denoise_highpass_hz)
        : base.denoise_highpass_hz,
    denoise_gate:
      patch.denoise_gate !== undefined
        ? parseBoolean(patch.denoise_gate, base.denoise_gate)
        : base.denoise_gate,
    denoise_gate_db:
      patch.denoise_gate_db !== undefined
        ? parseNumber(patch.denoise_gate_db, base.denoise_gate_db)
        : base.denoise_gate_db,
    denoise_rnnoise:
      patch.denoise_rnnoise !== undefined
        ? parseBoolean(patch.denoise_rnnoise, base.denoise_rnnoise)
        : base.denoise_rnnoise,
    denoise_agc:
      patch.denoise_agc !== undefined
        ? parseBoolean(patch.denoise_agc, base.denoise_agc)
        : base.denoise_agc,
    denoise_agc_target_db:
      patch.denoise_agc_target_db !== undefined
        ? parseNumber(patch.denoise_agc_target_db, base.denoise_agc_target_db)
        : base.denoise_agc_target_db,
    dictationWave:
      patch.dictationWave !== undefined
        ? parseBoolean(patch.dictationWave, base.dictationWave)
        : base.dictationWave,
    dictationWaveBars:
      patch.dictationWaveBars !== undefined
        ? parseNumber(patch.dictationWaveBars, base.dictationWaveBars)
        : base.dictationWaveBars,
  };
}

const FIELD_TO_PREF: Record<keyof SpeechConfig, string> = {
  enabled: 'tempo_speech_enabled',
  activation: 'tempo_speech_activation',
  hotkey: 'tempo_speech_hotkey',
  cancelHotkey: 'tempo_speech_cancel_hotkey',
  holdThresholdMs: 'tempo_speech_hold_threshold_ms',
  engine: 'tempo_speech_engine',
  modelId: 'tempo_speech_model_id',
  device: 'tempo_speech_device',
  channel: 'tempo_speech_channel',
  vadBackend: 'tempo_speech_vad_backend',
  vadEnergyThreshold: 'tempo_speech_vad_energy_threshold',
  language: 'tempo_speech_language',
  translateToEnglish: 'tempo_speech_translate_to_english',
  vadFallbackReason: 'tempo_speech_vad_fallback_reason',
  customWords: 'tempo_speech_custom_words',
  removeFillerWords: 'tempo_speech_remove_filler_words',
  pasteMethod: 'tempo_speech_paste_method',
  clipboardBehavior: 'tempo_speech_clipboard_behavior',
  pasteDelayMs: 'tempo_speech_paste_delay_ms',
  pasteDelayAfterMs: 'tempo_speech_paste_delay_after_ms',
  appendSpace: 'tempo_speech_append_space',
  autoSubmit: 'tempo_speech_auto_submit',
  feedbackEnabled: 'tempo_speech_feedback_enabled',
  feedbackVolume: 'tempo_speech_feedback_volume',
  soundTheme: 'tempo_speech_sound_theme',
  historyEnabled: 'tempo_speech_history_enabled',
  historyLimit: 'tempo_speech_history_limit',
  retentionDays: 'tempo_speech_retention_days',
  postprocessEnabled: 'tempo_speech_postprocess_enabled',
  postprocessPrompt: 'tempo_speech_postprocess_prompt',
  overlayEnabled: 'tempo_speech_overlay_enabled',
  onboarded: 'tempo_speech_onboarded',
  accelerator: 'tempo_speech_accelerator',
  gpuDevice: 'tempo_speech_gpu_device',
  modelUnloadSecs: 'tempo_speech_model_unload_secs',
  denoise_highpass: 'tempo_speech_denoise_highpass',
  denoise_highpass_hz: 'tempo_speech_denoise_highpass_hz',
  denoise_gate: 'tempo_speech_denoise_gate',
  denoise_gate_db: 'tempo_speech_denoise_gate_db',
  denoise_rnnoise: 'tempo_speech_denoise_rnnoise',
  denoise_agc: 'tempo_speech_denoise_agc',
  denoise_agc_target_db: 'tempo_speech_denoise_agc_target_db',
  dictationWave: 'tempo_speech_dictation_wave',
  dictationWaveBars: 'tempo_speech_dictation_wave_bars',
};

async function persistToLocalPrefs(config: SpeechConfig, patch: Partial<SpeechConfig>): Promise<void> {
  const writes: Promise<void>[] = [];
  for (const key of Object.keys(patch) as Array<keyof SpeechConfig>) {
    const prefKey = FIELD_TO_PREF[key];
    if (prefKey && config[key] !== undefined) {
      writes.push(setPref(prefKey, config[key]));
    }
  }
  await Promise.all(writes);
}

export async function saveSpeechConfig(patch: Partial<SpeechConfig>): Promise<SpeechConfig> {
  let result: SpeechConfig;

  if (isTauri()) {
    try {
      result = await applySpeechConfig(patch);
    } catch {
      // In unit test environments where applySpeechConfig is unmocked or offline, fallback to local merge
      result = mergeSpeechConfig(loadSpeechConfig(), patch);
    }
  } else {
    result = mergeSpeechConfig(loadSpeechConfig(), patch);
  }

  // Update local pref cache from the returned config so UI and Rust cannot drift
  await persistToLocalPrefs(result, patch);
  return result;
}

export const saveSpeechSettings = saveSpeechConfig;
export const setSpeechSettings = saveSpeechConfig;

export function subscribeSpeechConfig(cb: (c: SpeechConfig) => void): () => void {
  return subscribePrefs((key) => {
    if (key.startsWith('tempo_speech_') || key.startsWith('alarmer_speech_')) {
      cb(loadSpeechConfig());
    }
  });
}

export const subscribeSpeechSettings = subscribeSpeechConfig;
