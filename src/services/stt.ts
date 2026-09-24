// src/services/stt.ts
// Wave 11 - Speech to Text (R02, R03, R24, R25): typed wrapper over Rust STT commands.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';
import type { Translations } from './i18n';
import { loadSpeechConfig, type SpeechConfig } from './speechSettings';

export type SttModelEngine =
  | 'whisper'
  | 'parakeet'
  | 'canary'
  | 'cohere'
  | 'moonshine'
  | 'sensevoice'
  | 'gigaam';

export interface ModelInfo {
  id: string;
  name: string;
  engine?: SttModelEngine | string;
  archive?: string;
  supported?: boolean;
  unsupported?: boolean;
  unsupportedReason?: string;
  unsupported_reason?: string;
  description?: string;
  filename?: string;
  quant?: string;
  quants?: string[];
  bytes: number;
  sha256?: string | null;
  revision?: string | null;
  languages: string[];
  languageCount?: number;
  language_count?: number;
  speedScore?: number;
  speed_score?: number;
  accuracyScore?: number;
  accuracy_score?: number;
  parameters?: string;
  recommended?: boolean;
  recommendedRank?: number | null;
  supportsTranslation?: boolean;
  supports_translation?: boolean;
  supportsLanguageDetect?: boolean;
  supports_language_detect?: boolean;
  installed: boolean;
  path?: string | null;
  isDownloading?: boolean;
  is_downloading?: boolean;
  partialBytes?: number;
  partial_bytes?: number;
  isCustom?: boolean;
  is_custom?: boolean;
  source?: 'catalog' | 'custom' | string;
  wer?: number;
}

export interface DownloadProgress {
  model_id: string;
  modelId?: string;
  received: number;
  total: number;
  percentage?: number;
  speed_bps?: number;
  speedBps?: number;
  eta_secs?: number | null;
  etaSecs?: number | null;
  phase?: 'downloading' | 'verifying' | 'done' | 'cancelled' | 'error' | string;
  done?: boolean;
  error?: string | null;
}

export type SttEngineKind = 'local' | 'cloud';
export type SttEngineType = SttEngineKind;
export type DictationMode = 'type' | 'clipboard' | 'insert';

export interface EngineInfo {
  engine: SttEngineKind;
  model_id: string | null;
  available: boolean;
}

export interface DictationResult {
  text: string;
  duration_ms: number;
  engine: SttEngineKind;
}

export interface DictationState {
  recording: boolean;
  level: number;
  since: number | null;
}

export interface TranscribeResult {
  text: string;
  language?: string;
  duration_ms?: number;
}

export interface AudioDeviceInfo {
  name: string;
  isDefault: boolean;
  is_default?: boolean;
  channels: number;
}

export interface HistoryEntry {
  id: string;
  text: string;
  createdAt: string;
  created_at?: string;
  durationMs: number;
  duration_ms?: number;
  modelId?: string | null;
  model_id?: string | null;
  language?: string | null;
  audioPath?: string | null;
  audio_path?: string | null;
  saved: boolean;
  appName?: string | null;
  app_name?: string | null;
}

export interface AcceleratorInfo {
  id: string;
  name: string;
  kind: string;
  deviceType: string;
  device_type?: string;
  memoryTotal: number;
  memory_total?: number;
  memoryFree: number;
  memory_free?: number;
  isCpu: boolean;
  is_cpu?: boolean;
}

export type SttErrorCode =
  | 'no_model'
  | 'no_microphone'
  | 'no_speech'
  | 'cloud_refused'
  | 'injection_impossible'
  | 'network_error'
  | 'disk_full'
  | 'model_verify_failed'
  | 'hotkey_invalid'
  | 'hotkey_taken'
  | 'no_device'
  | 'import_failed'
  | 'postprocess_failed'
  | 'unknown';

