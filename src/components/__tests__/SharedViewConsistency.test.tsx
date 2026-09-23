import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RecordingsView } from '../RecordingsView';
import { DrawingsView } from '../DrawingsView';
import { StatsView } from '../StatsView';
import { I18nService } from '../../services/i18n';
import * as recordingsService from '../../services/recordings';
import * as recorderService from '../../services/recorder';
import * as drawingsService from '../../services/drawings';
import * as sessionStore from '../../services/sessionStore';
import * as tasksService from '../../services/tasks';
import type { StoredSession } from '../../services/sessionStore';

// Mock audio/screen recorders
vi.mock('../../services/recorder', () => ({
  listDevices: vi.fn().mockResolvedValue({ inputs: [], loopback: [] }),
  listSources: vi.fn().mockResolvedValue([]),
  startRecording: vi.fn(),
  pauseRecording: vi.fn(),
  stopRecording: vi.fn(),
  cancelRecording: vi.fn(),
  recordingLevel: vi.fn().mockResolvedValue({ peak: 0, rms: 0 }),
  previewSource: vi.fn().mockResolvedValue(null),
  recorderErrorKey: vi.fn(),
}));

vi.mock('../../services/recordings', () => ({
  listRecordings: vi.fn().mockResolvedValue([]),
  saveRecording: vi.fn(),
  renameRecording: vi.fn(),
  deleteRecording: vi.fn(),
  recordingBytes: vi.fn().mockResolvedValue(0),
}));

vi.mock('../../services/transcribe', () => ({
  transcribeRecording: vi.fn(),
  transcribePending: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/assets', () => ({
  assetDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: vi.fn((path: string) => `asset://${path}`),
}));

// Mock Excalidraw
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: () => <div data-testid="mock-excalidraw" />,
}));

vi.mock('../../services/drawings', () => ({
  listDrawings: vi.fn().mockResolvedValue([]),
  loadScene: vi.fn().mockResolvedValue(null),
  getDrawingRaw: vi.fn().mockResolvedValue(null),
  createDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
}));

vi.mock('../../services/sessionStore', () => ({
  listSessions: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../services/tasks', () => ({
  listTasks: vi.fn().mockResolvedValue([]),
}));

describe('Shared visual consistency across views (RecordingsView, DrawingsView, StatsView)', () => {
  const t = I18nService.t();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('RecordingsView renders shared ScreenHeader and EmptyState', async () => {
    vi.mocked(recordingsService.listRecordings).mockResolvedValue([]);
    vi.mocked(recorderService.listDevices).mockResolvedValue({ inputs: [], loopback: [] });
    vi.mocked(recorderService.listSources).mockResolvedValue([]);

    render(<RecordingsView />);

    await waitFor(() => {
      // ScreenHeader renders navRecordings
      expect(screen.getByRole('heading', { level: 1, name: t.navRecordings })).toBeDefined();
    });

    // EmptyState renders description
    expect(screen.getByText(t.recEmpty)).toBeDefined();
  });

  it('DrawingsView renders shared EmptyState when no drawings exist', async () => {
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([]);

    render(<DrawingsView />);

    await waitFor(() => {
      expect(screen.getByText(t.drawingsEmpty)).toBeDefined();
      expect(screen.getAllByRole('button', { name: t.drawingsNew }).length).toBeGreaterThanOrEqual(1);
    });
  });

  it('StatsView renders shared EmptyState when empty, and ScreenHeader when data exists', async () => {
    vi.mocked(sessionStore.listSessions).mockResolvedValue([]);
    vi.mocked(tasksService.listTasks).mockResolvedValue([]);

    const { rerender } = render(<StatsView tasks={[]} />);

    await waitFor(() => {
      // EmptyState renders statsEmptyTitle
      expect(screen.getByText(t.statsEmptyTitle)).toBeDefined();
    });

    const sampleSession: StoredSession = {
      id: 's1',
      started_at: new Date().toISOString(),
      ended_at: new Date().toISOString(),
      duration_sec: 1500,
      kind: 'pomodoro',
      completed: true,
      task_id: null,
    };
    vi.mocked(sessionStore.listSessions).mockResolvedValue([sampleSession]);

    rerender(<StatsView tasks={[]} />);
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: t.statsTitle })).toBeDefined();
    });
  });
});
