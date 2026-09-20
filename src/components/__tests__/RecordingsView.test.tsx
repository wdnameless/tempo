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
});