export type SttTranslationKey =
  | keyof Translations
  | 'sttErrorModelVerifyFailed'
  | 'sttErrorHotkeyInvalid'
  | 'sttErrorHotkeyTaken'
  | 'sttErrorNoDevice'
  | 'sttErrorImportFailed'
  | 'sttErrorPostprocessFailed';

export class SttError extends Error {
  public readonly code: SttErrorCode;
  public readonly translationKey: SttTranslationKey;

  constructor(code: SttErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SttError';
    this.code = code;
    this.translationKey = sttCodeToKey(code);
  }
}

/**
 * Maps an STT error code to a Translation key name.
 */
function sttCodeToKey(code: SttErrorCode): SttTranslationKey {
  switch (code) {
    case 'no_model':
      return 'sttErrorNoModel';
    case 'no_microphone':
      return 'sttErrorNoMic';
    case 'no_speech':
      return 'noSpeechDetected';
    case 'cloud_refused':
      return 'sttErrorCloudRefused';
    case 'injection_impossible':
      return 'sttErrorInjectionFailed';
    case 'disk_full':
      return 'sttErrorDiskSpace';
    case 'network_error':
      return 'sttErrorNetwork';
    case 'model_verify_failed':
      return 'sttErrorModelVerifyFailed';
    case 'hotkey_invalid':
      return 'sttErrorHotkeyInvalid';
    case 'hotkey_taken':
      return 'sttErrorHotkeyTaken';
    case 'no_device':
      return 'sttErrorNoDevice';
    case 'import_failed':
      return 'sttErrorImportFailed';
    case 'postprocess_failed':
      return 'sttErrorPostprocessFailed';
    case 'unknown':
    default:
      return 'voiceActionFailed';
  }
}

const KNOWN_CODES: SttErrorCode[] = [
  'no_model',
  'no_microphone',
  'no_speech',
  'cloud_refused',
  'injection_impossible',
  'network_error',
  'disk_full',
  'model_verify_failed',
  'hotkey_invalid',
  'hotkey_taken',
  'no_device',
  'import_failed',
  'postprocess_failed',
  'unknown',
];

/**
 * Maps an unknown error, string, or object to a structured SttError.
 */
