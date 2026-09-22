import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrawingsView } from '../DrawingsView';
import * as drawingsService from '../../services/drawings';
import { I18nService } from '../../services/i18n';
import type { Scene } from '../../services/canvas';
import type { DrawingItem } from '../../services/drawings';

// Mock Excalidraw component
vi.mock('@excalidraw/excalidraw', () => ({
  Excalidraw: (props: { theme?: string; initialData?: unknown; onChange?: (elements: unknown[], appState: unknown) => void }) => (
    <div data-testid="mock-excalidraw" data-theme={props.theme}>
      <canvas width={800} height={600} />
      <button
        data-testid="simulate-draw"
        onClick={() => props.onChange?.([{ id: 'elem-1', type: 'rectangle' }], { viewBackgroundColor: '#121212' })}
      >
        Simulate Draw
      </button>
    </div>
  ),
}));

// Mock drawings service
vi.mock('../../services/drawings', () => ({
  listDrawings: vi.fn(),
  loadScene: vi.fn(),
  getDrawingRaw: vi.fn(),
  createDrawing: vi.fn(),
  updateDrawing: vi.fn(),
  deleteDrawing: vi.fn(),
}));

const mockConvertFileSrc = vi.fn((p: string, scheme?: string) => {
  if (scheme !== 'tempo-media') {
    throw new Error(`convertFileSrc expected scheme 'tempo-media', got '${scheme}'`);
  }
  return `asset://localhost/${p}`;
});

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string, scheme?: string) => mockConvertFileSrc(p, scheme),
}));

describe('DrawingsView', () => {
  const t = I18nService.t();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the empty state when there are no drawings', async () => {
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([]);

    render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.listDrawings).toHaveBeenCalled();
    });

    expect(screen.getByText(t.drawingsEmpty)).toBeDefined();
  });

  it('selecting a drawing loads its scene and renders Excalidraw with dark theme', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'First Sketch',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    const mockScene: Scene = {
      version: 1,
      strokes: [],
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue(mockScene);
    vi.mocked(drawingsService.getDrawingRaw).mockResolvedValue({
      id: 'draw-1',
      title: 'First Sketch',
      scene_json: JSON.stringify({ elements: [{ id: 'elem-1', type: 'rectangle' }], appState: { theme: 'dark' } }),
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
      deleted_at: null,
    });

    render(<DrawingsView />);

    await waitFor(() => {
      expect(screen.getByText('First Sketch')).toBeDefined();
    });

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
      expect(drawingsService.getDrawingRaw).toHaveBeenCalledWith('draw-1');
    });

    const excalidraw = await screen.findByTestId('mock-excalidraw');
    expect(excalidraw.getAttribute('data-theme')).toBe('dark');
  });

  it('creates a new drawing when Plus button is clicked', async () => {
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([]);
    const createdDrawing: DrawingItem = {
      id: 'draw-new-1',
      title: `${t.navDrawings} 1`,
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };
    vi.mocked(drawingsService.createDrawing).mockResolvedValue(createdDrawing);
    vi.mocked(drawingsService.getDrawingRaw).mockResolvedValue({
      id: 'draw-new-1',
      title: `${t.navDrawings} 1`,
      scene_json: '{}',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
      deleted_at: null,
    });

    render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.listDrawings).toHaveBeenCalled();
    });

    const plusBtn = screen.getByLabelText(t.drawingsNew);
    fireEvent.click(plusBtn);

    await waitFor(() => {
      expect(drawingsService.createDrawing).toHaveBeenCalled();
    });
  });

  it('deletes a drawing when delete button is clicked', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-to-del',
      title: 'To Delete',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.deleteDrawing).mockResolvedValue();
    vi.mocked(drawingsService.getDrawingRaw).mockResolvedValue({
      id: 'draw-to-del',
      title: 'To Delete',
      scene_json: '{}',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
      deleted_at: null,
    });

    render(<DrawingsView />);

    await waitFor(() => {
      expect(screen.getByText('To Delete')).toBeDefined();
    });

    const delBtn = screen.getByLabelText(t.drawingsDelete);
    fireEvent.click(delBtn);

    await waitFor(() => {
      expect(drawingsService.deleteDrawing).toHaveBeenCalledWith('draw-to-del');
    });
  });

  it('renders preview image using convertFileSrc with tempo-media scheme', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-preview-1',
      title: 'Preview Drawing',
      preview_path: 'drawings/preview-1.svg',
      updated_at: '2026-09-20T00:00:00Z',
    };
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.getDrawingRaw).mockResolvedValue({
      id: 'draw-preview-1',
      title: 'Preview Drawing',
      scene_json: '{}',
      preview_path: 'drawings/preview-1.svg',
      updated_at: '2026-09-20T00:00:00Z',
      deleted_at: null,
    });

    render(<DrawingsView />);

    await waitFor(() => {
      expect(screen.getByAltText('Preview Drawing')).toBeDefined();
    });
    expect(mockConvertFileSrc).toHaveBeenCalledWith('drawings/preview-1.svg', 'tempo-media');
  });

  it('auto-saves scene changes to updateDrawing', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-autosave',
      title: 'Autosave Drawing',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.updateDrawing).mockResolvedValue(mockDrawing);
    vi.mocked(drawingsService.getDrawingRaw).mockResolvedValue({
      id: 'draw-autosave',
      title: 'Autosave Drawing',
      scene_json: '{}',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
      deleted_at: null,
    });

    render(<DrawingsView />);

    await waitFor(() => {
      expect(screen.getByText('Autosave Drawing')).toBeDefined();
    });

    const drawBtn = await screen.findByTestId('simulate-draw');
    fireEvent.click(drawBtn);

    await waitFor(
      () => {
        expect(drawingsService.updateDrawing).toHaveBeenCalledWith(
          'draw-autosave',
          expect.objectContaining({
            scene_json: expect.stringContaining('elem-1'),
          })
        );
      },
      { timeout: 2000 }
    );
  });
});
