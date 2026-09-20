import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listDrawings,
  getDrawing,
  loadScene,
  createDrawing,
  updateDrawing,
  saveScene,
  renameDrawing,
  setPreview,
  deleteDrawing,
  type DrawingMeta,
} from '../drawings';
import type { EntityMeta } from '../db';
import type { Scene } from '../canvas';
import * as assetsModule from '../assets';
// Mock the repo module
const mockStore = new Map<string, DrawingMeta>();

vi.mock('../db', () => ({
  repo: () => ({
    all: vi.fn(async () => Array.from(mockStore.values()).filter((r) => !r.deleted_at)),
    byId: vi.fn(async (id: string) => {
      const item = mockStore.get(id);
      if (!item || item.deleted_at) return null;
      return item;
    }),
    insert: vi.fn(async (data: Omit<DrawingMeta, keyof EntityMeta>) => {
      const id = 'drawing-' + Math.random().toString(36).slice(2, 9);
      const now = new Date().toISOString();
      const meta: DrawingMeta = {
        id,
        title: data.title || 'Untitled Drawing',
        scene_json: data.scene_json || '{"version":1,"strokes":[]}',
        preview_path: data.preview_path ?? null,
        updated_at: now,
        deleted_at: null,
      };
      mockStore.set(id, meta);
      return meta;
    }),
    update: vi.fn(async (id: string, patch: Partial<Omit<DrawingMeta, keyof EntityMeta>>) => {
      const existing = mockStore.get(id);
      if (!existing || existing.deleted_at) {
        throw new Error(`Drawing not found: ${id}`);
      }
      const updated: DrawingMeta = {
        ...existing,
        ...patch,
        updated_at: new Date().toISOString(),
      };
      mockStore.set(id, updated);
      return updated;
    }),
    remove: vi.fn(async (id: string) => {
      const existing = mockStore.get(id);
      if (existing) {
        existing.deleted_at = new Date().toISOString();
      }
    }),
  }),
}));

// Mock assets module
vi.mock('../assets', () => ({
  assetDelete: vi.fn(async () => {}),
}));

describe('drawings service', () => {
  beforeEach(() => {
    mockStore.clear();
    vi.clearAllMocks();
  });

  describe('createDrawing and listDrawings', () => {
    it('creates a new drawing with defaults and lists it', async () => {
      const item = await createDrawing();
      expect(item.id).toBeDefined();
      expect(item.title).toBe('Untitled Drawing');
      expect(item.preview_path).toBeNull();

      const list = await listDrawings();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(item.id);
    });

    it('creates a drawing with custom title and scene', async () => {
      const customScene: Scene = {
        version: 1,
        strokes: [
          {
            id: 's1',
            tool: 'line',
            color: '#123456',
            width: 5,
            points: [
              { x: 0, y: 0, pressure: 0.5 },
              { x: 10, y: 10, pressure: 0.5 },
            ],
          },
        ],
      };

      const created = await createDrawing({
        title: 'My Custom Diagram',
        scene: customScene,
        preview_path: 'assets/drawing/preview1.png',
      });

      expect(created.title).toBe('My Custom Diagram');
      expect(created.preview_path).toBe('assets/drawing/preview1.png');

      const loaded = await loadScene(created.id);
      expect(loaded).toEqual(customScene);
    });
  });

  describe('getDrawing', () => {
    it('returns null for non-existent drawing', async () => {
      const item = await getDrawing('non-existent');
      expect(item).toBeNull();
    });

    it('returns drawing item when found', async () => {
      const created = await createDrawing({ title: 'Plan' });
      const found = await getDrawing(created.id);
      expect(found).not.toBeNull();
      expect(found?.title).toBe('Plan');
    });
  });

  describe('loadScene', () => {
    it('throws a clear error on missing drawing', async () => {
      await expect(loadScene('missing-id')).rejects.toThrow('Drawing not found: missing-id');
    });

    it('returns empty scene without throwing when scene_json is corrupt', async () => {
      const id = 'corrupt-drawing';
      mockStore.set(id, {
        id,
        title: 'Broken',
        scene_json: 'corrupt-{not-valid-json',
        preview_path: null,
        updated_at: new Date().toISOString(),
        deleted_at: null,
      });

      const scene = await loadScene(id);
      expect(scene).toEqual({ version: 1, strokes: [] });
    });
  });

  describe('updateDrawing', () => {
    it('updates title, scene, and preview_path', async () => {
      const created = await createDrawing({ title: 'Initial' });
      const newScene: Scene = {
        version: 1,
        strokes: [
          {
            id: 's2',
            tool: 'rect',
            color: '#ff0000',
            width: 2,
            points: [
              { x: 5, y: 5, pressure: 0.5 },
              { x: 25, y: 25, pressure: 0.5 },
            ],
          },
        ],
      };

      const updated = await updateDrawing(created.id, {
        title: 'Renamed',
        scene: newScene,
        preview_path: 'assets/drawing/new-preview.png',
      });

      expect(updated.title).toBe('Renamed');
      expect(updated.preview_path).toBe('assets/drawing/new-preview.png');

      const loaded = await loadScene(created.id);
      expect(loaded).toEqual(newScene);
    });

    it('convenience helpers saveScene, renameDrawing, setPreview update fields', async () => {
      const created = await createDrawing({ title: 'Before' });
      await renameDrawing(created.id, 'After');
      let current = await getDrawing(created.id);
      expect(current?.title).toBe('After');

      await setPreview(created.id, 'assets/preview.png');
      current = await getDrawing(created.id);
      expect(current?.preview_path).toBe('assets/preview.png');

      const scene: Scene = { version: 1, strokes: [] };
      await saveScene(created.id, scene);
      const loaded = await loadScene(created.id);
      expect(loaded).toEqual(scene);
    });

    it('throws when updating non-existent drawing', async () => {
      await expect(updateDrawing('does-not-exist', { title: 'New' })).rejects.toThrow(
        'Drawing not found: does-not-exist',
      );
    });
  });

  describe('deleteDrawing and preview cleanup', () => {
    it('soft-deletes row and removes preview file through assetDelete', async () => {
      const previewPath = 'assets/drawing/thumb-123.png';
      const created = await createDrawing({
        title: 'To Delete',
        preview_path: previewPath,
      });

      const spyAssetDelete = vi.spyOn(assetsModule, 'assetDelete');

      await deleteDrawing(created.id);

      // Verify soft-deleted from list
      const list = await listDrawings();
      expect(list.find((d) => d.id === created.id)).toBeUndefined();

      // Verify assetDelete was invoked with preview_path
      expect(spyAssetDelete).toHaveBeenCalledTimes(1);
      expect(spyAssetDelete).toHaveBeenCalledWith(previewPath);
    });

    it('does not invoke assetDelete if drawing has no preview_path', async () => {
      const created = await createDrawing({
        title: 'No Preview',
        preview_path: null,
      });

      const spyAssetDelete = vi.spyOn(assetsModule, 'assetDelete');

      await deleteDrawing(created.id);

      expect(spyAssetDelete).not.toHaveBeenCalled();
    });

    it('handles non-existent drawing gracefully', async () => {
      const spyAssetDelete = vi.spyOn(assetsModule, 'assetDelete');
      await deleteDrawing('not-found');
      expect(spyAssetDelete).not.toHaveBeenCalled();
    });
  });
});