export function mapSttError(err: unknown): SttError {
  if (err instanceof SttError) {
    return err;
  }

  if (typeof err === 'object' && err !== null) {
    const maybeObj = err as Record<string, unknown>;
    const code = typeof maybeObj.code === 'string' ? maybeObj.code : undefined;
    const msg = typeof maybeObj.message === 'string' ? maybeObj.message : undefined;
    if (code) {
      const normalizedCode = code.toLowerCase() as SttErrorCode;
      if (KNOWN_CODES.includes(normalizedCode)) {
        return new SttError(normalizedCode, msg ?? code);
      }
    }
  }

  const raw = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();

  if (
    lower.includes('model_verify_failed') ||
    lower.includes('verify failed') ||
    lower.includes('verification failed') ||
    lower.includes('sha256 mismatch') ||
    lower.includes('checksum mismatch')
  ) {
    return new SttError('model_verify_failed', raw);
  }

  if (
    lower.includes('hotkey_taken') ||
    lower.includes('hotkey taken') ||
    lower.includes('already registered') ||
    lower.includes('shortcut taken') ||
    lower.includes('accelerator taken') ||
    lower.includes('hotkey in use')
  ) {
    return new SttError('hotkey_taken', raw);
  }

  if (
    lower.includes('hotkey_invalid') ||
    lower.includes('invalid hotkey') ||
    lower.includes('invalid accelerator') ||
    lower.includes('shortcut invalid') ||
    lower.includes('invalid shortcut')
  ) {
    return new SttError('hotkey_invalid', raw);
  }

  if (
    lower.includes('import_failed') ||
    lower.includes('failed to import') ||
    lower.includes('import failed') ||
    lower.includes('corrupt gguf') ||
    lower.includes('invalid gguf')
  ) {
    return new SttError('import_failed', raw);
  }

  if (
    lower.includes('postprocess_failed') ||
    lower.includes('postprocess failed') ||
    lower.includes('post-process failed') ||
    lower.includes('polish failed')
  ) {
    return new SttError('postprocess_failed', raw);
  }

  if (
    lower.includes('no_device') ||
    lower.includes('no device') ||
    lower.includes('device not found') ||
    lower.includes('audio device not found')
  ) {
    return new SttError('no_device', raw);
  }

  if (
    lower.includes('no model') ||
    lower.includes('not downloaded') ||
    lower.includes('model not found') ||
    lower.includes('nomodel') ||
    lower.includes('no_model')
  ) {
    return new SttError('no_model', raw);
  }

  if (
    lower.includes('microphone') ||
    lower.includes('mic') ||
    lower.includes('no_microphone') ||
    lower.includes('audio input')
  ) {
    return new SttError('no_microphone', raw);
  }

  if (
    lower.includes('no speech') ||
    lower.includes('nospeech') ||
    lower.includes('no_speech') ||
    lower.includes('silence') ||
    lower.includes('empty audio') ||
    lower.includes('empty capture')
  ) {
    return new SttError('no_speech', raw);
  }

  if (
    lower.includes('cloud') ||
    lower.includes('byok') ||
    lower.includes('401') ||
    lower.includes('unauthorized') ||
    lower.includes('quota') ||
    lower.includes('cloud_refused')
  ) {
    return new SttError('cloud_refused', raw);
  }

  if (
    lower.includes('inject') ||
    lower.includes('sendinput') ||
    lower.includes('elevated') ||
    lower.includes('injection_impossible')
  ) {
    return new SttError('injection_impossible', raw);
  }

  if (
    lower.includes('network') ||
    lower.includes('timeout') ||
    lower.includes('econnrefused') ||
    lower.includes('offline') ||
    lower.includes('connect')
  ) {
    return new SttError('network_error', raw);
  }

  if (
    lower.includes('disk') ||
    lower.includes('space') ||
    lower.includes('enospc') ||
    lower.includes('full')
  ) {
    return new SttError('disk_full', raw);
  }

  return new SttError('unknown', raw);
}

/**
 * Public helper mapping an arbitrary error or code to keyof Translations.
 */
export function sttErrorKey(err: unknown): SttTranslationKey {
  return mapSttError(err).translationKey;
}

// --------------------------------------------------------------------------
// Core Service Methods (interfaces.md §6)
// --------------------------------------------------------------------------

/**
 * Returns available local Whisper models and their download status.
 */
export async function listModels(): Promise<ModelInfo[]> {
  if (!isTauri()) {
    return [
      { id: 'tiny', name: 'Whisper Tiny', bytes: 77_652_000, wer: 10.4, languages: ['ru', 'en'], installed: false },
      { id: 'base', name: 'Whisper Base', bytes: 147_951_000, wer: 8.1, languages: ['ru', 'en'], installed: false },
      { id: 'small', name: 'Whisper Small', bytes: 487_600_000, wer: 5.7, languages: ['ru', 'en'], installed: false },
    ];
  }
  return invoke<ModelInfo[]>('stt_catalog');
}
export const getModelCatalog = listModels;

/**
 * Downloads a Whisper model by ID and optional quantization.
 */
