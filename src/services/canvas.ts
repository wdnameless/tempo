/**
 * Pure canvas model: strokes in world coordinates, a Viewport over them, no DOM.
 *
 * All coordinates on Stroke and StrokePoint are in world space.
 * Viewport defines the transformation between world coordinates and screen pixels:
 *   screen = world * zoom + view
 *   world  = (screen - view) / zoom
 */

export type ToolId = 'pen' | 'marker' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'text';

export interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
}

export interface Stroke {
  id: string;
  tool: ToolId;
  color: string;
  width: number;
  points: StrokePoint[];
  /** Только для text: строка и её размер. */
  text?: string;
}

export interface Scene {
  version: 1;
  strokes: Stroke[];
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface RectBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function emptyScene(): Scene {
  return {
    version: 1,
    strokes: [],
  };
}

/**
 * Screen pixels to world coordinates:
 * world = (screen - view.xy) / zoom
 */
export function screenToWorld(
  point: { x: number; y: number },
  view: Viewport,
): { x: number; y: number } {
  const zoom = view.zoom === 0 ? 1 : view.zoom;
  return {
    x: (point.x - view.x) / zoom,
    y: (point.y - view.y) / zoom,
  };
}

/**
 * World coordinates to screen pixels:
 * screen = world * zoom + view.xy
 */
export function worldToScreen(
  point: { x: number; y: number },
  view: Viewport,
): { x: number; y: number } {
  return {
    x: point.x * view.zoom + view.x,
    y: point.y * view.zoom + view.y,
  };
}

/**
 * Computes axis-aligned bounding box of a stroke in world coordinates,
 * expanded by half the stroke width (or minimum margin) so that line thickness
 * is accounted for in culling and hit testing.
 */
export function strokeBounds(stroke: Stroke): RectBounds {
  const points = stroke.points;
  if (!points || points.length === 0) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }

  // Handle special cases: if text, approximate width/height if only 1 anchor point
  if (stroke.tool === 'text' && stroke.text) {
    const textLen = stroke.text.length;
    const fontSize = stroke.width || 16;
    // Rough estimate in world units: ~0.6 * fontSize per char width, 1.2 * fontSize height
    const estimatedWidth = textLen * fontSize * 0.6;
    const estimatedHeight = fontSize * 1.2;
    maxX = Math.max(maxX, minX + estimatedWidth);
    maxY = Math.max(maxY, minY + estimatedHeight);
  }

  // Expand bounds by half-width for stroke rendering margin
  const halfWidth = Math.max(stroke.width / 2, 1);
  return {
    minX: minX - halfWidth,
    minY: minY - halfWidth,
    maxX: maxX + halfWidth,
    maxY: maxY + halfWidth,
  };
}

/**
 * Returns strokes that intersect the world viewport rectangle.
 * Viewport world rect:
 *   left   = -view.x / view.zoom
 *   top    = -view.y / view.zoom
 *   right  = (size.width - view.x) / view.zoom
 *   bottom = (size.height - view.y) / view.zoom
 */
export function visibleStrokes(
  scene: Scene,
  view: Viewport,
  size: { width: number; height: number },
): Stroke[] {
  return buildFrame(scene, view, size);
}

/**
 * Hot path: builds the visible list for one render frame (culling + preserving z-order).
 *
 * PERFORMANCE NOTE:
 * To meet the 60fps budget (R46), this function runs in a single linear pass with
 * minimal allocations. We compute the world viewport bounds once up front, and for each
 * stroke, compute/check its bounding box against viewport boundaries using primitive
 * number comparisons without allocating intermediate objects per stroke.
 */
