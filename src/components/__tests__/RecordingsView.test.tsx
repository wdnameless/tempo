import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { RecordingsView } from '../RecordingsView';
import { I18nService } from '../../services/i18n';
import * as recorderService from '../../services/recorder';
import * as recordingsService from '../../services/recordings';

// Mock Tauri convertFileSrc
const mockConvertFileSrc = vi.fn((path: string, scheme?: string) => {
  if (scheme !== 'tempo-media') {
    throw new Error(`convertFileSrc expected scheme 'tempo-media', got '${scheme}'`);
  }
  return `asset://localhost/${path}`;
});
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string, scheme?: string) => mockConvertFileSrc(path, scheme),
}));

// Mock recorder and recordings services
vi.mock('../../services/recorder', () => ({
  listDevices: vi.fn(),
  listSources: vi.fn(),
  startRecording: vi.fn(),
  pauseRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  recordingState: vi.fn(),
  recordingLevel: vi.fn(),
  previewSource: vi.fn(),
  recorderChannels: vi.fn(),
  setRecorderChannels: vi.fn(),
  recorderErrorKey: vi.fn((err: unknown, kind?: 'audio' | 'screen') => {
    let variant: unknown;
    if (err && typeof err === 'object' && 'variant' in err) {
      variant = err.variant;
    }
    if (variant === 'NoDevice') return kind === 'screen' ? 'recNoSources' : 'recNoDevices';
    if (variant === 'AccessDenied') return kind === 'screen' ? 'recPermissionScreen' : 'recPermissionMic';
    return 'recPermissionHint';
  }),
}));

vi.mock('../../services/recordings', () => ({
  listRecordings: vi.fn(),
  saveRecording: vi.fn(),
  renameRecording: vi.fn(),
  deleteRecording: vi.fn(),
  recordingBytes: vi.fn(),
}));
vi.mock('../../services/transcribe', () => ({
  transcribeRecording: vi.fn(),
  transcribePending: vi.fn(),
}));
vi.mock('../../services/stt', () => ({
  sttErrorKey: vi.fn(() => 'recTranscriptFailed'),
}));
vi.mock('../../services/assets', () => ({
  assetDelete: vi.fn().mockResolvedValue(undefined),
}));
import * as assetsService from '../../services/assets';
import * as transcribeService from '../../services/transcribe';

