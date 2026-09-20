// src/services/recordings.ts
// Wave 7 - Recordings Library (R15, R16, R43, R45): database repository & asset file management for recordings.

import { repo, type EntityMeta } from './db';
import { assetDelete, assetStat } from './assets';
import type { RecordingResult } from './recorder';
import { reindex } from './search';
export type RecordingKind = 'audio' | 'screen';
export type TranscriptStatus = 'pending' | 'done' | 'completed' | 'failed' | 'none';

/**
 * SQLite row representation in the 'recordings' table.
 * Conforms to interfaces §19 and EntityMeta:
 * (id, title, kind, file_path, duration_sec, transcript, transcript_status, updated_at, deleted_at)
 */
export interface RecordingRow extends EntityMeta {
  title: string;
  kind: RecordingKind;
  file_path: string;
  duration_sec: number;
  transcript: string | null;
  transcript_status: TranscriptStatus;
}

export interface RecordingItem {
  id: string;
  title: string;
  kind: RecordingKind;
  file_path: string;
  duration_sec: number;
  transcript: string | null;
  transcript_status: TranscriptStatus;
  updated_at: string;
}

export interface SaveRecordingInput {
  result: RecordingResult;
  kind: RecordingKind;
  title?: string;
  transcript?: string | null;
  transcript_status?: TranscriptStatus;
}

export interface UpdateRecordingInput {
  title?: string;
  transcript?: string | null;
  transcript_status?: TranscriptStatus;
}

const recordingsRepo = repo<RecordingRow>('recordings');

/**
 * Formats a default title for a recording based on current date and kind.
 */
function defaultRecordingTitle(kind: RecordingKind, date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const year = date.getFullYear();
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  const hours = pad(date.getHours());
  const mins = pad(date.getMinutes());
  const kindLabel = kind === 'screen' ? 'Screen Recording' : 'Audio Recording';
  return `${kindLabel} ${year}-${month}-${day} ${hours}:${mins}`;
}

/**
 * List all non-deleted recordings ordered by updated_at descending.
 */
export async function listRecordings(): Promise<RecordingItem[]> {
  const rows = await recordingsRepo.all();
  // Sort descending by updated_at
  return rows
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((row) => ({
      id: row.id,
      title: row.title,
      kind: row.kind,
      file_path: row.file_path,
      duration_sec: row.duration_sec,
      transcript: row.transcript,
      transcript_status: row.transcript_status,
      updated_at: row.updated_at,
    }));
}

/**
 * Get a recording by ID.
 * Returns null if not found or soft-deleted.
 */
export async function getRecording(id: string): Promise<RecordingItem | null> {
  const row = await recordingsRepo.byId(id);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    file_path: row.file_path,
    duration_sec: row.duration_sec,
    transcript: row.transcript,
    transcript_status: row.transcript_status,
    updated_at: row.updated_at,
  };
}

/**
 * Saves a completed recording to SQLite after a successful stop.
 * IMPORTANT: It MUST store the file_path from the recording result (written by Rust)
 * and never a caller-invented path.
 */
export async function saveRecording(
  resultOrInput: RecordingResult | SaveRecordingInput,
  kind?: RecordingKind,
  title?: string,
): Promise<RecordingItem> {
  let chosenResult: RecordingResult;
  let chosenKind: RecordingKind;
  let chosenTitleStr: string | undefined;
  let transcript: string | null = null;
  let transcriptStatus: TranscriptStatus = 'none';

  if ('result' in resultOrInput) {
    chosenResult = resultOrInput.result;
    chosenKind = resultOrInput.kind;
    chosenTitleStr = resultOrInput.title;
    transcript = resultOrInput.transcript ?? null;
    transcriptStatus = resultOrInput.transcript_status ?? 'none';
  } else {
    chosenResult = resultOrInput;
    chosenKind = kind ?? 'audio';
    chosenTitleStr = title;
  }

  const finalTitle = chosenTitleStr && chosenTitleStr.trim().length > 0
    ? chosenTitleStr.trim()
    : defaultRecordingTitle(chosenKind);

  const row = await recordingsRepo.insert({
    title: finalTitle,
    kind: chosenKind,
    file_path: chosenResult.path,
    duration_sec: chosenResult.duration_sec,
    transcript,
    transcript_status: transcriptStatus,
  });

  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    file_path: row.file_path,
    duration_sec: row.duration_sec,
    transcript: row.transcript,
    transcript_status: row.transcript_status,
    updated_at: row.updated_at,
  };
}

/**
 * Rename a recording by ID.
 */
export async function renameRecording(id: string, title: string): Promise<RecordingItem> {
  return updateRecording(id, { title: title.trim() });
}

/**
 * Update recording title or transcript fields.
 */
export async function updateRecording(
  id: string,
  patch: UpdateRecordingInput,
): Promise<RecordingItem> {
  const row = await recordingsRepo.update(id, patch);
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    file_path: row.file_path,
    duration_sec: row.duration_sec,
    transcript: row.transcript,
    transcript_status: row.transcript_status,
    updated_at: row.updated_at,
  };
}

/**
 * Updates the transcription text and status for a recording.
 */
export async function updateTranscript(
  id: string,
  transcript: string,
  status: 'done' | 'failed' = 'done',
): Promise<RecordingItem> {
  return updateRecording(id, {
    transcript,
    transcript_status: status,
  });
}

/**
 * Updates only the transcript status (e.g. to 'pending' or 'failed').
 */
export async function updateTranscriptStatus(
  id: string,
  status: 'pending' | 'done' | 'failed',
): Promise<RecordingItem> {
  return updateRecording(id, {
    transcript_status: status,
  });
}

/**
 * Soft-delete a recording row AND delete the media file via assetDelete (R43).
 * A row whose file is gone is invisible garbage.
 */
export async function deleteRecording(id: string): Promise<void> {
  const existing = await recordingsRepo.byId(id);
  if (!existing) {
    return;
  }

  // Soft-delete the database row
  await recordingsRepo.remove(id);

  // Remove the underlying file from disk
  if (existing.file_path) {
    try {
      await assetDelete(existing.file_path);
    } catch {
      // Deletion failure of an already missing file should not break the operation
    }
  }
}

/**
 * Returns the size in bytes of a recording's file on disk.
 * Returns 0 for a file that has already disappeared or failed to stat,
 * so the library screen never breaks if a file was pruned underneath it.
 */
export async function recordingBytes(target: string | RecordingItem): Promise<number> {
  const filePath = typeof target === 'string' ? target : target.file_path;
  if (!filePath) {
    return 0;
  }
  return assetStat(filePath);
}

/**
 * Reindexes the full-text search entries for recordings.
 *
 * The index is rebuilt per kind, not per row, so this takes no id — the callers
 * pass one because it reads naturally at the call site, and an unused parameter
 * would only suggest it is used.
 */
export async function reindexRecordings(): Promise<void> {
  try {
    await reindex('recording');
  } catch {
    // Non-fatal: search falls back to titles when the index is unavailable.
  }
}