export async function downloadModel(modelId: string, quant?: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_download', { modelId, quant });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Retrieves current download progress for models as an array.
 */
export async function downloadProgress(): Promise<DownloadProgress[]> {
  if (!isTauri()) {
    return [];
  }
  try {
    const res = await invoke<DownloadProgress[] | DownloadProgress>('stt_download_progress');
    if (Array.isArray(res)) {
      return res;
    }
    if (res && typeof res === 'object' && ('model_id' in res || 'modelId' in res)) {
      return [res as DownloadProgress];
    }
    return [];
  } catch {
    return [];
  }
}
export const getDownloadProgress = downloadProgress;

/**
 * Cancels an active model download.
 */
export async function cancelDownload(modelId?: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_download_cancel', modelId ? { modelId } : {});
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Deletes a downloaded model from disk.
 */
export async function deleteModel(modelId: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_model_delete', { modelId });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Rescans the models directory on disk.
 */
export async function rescanModels(): Promise<ModelInfo[]> {
  if (!isTauri()) {
    return listModels();
  }
  try {
    return await invoke<ModelInfo[]>('stt_rescan_models');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Imports a custom .gguf model file.
 */
export async function importModel(path: string): Promise<ModelInfo> {
  if (!isTauri()) {
    return {
      id: 'custom-imported',
      name: 'Custom Model',
      bytes: 100_000_000,
      languages: ['en'],
      installed: true,
      isCustom: true,
      source: 'custom',
    };
  }
  try {
    return await invoke<ModelInfo>('stt_import_model', { path });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Returns the path to the models storage directory.
 */
export async function modelsDir(): Promise<string> {
  if (!isTauri()) return '';
  return invoke<string>('stt_models_dir');
}

/**
 * Opens the models directory in system file explorer.
 */
export async function openModelsDir(): Promise<void> {
  if (!isTauri()) return;
  await invoke('stt_open_models_dir');
}

/**
 * Returns free disk space in bytes on the models storage drive.
 */
export async function freeDiskSpace(): Promise<number> {
  if (!isTauri()) return 0;
  return invoke<number>('stt_free_disk_space');
}

/**
 * Retrieves the current STT engine and its availability.
 */
export async function getEngine(): Promise<EngineInfo> {
  if (!isTauri()) {
    return { engine: 'local', model_id: 'base', available: false };
  }
  return invoke<EngineInfo>('stt_engine');
}
export const getSttEngine = getEngine;

/**
 * Configures the STT engine ('local' | 'cloud') and selected model ID.
 */
export async function setEngine(engine: SttEngineKind, modelId?: string | null): Promise<void> {
  if (!isTauri()) return;
  await invoke('stt_set_engine', { engine, modelId: modelId ?? null });
}
export const setSttEngine = setEngine;

/**
 * Starts speech dictation.
 */
export async function startDictation(mode: DictationMode = 'insert'): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_start_dictation', { mode });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Stops dictation and returns the recognized text, duration and engine used.
 */
export async function stopDictation(): Promise<DictationResult> {
  if (!isTauri()) {
    return { text: '', duration_ms: 0, engine: 'local' };
  }
  try {
    return await invoke<DictationResult>('stt_stop_dictation');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Cancels active dictation without processing speech.
 */
export async function cancelDictation(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_cancel_dictation');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Returns current dictation recording state and audio level.
 */
export async function dictationState(): Promise<DictationState> {
  if (!isTauri()) {
    return { recording: false, level: 0, since: null };
  }
  return invoke<DictationState>('stt_dictation_state');
}
export const getDictationState = dictationState;

/**
 * Transcribes an audio file on disk via Rust stt_transcribe_file.
 */
export async function transcribeFile(path: string): Promise<TranscribeResult> {
  if (!isTauri()) {
    return { text: '', language: 'en' };
  }
  try {
    return await invoke<TranscribeResult>('stt_transcribe_file', { path });
  } catch (err) {
    throw mapSttError(err);
  }
}
export const transcribeAudioFile = transcribeFile;

/**
 * Retrieves speech configuration as seen by the backend.
 */
export async function speectConfig(): Promise<SpeechConfig> {
  if (!isTauri()) {
    return loadSpeechConfig();
  }
  return invoke<SpeechConfig>('stt_speech_settings');
}
export const speechConfig = speectConfig;

/**
 * Applies a speech configuration patch to backend and preferences.
 */
export async function applySpeechConfig(patch: Partial<SpeechConfig>): Promise<SpeechConfig> {
  if (!isTauri()) {
    const current = loadSpeechConfig();
    return { ...current, ...patch };
  }
  try {
    return await invoke<SpeechConfig>('stt_apply_speech_settings', { patch });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Validates a hotkey combination against backend shortcut parser and register test.
 */
export async function validateHotkey(accel: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_validate_hotkey', { accelerator: accel });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Temporarily suspends global shortcuts (e.g. while recording a hotkey in UI).
 */
export async function suspendShortcuts(): Promise<void> {
  if (!isTauri()) return;
  await invoke('stt_suspend_shortcuts');
}

/**
 * Resumes global shortcuts after suspension.
 */
export async function resumeShortcuts(): Promise<void> {
  if (!isTauri()) return;
  await invoke('stt_resume_shortcuts');
}

/**
 * Lists available audio input devices (microphones).
 */
export async function inputDevices(): Promise<AudioDeviceInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<AudioDeviceInfo[]>('stt_input_devices');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Returns available channels for a given audio input device.
 */
export async function inputChannels(device: string): Promise<number> {
  if (!isTauri()) return 1;
  try {
    return await invoke<number>('stt_input_channels', { device });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Lists available audio output devices.
 */
export async function outputDevices(): Promise<string[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<string[]>('stt_output_devices');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Plays a test feedback sound ('start' | 'stop').
 */
export async function playTestSound(kind: 'start' | 'stop'): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_play_test_sound', { kind });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Returns live microphone audio level for level metering without recording.
 */
export async function micLevel(): Promise<number> {
  if (!isTauri()) return 0;
  try {
    return await invoke<number>('stt_mic_level');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Lists recent dictation history entries.
 */
export async function historyList(limit?: number): Promise<HistoryEntry[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<HistoryEntry[]>('stt_history_list', { limit });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Deletes a dictation history entry.
 */
export async function historyDelete(id: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_history_delete', { id });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Marks a dictation history entry as saved (starred/pinned).
 */
export async function historySetSaved(id: string, saved: boolean): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_history_set_saved', { id, saved });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Retries transcription on a saved history entry's recorded audio.
 */
export async function historyRetry(id: string): Promise<TranscribeResult> {
  if (!isTauri()) {
    return { text: '', language: 'en' };
  }
  try {
    return await invoke<TranscribeResult>('stt_history_retry', { id });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Clears the entire dictation history.
 */
export async function historyClear(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_history_clear');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Runs text post-processing / polish through the AI model.
 */
export async function postprocessText(text: string): Promise<string> {
  if (!isTauri()) return text;
  try {
    return await invoke<string>('stt_postprocess', { text });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Lists available compute accelerators for Whisper transcription.
 */
export async function accelerators(): Promise<AcceleratorInfo[]> {
  if (!isTauri()) return [];
  try {
    return await invoke<AcceleratorInfo[]>('stt_accelerators');
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Poller utility for model download progress that guarantees teardown.
 * Progress polling stops automatically when a download ends or errors out,
 * ensuring no battery or CPU drain from orphaned intervals.
 */
export function pollDownloadProgress(
  onProgress: (progress: DownloadProgress) => void,
  intervalMs = 250,
  getProgressFn?: () => Promise<DownloadProgress | DownloadProgress[]>,
): () => void {
  let active = true;
  let timer: number | undefined = undefined;

  const fetchProgress =
    getProgressFn ??
    (async () => {
      const list = await downloadProgress();
      return list[0] ?? { model_id: '', received: 0, total: 0, done: true, error: null };
    });

  const tick = async () => {
    if (!active) return;
    try {
      const prog = await fetchProgress();
      if (!active) return;

      if (Array.isArray(prog)) {
        for (const p of prog) {
          onProgress(p);
        }
        const anyActive = prog.some((p) => !p.done && !p.error);
        if (prog.length > 0 && !anyActive) {
          active = false;
          return;
        }
      } else {
        onProgress(prog);
        if (prog.done || prog.error) {
          active = false;
          return;
        }
      }
    } catch {
      active = false;
      return;
    }

    if (active) {
      timer = window.setTimeout(tick, intervalMs);
    }
  };

  void tick();

  return () => {
    active = false;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
}
