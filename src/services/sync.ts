import { isTauri } from './platform';
import { invoke } from '@tauri-apps/api/core';

export interface SyncTransport {
  kind: 'none' | 'folder';
  folder: string | null;
}

export interface SyncStatus {
  device_id: string;
  transport: 'none' | 'folder';
  folder: string | null;
  last_sync: string | null;
  pending: number;
  media: boolean;
}

export interface SyncOutcome {
  sent: number;
  received: number;
  applied: number;
  conflicts: number;
  media_copied: number;
}

export type SyncErrorKind =
  | 'FolderMissing'
  | 'FolderNotWritable'
  | 'NoTransport'
  | 'CorruptFile'
  | 'IoError'
  | 'Unknown';

export class SyncError extends Error {
  readonly kind: SyncErrorKind;
  readonly details?: string;

  constructor(kind: SyncErrorKind, message: string, details?: string) {
    super(message);
    this.name = 'SyncError';
    this.kind = kind;
    this.details = details;
    Object.setPrototypeOf(this, SyncError.prototype);
  }
}

/**
 * Normalises raw errors thrown from Tauri IPC / sync_now into a typed SyncError.
 */
export function toSyncError(err: unknown): SyncError {
  if (err instanceof SyncError) {
    return err;
  }

  const raw = err instanceof Error ? err.message : String(err ?? '');
  const lower = raw.toLowerCase();

  if (
    lower.includes('folder_not_found') ||
    lower.includes('folder missing') ||
    lower.includes('not found') ||
    lower.includes('no such file or directory')
  ) {
    return new SyncError('FolderMissing', 'Sync folder was not found', raw);
  }

  if (
    lower.includes('folder_inaccessible') ||
    lower.includes('permission denied') ||
    lower.includes('read-only') ||
    lower.includes('not writable')
  ) {
    return new SyncError('FolderNotWritable', 'Sync folder is not writable or inaccessible', raw);
  }

  if (lower.includes('no_transport') || lower.includes('folder_not_configured')) {
    return new SyncError('NoTransport', 'Sync transport is not configured', raw);
  }

  if (lower.includes('corrupt') || lower.includes('malformed') || lower.includes('invalid json')) {
    return new SyncError('CorruptFile', 'Corrupt peer file encountered', raw);
  }

  if (lower.includes('io error') || lower.includes('failed to write') || lower.includes('failed to read')) {
    return new SyncError('IoError', 'File I/O error during sync', raw);
  }

  return new SyncError('Unknown', raw || 'Unknown sync error', raw);
}

// In-memory fallback state for non-Tauri / mock environments
const mockStatus: SyncStatus = {
  device_id: 'mock-device-uuid',
  transport: 'none',
  folder: null,
  last_sync: null,
  pending: 0,
  media: false,
};

/**
 * Retrieves the current synchronization status from the backend.
 */
export async function getSyncStatus(): Promise<SyncStatus> {
  if (!isTauri()) {
    return { ...mockStatus };
  }
  return await invoke<SyncStatus>('sync_status');
}

/**
 * Updates the sync transport configuration (none or shared folder path).
 */
export async function setSyncTransport(
  kind: 'none' | 'folder',
  folder?: string | null
): Promise<void> {
  if (!isTauri()) {
    mockStatus.transport = kind;
    mockStatus.folder = folder ?? null;
    return;
  }
  await invoke('sync_set_transport', {
    transport: kind,
    folder: folder ?? null,
  });
}

/**
 * Enables or disables syncing of media attachment files.
 */
export async function setSyncMedia(enabled: boolean): Promise<void> {
  if (!isTauri()) {
    mockStatus.media = enabled;
    return;
  }
  await invoke('sync_set_media', { enabled });
}

/**
 * Executes a sync cycle against the configured transport immediately.
 * Throws a typed SyncError on failure.
 */
export async function syncNow(): Promise<SyncOutcome> {
  if (!isTauri()) {
    if (mockStatus.transport === 'none' || !mockStatus.folder) {
      throw new SyncError('NoTransport', 'Sync transport is not configured');
    }
    mockStatus.last_sync = new Date().toISOString();
    mockStatus.pending = 0;
    return {
      sent: 0,
      received: 0,
      applied: 0,
      conflicts: 0,
      media_copied: 0,
    };
  }

  try {
    return await invoke<SyncOutcome>('sync_now');
  } catch (err) {
    throw toSyncError(err);
  }
}

/**
 * Returns the count of pending local journal entries waiting to be synced.
 */
export async function syncPending(): Promise<number> {
  if (!isTauri()) {
    return mockStatus.pending;
  }
  return await invoke<number>('sync_pending');
}
