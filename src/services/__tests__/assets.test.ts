// src/services/__tests__/assets.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  assetSave,
  assetDelete,
  assetUsage,
  assetPrune,
  assetStat,
  pruneOnStartup,
  DEFAULT_MEDIA_LIMIT_BYTES,
  uint8ArrayToBase64,
  AssetRef,
} from '../assets';

vi.mock('../settings', () => ({
  getPref: vi.fn(),
}));

import { getPref } from '../settings';
const mockGetPref = vi.mocked(getPref);

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('assets service', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  describe('uint8ArrayToBase64', () => {
    it('round-trips small byte arrays accurately', () => {
      const original = new Uint8Array([104, 101, 108, 108, 111]); // "hello"
      const encoded = uint8ArrayToBase64(original);
      expect(encoded).toBe(btoa('hello'));

      // Decode back
      const decodedStr = atob(encoded);
      const decodedBytes = new Uint8Array(decodedStr.length);
      for (let i = 0; i < decodedStr.length; i++) {
        decodedBytes[i] = decodedStr.charCodeAt(i);
      }
      expect(decodedBytes).toEqual(original);
    });

    it('handles a large-ish payload (e.g. 200 KB) without call-stack overflow', () => {
      const size = 200 * 1024; // 200 KB
      const largeData = new Uint8Array(size);
      for (let i = 0; i < size; i++) {
        largeData[i] = i % 256;
      }

      // Should not throw RangeError: Maximum call stack size exceeded
      expect(() => {
        const b64 = uint8ArrayToBase64(largeData);
        expect(b64.length).toBeGreaterThan(0);
      }).not.toThrow();
    });
  });

  describe('assetSave', () => {
    it('sends base64 encoded data to Rust and returns AssetRef', async () => {
      const bytes = new Uint8Array([1, 2, 3, 4, 5]);
      const expectedRef: AssetRef = {
        kind: 'drawing',
        path: '/mock/path/drawing/test.bin',
        bytes: 5,
      };

      mockInvoke.mockResolvedValueOnce(expectedRef);

      const result = await assetSave('drawing', 'test.bin', bytes);

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('asset_save', {
        kind: 'drawing',
        name: 'test.bin',
        data_base64: uint8ArrayToBase64(bytes),
      });
      expect(result).toEqual(expectedRef);

      // Verify the base64 sent actually round-trips to the original bytes
      const sentPayload = mockInvoke.mock.calls[0][1] as { data_base64: string };
      const raw = atob(sentPayload.data_base64);
      const reconstructed = new Uint8Array(raw.length);
      for (let i = 0; i < raw.length; i++) {
        reconstructed[i] = raw.charCodeAt(i);
      }
      expect(reconstructed).toEqual(bytes);
    });
  });

  describe('assetDelete', () => {
    it('accepts an AssetRef and invokes asset_delete with ref.path', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      const ref: AssetRef = {
        kind: 'preview',
        path: '/mock/data/assets/preview/canvas_1.png',
        bytes: 1234,
      };

      await assetDelete(ref);

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('asset_delete', {
        path: '/mock/data/assets/preview/canvas_1.png',
      });
    });

    it('accepts a string path directly and invokes asset_delete', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);

      await assetDelete('/mock/data/assets/drawing/sketch.json');

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('asset_delete', {
        path: '/mock/data/assets/drawing/sketch.json',
      });
    });
  });

  describe('assetUsage', () => {
    it('returns total bytes and by_kind map', async () => {
      const mockUsage = {
        total: 1048576,
        by_kind: {
          drawing: 524288,
          preview: 524288,
        },
      };
      mockInvoke.mockResolvedValueOnce(mockUsage);

      const res = await assetUsage();

      expect(mockInvoke).toHaveBeenCalledWith('asset_usage');
      expect(res).toEqual(mockUsage);
    });
  });

  describe('assetPrune', () => {
    it('passes limit_bytes to asset_prune command and returns result', async () => {
      const pruneResult = {
        removed: 3,
        freed: 2097152,
      };
      mockInvoke.mockResolvedValueOnce(pruneResult);

      const res = await assetPrune(5000000);

      expect(mockInvoke).toHaveBeenCalledWith('asset_prune', {
        limit_bytes: 5000000,
      });
      expect(res).toEqual(pruneResult);
    });
  });

  describe('assetStat', () => {
    it('returns file size in bytes from asset_stat', async () => {
      mockInvoke.mockResolvedValueOnce(123456);
      const size = await assetStat('C:/assets/audio/1.wav');
      expect(mockInvoke).toHaveBeenCalledWith('asset_stat', { path: 'C:/assets/audio/1.wav' });
      expect(size).toBe(123456);
    });

    it('returns 0 if asset_stat throws or file is missing', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('File not found'));
      const size = await assetStat('C:/assets/audio/missing.wav');
      expect(size).toBe(0);
    });
  });

  describe('pruneOnStartup', () => {
    it('does not call assetPrune when usage is under the cap', async () => {
      mockGetPref.mockReturnValue(DEFAULT_MEDIA_LIMIT_BYTES); // 1 GB
      mockInvoke.mockResolvedValueOnce({ total: 500000, by_kind: {} }); // assetUsage

      const result = await pruneOnStartup();
      expect(mockInvoke).toHaveBeenCalledWith('asset_usage');
      expect(mockInvoke).not.toHaveBeenCalledWith('asset_prune', expect.anything());
      expect(result).toEqual({ removed: 0, freed: 0 });
    });

    it('calls assetPrune when usage is over the cap', async () => {
      const customCap = 1000;
      mockGetPref.mockReturnValue(customCap);
      mockInvoke.mockResolvedValueOnce({ total: 2000, by_kind: {} }); // assetUsage
      mockInvoke.mockResolvedValueOnce({ removed: 2, freed: 1000 }); // assetPrune

      const result = await pruneOnStartup();
      expect(mockInvoke).toHaveBeenCalledWith('asset_usage');
      expect(mockInvoke).toHaveBeenCalledWith('asset_prune', { limit_bytes: customCap });
      expect(result).toEqual({ removed: 2, freed: 1000 });
    });
  });
});