export function buildFrame(
  scene: Scene,
  view: Viewport,
  size: { width: number; height: number },
): Stroke[] {
  const zoom = view.zoom === 0 ? 1 : view.zoom;
  const invZoom = 1 / zoom;

  // Viewport rectangle in world coordinates
  const vMinX = -view.x * invZoom;
  const vMinY = -view.y * invZoom;
  const vMaxX = (size.width - view.x) * invZoom;
  const vMaxY = (size.height - view.y) * invZoom;

  const strokes = scene.strokes;
  const count = strokes.length;
  const result: Stroke[] = [];

  for (let i = 0; i < count; i++) {
    const s = strokes[i];
    const pts = s.points;
    const ptLen = pts.length;
    if (ptLen === 0) continue;

    // Fast-path inlined bounds check to avoid object allocation in hot path
    let sMinX = pts[0].x;
    let sMinY = pts[0].y;
    let sMaxX = pts[0].x;
    let sMaxY = pts[0].y;

    for (let j = 1; j < ptLen; j++) {
      const p = pts[j];
      if (p.x < sMinX) sMinX = p.x;
      if (p.y < sMinY) sMinY = p.y;
      if (p.x > sMaxX) sMaxX = p.x;
      if (p.y > sMaxY) sMaxY = p.y;
    }

    if (s.tool === 'text' && s.text) {
      const fontSize = s.width || 16;
      const estWidth = s.text.length * fontSize * 0.6;
      const estHeight = fontSize * 1.2;
      if (sMinX + estWidth > sMaxX) sMaxX = sMinX + estWidth;
      if (sMinY + estHeight > sMaxY) sMaxY = sMinY + estHeight;
    }

    const halfW = s.width > 2 ? s.width * 0.5 : 1;
    sMinX -= halfW;
    sMinY -= halfW;
    sMaxX += halfW;
    sMaxY += halfW;

    // Overlap check: two rectangles overlap if they overlap on both axes
    if (sMaxX >= vMinX && sMinX <= vMaxX && sMaxY >= vMinY && sMinY <= vMaxY) {
      result.push(s);
    }
  }

  return result;
}

/**
 * Erases whole strokes whose bounds or points come within `radius` of `point`.
 * Returns a new Scene without mutating the input scene.
 * Vector-level eraser: removes entire strokes so that SVG export and vector semantics remain intact.
 */
export function eraseAt(
  scene: Scene,
  point: { x: number; y: number },
  radius: number,
): Scene {
  const r = Math.max(0, radius);
  const px = point.x;
  const py = point.y;
  const rSq = r * r;

  const surviving = scene.strokes.filter((stroke) => {
    const bounds = strokeBounds(stroke);
    // If point is completely outside bounding box expanded by radius, keep stroke
    if (
      px < bounds.minX - r ||
      px > bounds.maxX + r ||
      py < bounds.minY - r ||
      py > bounds.maxY + r
    ) {
      return true;
    }

    // Closer check: check distance to any stroke point or segment
    const pts = stroke.points;
    if (pts.length === 0) return false;

    // Check if any point is within radius
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - px;
      const dy = pts[i].y - py;
      if (dx * dx + dy * dy <= rSq) {
        return false; // hit! erase whole stroke
      }
    }

    // For multi-point strokes (lines, paths, rects), check distance to segments
    for (let i = 0; i < pts.length - 1; i++) {
      if (distToSegmentSquared(px, py, pts[i], pts[i + 1]) <= rSq) {
        return false; // hit! erase whole stroke
      }
    }

    return true;
  });

  return {
    version: 1,
    strokes: surviving,
  };
}

