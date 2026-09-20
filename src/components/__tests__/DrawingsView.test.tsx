import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DrawingsView } from '../DrawingsView';
import * as canvasService from '../../services/canvas';
import * as drawingsService from '../../services/drawings';
import * as assetsService from '../../services/assets';
import { I18nService } from '../../services/i18n';
import type { Scene } from '../../services/canvas';
import type { DrawingItem } from '../../services/drawings';

// Mock the services
vi.mock('../../services/drawings', () => ({
  listDrawings: vi.fn(),
  loadScene: vi.fn(),
  createDrawing: vi.fn(),
  saveScene: vi.fn(),
  deleteDrawing: vi.fn(),
  setPreview: vi.fn(),
}));

vi.mock('../../services/assets', () => ({
  assetSave: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (p: string) => `asset://localhost/${p}`,
}));

describe('DrawingsView', () => {
  const t = I18nService.t();
  let originalDpr: number;
  let contextCalls: {
    scale: [number, number][];
    clearRect: [number, number, number, number][];
    fillRect: [number, number, number, number][];
    beginPath: number;
    stroke: number;
    fill: number;
  };

  beforeEach(() => {
    vi.clearAllMocks();

    originalDpr = window.devicePixelRatio;
    window.devicePixelRatio = 2;

    contextCalls = {
      scale: [],
      clearRect: [],
      fillRect: [],
      beginPath: 0,
      stroke: 0,
      fill: 0,
    };

    // Stub getContext on HTMLCanvasElement prototype with a recording fake context
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(((contextId: string) => {
      if (contextId === '2d') {
        return {
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn((sx: number, sy: number) => {
            contextCalls.scale.push([sx, sy]);
          }),
          clearRect: vi.fn((x: number, y: number, w: number, h: number) => {
            contextCalls.clearRect.push([x, y, w, h]);
          }),
          strokeRect: vi.fn(),
          fillRect: vi.fn((x: number, y: number, w: number, h: number) => {
            contextCalls.fillRect.push([x, y, w, h]);
          }),
          beginPath: vi.fn(() => {
            contextCalls.beginPath++;
          }),
          moveTo: vi.fn(),
          lineTo: vi.fn(),
          stroke: vi.fn(() => {
            contextCalls.stroke++;
          }),
          fill: vi.fn(() => {
            contextCalls.fill++;
          }),
          arc: vi.fn(),
          ellipse: vi.fn(),
          fillText: vi.fn(),
          setLineDash: vi.fn(),
          setTransform: vi.fn(),
          resetTransform: vi.fn(),
          measureText: vi.fn(() => ({ width: 50 })),
          canvas: {
            width: 800,
            height: 600,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
          },
        } as unknown as CanvasRenderingContext2D;
      }
      return null;
    }) as unknown as typeof HTMLCanvasElement.prototype.getContext);

    // Stub toBlob on HTMLCanvasElement prototype
    HTMLCanvasElement.prototype.toBlob = vi.fn((callback: BlobCallback) => {
      const blob = new Blob(['test-png-data'], { type: 'image/png' });
      callback(blob);
    });

    // ResizeObserver stub
    window.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };

    // Canvas getBoundingClientRect stub
    HTMLCanvasElement.prototype.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 800,
      bottom: 600,
      width: 800,
      height: 600,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    HTMLCanvasElement.prototype.setPointerCapture = vi.fn();
    HTMLCanvasElement.prototype.releasePointerCapture = vi.fn();
  });

  afterEach(() => {
    window.devicePixelRatio = originalDpr;
    vi.restoreAllMocks();
  });

  it('renders the empty state when there are no drawings', async () => {
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([]);

    render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.listDrawings).toHaveBeenCalled();
    });

    expect(screen.getByText(t.drawingsEmpty)).toBeDefined();
  });

  it('selecting a drawing loads its scene', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'First Sketch',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    const mockScene: Scene = {
      version: 1,
      strokes: [
        {
          id: 'stroke-1',
          tool: 'pen',
          color: '#ff0000',
          width: 4,
          points: [{ x: 10, y: 10, pressure: 0.8 }],
        },
      ],
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue(mockScene);

    render(<DrawingsView />);

    await waitFor(() => {
      expect(screen.getByText('First Sketch')).toBeDefined();
    });

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
    });
  });

  it('canvas element gets backing store scaled by devicePixelRatio', async () => {
    vi.mocked(drawingsService.listDrawings).mockResolvedValue([]);

    const { container } = render(<DrawingsView />);
    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas).toBeDefined();

    // With window.devicePixelRatio = 2, backing store width and height should reflect scale factor 2
    expect(contextCalls.scale.some(([sx, sy]) => sx === 2 && sy === 2)).toBe(true);
  });

  it('a pointer stroke on the canvas adds a stroke to the model and saves it', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'Active Drawing',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue({ version: 1, strokes: [] });
    vi.mocked(drawingsService.saveScene).mockResolvedValue(mockDrawing);

    const { container } = render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
    });

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    // Simulate pointer stroke
    fireEvent.pointerDown(canvas, {
      clientX: 100,
      clientY: 100,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pressure: 0.7,
    });

    fireEvent.pointerMove(canvas, {
      clientX: 120,
      clientY: 130,
      button: 0,
      buttons: 1,
      pointerId: 1,
      pressure: 0.8,
    });

    fireEvent.pointerUp(canvas, {
      clientX: 120,
      clientY: 130,
      button: 0,
      buttons: 0,
      pointerId: 1,
    });

    await waitFor(() => {
      expect(drawingsService.saveScene).toHaveBeenCalledWith(
        'draw-1',
        expect.objectContaining({
          version: 1,
          strokes: expect.arrayContaining([
            expect.objectContaining({
              tool: 'pen',
              points: expect.any(Array),
            }),
          ]),
        })
      );
    });
  });

  it('eraser tool calls eraseAt with world coordinates and brush radius', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'Drawing with Strokes',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    const initialScene: Scene = {
      version: 1,
      strokes: [
        {
          id: 'stroke-1',
          tool: 'pen',
          color: '#3b82f6',
          width: 4,
          points: [{ x: 50, y: 50, pressure: 1 }],
        },
      ],
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue(initialScene);
    vi.mocked(drawingsService.saveScene).mockResolvedValue(mockDrawing);

    const eraseAtSpy = vi.spyOn(canvasService, 'eraseAt');

    const { container } = render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
    });

    // Switch tool to eraser
    const eraserBtn = screen.getByLabelText(t.drawToolEraser);
    fireEvent.click(eraserBtn);

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.pointerDown(canvas, {
      clientX: 50,
      clientY: 50,
      button: 0,
      buttons: 1,
      pointerId: 1,
    });

    expect(eraseAtSpy).toHaveBeenCalledWith(
      expect.objectContaining({ version: 1 }),
      expect.objectContaining({ x: 50, y: 50 }),
      expect.any(Number)
    );
  });

  it('switching tools changes what a fresh stroke becomes', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'Tool Switch Test',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue({ version: 1, strokes: [] });
    vi.mocked(drawingsService.saveScene).mockResolvedValue(mockDrawing);

    const { container } = render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
    });

    // Select Rectangle tool
    const rectBtn = screen.getByLabelText(t.drawToolRect);
    fireEvent.click(rectBtn);

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;

    fireEvent.pointerDown(canvas, {
      clientX: 10,
      clientY: 10,
      button: 0,
      buttons: 1,
      pointerId: 1,
    });

    fireEvent.pointerMove(canvas, {
      clientX: 80,
      clientY: 60,
      button: 0,
      buttons: 1,
      pointerId: 1,
    });

    fireEvent.pointerUp(canvas, {
      clientX: 80,
      clientY: 60,
      button: 0,
      buttons: 0,
      pointerId: 1,
    });

    await waitFor(() => {
      expect(drawingsService.saveScene).toHaveBeenCalledWith(
        'draw-1',
        expect.objectContaining({
          strokes: expect.arrayContaining([
            expect.objectContaining({
              tool: 'rect',
            }),
          ]),
        })
      );
    });
  });

  it('export SVG calls sceneToSvg and assetSave with kind preview', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-export-1',
      title: 'Export Test',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    const testScene: Scene = {
      version: 1,
      strokes: [
        {
          id: 's-1',
          tool: 'line',
          color: '#000000',
          width: 2,
          points: [
            { x: 0, y: 0, pressure: 1 },
            { x: 100, y: 100, pressure: 1 },
          ],
        },
      ],
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue(testScene);
    vi.mocked(assetsService.assetSave).mockResolvedValue({
      kind: 'preview',
      path: '/mock/path/preview.svg',
      bytes: 120,
    });

    const sceneToSvgSpy = vi.spyOn(canvasService, 'sceneToSvg');

    render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-export-1');
    });

    const exportSvgBtn = screen.getByLabelText(t.drawExportSvg);
    fireEvent.click(exportSvgBtn);

    await waitFor(() => {
      expect(sceneToSvgSpy).toHaveBeenCalledWith(testScene);
      expect(assetsService.assetSave).toHaveBeenCalledWith(
        'preview',
        'draw-export-1.svg',
        expect.any(Object)
      );
    });
  });
  it('the click that opens the text editor does not close it', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'Text Drawing',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue({ version: 1, strokes: [] });
    vi.mocked(drawingsService.saveScene).mockResolvedValue(mockDrawing);

    const { container } = render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
    });

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.click(screen.getByLabelText(t.drawToolText));
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });

    const field = await screen.findByPlaceholderText('Type text...');

    // Placing the caret costs focus, so the browser blurs the field it has just
    // focused. That blur belongs to the opening click.
    fireEvent.blur(field);
    expect(screen.getByPlaceholderText('Type text...')).toBeDefined();

    // Enter is the user's own decision, whatever the pointer is doing.
    fireEvent.change(screen.getByPlaceholderText('Type text...'), { target: { value: 'Совещание <b>' } });
    fireEvent.keyDown(screen.getByPlaceholderText('Type text...'), { key: 'Enter' });

    await waitFor(() => {
      expect(drawingsService.saveScene).toHaveBeenCalledWith(
        'draw-1',
        expect.objectContaining({
          strokes: [expect.objectContaining({ tool: 'text', text: 'Совещание <b>' })],
        })
      );
    });
    expect(screen.queryByPlaceholderText('Type text...')).toBeNull();
  });

  it('a blur after the click has ended finishes the text', async () => {
    const mockDrawing: DrawingItem = {
      id: 'draw-1',
      title: 'Text Drawing',
      preview_path: null,
      updated_at: '2026-09-20T00:00:00Z',
    };

    vi.mocked(drawingsService.listDrawings).mockResolvedValue([mockDrawing]);
    vi.mocked(drawingsService.loadScene).mockResolvedValue({ version: 1, strokes: [] });
    vi.mocked(drawingsService.saveScene).mockResolvedValue(mockDrawing);

    const { container } = render(<DrawingsView />);

    await waitFor(() => {
      expect(drawingsService.loadScene).toHaveBeenCalledWith('draw-1');
    });

    const canvas = container.querySelector('canvas') as HTMLCanvasElement;
    fireEvent.click(screen.getByLabelText(t.drawToolText));
    fireEvent.pointerDown(canvas, { clientX: 100, clientY: 100, button: 0, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 100, clientY: 100, button: 0, buttons: 0, pointerId: 1 });
    fireEvent.change(await screen.findByPlaceholderText('Type text...'), { target: { value: 'Заметка' } });

    // Clicking elsewhere is a real decision to finish.
    fireEvent.blur(screen.getByPlaceholderText('Type text...'));

    await waitFor(() => {
      expect(drawingsService.saveScene).toHaveBeenCalledWith(
        'draw-1',
        expect.objectContaining({
          strokes: [expect.objectContaining({ tool: 'text', text: 'Заметка' })],
        })
      );
    });
    expect(screen.queryByPlaceholderText('Type text...')).toBeNull();
  });
});
