import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  getSyncStatus,
  setSyncTransport,
  setSyncMedia,
  syncNow,
  syncPending,
  toSyncError,
  SyncError,
} from '../sync';
import * as platform from '../platform';
import { invoke } from '@tauri-apps/api/core';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

describe('sync service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('toSyncError mapping', () => {
    it('maps folder missing strings to FolderMissing kind', () => {
      const err = toSyncError('folder_not_found: /path/does/not/exist');
      expect(err).toBeInstanceOf(SyncError);
      expect(err.kind).toBe('FolderMissing');
      expect(err.details).toBe('folder_not_found: /path/does/not/exist');
    });

    it('maps folder inaccessible or permission denied to FolderNotWritable', () => {
      const err = toSyncError('folder_inaccessible: Permission denied');
      expect(err.kind).toBe('FolderNotWritable');
    });

    it('maps no_transport to NoTransport', () => {
      const err = toSyncError('no_transport');
      expect(err.kind).toBe('NoTransport');
    });

    it('maps corrupt file errors to CorruptFile', () => {
      const err = toSyncError('corrupt peer file skipped');
      expect(err.kind).toBe('CorruptFile');
    });

    it('maps I/O errors to IoError', () => {
      const err = toSyncError('failed to write file: disk full');
      expect(err.kind).toBe('IoError');
    });

    it('maps unrecognized errors to Unknown', () => {
      const err = toSyncError('something completely unexpected');
      expect(err.kind).toBe('Unknown');
      expect(err.message).toBe('something completely unexpected');
    });

    it('preserves existing SyncError instance', () => {
      const original = new SyncError('FolderMissing', 'folder missing');
      expect(toSyncError(original)).toBe(original);
    });
  });

  describe('in Tauri environment', () => {
    beforeEach(() => {
      vi.spyOn(platform, 'isTauri').mockReturnValue(true);
    });

    it('calls sync_status via invoke', async () => {
      const mockStatus = {
        device_id: 'device-1234',
        transport: 'folder' as const,
        folder: '/shared/sync',
        last_sync: '2026-09-20T12:00:00Z',
        pending: 3,
        media: true,
      };
      vi.mocked(invoke).mockResolvedValueOnce(mockStatus);

      const res = await getSyncStatus();
      expect(invoke).toHaveBeenCalledWith('sync_status');
      expect(res).toEqual(mockStatus);
    });

    it('calls sync_set_transport via invoke with arguments', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await setSyncTransport('folder', '/my/sync/dir');
      expect(invoke).toHaveBeenCalledWith('sync_set_transport', {
        transport: 'folder',
        folder: '/my/sync/dir',
      });
    });

    it('calls sync_set_media via invoke with arguments', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(undefined);

      await setSyncMedia(true);
      expect(invoke).toHaveBeenCalledWith('sync_set_media', { enabled: true });
    });

    it('calls sync_now and returns outcome', async () => {
      const outcome = {
        sent: 2,
        received: 1,
        applied: 1,
        conflicts: 0,
        media_copied: 5,
      };
      vi.mocked(invoke).mockResolvedValueOnce(outcome);

      const res = await syncNow();
      expect(invoke).toHaveBeenCalledWith('sync_now');
      expect(res).toEqual(outcome);
    });

    it('catches and transforms raw invoke errors in syncNow to SyncError', async () => {
      vi.mocked(invoke).mockRejectedValueOnce('folder_not_found: /missing');
      await expect(syncNow()).rejects.toThrow(SyncError);

      vi.mocked(invoke).mockRejectedValueOnce('folder_not_found: /missing');
      try {
        await syncNow();
      } catch (e: unknown) {
        expect(e).toBeInstanceOf(SyncError);
        if (e instanceof SyncError) {
          expect(e.kind).toBe('FolderMissing');
        }
      }
    });

    it('calls sync_pending via invoke', async () => {
      vi.mocked(invoke).mockResolvedValueOnce(7);

      const count = await syncPending();
      expect(invoke).toHaveBeenCalledWith('sync_pending');
      expect(count).toBe(7);
    });
  });

  describe('in non-Tauri / mock environment', () => {
    beforeEach(() => {
      vi.spyOn(platform, 'isTauri').mockReturnValue(false);
    });

    it('allows updating transport and status locally without throwing', async () => {
      await setSyncTransport('folder', '/tmp/sync');
      const status = await getSyncStatus();
      expect(status.transport).toBe('folder');
      expect(status.folder).toBe('/tmp/sync');
    });

    it('allows updating media flag locally', async () => {
      await setSyncMedia(true);
      const status = await getSyncStatus();
      expect(status.media).toBe(true);
    });
  });
});
