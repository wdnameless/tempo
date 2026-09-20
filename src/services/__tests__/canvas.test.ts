import { describe, it, expect } from 'vitest';
import {
  screenToWorld,
  worldToScreen,
  buildFrame,
  eraseAt,
  sceneToSvg,
  parseScene,
  serializeScene,
  emptyScene,
  type Scene,
  type Stroke,
  type Viewport,
} from '../canvas';

describe('canvas service', () => {
  describe('screenToWorld and worldToScreen', () => {
    it('round-trips screen and world coordinates', () => {
      const view: Viewport = { x: 150, y: -80, zoom: 1.5 };
      const originalScreen = { x: 400, y: 300 };

      const world = screenToWorld(originalScreen, view);
      const backToScreen = worldToScreen(world, view);

      expect(backToScreen.x).toBeCloseTo(originalScreen.x, 5);
      expect(backToScreen.y).toBeCloseTo(originalScreen.y, 5);
    });

    it('handles identity view (zoom = 1, pan = 0)', () => {
      const view: Viewport = { x: 0, y: 0, zoom: 1 };
      const pt = { x: 123, y: 456 };
      expect(screenToWorld(pt, view)).toEqual(pt);
      expect(worldToScreen(pt, view)).toEqual(pt);
    });
  });

  describe('stroke pressure', () => {
    it('preserves per-point pressure values', () => {
      const stroke: Stroke = {
        id: 's1',
        tool: 'pen',
        color: '#000000',
        width: 3,
        points: [
          { x: 10, y: 20, pressure: 0.1 },
          { x: 15, y: 25, pressure: 0.85 },
          { x: 20, y: 30, pressure: 0.4 },
        ],
      };

      const scene: Scene = { version: 1, strokes: [stroke] };
      const json = serializeScene(scene);
      const restored = parseScene(json);

      expect(restored.strokes).toHaveLength(1);
      expect(restored.strokes[0].points[0].pressure).toBe(0.1);
      expect(restored.strokes[0].points[1].pressure).toBe(0.85);
      expect(restored.strokes[0].points[2].pressure).toBe(0.4);
    });
  });

  describe('eraseAt', () => {
    it('removes a whole stroke it overlaps and keeps a distant one', () => {
      const strokeNear: Stroke = {
        id: 'near',
        tool: 'pen',
        color: '#ff0000',
        width: 2,
        points: [
          { x: 50, y: 50, pressure: 0.5 },
          { x: 55, y: 55, pressure: 0.5 },
        ],
      };

      const strokeFar: Stroke = {
        id: 'far',
        tool: 'pen',
        color: '#00ff00',
        width: 2,
        points: [
          { x: 500, y: 500, pressure: 0.5 },
          { x: 505, y: 505, pressure: 0.5 },
        ],
      };

      const scene: Scene = { version: 1, strokes: [strokeNear, strokeFar] };

      // Erase at (52, 52) with radius 10
      const erased = eraseAt(scene, { x: 52, y: 52 }, 10);

      expect(erased.strokes).toHaveLength(1);
      expect(erased.strokes[0].id).toBe('far');
    });

    it('does not mutate the input scene', () => {
      const stroke: Stroke = {
        id: 's1',
        tool: 'pen',
        color: '#000000',
        width: 2,
        points: [{ x: 10, y: 10, pressure: 0.5 }],
      };
      const scene: Scene = { version: 1, strokes: [stroke] };
      const originalStrokesRef = scene.strokes;

      const erased = eraseAt(scene, { x: 10, y: 10 }, 5);

      expect(erased.strokes).toHaveLength(0);
      expect(scene.strokes).toHaveLength(1);
      expect(scene.strokes).toBe(originalStrokesRef);
    });
  });

  describe('sceneToSvg', () => {
    it('escapes < in a text stroke', () => {
      const textStroke: Stroke = {
        id: 'text-1',
        tool: 'text',
        color: '#123456',
        width: 14,
        text: '<script>alert("xss")</script> & "quotes"',
        points: [{ x: 20, y: 30, pressure: 0.5 }],
      };

      const scene: Scene = { version: 1, strokes: [textStroke] };
      const svg = sceneToSvg(scene);

      expect(svg).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt; &amp; &quot;quotes&quot;');
      expect(svg).not.toContain('<script>');
    });

    it('has a path per visible stroke', () => {
      const stroke1: Stroke = {
        id: 'p1',
        tool: 'pen',
        color: '#000000',
        width: 2,
        points: [
          { x: 0, y: 0, pressure: 0.5 },
          { x: 10, y: 10, pressure: 0.5 },
        ],
      };
      const stroke2: Stroke = {
        id: 'p2',
        tool: 'marker',
        color: '#ffff00',
        width: 8,
        points: [
          { x: 20, y: 20, pressure: 0.5 },
          { x: 30, y: 30, pressure: 0.5 },
        ],
      };

      const scene: Scene = { version: 1, strokes: [stroke1, stroke2] };
      const svg = sceneToSvg(scene);

      const pathMatches = svg.match(/<path /g);
      expect(pathMatches).toHaveLength(2);
      expect(svg).toContain('viewBox=');
    });

    it('produces valid default svg for empty scene', () => {
      const svg = sceneToSvg(emptyScene());
      expect(svg).toContain('<svg');
      expect(svg).toContain('</svg>');
    });
  });

  describe('parseScene and serializeScene', () => {
    it('never throws on malformed JSON or unexpected shapes', () => {
      expect(parseScene('{')).toEqual(emptyScene());
      expect(parseScene('{}')).toEqual(emptyScene());
      expect(parseScene('{"version":1,"strokes":[{}]}')).toEqual({
        version: 1,
        strokes: [
          {
            id: expect.any(String),
            tool: 'pen',
            color: '#000000',
            width: 2,
            points: [],
          },
        ],
      });
      expect(parseScene('')).toEqual(emptyScene());
      expect(parseScene(null as unknown as string)).toEqual(emptyScene());
      expect(parseScene('{"strokes":"not-an-array"}')).toEqual(emptyScene());
    });

    it('round-trips a scene via serialize→parse', () => {
      const scene: Scene = {
        version: 1,
        strokes: [
          {
            id: 'stroke-123',
            tool: 'rect',
            color: '#3b82f6',
            width: 4,
            points: [
              { x: 0, y: 0, pressure: 0.5 },
              { x: 100, y: 80, pressure: 0.5 },
            ],
          },
        ],
      };

      const serialized = serializeScene(scene);
      const parsed = parseScene(serialized);

      expect(parsed).toEqual(scene);
    });
  });

  describe('performance budget (R46)', () => {
    it('buildFrame renders 60 frames under 1000ms with 500 strokes, and culling works', () => {
      // Build a scene with 500 strokes spread across a wide area (0 to 5000 in world coordinates)
      const strokes: Stroke[] = [];
      for (let i = 0; i < 500; i++) {
        const originX = (i % 25) * 200;
        const originY = Math.floor(i / 25) * 200;
        strokes.push({
          id: `stroke-${i}`,
          tool: 'pen',
          color: '#000000',
          width: 2,
          points: [
            { x: originX, y: originY, pressure: 0.5 },
            { x: originX + 20, y: originY + 20, pressure: 0.5 },
            { x: originX + 40, y: originY + 10, pressure: 0.5 },
          ],
        });
      }

      const scene: Scene = { version: 1, strokes };

      // Viewport zoomed in on a small section: 0 to 400 world units
      const view: Viewport = { x: 0, y: 0, zoom: 1 };
      const screenSize = { width: 400, height: 400 };

      // Assert culling actually culls: with a zoomed-in viewport, buildFrame returns fewer strokes than scene holds
      const visible = buildFrame(scene, view, screenSize);
      expect(visible.length).toBeLessThan(scene.strokes.length);
      expect(visible.length).toBeGreaterThan(0);

      // Assert the total stays well under 1000 ms (60 frames at 60fps budget).
      // The generous threshold catches quadratic regressions without runner flakiness.
      const start = performance.now();
      for (let frame = 0; frame < 60; frame++) {
        // Slightly pan each frame to simulate real user pan
        const currentView: Viewport = { x: -frame * 2, y: -frame * 2, zoom: 1 };
        const frameStrokes = buildFrame(scene, currentView, screenSize);
        // Basic sanity to prevent dead-code elimination
        expect(frameStrokes.length).toBeGreaterThan(0);
      }
      const durationMs = performance.now() - start;
      console.log(`[R46 PERF] 60 frames (500 strokes each): total=${durationMs.toFixed(2)}ms, perFrame=${(durationMs / 60).toFixed(3)}ms`);

      // Assert duration is well under budget
      expect(durationMs).toBeLessThan(1000);
    });
  });
});
