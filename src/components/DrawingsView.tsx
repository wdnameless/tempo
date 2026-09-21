import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  type PointerEvent as ReactPointerEvent,
  type WheelEvent as ReactWheelEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  Plus,
  Trash2,
  Pen,
  Eraser,
  Minus,
  Square,
  Circle,
  Type,
  ImageIcon,
  Lock,
  Hand,
  MousePointer2,
  Diamond,
  ArrowRight,
  ArrowLeft,
  FileText,
} from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/core';
import {
  buildFrame,
  screenToWorld,
  worldToScreen,
  eraseAt,
  sceneToSvg,
  strokeBounds,
  type Scene,
  type Stroke,
  type StrokePoint,
  type Viewport,
  type ToolId,
} from '../services/canvas';
import {
  listDrawings,
  loadScene,
  createDrawing,
  saveScene,
  deleteDrawing,
  setPreview,
  type DrawingItem,
} from '../services/drawings';
import { assetSave } from '../services/assets';
import { I18nService } from '../services/i18n';

interface ViewSize {
  width: number;
  height: number;
}

/**
 * Renders stroke primitives onto an HTML5 2D canvas context in screen space.
 * Factored out so both the main display canvas and the offscreen export canvas can share it.
 */
function renderStrokesToContext(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  view: Viewport,
): void {
  for (const stroke of strokes) {
    if (stroke.points.length === 0) continue;

    ctx.save();
    ctx.strokeStyle = stroke.color;
    ctx.fillStyle = stroke.color;
    ctx.lineWidth = Math.max(1, stroke.width * view.zoom);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (stroke.tool === 'marker') {
      ctx.globalAlpha = 0.4;
    }

    if (stroke.tool === 'pen' || stroke.tool === 'marker') {
      if (stroke.points.length === 1) {
        const p = worldToScreen(stroke.points[0], view);
        const r = Math.max(1, (stroke.width * (stroke.points[0].pressure || 1) * view.zoom) / 2);
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.beginPath();
        const start = worldToScreen(stroke.points[0], view);
        ctx.moveTo(start.x, start.y);
        for (let i = 1; i < stroke.points.length; i++) {
          const pt = worldToScreen(stroke.points[i], view);
          ctx.lineTo(pt.x, pt.y);
        }
        ctx.stroke();
      }
    } else if (stroke.tool === 'line') {
      if (stroke.points.length >= 2) {
        const p1 = worldToScreen(stroke.points[0], view);
        const p2 = worldToScreen(stroke.points[stroke.points.length - 1], view);
        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.lineTo(p2.x, p2.y);
        ctx.stroke();
      }
    } else if (stroke.tool === 'rect') {
      if (stroke.points.length >= 2) {
        const p1 = worldToScreen(stroke.points[0], view);
        const p2 = worldToScreen(stroke.points[stroke.points.length - 1], view);
        const rx = Math.min(p1.x, p2.x);
        const ry = Math.min(p1.y, p2.y);
        const rw = Math.abs(p2.x - p1.x);
        const rh = Math.abs(p2.y - p1.y);
        ctx.strokeRect(rx, ry, rw, rh);
      }
    } else if (stroke.tool === 'ellipse') {
      if (stroke.points.length >= 2) {
        const p1 = worldToScreen(stroke.points[0], view);
        const p2 = worldToScreen(stroke.points[stroke.points.length - 1], view);
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.max(1, rx), Math.max(1, ry), 0, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else if (stroke.tool === 'text') {
      const p = worldToScreen(stroke.points[0], view);
      const fontSize = Math.max(8, stroke.width * view.zoom);
      ctx.font = `${fontSize}px sans-serif`;
      ctx.textBaseline = 'top';
      ctx.fillText(stroke.text || '', p.x, p.y);
    }

    ctx.restore();
  }
}

/**
 * Infinite canvas vector drawings view: manages multiple drawings, freehand pen/marker,
 * shapes, whole-stroke eraser, pan/zoom, debounced autosave, and PNG/SVG export.
 */
/**
 * The empty canvas, shared: `scene` is a dependency of the render effect, and a
 * fresh object every render would repaint the canvas for nothing.
 */
const EMPTY_SCENE: Scene = { version: 1, strokes: [] };

export function DrawingsView(): React.JSX.Element {
  const t = I18nService.t();

  const [drawings, setDrawings] = useState<DrawingItem[]>([]);
  const [activeDrawingId, setActiveDrawingId] = useState<string | null>(null);
  /**
   * The scene as loaded, tagged with the drawing it belongs to. What the canvas
   * shows is derived below instead of being cleared by an effect: "nothing is
   * selected" is a fact about the selection, not a state change of its own.
   */
  const [loaded, setLoaded] = useState<{ id: string | null; scene: Scene }>({
    id: null,
    scene: EMPTY_SCENE,
  });

  // Navigation viewport state
  const [viewport, setViewport] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });

  /**
   * The scene on screen: the loaded one, or an empty canvas whenever the
   * selection has moved on from what was loaded.
   */
  const scene = loaded.id === activeDrawingId ? loaded.scene : EMPTY_SCENE;

  /** Replaces the scene of the open drawing. Callers check there is one. */
  const applyScene = useCallback(
    (id: string, next: Scene) => setLoaded({ id, scene: next }),
    []
  );

  // Active tool settings
  const [activeTool, setActiveTool] = useState<ToolId>('pen');
  const [strokeColor, setStrokeColor] = useState<string>('#ffffff');
  const [strokeWidth, setStrokeWidth] = useState<number>(3);

  // Active text editing state
  const [textInputPosition, setTextInputPosition] = useState<{ x: number; y: number } | null>(null);
  const [textInputValue, setTextInputValue] = useState<string>('');

  // Canvas DOM container & backing store size
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [canvasSize, setCanvasSize] = useState<ViewSize>({ width: 800, height: 600 });

  // Refs for hot-path interaction state
  const isPointerDownRef = useRef(false);
  const isPanningRef = useRef(false);
  const panStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const viewStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const activeStrokeRef = useRef<Stroke | null>(null);
  const sceneRef = useRef<Scene>(scene);
  // Mirrored after commit: pointer handlers run after the browser has painted,
  // so they always see the scene the canvas is actually showing.
  useEffect(() => {
    sceneRef.current = scene;
  }, [scene]);

  // Track if space bar is currently held down for space+drag panning
  const isSpacePressedRef = useRef(false);

  // Track if scene has unsaved changes and timer for debounced autosave
  const isDirtyRef = useRef(false);
  const autoSaveTimerRef = useRef<number | null>(null);

  /**
   * Loads the drawing list and adjusts the selection.
   *
   * The state writes live in the continuation, not in an `async` body: React
   * treats an awaited write as if it belonged to the render-triggered pass that
   * called this, and the continuation is also where the cancellation belongs.
   */
  const refreshDrawings = useCallback((selectId?: string): Promise<void> => {
    return listDrawings()
      .then((items) => {
        setDrawings(items);
        // The selection is adjusted inside the updater, not read from a closure:
        // depending on `activeDrawingId` here would give this callback a new
        // identity on every selection, and the effect below would refetch each time.
        setActiveDrawingId((prev) => {
          if (selectId) return selectId;
          return prev ?? (items.length > 0 ? items[0].id : null);
        });
      })
      .catch(() => {
        // A list that cannot be read leaves the screen as it was; there is
        // nothing useful to tell the user about a screen they just opened.
      });
  }, []);

  useEffect(() => {
    void refreshDrawings();
  }, [refreshDrawings]);

  // Persist current scene to database
  const performSave = useCallback(
    async (id: string, currentScene: Scene) => {
      try {
        await saveScene(id, currentScene);
        isDirtyRef.current = false;
      } catch {
        // Retry will occur on next change
      }
    },
    []
  );

  // Debounced auto-save scheduler
  const scheduleAutoSave = useCallback(() => {
    isDirtyRef.current = true;
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = window.setTimeout(() => {
      if (activeDrawingId && isDirtyRef.current) {
        performSave(activeDrawingId, sceneRef.current);
      }
    }, 1000);
  }, [activeDrawingId, performSave]);

  // Track space bar key events for space+drag panning
  useEffect(() => {
    const handleKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space' && !textInputPosition) {
        isSpacePressedRef.current = true;
      }
    };
    const handleKeyUp = (e: globalThis.KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpacePressedRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [textInputPosition]);

  // Load scene whenever the selected drawing changes
  useEffect(() => {
    if (!activeDrawingId) return;
    const drawingId = activeDrawingId;
    let isMounted = true;
    loadScene(drawingId)
      .then((loadedScene) => {
        if (isMounted) {
          setLoaded({ id: drawingId, scene: loadedScene });
          setViewport({ x: 0, y: 0, zoom: 1 });
          isDirtyRef.current = false;
        }
      })
      .catch(() => {
        if (isMounted) {
          // A drawing whose scene cannot be read opens empty rather than
          // leaving the previous drawing's strokes on screen.
          setLoaded({ id: drawingId, scene: EMPTY_SCENE });
        }
      });

    return () => {
      isMounted = false;
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
      if (activeDrawingId && isDirtyRef.current) {
        performSave(activeDrawingId, sceneRef.current);
      }
    };
  }, [activeDrawingId, performSave]);

  // Resize canvas according to container dimensions
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setCanvasSize({ width, height });
        }
      }
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  // Main canvas render frame
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    // Scale backing store by devicePixelRatio to ensure sharp crisp rendering on high-DPI displays
    canvas.width = canvasSize.width * dpr;
    canvas.height = canvasSize.height * dpr;

    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);

    // Visible strokes from spatial culling
    const visible = buildFrame(scene, viewport, canvasSize);

    // If an in-progress stroke exists, render it as well
    const allToRender = activeStrokeRef.current
      ? [...visible, activeStrokeRef.current]
      : visible;

    renderStrokesToContext(ctx, allToRender, viewport);
    ctx.restore();
  }, [scene, viewport, canvasSize]);

  // Create a new drawing
  const handleCreateNew = async () => {
    try {
      const newDrawing = await createDrawing({ title: t.navDrawings });
      await refreshDrawings(newDrawing.id);
    } catch {
      // Creation error handled silently
    }
  };

  // Delete active drawing
  const handleDeleteDrawing = async (id: string) => {
    try {
      await deleteDrawing(id);
      const remaining = drawings.filter((d) => d.id !== id);
      setDrawings(remaining);
      if (activeDrawingId === id) {
        setActiveDrawingId(remaining.length > 0 ? remaining[0].id : null);
      }
    } catch {
      // Deletion error handled silently
    }
  };

  // Reset pan & zoom
  const handleResetView = () => {
    setViewport({ x: 0, y: 0, zoom: 1 });
  };

  // Wheel event for zoom centered on cursor
  const handleWheel = (e: ReactWheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const cursorScreenX = e.clientX - rect.left;
    const cursorScreenY = e.clientY - rect.top;

    const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
    const newZoom = Math.min(Math.max(viewport.zoom * zoomFactor, 0.1), 10);

    // Zoom centered on cursor position:
    // (cursor - view.new) / zoom.new = (cursor - view.old) / zoom.old
    const newX = cursorScreenX - (cursorScreenX - viewport.x) * (newZoom / viewport.zoom);
    const newY = cursorScreenY - (cursorScreenY - viewport.y) * (newZoom / viewport.zoom);

    setViewport({
      x: newX,
      y: newY,
      zoom: newZoom,
    });
  };

  // Pointer down: dispatch stroke creation, panning, or text placement
  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !activeDrawingId) return;
    canvas.setPointerCapture(e.pointerId);

    const rect = canvas.getBoundingClientRect();
    const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPt = screenToWorld(screenPt, viewport);

    // Middle button, or left button with Space pressed or shift pressed -> pan
    if (e.button === 1 || e.buttons === 4 || (e.button === 0 && (isSpacePressedRef.current || e.shiftKey))) {
      isPanningRef.current = true;
      panStartRef.current = { x: e.clientX, y: e.clientY };
      viewStartRef.current = { x: viewport.x, y: viewport.y };
      return;
    }

    if (e.button !== 0) return;

    isPointerDownRef.current = true;

    if (activeTool === 'eraser') {
      const eraseRadius = strokeWidth * 2;
      const updated = eraseAt(sceneRef.current, worldPt, eraseRadius);
      applyScene(activeDrawingId, updated);
      scheduleAutoSave();
      return;
    }

    if (activeTool === 'text') {
      setTextInputPosition(screenPt);
      setTextInputValue('');
      // The press stays open deliberately. Placing the caret costs focus - the
      // browser moves it on mousedown - so the field is blurred by the very
      // gesture that created it. handleTextCommit treats that blur as the
      // click it is, and only a later one as a decision to finish.
      return;
    }

    // Pressure fallback for pen: pointerEvent.pressure > 0 ? pressure : 0.5
    const reportedPressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;

    const newStroke: Stroke = {
      id: `stroke-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      tool: activeTool,
      color: strokeColor,
      width: strokeWidth,
      points: [
        {
          x: worldPt.x,
          y: worldPt.y,
          pressure: activeTool === 'pen' ? reportedPressure : 1.0,
        },
      ],
    };

    activeStrokeRef.current = newStroke;

    // Trigger canvas redraw with the active stroke
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      const visible = buildFrame(sceneRef.current, viewport, canvasSize);
      renderStrokesToContext(ctx, [...visible, newStroke], viewport);
      ctx.restore();
    }
  };

  // Pointer move: append points or pan
  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!activeDrawingId) return;
    if (isPanningRef.current) {
      const dx = e.clientX - panStartRef.current.x;
      const dy = e.clientY - panStartRef.current.y;
      setViewport((prev) => ({
        ...prev,
        x: viewStartRef.current.x + dx,
        y: viewStartRef.current.y + dy,
      }));
      return;
    }

    if (!isPointerDownRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const screenPt = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const worldPt = screenToWorld(screenPt, viewport);

    if (activeTool === 'eraser') {
      const eraseRadius = strokeWidth * 2;
      const updated = eraseAt(sceneRef.current, worldPt, eraseRadius);
      applyScene(activeDrawingId, updated);
      scheduleAutoSave();
      return;
    }

    const currentStroke = activeStrokeRef.current;
    if (!currentStroke) return;

    const reportedPressure = e.pressure !== undefined && e.pressure > 0 ? e.pressure : 0.5;
    const pt: StrokePoint = {
      x: worldPt.x,
      y: worldPt.y,
      pressure: activeTool === 'pen' ? reportedPressure : 1.0,
    };

    if (activeTool === 'pen' || activeTool === 'marker') {
      currentStroke.points.push(pt);
    } else {
      // Shapes keep start point and update current end point
      if (currentStroke.points.length === 1) {
        currentStroke.points.push(pt);
      } else {
        currentStroke.points[1] = pt;
      }
    }

    // Direct redraw during active stroke
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, canvasSize.width, canvasSize.height);
      const visible = buildFrame(sceneRef.current, viewport, canvasSize);
      renderStrokesToContext(ctx, [...visible, currentStroke], viewport);
      ctx.restore();
    }
  };

  // Pointer up: commit current stroke to scene and save
  const handlePointerUp = () => {
    if (isPanningRef.current) {
      isPanningRef.current = false;
    }

    if (!isPointerDownRef.current) return;
    isPointerDownRef.current = false;

    const finished = activeStrokeRef.current;
    activeStrokeRef.current = null;

    if (finished && finished.points.length > 0 && activeDrawingId) {
      const nextScene: Scene = {
        version: 1,
        strokes: [...sceneRef.current.strokes, finished],
      };
      applyScene(activeDrawingId, nextScene);
      isDirtyRef.current = true;
      performSave(activeDrawingId, nextScene);
    }
  };

  // Text commit
  const handleTextCommit = () => {
    if (!activeDrawingId) return;
    if (textInputPosition && textInputValue.trim().length > 0) {
      const worldPt = screenToWorld(textInputPosition, viewport);
      const textStroke: Stroke = {
        id: `text-${Date.now()}`,
        tool: 'text',
        color: strokeColor,
        width: Math.max(12, strokeWidth * 4),
        points: [{ x: worldPt.x, y: worldPt.y, pressure: 1 }],
        text: textInputValue,
      };

      const nextScene: Scene = {
        version: 1,
        strokes: [...sceneRef.current.strokes, textStroke],
      };
      applyScene(activeDrawingId, nextScene);
      isDirtyRef.current = true;
      performSave(activeDrawingId, nextScene);
      
    }
    setTextInputPosition(null);
    setTextInputValue('');
  };

  /**
   * Leaving the field finishes the text.
   *
   * Except when the click that opened the editor is still in progress: placing
   * the caret costs focus, so the browser blurs the field it has just focused.
   * That blur belongs to the same gesture, and reading it as a decision to
   * finish would close the editor before the user could type into it.
   */
  const handleTextBlur = () => {
    if (isPointerDownRef.current) return;
    handleTextCommit();
  };

  const handleTextKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleTextCommit();
    } else if (e.key === 'Escape') {
      setTextInputPosition(null);
      setTextInputValue('');
    }
  };

  // Export scene to PNG using total scene bounds (not just current viewport)
  const handleExportPng = async () => {
    const strokes = scene.strokes;
    if (strokes.length === 0) return;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;

    for (const stroke of strokes) {
      const b = strokeBounds(stroke);
      if (b.minX < minX) minX = b.minX;
      if (b.minY < minY) minY = b.minY;
      if (b.maxX > maxX) maxX = b.maxX;
      if (b.maxY > maxY) maxY = b.maxY;
    }

    const margin = 20;
    const bWidth = Math.max(100, Math.ceil(maxX - minX + margin * 2));
    const bHeight = Math.max(100, Math.ceil(maxY - minY + margin * 2));

    const offscreen = document.createElement('canvas');
    offscreen.width = bWidth;
    offscreen.height = bHeight;

    const offCtx = offscreen.getContext('2d');
    if (!offCtx) return;

    // Viewport translating world (minX - margin, minY - margin) to (0, 0)
    const exportView: Viewport = {
      x: -(minX - margin),
      y: -(minY - margin),
      zoom: 1,
    };

    renderStrokesToContext(offCtx, strokes, exportView);

    // Convert offscreen canvas to PNG blob bytes
    offscreen.toBlob(async (blob) => {
      if (!blob || !activeDrawingId) return;
      const arrayBuffer = await blob.arrayBuffer();
      const uint8 = new Uint8Array(arrayBuffer);
      const filename = `${activeDrawingId}.png`;

      try {
        const assetRef = await assetSave('preview', filename, uint8);
        await setPreview(activeDrawingId, assetRef.path);
        // Refresh drawings list to show updated preview thumbnail
        await refreshDrawings();
      } catch {
        // Fallback for download in web/test environment
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeDrawingId}.png`;
        a.click();
        URL.revokeObjectURL(url);
      }
    }, 'image/png');
  };

  // Export scene to SVG markup string and save/download
  const handleExportSvg = async () => {
    const svgString = sceneToSvg(scene);
    const blob = new Blob([svgString], { type: 'image/svg+xml' });

    if (activeDrawingId) {
      const encoder = new TextEncoder();
      const uint8 = encoder.encode(svgString);
      const filename = `${activeDrawingId}.svg`;
      try {
        await assetSave('preview', filename, uint8);
      } catch {
        // Fallback to browser download
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${activeDrawingId || 'drawing'}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const zoomPercent = Math.round(viewport.zoom * 100);


  return (
    <div className="flex flex-1 h-full w-full overflow-hidden select-none bg-black text-white">
      {/* Left Sidebar: Drawings List matching Screenshot 2 */}
      <div className="w-52 flex flex-col border-r border-white/10 bg-[#060608] select-none shrink-0">
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-white">
            <ArrowLeft className="w-3.5 h-3.5 opacity-60 hover:opacity-100 cursor-pointer" />
            <span>DRAWING</span>
          </div>
          <button
            type="button"
            onClick={handleCreateNew}
            aria-label={t.drawingsNew}
            className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-colors"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {drawings.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-4 text-center text-xs text-[var(--text-muted)]">
              <ImageIcon className="w-8 h-8 mb-2 opacity-40" />
              <p>{t.drawingsEmpty}</p>
            </div>
          ) : (
            drawings.map((item) => {
              const isSelected = item.id === activeDrawingId;
              return (
                <div
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setActiveDrawingId(item.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      setActiveDrawingId(item.id);
                    }
                  }}
                  className={`group flex items-center justify-between px-2.5 py-1.5 rounded-lg cursor-pointer text-xs transition-colors ${
                    isSelected
                      ? 'bg-white/10 text-white font-medium shadow-xs'
                      : 'hover:bg-white/5 text-white/50 hover:text-white/80'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    {item.preview_path ? (
                      <img
                        src={convertFileSrc(item.preview_path, 'tempo-media')}
                        alt={item.title}
                        className="w-7 h-7 rounded border border-[var(--border-subtle)] object-cover bg-white"
                      />
                    ) : (
                      <div className="w-7 h-7 rounded border border-[var(--border-subtle)] bg-[var(--surface-canvas)] flex items-center justify-center text-[var(--text-muted)]">
                        <FileText className="w-3.5 h-3.5 opacity-50" />
                      </div>
                    )}
                    <span className="truncate">{item.title}</span>
                  </div>

                  <button
                    type="button"
                    title={t.drawingsDelete}
                    aria-label={t.drawingsDelete}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteDrawing(item.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-1 text-white/40 hover:text-red-400 transition-opacity"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Right Area: Infinite Canvas and Floating Toolbars */}
      <div ref={containerRef} className="relative flex-1 h-full overflow-hidden">
        <canvas
          ref={canvasRef}
          onWheel={handleWheel}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          className="w-full h-full cursor-crosshair touch-none bg-black"
        />

        {/* Text Input Floating Overlay */}
        {textInputPosition && (
          <div
            className="absolute z-30"
            style={{ left: textInputPosition.x, top: textInputPosition.y }}
          >
            <input
              autoFocus
              type="text"
              value={textInputValue}
              onChange={(e) => setTextInputValue(e.target.value)}
              onKeyDown={handleTextKeyDown}
              onBlur={handleTextBlur}
              placeholder="Type text..."
              style={{
                color: strokeColor,
                fontSize: `${Math.max(12, strokeWidth * 4 * viewport.zoom)}px`,
              }}
              className="bg-transparent border-b border-[var(--border-focus)] outline-none px-1"
            />
          </div>
        )}

        {/* Top Control Bar: Tool selection, color, width, zoom & exports */}
        {/* Floating Bottom Tool Dock matching Screenshot 2 [ 🔒 ✋ ↖ □ ◇ ○ → — | ✎ A 🖼 ⌫ ] */}
        <div
          className="fixed bottom-7 left-1/2 -translate-x-1/2 z-30 flex items-center gap-1 px-3 py-1.5 rounded-2xl border border-white/10 bg-[#121214]/90 backdrop-blur-xl shadow-2xl text-xs text-white/70 select-none"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          {/* 1. Lock */}
          <button
            type="button"
            aria-label="Lock"
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
          >
            <Lock className="w-4 h-4" />
          </button>

          {/* 2. Hand (Pan) */}
          <button
            type="button"
            aria-label="Pan"
            onClick={() => setActiveTool('pen')}
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
          >
            <Hand className="w-4 h-4" />
          </button>

          {/* 3. Selection Pointer */}
          <button
            type="button"
            aria-label="Select"
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
          >
            <MousePointer2 className="w-4 h-4" />
          </button>

          {/* 4. Rectangle */}
          <button
            type="button"
            title={t.drawToolRect}
            aria-label={t.drawToolRect}
            onClick={() => setActiveTool('rect')}
            className={`p-1.5 rounded-lg transition-colors ${
              activeTool === 'rect' ? 'bg-[#282828] text-white font-bold' : 'hover:text-white hover:bg-white/10'
            }`}
          >
            <Square className="w-4 h-4" />
          </button>

          {/* 5. Diamond */}
          <button
            type="button"
            aria-label="Diamond"
            onClick={() => setActiveTool('rect')}
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
          >
            <Diamond className="w-4 h-4" />
          </button>

          {/* 6. Circle */}
          <button
            type="button"
            title={t.drawToolEllipse}
            aria-label={t.drawToolEllipse}
            onClick={() => setActiveTool('ellipse')}
            className={`p-1.5 rounded-lg transition-colors ${
              activeTool === 'ellipse' ? 'bg-[#282828] text-white font-bold' : 'hover:text-white hover:bg-white/10'
            }`}
          >
            <Circle className="w-4 h-4" />
          </button>

          {/* 7. Arrow */}
          <button
            type="button"
            aria-label="Arrow"
            onClick={() => setActiveTool('line')}
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
          >
            <ArrowRight className="w-4 h-4" />
          </button>

          {/* 8. Line */}
          <button
            type="button"
            title={t.drawToolLine}
            aria-label={t.drawToolLine}
            onClick={() => setActiveTool('line')}
            className={`p-1.5 rounded-lg transition-colors ${
              activeTool === 'line' ? 'bg-[#282828] text-white font-bold' : 'hover:text-white hover:bg-white/10'
            }`}
          >
            <Minus className="w-4 h-4" />
          </button>

          {/* Subtle separator matching screenshot */}
          <div className="h-4 w-[1px] bg-white/15 mx-1" />

          {/* 9. Pen (Active default) */}
          <button
            type="button"
            title={t.drawToolPen}
            aria-label={t.drawToolPen}
            onClick={() => setActiveTool('pen')}
            className={`p-1.5 rounded-lg transition-colors ${
              activeTool === 'pen' ? 'bg-[#282828] text-white font-bold' : 'hover:text-white hover:bg-white/10'
            }`}
          >
            <Pen className="w-4 h-4" />
          </button>

          {/* 10. Text */}
          <button
            type="button"
            title={t.drawToolText}
            aria-label={t.drawToolText}
            onClick={() => setActiveTool('text')}
            className={`p-1.5 rounded-lg transition-colors ${
              activeTool === 'text' ? 'bg-[#282828] text-white font-bold' : 'hover:text-white hover:bg-white/10'
            }`}
          >
            <Type className="w-4 h-4" />
          </button>

          {/* 11. Image (Export PNG) */}
          <button
            type="button"
            title={t.drawExportPng}
            aria-label={t.drawExportPng}
            onClick={handleExportPng}
            className="p-1.5 rounded-lg hover:text-white hover:bg-white/10 transition-colors"
          >
            <ImageIcon className="w-4 h-4" />
          </button>

          {/* 12. Eraser */}
          <button
            type="button"
            title={t.drawToolEraser}
            aria-label={t.drawToolEraser}
            onClick={() => setActiveTool('eraser')}
            className={`p-1.5 rounded-lg transition-colors ${
              activeTool === 'eraser' ? 'bg-[#282828] text-white font-bold' : 'hover:text-white hover:bg-white/10'
            }`}
          >
            <Eraser className="w-4 h-4" />
          </button>

          <div className="h-4 w-[1px] bg-white/15 mx-0.5" />

          {/* Color picker */}
          <input
            type="color"
            value={strokeColor}
            aria-label={t.drawColor}
            onChange={(e) => setStrokeColor(e.target.value)}
            className="w-4 h-4 rounded-full border border-white/20 p-0 bg-transparent cursor-pointer shrink-0"
          />

          {/* Stroke width */}
          <input
            type="range"
            min="1"
            max="20"
            value={strokeWidth}
            aria-label={t.drawWidth}
            onChange={(e) => setStrokeWidth(Number(e.target.value))}
            className="w-10 accent-white cursor-pointer hidden md:block"
          />
          {/* Zoom Reset */}
          <button
            type="button"
            title={t.drawReset}
            aria-label={t.drawReset}
            onClick={handleResetView}
            className="px-2 py-1 rounded-lg text-[10px] font-mono hover:bg-white/10 text-white/50 hover:text-white transition-colors"
          >
            {zoomPercent}%
          </button>
          {/* Hidden SVG export for test & keyboard accessibility */}
          <button
            type="button"
            title={t.drawExportSvg}
            aria-label={t.drawExportSvg}
            onClick={handleExportSvg}
            className="sr-only"
          >
            SVG
          </button>
        </div>
      </div>
    </div>
  );
}
