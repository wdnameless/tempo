import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  transcribeRecording,
  transcribePending,
  transcriptSearchText,
} from '../transcribe';
import * as recordingsService from '../recordings';
import * as sttService from '../stt';
import type { RecordingItem } from '../recordings';

describe('transcribe service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('transcriptSearchText', () => {
    it('combines title and transcript into searchable text', () => {
      const rec: RecordingItem = {
        id: 'rec-1',
        title: 'Meeting with Alice',
        kind: 'audio',
        file_path: 'C:/recordings/rec-1.wav',
        duration_sec: 60,
        updated_at: '2026-09-20T10:00:00Z',
        transcript: 'We discussed the launch roadmap and agreed on dates.',
        transcript_status: 'done',
      };

      const searchText = transcriptSearchText(rec);
      expect(searchText).toContain('We discussed the launch roadmap');
      expect(searchText).toBe('Meeting with Alice\nWe discussed the launch roadmap and agreed on dates.');
    });

    it('returns empty string when transcript is empty or whitespace', () => {
      expect(transcriptSearchText({ transcript: '' })).toBe('');
      expect(transcriptSearchText({ transcript: '   \n  \t  ' })).toBe('');
      expect(transcriptSearchText({ transcript: undefined })).toBe('');
    });

    it('returns only transcript when no title provided', () => {
      expect(transcriptSearchText({ transcript: 'Hello world' })).toBe('Hello world');
    });

    it('returns only title when transcript is empty whitespace', () => {
      expect(transcriptSearchText({ title: 'My Voice Note', transcript: '   ' })).toBe('My Voice Note');
    });
  });

  describe('transcribeRecording', () => {
    it('transcribes a recording, saves transcript, and reindexes', async () => {
      const rec: RecordingItem = {
        id: 'rec-1',
        title: 'Voice Note',
        kind: 'audio',
        file_path: 'C:/recordings/rec-1.wav',
        duration_sec: 30,
        updated_at: '2026-09-20T10:00:00Z',
        transcript: null,
        transcript_status: 'pending',
      };

      vi.spyOn(recordingsService, 'getRecording').mockResolvedValue(rec);
      const updateTranscriptSpy = vi
        .spyOn(recordingsService, 'updateTranscript')
        .mockResolvedValue({ ...rec, transcript: 'Recorded voice test', transcript_status: 'done' });
      // Status is updated on failure or done via updateTranscript
      const reindexSpy = vi
        .spyOn(recordingsService, 'reindexRecordings')
        .mockResolvedValue(undefined);

      vi.spyOn(sttService, 'transcribeAudioFile').mockResolvedValue({
        text: 'Recorded voice test',
        language: 'en',
      });

      const res = await transcribeRecording('rec-1');

      expect(res.text).toBe('Recorded voice test');
      expect(res.language).toBe('en');
      expect(updateTranscriptSpy).toHaveBeenCalledWith('rec-1', 'Recorded voice test', 'done');
      expect(reindexSpy).toHaveBeenCalled();
    });

    it('marks recording as failed when transcription throws error', async () => {
      const rec: RecordingItem = {
        id: 'rec-fail',
        title: 'Broken Audio',
        kind: 'audio',
        file_path: 'C:/recordings/fail.wav',
        duration_sec: 10,
        updated_at: '2026-09-20T10:00:00Z',
        transcript: null,
        transcript_status: 'pending',
      };

      vi.spyOn(recordingsService, 'getRecording').mockResolvedValue(rec);
      const updateStatusSpy = vi
        .spyOn(recordingsService, 'updateTranscriptStatus')
        .mockResolvedValue({ ...rec, transcript_status: 'failed' });

      vi.spyOn(sttService, 'transcribeAudioFile').mockRejectedValue(new Error('Corrupt wav file'));

      await expect(transcribeRecording('rec-fail')).rejects.toThrow('Corrupt wav file');
      expect(updateStatusSpy).toHaveBeenCalledWith('rec-fail', 'failed');
    });
  });

  describe('transcribePending', () => {
    it('processes a bounded batch, marks failed file, and continues with next without halting', async () => {
      const rec1: RecordingItem = {
        id: 'rec-1',
        title: 'Broken item',
        kind: 'audio',
        file_path: 'C:/recordings/broken.wav',
        duration_sec: 15,
        updated_at: '2026-09-20T10:00:00Z',
        transcript: null,
        transcript_status: 'pending',
      };
      const rec2: RecordingItem = {
        id: 'rec-2',
        title: 'Good item',
        kind: 'audio',
        file_path: 'C:/recordings/good.wav',
        duration_sec: 20,
        updated_at: '2026-09-20T10:00:00Z',
        transcript: null,
        transcript_status: 'pending',
      };
      const rec3: RecordingItem = {
        id: 'rec-3',
        title: 'Third item (outside limit)',
        kind: 'audio',
        file_path: 'C:/recordings/third.wav',
        duration_sec: 25,
        updated_at: '2026-09-20T10:00:00Z',
        transcript: null,
        transcript_status: 'pending',
      };

      vi.spyOn(recordingsService, 'listRecordings').mockResolvedValue([rec1, rec2, rec3]);

      // rec1 fails, rec2 succeeds
      vi.spyOn(recordingsService, 'getRecording').mockImplementation(async (id) => {
        if (id === 'rec-1') return rec1;
        if (id === 'rec-2') return rec2;
        return rec3;
      });

      const updateTranscriptSpy = vi
        .spyOn(recordingsService, 'updateTranscript')
        .mockResolvedValue({ ...rec2, transcript: 'Good transcript', transcript_status: 'done' });
      const updateStatusSpy = vi
        .spyOn(recordingsService, 'updateTranscriptStatus')
        .mockResolvedValue(rec1);
      vi.spyOn(recordingsService, 'reindexRecordings').mockResolvedValue(undefined);

      vi.spyOn(sttService, 'transcribeAudioFile').mockImplementation(async (filePath) => {
        if (filePath.includes('broken')) {
          throw new Error('Decoding error');
        }
        return { text: 'Good transcript', language: 'ru' };
      });

      // Limit to 2 items
      const summary = await transcribePending({ limit: 2 });

      expect(summary.total).toBe(2);
      expect(summary.processed).toBe(2);
      expect(summary.succeeded).toBe(1);
      expect(summary.failed).toBe(1);
      expect(summary.errors['rec-1']).toContain('Decoding error');

      // Check that rec1 was marked as failed
      expect(updateStatusSpy).toHaveBeenCalledWith('rec-1', 'failed');
      // Check that rec2 succeeded and saved transcript
      expect(updateTranscriptSpy).toHaveBeenCalledWith('rec-2', 'Good transcript', 'done');
    });
  });
});
