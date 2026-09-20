import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  mapSttError,
  sttErrorKey,
  pollDownloadProgress,
  type DownloadProgress,
} from '../stt';

describe('stt service', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('error mapping and discrimination', () => {
    it('distinguishes no-model from no-speech', () => {
      const errNoModel = mapSttError(new Error('no_model: no model loaded'));
      const errNoSpeech = mapSttError(new Error('no_speech: energy below vad threshold'));

      expect(errNoModel.code).toBe('no_model');
      expect(errNoSpeech.code).toBe('no_speech');
      expect(errNoModel.code).not.toBe(errNoSpeech.code);

      expect(sttErrorKey(errNoModel)).toBe('sttErrorNoModel');
      expect(sttErrorKey(errNoSpeech)).toBe('noSpeechDetected');
      expect(sttErrorKey(errNoModel)).not.toBe(sttErrorKey(errNoSpeech));
    });

    it('maps microphone failure to sttErrorNoMic', () => {
      const err = mapSttError('no_microphone: input stream closed');
      expect(err.code).toBe('no_microphone');
      expect(sttErrorKey(err)).toBe('sttErrorNoMic');
    });

    it('maps cloud refusal and injection failure', () => {
      const errCloud = mapSttError('cloud_refused: 401 unauthorized');
      expect(errCloud.code).toBe('cloud_refused');
      expect(sttErrorKey(errCloud)).toBe('sttErrorCloudRefused');

      const errInj = mapSttError('injection_impossible: elevated window');
      expect(errInj.code).toBe('injection_impossible');
      expect(sttErrorKey(errInj)).toBe('sttErrorInjectionFailed');
    });

    it('maps network and disk errors', () => {
      const errNet = mapSttError('network error while downloading model');
      expect(errNet.code).toBe('network_error');
      expect(sttErrorKey(errNet)).toBe('sttErrorNetwork');

      const errDisk = mapSttError('no space left on device');
      expect(errDisk.code).toBe('disk_full');
      expect(sttErrorKey(errDisk)).toBe('sttErrorDiskSpace');
    });

    it('falls back to unknown error', () => {
      const err = mapSttError('some weird whisper crash');
      expect(err.code).toBe('unknown');
      expect(sttErrorKey(err)).toBe('voiceActionFailed');
    });
  });

  describe('progress polling battery safety', () => {
    it('stops polling when download finishes or cancels', async () => {
      let pollCount = 0;

      const getProgress = vi.fn().mockImplementation(async (): Promise<DownloadProgress> => {
        pollCount++;
        if (pollCount >= 2) {
          return { model_id: 'whisper-tiny', received: 100, total: 100, done: true, error: null };
        }
        return { model_id: 'whisper-tiny', received: 50, total: 100, done: false, error: null };
      });

      const onProgress = vi.fn();
      const stop = pollDownloadProgress(onProgress, 10, getProgress);

      // First tick runs immediately on start
      await Promise.resolve();
      expect(pollCount).toBe(1);

      // Advance second tick (completes download)
      await vi.advanceTimersByTimeAsync(15);
      expect(pollCount).toBe(2);
      expect(onProgress).toHaveBeenCalledWith(
        expect.objectContaining({ done: true, received: 100 }),
      );

      // Advance further: verify polling stopped and does NOT continue ticking
      await vi.advanceTimersByTimeAsync(100);
      expect(pollCount).toBe(2);

      stop();
    });

    it('stops polling when an error occurs during download', async () => {
      let pollCount = 0;
      const getProgress = vi.fn().mockImplementation(async (): Promise<DownloadProgress> => {
        pollCount++;
        return {
          model_id: 'whisper-tiny',
          received: 10,
          total: 100,
          done: true,
          error: 'network error',
        };
      });

      const onProgress = vi.fn();
      const stop = pollDownloadProgress(onProgress, 10, getProgress);

      // Immediate tick on start
      await Promise.resolve();
      expect(pollCount).toBe(1);

      await vi.advanceTimersByTimeAsync(100);
      expect(pollCount).toBe(1);
      stop();
    });
  });
});