function distToSegmentSquared(
  px: number,
  py: number,
  v: { x: number; y: number },
  w: { x: number; y: number },
): number {
  const l2 = (w.x - v.x) * (w.x - v.x) + (w.y - v.y) * (w.y - v.y);
  if (l2 === 0) {
    const dx = px - v.x;
    const dy = py - v.y;
    return dx * dx + dy * dy;
  }
  let t = ((px - v.x) * (w.x - v.x) + (py - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  const projX = v.x + t * (w.x - v.x);
  const projY = v.y + t * (w.y - v.y);
  const dx = px - projX;
  const dy = py - projY;
  return dx * dx + dy * dy;
}

function escapeXml(unsafe: string): string {
  return unsafe
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/**
 * Exports a Scene to an SVG markup string.
 * Each stroke maps to SVG elements (<path>, <rect>, <ellipse>, <text>, etc.),
 * styled with stroke-width and color, fill="none" (except text).
 * The SVG has a viewBox tightly covering the scene bounds (or a default 100x100 if empty).
 * Text content is escaped to prevent injection.
 */
export function sceneToSvg(scene: Scene): string {
  if (!scene.strokes || scene.strokes.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"></svg>`;
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const stroke of scene.strokes) {
    const b = strokeBounds(stroke);
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }

  if (!Number.isFinite(minX)) {
    minX = 0;
    minY = 0;
    maxX = 100;
    maxY = 100;
  }

  // Add 10px margin around content bounds
  const margin = 10;
  minX -= margin;
  minY -= margin;
  maxX += margin;
  maxY += margin;

  const width = Math.max(1, Math.round(maxX - minX));
  const height = Math.max(1, Math.round(maxY - minY));
  const viewBox = `${minX} ${minY} ${width} ${height}`;

  const elements: string[] = [];

  for (const stroke of scene.strokes) {
    const color = escapeXml(stroke.color || '#000000');
    const strokeWidth = stroke.width || 2;
    const pts = stroke.points;
    switch (stroke.tool) {
      case 'rect': {
        const p1 = pts[0];
        const p2 = pts[pts.length - 1];
        const rx = Math.min(p1.x, p2.x);
        const ry = Math.min(p1.y, p2.y);
        const rw = Math.abs(p2.x - p1.x);
        const rh = Math.abs(p2.y - p1.y);
        elements.push(
          `<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" />`,
        );
        break;
      }
      case 'ellipse': {
        const p1 = pts[0];
        const p2 = pts[pts.length - 1];
        const cx = (p1.x + p2.x) / 2;
        const cy = (p1.y + p2.y) / 2;
        const rx = Math.abs(p2.x - p1.x) / 2;
        const ry = Math.abs(p2.y - p1.y) / 2;
        elements.push(
          `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" />`,
        );
        break;
      }
      case 'text': {
        const p = pts[0];
        const text = escapeXml(stroke.text || '');
        const fontSize = strokeWidth || 16;
        elements.push(
          `<text x="${p.x}" y="${p.y}" fill="${color}" font-size="${fontSize}" font-family="sans-serif">${text}</text>`,
        );
        break;
      }
      case 'marker': {
        const d = buildPathData(pts);
        elements.push(
          `<path d="${d}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="0.4" />`,
        );
        break;
      }
      case 'pen':
      case 'line':
      case 'eraser':
      default: {
        const d = buildPathData(pts);
        elements.push(
          `<path d="${d}" stroke="${color}" stroke-width="${strokeWidth}" fill="none" stroke-linecap="round" stroke-linejoin="round" />`,
        );
        break;
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width}" height="${height}">\n  ${elements.join('\n  ')}\n</svg>`;
}

function buildPathData(pts: StrokePoint[]): string {
  if (pts.length === 0) return '';
  if (pts.length === 1) {
    return `M ${pts[0].x} ${pts[0].y} L ${pts[0].x + 0.01} ${pts[0].y + 0.01}`;
  }
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    d += ` L ${pts[i].x} ${pts[i].y}`;
  }
  return d;
}

/**
 * Compact JSON serialization of a scene.
 */
export function serializeScene(scene: Scene): string {
  return JSON.stringify({
    version: 1,
    strokes: scene.strokes || [],
  });
}

/**
 * Tolerant scene parser.
 * A corrupt JSON or invalid shape (missing strokes, stroke without points)
 * yields an empty or partially-usable scene. MUST NEVER throw.
 */
export function parseScene(json: string): Scene {
  if (!json || typeof json !== 'string') {
    return emptyScene();
  }

  try {
    const raw = JSON.parse(json);
    if (!raw || typeof raw !== 'object') {
      return emptyScene();
    }

    if (!Array.isArray(raw.strokes)) {
      return emptyScene();
    }

    const validTools: Record<string, true> = {
      pen: true,
      marker: true,
      eraser: true,
      line: true,
      rect: true,
      ellipse: true,
      text: true,
    };
    const validStrokes: Stroke[] = [];
    for (const s of raw.strokes) {
      if (!s || typeof s !== 'object') continue;

      const tool: ToolId = validTools[s.tool] ? s.tool : 'pen';
      const id = typeof s.id === 'string' && s.id.length > 0 ? s.id : Math.random().toString(36).slice(2, 9);
      const color = typeof s.color === 'string' ? s.color : '#000000';
      const width = typeof s.width === 'number' && Number.isFinite(s.width) && s.width > 0 ? s.width : 2;

      const points: StrokePoint[] = [];
      if (Array.isArray(s.points)) {
        for (const p of s.points) {
          if (!p || typeof p !== 'object') continue;
          const x = typeof p.x === 'number' && Number.isFinite(p.x) ? p.x : 0;
          const y = typeof p.y === 'number' && Number.isFinite(p.y) ? p.y : 0;
          const pressure = typeof p.pressure === 'number' && Number.isFinite(p.pressure) ? p.pressure : 0.5;
          points.push({ x, y, pressure });
        }
      }

      const stroke: Stroke = {
        id,
        tool,
        color,
        width,
        points,
      };

      if (typeof s.text === 'string') {
        stroke.text = s.text;
      }

      validStrokes.push(stroke);
    }

    return {
      version: 1,
      strokes: validStrokes,
    };
  } catch {
    return emptyScene();
  }
}
