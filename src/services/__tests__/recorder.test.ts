// src/services/__tests__/recorder.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listDevices,
  listSources,
  previewSource,
  startRecording,
  pauseRecording,
  stopRecording,
  cancelRecording,
  recordingState,
  recordingLevel,
  RecordingError,
  recordingErrorKey,
  recorderErrorKey,
} from '../recorder';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';

const mockInvoke = vi.mocked(invoke);

describe('recorder service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listDevices and listSources', () => {
    it('calls recording_devices and returns devices', async () => {
      const mockDevices = {
        inputs: [{ id: 'mic1', name: 'Default Mic', is_default: true }],
        loopback: [{ id: 'loop1', name: 'System Audio', is_default: true }],
      };
      mockInvoke.mockResolvedValueOnce(mockDevices);

      const result = await listDevices();
      expect(mockInvoke).toHaveBeenCalledWith('recording_devices');
      expect(result).toEqual(mockDevices);
    });

    it('calls recording_sources and returns sources', async () => {
      const mockSources = [
        { id: 'mon1', name: 'Display 1', kind: 'monitor', width: 1920, height: 1080, is_primary: true },
      ];
      mockInvoke.mockResolvedValueOnce(mockSources);

      const result = await listSources();
      expect(mockInvoke).toHaveBeenCalledWith('recording_sources');
      expect(result).toEqual(mockSources);
    });

    it('calls recording_preview with source_id', async () => {
      mockInvoke.mockResolvedValueOnce('C:/data/assets/preview/preview.png');

      const result = await previewSource('mon1');
      expect(mockInvoke).toHaveBeenCalledWith('recording_preview', { source_id: 'mon1' });
      expect(result).toBe('C:/data/assets/preview/preview.png');
    });
  });

  describe('startRecording', () => {
    it('calls recording_start with normalized options and returns result', async () => {
      mockInvoke.mockResolvedValueOnce({ path: 'C:/data/assets/audio/rec.wav', kind: 'audio' });

      const res = await startRecording({
        kind: 'audio',
        mic: 'mic1',
        system: true,
      });

      expect(mockInvoke).toHaveBeenCalledWith('recording_start', {
        options: {
          kind: 'audio',
          source_id: undefined,
          fps: undefined,
          mic: 'mic1',
          system: true,
        },
      });
      expect(res).toEqual({ path: 'C:/data/assets/audio/rec.wav', kind: 'audio' });
    });

    it('rejects with typed RecordingError on Rust error variant string', async () => {
      mockInvoke.mockRejectedValueOnce('AccessDenied');

      await expect(startRecording({ kind: 'audio' })).rejects.toThrow(RecordingError);

      try {
        await startRecording({ kind: 'audio' });
      } catch (err) {
        expect(err).toBeInstanceOf(RecordingError);
        expect((err as RecordingError).variant).toBe('AccessDenied');
      }
    });

    it('rejects with typed RecordingError on NoDevice error', async () => {
      mockInvoke.mockRejectedValueOnce('NoDevice');

      try {
        await startRecording({ kind: 'audio' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RecordingError);
        expect((err as RecordingError).variant).toBe('NoDevice');
      }
    });

    it('rejects with typed RecordingError on AlreadyRecording', async () => {
      mockInvoke.mockRejectedValueOnce('AlreadyRecording');

      try {
        await startRecording({ kind: 'screen' });
        expect.unreachable('Should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(RecordingError);
        expect((err as RecordingError).variant).toBe('AlreadyRecording');
      }
    });
  });

  describe('recordingLevel', () => {
    it('returns peak and rms when recording', async () => {
      mockInvoke.mockResolvedValueOnce({ peak: 0.75, rms: 0.42 });

      const level = await recordingLevel();
      expect(mockInvoke).toHaveBeenCalledWith('recording_level');
      expect(level).toEqual({ peak: 0.75, rms: 0.42 });
    });

    it('returns zeros and does not throw when idle / nothing recording', async () => {
      mockInvoke.mockRejectedValueOnce(new Error('NotRecording'));

      const level = await recordingLevel();
      expect(level).toEqual({ peak: 0, rms: 0 });
    });

    it('returns zeros when invoke rejects with string NotRecording', async () => {
      mockInvoke.mockRejectedValueOnce('NotRecording');

      const level = await recordingLevel();
      expect(level).toEqual({ peak: 0, rms: 0 });
    });
  });

  describe('pause, stop, cancel, state', () => {
    it('pauseRecording passes boolean', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await pauseRecording(true);
      expect(mockInvoke).toHaveBeenCalledWith('recording_pause', { paused: true });
    });

    it('stopRecording returns path, duration_sec, bytes', async () => {
      const mockResult = { path: 'C:/assets/audio/1.wav', duration_sec: 12.5, bytes: 102400 };
      mockInvoke.mockResolvedValueOnce(mockResult);

      const res = await stopRecording();
      expect(mockInvoke).toHaveBeenCalledWith('recording_stop');
      expect(res).toEqual(mockResult);
    });

    it('cancelRecording invokes recording_cancel', async () => {
      mockInvoke.mockResolvedValueOnce(undefined);
      await cancelRecording();
      expect(mockInvoke).toHaveBeenCalledWith('recording_cancel');
    });

    it('recordingState returns current state', async () => {
      const state = { kind: 'audio', paused: false, path: 'C:/1.wav', started_at: '2026-09-20T10:00:00Z' };
      mockInvoke.mockResolvedValueOnce(state);

      const res = await recordingState();
      expect(mockInvoke).toHaveBeenCalledWith('recording_state');
      expect(res).toEqual(state);
    });
  });

  describe('recordingErrorKey translation key mapping', () => {
    it('maps AccessDenied to recPermissionMic for audio', () => {
      const err = new RecordingError('AccessDenied');
      expect(recordingErrorKey(err, 'audio')).toBe('recPermissionMic');
    });

    it('maps AccessDenied to recPermissionScreen for screen', () => {
      const err = new RecordingError('AccessDenied');
      expect(recordingErrorKey(err, 'screen')).toBe('recPermissionScreen');
    });

    it('maps NoDevice to recNoDevices for audio and recNoSources for screen', () => {
      const err = new RecordingError('NoDevice');
      expect(recordingErrorKey(err, 'audio')).toBe('recNoDevices');
      expect(recordingErrorKey(err, 'screen')).toBe('recNoSources');
      expect(recordingErrorKey(err)).toBe('recNoDevices');
    });

    it('maps DeviceBusy to recPermissionHint', () => {
      const err = new RecordingError('DeviceBusy');
      expect(recordingErrorKey(err)).toBe('recPermissionHint');
    });

    it('ensures denied microphone maps to its own key and not missing-device key', () => {
      const deniedErr = new RecordingError('AccessDenied');
      const missingErr = new RecordingError('NoDevice');
      expect(recordingErrorKey(deniedErr, 'audio')).not.toBe(recordingErrorKey(missingErr, 'audio'));
      expect(recordingErrorKey(deniedErr, 'audio')).toBe('recPermissionMic');
      expect(recordingErrorKey(missingErr, 'audio')).toBe('recNoDevices');
    });

    it('supports recorderErrorKey alias identically', () => {
      const err = new RecordingError('AccessDenied');
      expect(recorderErrorKey(err, 'audio')).toBe('recPermissionMic');
    });
  });
});
