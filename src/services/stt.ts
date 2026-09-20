// src/services/stt.ts
// Wave 11 - Speech to Text (R22, R23, R24): typed wrapper over Rust STT commands.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';
import type { Translations } from './i18n';

export interface ModelInfo {
  id: string;
  name: string;
  bytes: number;
  wer: number;
  languages: string[];
  installed: boolean;
  path?: string | null;
}

export interface DownloadProgress {
  model_id: string;
  received: number;
  total: number;
  done: boolean;
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
  language: string;
}

export type SttErrorCode =
  | 'no_model'
  | 'no_microphone'
  | 'no_speech'
  | 'cloud_refused'
  | 'injection_impossible'
  | 'network_error'
  | 'disk_full'
  | 'unknown';

export class SttError extends Error {
  public readonly code: SttErrorCode;
  public readonly translationKey: keyof Translations;

  constructor(code: SttErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'SttError';
    this.code = code;
    this.translationKey = sttCodeToKey(code);
  }
}

/**
 * Maps an STT error code to a Translation key.
 */
function sttCodeToKey(code: SttErrorCode): keyof Translations {
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
    case 'unknown':
    default:
      return 'voiceActionFailed';
  }
}

/**
 * Maps an unknown error or error string/object to a structured SttError.
 */
export function mapSttError(err: unknown): SttError {
  if (err instanceof SttError) {
    return err;
  }

  const raw = typeof err === 'string' ? err : err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();

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
    lower.includes('no device') ||
    lower.includes('nodevice') ||
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
export function sttErrorKey(err: unknown): keyof Translations {
  return mapSttError(err).translationKey;
}

// --------------------------------------------------------------------------
// Core Service Methods
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
 * Downloads a Whisper model by ID.
 */
export async function downloadModel(modelId: string, mirror?: string): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stt_download', { modelId, mirror });
  } catch (err) {
    throw mapSttError(err);
  }
}

/**
 * Retrieves current download progress for a model.
 */
export async function downloadProgress(): Promise<DownloadProgress> {
  if (!isTauri()) {
    return { model_id: '', received: 0, total: 0, done: true, error: null };
  }
  return invoke<DownloadProgress>('stt_download_progress');
}
export const getDownloadProgress = downloadProgress;

/**
 * Cancels an active model download.
 */
export async function cancelDownload(): Promise<void> {
  if (!isTauri()) return;
  await invoke('stt_download_cancel');
}

/**
 * Deletes a downloaded model from disk.
 */
export async function deleteModel(modelId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('stt_model_delete', { modelId });
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
  await invoke('stt_cancel_dictation');
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
 * Poller utility for model download progress that guarantees teardown.
 * Progress polling stops automatically when a download ends or errors out,
 * ensuring no battery or CPU drain from orphaned intervals.
 */
export function pollDownloadProgress(
  onProgress: (progress: DownloadProgress) => void,
  intervalMs = 250,
  getProgressFn: () => Promise<DownloadProgress> = downloadProgress,
): () => void {
  let active = true;
  let timer: number | undefined = undefined;
  const tick = async () => {
    if (!active) return;
    try {
      const prog = await getProgressFn();
      if (!active) return;
      onProgress(prog);

      // Stop polling when done or error occurred
      if (prog.done || prog.error) {
        active = false;
        return;
      }
    } catch {
      // In case of communication failure, stop polling
      active = false;
      return;
    }

    if (active) {
      timer = window.setTimeout(tick, intervalMs);
    }
  };
  // Start immediately so the caller gets first progress without waiting an interval
  void tick();

  return () => {
    active = false;
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timer = undefined;
    }
  };
}