describe('RecordingsView', () => {
  const t = I18nService.t();

  beforeEach(() => {
    vi.clearAllMocks();

    vi.mocked(recorderService.listDevices).mockResolvedValue({
      inputs: [
        { id: 'mic-1', name: 'Built-in Mic', is_default: true },
        { id: 'mic-2', name: 'USB Headset', is_default: false },
      ],
      loopback: [],
    });

    vi.mocked(recorderService.listSources).mockResolvedValue([
      { id: 'disp-1', name: 'Display 1', kind: 'monitor', width: 1920, height: 1080, is_primary: true },
      { id: 'win-1', name: 'Browser', kind: 'window', width: 1280, height: 720, is_primary: false },
    ]);

    vi.mocked(recorderService.previewSource).mockResolvedValue('data:image/png;base64,mock');
    vi.mocked(recorderService.recordingLevel).mockResolvedValue({ peak: 0.42, rms: 0.3 });
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([]);
    vi.mocked(recordingsService.recordingBytes).mockResolvedValue(1048576); // 1 MB
    vi.mocked(recorderService.recorderChannels).mockResolvedValue(2);
    vi.mocked(recorderService.setRecorderChannels).mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders the empty state in library', async () => {
    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText(t.recEmpty)).toBeDefined();
    });
  });

  it('switches between audio and screen tabs and shows appropriate pickers', async () => {
    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: t.recDevice })).toBeDefined();
    });
    expect(screen.getByText(t.recSystem)).toBeDefined();
    expect(screen.queryByRole('combobox', { name: t.recSource })).toBeNull();

    // Switch to Screen tab
    fireEvent.click(screen.getByRole('button', { name: t.recTabScreen }));

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: t.recSource })).toBeDefined();
    });
    expect(screen.getByText('1920 × 1080 px')).toBeDefined();
    expect(screen.getByRole('group', { name: t.recMonitors })).toBeDefined();
    expect(screen.getByRole('group', { name: t.recWindows })).toBeDefined();
  });

  it('starting calls startRecording with chosen device and source', async () => {
    vi.mocked(recorderService.startRecording).mockResolvedValue({ path: 'test.wav', kind: 'audio' });

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByRole('combobox', { name: t.recDevice })).toBeDefined();
    });

    // Select second device
    fireEvent.change(screen.getByRole('combobox', { name: t.recDevice }), {
      target: { value: 'mic-2' },
    });

    // Toggle system sound
    fireEvent.click(screen.getByLabelText(t.recSystem));

    // Start recording
    fireEvent.click(screen.getByRole('button', { name: t.recStart }));

    await waitFor(() => {
      expect(recorderService.startRecording).toHaveBeenCalledWith({
        kind: 'audio',
        mic: 'mic-2',
        system: true,
        source_id: undefined,
      });
    });
  });

  it('stopping calls stopRecording and then saveRecording with the returned result', async () => {
    vi.mocked(recorderService.startRecording).mockResolvedValue({ path: 'test.wav', kind: 'audio' });
    vi.mocked(recorderService.stopRecording).mockResolvedValue({
      path: 'assets/audio/test.wav',
      duration_sec: 12.5,
      bytes: 204800,
    });
    vi.mocked(recordingsService.saveRecording).mockResolvedValue({
      id: 'rec-1',
      title: 'New Recording',
      kind: 'audio',
      file_path: 'assets/audio/test.wav',
      duration_sec: 12.5,
      transcript: '',
      transcript_status: 'none',
      updated_at: new Date().toISOString(),
    });

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.recStart })).toBeDefined();
    });

    // Start
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recStart }));
    });

    // Stop button should now be visible
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.recStop })).toBeDefined();
    });

    // Stop
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recStop }));
    });

    await waitFor(() => {
      expect(recorderService.stopRecording).toHaveBeenCalledTimes(1);
      expect(recordingsService.saveRecording).toHaveBeenCalledWith(
        {
          path: 'assets/audio/test.wav',
          duration_sec: 12.5,
          bytes: 204800,
        },
        'audio',
      );
    });
  });

  it('cancelling calls cancelRecording and saves nothing', async () => {
    vi.mocked(recorderService.startRecording).mockResolvedValue({ path: 'test.wav', kind: 'audio' });
    vi.mocked(recorderService.cancelRecording).mockResolvedValue(undefined);

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.recStart })).toBeDefined();
    });

    // Start
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recStart }));
    });

    // Cancel button should be visible
    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.recCancel })).toBeDefined();
    });

    // Cancel
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recCancel }));
    });

    await waitFor(() => {
      expect(recorderService.cancelRecording).toHaveBeenCalledTimes(1);
      expect(recordingsService.saveRecording).not.toHaveBeenCalled();
    });
  });

  it('failed start shows the permission message for that specific error', async () => {
    const error = { variant: 'AccessDenied' };
    vi.mocked(recorderService.startRecording).mockRejectedValue(error);

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.recStart })).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recStart }));
    });

    await waitFor(() => {
      expect(recorderService.recorderErrorKey).toHaveBeenCalledWith(error, 'audio');
      expect(screen.getByText(t.recPermissionMic)).toBeDefined();
    });
  });

  it('level meter stops polling after stop', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.mocked(recorderService.startRecording).mockResolvedValue({ path: 'test.wav', kind: 'audio' });
    vi.mocked(recorderService.stopRecording).mockResolvedValue({
      path: 'test.wav',
      duration_sec: 5,
      bytes: 1000,
    });

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: t.recStart })).toBeDefined();
    });

    // Start recording
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recStart }));
    });

    // Advance 350ms (should poll ~3 times)
    await act(async () => {
      vi.advanceTimersByTime(350);
    });
    const pollCallsWhileRecording = vi.mocked(recorderService.recordingLevel).mock.calls.length;
    expect(pollCallsWhileRecording).toBeGreaterThan(0);

    // Stop recording
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: t.recStop }));
    });

    const callsAtStop = vi.mocked(recorderService.recordingLevel).mock.calls.length;

    // Advance another 500ms while stopped
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Polling must not increase
    expect(vi.mocked(recorderService.recordingLevel).mock.calls.length).toBe(callsAtStop);

    vi.useRealTimers();
  });

  it('a recording without a file size renders instead of throwing', async () => {
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-missing-size',
        title: 'Meeting Notes',
        kind: 'audio',
        file_path: 'assets/audio/meeting.wav',
        duration_sec: 65,
        transcript: '',
        transcript_status: 'none',
        updated_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(recordingsService.recordingBytes).mockRejectedValue(new Error('File not found'));

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Meeting Notes')).toBeDefined();
      expect(screen.getByText(/01:05/)).toBeDefined();
      expect(screen.getByText(new RegExp(`${t.recSize}: —`))).toBeDefined();
    });
  });

  it('renders per-row transcript states and allows reading transcript', async () => {
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-done',
        title: 'Interview',
        kind: 'audio',
        file_path: 'audio/interview.wav',
        duration_sec: 120,
        transcript: 'Hello and welcome to the team meeting.',
        transcript_status: 'done',
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-failed',
        title: 'Voice Note',
        kind: 'audio',
        file_path: 'audio/note.wav',
        duration_sec: 30,
        transcript: null,
        transcript_status: 'failed',
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-pending',
        title: 'Brainstorm',
        kind: 'audio',
        file_path: 'audio/brainstorm.wav',
        duration_sec: 60,
        transcript: null,
        transcript_status: 'pending',
        updated_at: new Date().toISOString(),
      },
      {
        id: 'rec-untranscribed',
        title: 'Untouched',
        kind: 'audio',
        file_path: 'audio/untouched.wav',
        duration_sec: 45,
        transcript: null,
        transcript_status: 'none',
        updated_at: new Date().toISOString(),
      },
    ]);

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Interview')).toBeDefined();
      expect(screen.getByText('Voice Note')).toBeDefined();
      expect(screen.getByText('Brainstorm')).toBeDefined();
      expect(screen.getByText('Untouched')).toBeDefined();
    });

    // Check badges
    expect(screen.getByText(t.recTranscriptDone)).toBeDefined();
    expect(screen.getByText(t.recTranscriptFailed)).toBeDefined();
    expect(screen.getByText(t.recTranscriptPending)).toBeDefined();

    // Read the transcript in the row
    expect(screen.getByText('Hello and welcome to the team meeting.')).toBeDefined();
  });

  it('invokes transcribeRecording for a single row and transcribePending for batch', async () => {
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-test-1',
        title: 'Quick Memo',
        kind: 'audio',
        file_path: 'audio/memo.wav',
        duration_sec: 15,
        transcript: null,
        transcript_status: 'none',
        updated_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(transcribeService.transcribeRecording).mockResolvedValue({
      text: 'Mocked transcription text',
      language: 'en',
    });
    vi.mocked(transcribeService.transcribePending).mockResolvedValue({
      total: 1,
      processed: 1,
      succeeded: 1,
      failed: 0,
      errors: {},
    });

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Quick Memo')).toBeDefined();
    });

    // Click single row transcribe button
    // Click batch transcribe button
    const batchBtn = screen.getByRole('button', { name: new RegExp(t.recTranscribeAll) });
    expect(batchBtn).toBeDefined();
    fireEvent.click(batchBtn);

    await waitFor(() => {
      expect(transcribeService.transcribePending).toHaveBeenCalled();
    });

    // Click single row transcribe button
    const transcribeBtns = screen.getAllByRole('button', { name: t.recTranscribe });
    expect(transcribeBtns.length).toBeGreaterThan(0);
    fireEvent.click(transcribeBtns[0]);

    await waitFor(() => {
      expect(transcribeService.transcribeRecording).toHaveBeenCalledWith('rec-test-1');
    });
  });

  it('shows error state when single row transcription fails', async () => {
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-fail-test',
        title: 'Broken Audio',
        kind: 'audio',
        file_path: 'audio/broken.wav',
        duration_sec: 25,
        transcript: null,
        transcript_status: 'none',
        updated_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(transcribeService.transcribeRecording).mockRejectedValue(new Error('Network failure'));

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Broken Audio')).toBeDefined();
    });
    const transcribeBtns = screen.getAllByRole('button', { name: t.recTranscribe });
    fireEvent.click(transcribeBtns[0]);

    await waitFor(() => {
      expect(screen.getAllByText(t.recTranscriptFailed).length).toBeGreaterThan(0);
    });
  });

  it('asks for confirmation before deleting a recording and deletes on confirm', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-del-1',
        title: 'Delete Me',
        kind: 'audio',
        file_path: 'audio/delete.wav',
        duration_sec: 10,
        transcript: null,
        transcript_status: 'none',
        updated_at: new Date().toISOString(),
      },
    ]);
    vi.mocked(recordingsService.deleteRecording).mockResolvedValue();

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Delete Me')).toBeDefined();
    });

    const delBtn = screen.getByRole('button', { name: t.recDelete });
    fireEvent.click(delBtn);

    await waitFor(() => {
      expect(confirmSpy).toHaveBeenCalled();
      expect(recordingsService.deleteRecording).toHaveBeenCalledWith('rec-del-1');
    });
    confirmSpy.mockRestore();
  });

  it('cancelling delete does not call deleteRecording', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-del-2',
        title: 'Keep Me',
        kind: 'audio',
        file_path: 'audio/keep.wav',
        duration_sec: 10,
        transcript: null,
        transcript_status: 'none',
        updated_at: new Date().toISOString(),
      },
    ]);

    render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Keep Me')).toBeDefined();
    });

    const delBtn = screen.getByRole('button', { name: t.recDelete });
    fireEvent.click(delBtn);

    expect(confirmSpy).toHaveBeenCalled();
    expect(recordingsService.deleteRecording).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('cleans up preview file on component unmount', async () => {
    vi.mocked(recorderService.listSources).mockResolvedValue([
      {
        id: 'screen:1',
        name: 'Display 1',
        kind: 'monitor',
        width: 1920,
        height: 1080,
        is_primary: true,
      },
    ]);
    vi.mocked(recorderService.previewSource).mockResolvedValue('C:/assets/screen/preview.png');

    const { unmount } = render(<RecordingsView />);

    const screenTab = screen.getByRole('button', { name: /Экран|Screen/i });
    fireEvent.click(screenTab);

    await waitFor(() => {
      expect(recorderService.previewSource).toHaveBeenCalledWith('screen:1');
    });

    unmount();

    expect(assetsService.assetDelete).toHaveBeenCalledWith('C:/assets/screen/preview.png');
  });
  it('reads current channel mode on mount and writes new mode when switched', async () => {
    vi.mocked(recorderService.recorderChannels).mockResolvedValue(2);
    render(<RecordingsView />);

    await waitFor(() => {
      expect(recorderService.recorderChannels).toHaveBeenCalled();
    });

    const stereoOption = screen.getByRole('radio', { name: t.recChannelsStereo });
    expect(stereoOption.getAttribute('aria-checked')).toBe('true');

    const monoOption = screen.getByRole('radio', { name: t.recChannelsMono });
    expect(monoOption.getAttribute('aria-checked')).toBe('false');

    fireEvent.click(monoOption);

    await waitFor(() => {
      expect(recorderService.setRecorderChannels).toHaveBeenCalledWith(1);
      expect(monoOption.getAttribute('aria-checked')).toBe('true');
    });
  });

  it('renders custom AudioPlayer and ensures native audio controls element is gone', async () => {
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([
      {
        id: 'rec-player-test',
        title: 'Voice Note For Player',
        kind: 'audio',
        file_path: 'audio/voice_note.wav',
        duration_sec: 42,
        transcript: null,
        transcript_status: 'none',
        updated_at: '2026-09-20T10:00:00Z',
      },
    ]);

    const { container } = render(<RecordingsView />);

    await waitFor(() => {
      expect(screen.getByText('Voice Note For Player')).toBeDefined();
    });

    // Native <audio controls> must NOT exist anywhere in the DOM
    const nativeControlsAudio = container.querySelectorAll('audio[controls]');
    expect(nativeControlsAudio.length).toBe(0);

    // Audio element exists headless without controls attribute
    const headlessAudio = container.querySelectorAll('audio');
    expect(headlessAudio.length).toBe(1);
    expect(headlessAudio[0].hasAttribute('controls')).toBe(false);

    // Custom AudioPlayer controls are present (play button, seek input, volume input)
    expect(screen.getByRole('button', { name: t.playerPlay })).toBeDefined();
    expect(screen.getByLabelText(t.playerSeek)).toBeDefined();
    expect(screen.getByLabelText(t.playerVolume)).toBeDefined();
  });
});
