import {
  listRecordings,
  getRecording,
  updateTranscript,
  updateTranscriptStatus,
  reindexRecordings,
} from './recordings';
import { transcribeAudioFile, type TranscribeResult } from './stt';
export type { TranscribeResult };
export const transcribeFile = transcribeAudioFile;
/**
 * Result of transcribing a single recording file.
 */
export interface TranscribeSingleResult {
  id: string;
  success: boolean;
  transcript?: string;
  error?: string;
}

export interface TranscribeSummary {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Record<string, string>;
  results?: TranscribeSingleResult[];
}

export interface TranscribePendingOptions {
  limit?: number;
}

export type TranscribeBatchResult = TranscribeSummary;

/**
 * Builds the composite searchable text for a recording.
 * Per interfaces §22: transcriptSearchText(item: RecordingItem): string
 * If transcript is empty or whitespace-only, it is not indexed as transcript.
 */
export function transcriptSearchText(item: { title?: string | null; transcript?: string | null }): string {
  const cleanTitle = (item.title || '').trim();
  const cleanTranscript = (item.transcript || '').trim();

  if (!cleanTitle && !cleanTranscript) {
    return '';
  }
  if (!cleanTranscript) {
    return cleanTitle;
  }
  if (!cleanTitle) {
    return cleanTranscript;
  }
  return `${cleanTitle}\n${cleanTranscript}`;
}
export const buildRecordingSearchText = (title: string, transcript?: string | null) =>
  transcriptSearchText({ title, transcript });
export const getRecordingSearchText = transcriptSearchText;
/**
 * Transcribes a single recording by its ID.
 * Updates recording status to 'done' on success or 'failed' on failure.
 * Also triggers reindexing of the recording in the FTS search table.
 */
export async function transcribeRecording(
  id: string,
  filePath?: string,
): Promise<TranscribeResult> {
  // If filePath not provided, fetch recording to get it
  let path = filePath;
  if (!path) {
    const target = await getRecording(id);
    if (!target) {
      throw new Error(`Recording not found: ${id}`);
    }
    path = target.file_path;
  }

  try {
    const result = await transcribeAudioFile(path);
    await updateTranscript(id, result.text, 'done');
    try {
      await reindexRecordings();
    } catch {
      // Non-fatal if reindex fails
    }
    return result;
  } catch (err) {
    await updateTranscriptStatus(id, 'failed');
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(`Transcription failed for recording ${id}: ${reason}`, { cause: err });
  }
}

/**
 * Processes a bounded batch of recordings with pending transcript status.
 * Continues processing subsequent files even if one file fails.
 *
 * @param limit Maximum number of recordings to process in this run (default 10)
 */
export async function transcribePending(
  options: number | TranscribePendingOptions = 10,
): Promise<TranscribeSummary> {
  const limit = typeof options === 'number' ? options : (options.limit ?? 10);
  const all = await listRecordings();
  const pending = all.filter(
    (r) =>
      r.transcript_status === 'pending' ||
      (!r.transcript && r.transcript_status !== 'failed' && r.transcript_status !== 'done'),
  );

  const batch = pending.slice(0, Math.max(1, limit));
  const errors: Record<string, string> = {};
  const results: TranscribeSingleResult[] = [];
  let succeeded = 0;
  let failed = 0;

  for (const item of batch) {
    try {
      const res = await transcribeAudioFile(item.file_path);
      await updateTranscript(item.id, res.text, 'done');
      succeeded++;
      results.push({ id: item.id, success: true, transcript: res.text });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      errors[item.id] = msg;
      results.push({ id: item.id, success: false, error: msg });
      try {
        await updateTranscriptStatus(item.id, 'failed');
      } catch {
        // Ignore failure to update status
      }
    }
  }

  if (succeeded > 0) {
    try {
      await reindexRecordings();
    } catch {
      // Non-fatal
    }
  }

  return {
    total: batch.length,
    processed: succeeded + failed,
    succeeded,
    failed,
    errors,
    results,
  };
}
