// src/services/recorder.ts
// Wave 7 - Audio & Screen Recording (R15, R16, R45, R46): typed wrapper over Rust recording commands.

import { invoke } from '@tauri-apps/api/core';
import type { Translations } from './i18n';

export interface DeviceInfo {
  id: string;
  name: string;
  is_default: boolean;
}

export interface SourceInfo {
  id: string;
  name: string;
  kind: 'monitor' | 'window';
  width: number;
  height: number;
  is_primary: boolean;
}

export interface StartOptions {
  kind: 'audio' | 'screen';
  source_id?: string;
  fps?: number;
  mic?: string;
  system?: boolean;
}

export interface RecordingState {
  kind: 'audio' | 'screen' | null;
  paused: boolean;
  path: string | null;
  /** Epoch seconds when the recording started; null when idle. */
  started_at: number | null;
}

export interface RecordingResult {
  path: string;
  duration_sec: number;
  bytes: number;
}

export type RecordingErrorVariant =
  | 'NoDevice'
  | 'AccessDenied'
  | 'DeviceBusy'
  | 'Unsupported'
  | 'AlreadyRecording'
  | 'NotRecording';

export type RecorderErrorVariant = RecordingErrorVariant;

export class RecordingError extends Error {
  public readonly variant: RecordingErrorVariant;

  constructor(variant: RecordingErrorVariant, message?: string) {
    super(message ?? variant);
    this.name = 'RecordingError';
    this.variant = variant;
    // Maintain proper prototype chain for instanceof checks
    Object.setPrototypeOf(this, RecordingError.prototype);
  }
}

export const RecorderError = RecordingError;
const KNOWN_ERROR_VARIANTS: Record<RecordingErrorVariant, true> = {
  NoDevice: true,
  AccessDenied: true,
  DeviceBusy: true,
  Unsupported: true,
  AlreadyRecording: true,
  NotRecording: true,
};

function isRecordingErrorVariant(v: string): v is RecordingErrorVariant {
  return Object.prototype.hasOwnProperty.call(KNOWN_ERROR_VARIANTS, v);
}
function parseRecordingError(err: unknown): RecordingError {
  if (err instanceof RecordingError) {
    return err;
  }
  if (typeof err === 'string' && isRecordingErrorVariant(err)) {
    return new RecordingError(err);
  }
  if (err && typeof err === 'object' && 'variant' in err && typeof (err as { variant: unknown }).variant === 'string') {
    const v = (err as { variant: string }).variant;
    if (isRecordingErrorVariant(v)) {
      return new RecordingError(v);
    }
  }
  // Generic error fallback
  const msg = err instanceof Error ? err.message : String(err);
  for (const variant of Object.keys(KNOWN_ERROR_VARIANTS) as RecordingErrorVariant[]) {
    if (msg.includes(variant)) {
      return new RecordingError(variant, msg);
    }
  }
  return new RecordingError('Unsupported', msg);
}

/**
 * Maps a recording error to a typed translation key so components never match on message strings (R45).
 */
export function recordingErrorKey(
  err: unknown,
  kind?: 'audio' | 'screen',
): keyof Translations {
  const error = parseRecordingError(err);
  switch (error.variant) {
    case 'NoDevice':
      return kind === 'screen' ? 'recNoSources' : 'recNoDevices';
    case 'AccessDenied':
      return kind === 'screen' ? 'recPermissionScreen' : 'recPermissionMic';
    case 'DeviceBusy':
      return 'recPermissionHint';
    case 'Unsupported':
    case 'AlreadyRecording':
    case 'NotRecording':
    default:
      return kind === 'screen' ? 'recPermissionScreen' : 'recPermissionMic';
  }
}

export const recorderErrorKey = recordingErrorKey;

export async function listDevices(): Promise<{ inputs: DeviceInfo[]; loopback: DeviceInfo[] }> {
  try {
    return await invoke<{ inputs: DeviceInfo[]; loopback: DeviceInfo[] }>('recording_devices');
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function listSources(): Promise<SourceInfo[]> {
  try {
    return await invoke<SourceInfo[]>('recording_sources');
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function previewSource(sourceId: string): Promise<string> {
  try {
    return await invoke<string>('recording_preview', { source_id: sourceId });
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function startRecording(options: StartOptions): Promise<{ path: string; kind: 'audio' | 'screen' }> {
  try {
    return await invoke<{ path: string; kind: 'audio' | 'screen' }>('recording_start', { options });
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function pauseRecording(paused: boolean): Promise<void> {
  try {
    await invoke<void>('recording_pause', { paused });
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function stopRecording(): Promise<RecordingResult> {
  try {
    return await invoke<RecordingResult>('recording_stop');
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function cancelRecording(): Promise<void> {
  try {
    await invoke<void>('recording_cancel');
  } catch (err) {
    throw parseRecordingError(err);
  }
}

export async function recordingState(): Promise<RecordingState> {
  try {
    return await invoke<RecordingState>('recording_state');
  } catch (err) {
    throw parseRecordingError(err);
  }
}

/**
 * Polls audio input / recording levels (~10x/sec).
 * Returns zeros instead of throwing when not recording or if invoke fails,
 * preventing unhandled rejections during UI polling loops.
 */
export async function recordingLevel(): Promise<{ peak: number; rms: number }> {
  try {
    return await invoke<{ peak: number; rms: number }>('recording_level');
  } catch {
    return { peak: 0, rms: 0 };
  }
}
