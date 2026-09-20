// src/services/__tests__/recordings.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listRecordings,
  getRecording,
  saveRecording,
  updateRecording,
  renameRecording,
  deleteRecording,
  recordingBytes,
  RecordingItem,
} from '../recordings';

interface MockRecordingDbRow {
  id: string;
  title: string;
  kind: 'audio' | 'screen';
  file_path: string;
  duration_sec: number;
  transcript: string | null;
  transcript_status: string;
  updated_at: string;
  deleted_at: string | null;
}

const mockRows: Map<string, MockRecordingDbRow> = new Map();
let mockIdCounter = 1;

vi.mock('../db', () => ({
  repo: vi.fn(() => ({
    all: vi.fn(async () => Array.from(mockRows.values()).filter((r) => !r.deleted_at)),
    byId: vi.fn(async (id: string) => mockRows.get(id) ?? null),
    insert: vi.fn(async (data: Omit<MockRecordingDbRow, 'id' | 'updated_at' | 'deleted_at'>) => {
      const id = `rec-${mockIdCounter++}`;
      const now = new Date().toISOString();
      const row: MockRecordingDbRow = {
        id,
        ...data,
        updated_at: now,
        deleted_at: null,
      };
      mockRows.set(id, row);
      return row;
    }),
    update: vi.fn(async (id: string, patch: Partial<MockRecordingDbRow>) => {
      const existing = mockRows.get(id);
      if (!existing) throw new Error(`Not found: ${id}`);
      const updated: MockRecordingDbRow = {
        ...existing,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      mockRows.set(id, updated);
      return updated;
    }),
    remove: vi.fn(async (id: string) => {
      const existing = mockRows.get(id);
      if (existing) {
        existing.deleted_at = new Date().toISOString();
      }
    }),
  })),
}));

// Mock assets.ts
vi.mock('../assets', () => ({
  assetDelete: vi.fn(async () => undefined),
  assetStat: vi.fn(async (path: string) => {
    if (path === 'C:/assets/audio/exists.wav') {
      return 42000;
    }
    return 0; // vanished / not found
  }),
}));

import { assetDelete, assetStat } from '../assets';

const mockAssetDelete = vi.mocked(assetDelete);
const mockAssetStat = vi.mocked(assetStat);

describe('recordings service', () => {
  beforeEach(() => {
    mockRows.clear();
    mockIdCounter = 1;
    vi.clearAllMocks();
  });

  describe('saveRecording', () => {
    it('stores the returned path from Rust and never a caller-supplied path', async () => {
      const rustResult = {
        path: 'C:/tempo/data/assets/audio/rec_2026-09-20.wav',
        duration_sec: 45.2,
        bytes: 1048576,
      };

      const saved = await saveRecording({
        result: rustResult,
        kind: 'audio',
      });

      expect(saved.file_path).toBe('C:/tempo/data/assets/audio/rec_2026-09-20.wav');
      expect(saved.duration_sec).toBe(45.2);
      expect(saved.kind).toBe('audio');
      expect(saved.title).toMatch(/Audio/);

      const inDb = await getRecording(saved.id);
      expect(inDb).not.toBeNull();
      expect(inDb?.file_path).toBe('C:/tempo/data/assets/audio/rec_2026-09-20.wav');
    });

    it('uses user title if provided or defaults title to date and kind', async () => {
      const rustResult = {
        path: 'C:/assets/screen/take1.mp4',
        duration_sec: 120,
        bytes: 5000000,
      };

      const custom = await saveRecording({
        result: rustResult,
        kind: 'screen',
        title: 'Sprint Demo 42',
      });
      expect(custom.title).toBe('Sprint Demo 42');

      const fallback = await saveRecording({
        result: rustResult,
        kind: 'screen',
      });
      expect(fallback.title).toMatch(/Screen/);
    });

    it('supports direct (result, kind, title) positional arguments', async () => {
      const rustResult = {
        path: 'C:/assets/audio/voice.wav',
        duration_sec: 10,
        bytes: 1000,
      };

      const item = await saveRecording(rustResult, 'audio', 'My Meeting');
      expect(item.title).toBe('My Meeting');
      expect(item.file_path).toBe(rustResult.path);
    });
  });

  describe('deleteRecording', () => {
    it('removes both the row and the file through assetDelete (R43)', async () => {
      const rustResult = {
        path: 'C:/assets/audio/delete_me.wav',
        duration_sec: 5,
        bytes: 2048,
      };

      const item = await saveRecording({
        result: rustResult,
        kind: 'audio',
      });

      await deleteRecording(item.id);

      // Verify DB row soft deleted
      const items = await listRecordings();
      expect(items.find((i) => i.id === item.id)).toBeUndefined();

      // Verify assetDelete was called on the file path
      expect(mockAssetDelete).toHaveBeenCalledWith('C:/assets/audio/delete_me.wav');
    });

    it('does not throw if file deletion fails or file is already gone', async () => {
      mockAssetDelete.mockRejectedValueOnce(new Error('File not found'));

      const rustResult = {
        path: 'C:/assets/audio/vanished.wav',
        duration_sec: 5,
        bytes: 2048,
      };

      const item = await saveRecording({
        result: rustResult,
        kind: 'audio',
      });

      await expect(deleteRecording(item.id)).resolves.not.toThrow();
    });
  });

  describe('recordingBytes', () => {
    it('returns size in bytes for existing file', async () => {
      const size = await recordingBytes('C:/assets/audio/exists.wav');
      expect(size).toBe(42000);
      expect(mockAssetStat).toHaveBeenCalledWith('C:/assets/audio/exists.wav');
    });

    it('returns 0 for a file that has disappeared underneath', async () => {
      const size = await recordingBytes('C:/assets/audio/pruned_away.wav');
      expect(size).toBe(0);
    });

    it('accepts a RecordingItem object directly', async () => {
      const item: RecordingItem = {
        id: '1',
        title: 'Test',
        kind: 'audio',
        file_path: 'C:/assets/audio/exists.wav',
        duration_sec: 10,
        transcript: null,
        transcript_status: 'none',
        updated_at: '2026-09-20',
      };

      const size = await recordingBytes(item);
      expect(size).toBe(42000);
    });

    it('returns 0 if file_path is empty', async () => {
      const size = await recordingBytes('');
      expect(size).toBe(0);
    });
  });

  describe('renameRecording and updateRecording', () => {
    it('renames recording title', async () => {
      const item = await saveRecording({
        result: { path: 'C:/1.wav', duration_sec: 1, bytes: 10 },
        kind: 'audio',
      });

      const renamed = await renameRecording(item.id, 'New Title');
      expect(renamed.title).toBe('New Title');

      const retrieved = await getRecording(item.id);
      expect(retrieved?.title).toBe('New Title');
    });

    it('updates transcript and transcript_status', async () => {
      const item = await saveRecording({
        result: { path: 'C:/1.wav', duration_sec: 1, bytes: 10 },
        kind: 'audio',
      });

      const updated = await updateRecording(item.id, {
        transcript: 'Hello world transcription',
        transcript_status: 'completed',
      });

      expect(updated.transcript).toBe('Hello world transcription');
      expect(updated.transcript_status).toBe('completed');
    });
  });
});
