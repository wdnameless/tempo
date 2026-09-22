import { repo, type EntityMeta } from './db';
import { parseScene, serializeScene, type Scene } from './canvas';
import { assetDelete } from './assets';

/**
 * Drawing metadata stored in SQLite drawings table.
 * Conforms to interfaces §18 and EntityMeta.
 */
export interface DrawingMeta extends EntityMeta {
  title: string;
  scene_json: string;
  preview_path: string | null;
}

export interface DrawingItem {
  id: string;
  title: string;
  preview_path: string | null;
  updated_at: string;
}

export interface CreateDrawingInput {
  title?: string;
  scene?: Scene;
  preview_path?: string | null;
}

export interface UpdateDrawingInput {
  title?: string;
  scene?: Scene;
  scene_json?: string;
  preview_path?: string | null;
}

const drawingsRepo = repo<DrawingMeta>('drawings');

/**
 * List all non-deleted drawings ordered by updated_at descending.
 */
export async function listDrawings(): Promise<DrawingItem[]> {
  const rows = await drawingsRepo.all();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    preview_path: row.preview_path,
    updated_at: row.updated_at,
  }));
}

/**
 * Get a drawing by ID.
 * Returns null if not found.
 */
export async function getDrawing(id: string): Promise<DrawingItem | null> {
  const row = await drawingsRepo.byId(id);
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    title: row.title,
    preview_path: row.preview_path,
    updated_at: row.updated_at,
  };
}

/**
 * Load the parsed Scene for a drawing.
 * Throws a clear error if the drawing is missing or deleted.
 * Corrupt scene_json returns an empty scene via parseScene without throwing.
 */
export async function loadScene(id: string): Promise<Scene> {
  const row = await drawingsRepo.byId(id);
  if (!row) {
    throw new Error(`Drawing not found: ${id}`);
  }
  return parseScene(row.scene_json);
}

export async function getDrawingRaw(id: string): Promise<DrawingMeta | null> {
  return drawingsRepo.byId(id);
}

/**
 * Create a new drawing and store it in the database.
 */
export async function createDrawing(input?: CreateDrawingInput): Promise<DrawingItem> {
  const title = input?.title?.trim() || 'Untitled Drawing';
  const scene = input?.scene ?? { version: 1, strokes: [] };
  const preview_path = input?.preview_path ?? null;

  const row = await drawingsRepo.insert({
    title,
    scene_json: serializeScene(scene),
    preview_path,
  });

  return {
    id: row.id,
    title: row.title,
    preview_path: row.preview_path,
    updated_at: row.updated_at,
  };
}

/**
 * Update an existing drawing's metadata or scene.
 * Throws if drawing does not exist.
 */
export async function updateDrawing(id: string, patch: UpdateDrawingInput): Promise<DrawingItem> {
  const updateData: Partial<Omit<DrawingMeta, 'id' | 'updated_at' | 'deleted_at'>> = {};

  if (patch.title !== undefined) {
    updateData.title = patch.title.trim() || 'Untitled Drawing';
  }
  if (patch.scene_json !== undefined) {
    updateData.scene_json = patch.scene_json;
  } else if (patch.scene !== undefined) {
    updateData.scene_json = serializeScene(patch.scene);
  }
  if (patch.preview_path !== undefined) {
    updateData.preview_path = patch.preview_path;
  }

  const updated = await drawingsRepo.update(id, updateData);
  if (!updated) {
    throw new Error(`Drawing not found: ${id}`);
  }

  return {
    id: updated.id,
    title: updated.title,
    preview_path: updated.preview_path,
    updated_at: updated.updated_at,
  };
}

/**
 * Convenience helper: save updated scene to a drawing.
 */
export async function saveScene(id: string, scene: Scene): Promise<DrawingItem> {
  return updateDrawing(id, { scene });
}

/**
 * Convenience helper: rename a drawing.
 */
export async function renameDrawing(id: string, title: string): Promise<DrawingItem> {
  return updateDrawing(id, { title });
}

/**
 * Convenience helper: update preview path of a drawing.
 */
export async function setPreview(id: string, preview_path: string | null): Promise<DrawingItem> {
  return updateDrawing(id, { preview_path });
}

/**
 * Soft-delete a drawing row AND delete its preview file via assetDelete if present.
 * A file whose row is gone is invisible garbage, so preview cleanup happens synchronously here.
 */
export async function deleteDrawing(id: string): Promise<void> {
  const existing = await drawingsRepo.byId(id);
  if (!existing) {
    return;
  }

  // Soft-delete the database row first
  await drawingsRepo.remove(id);
  // If there is an associated preview image, remove it from disk
  if (existing.preview_path) {
    try {
      await assetDelete(existing.preview_path);
    } catch {
      // Deletion of preview file failing should not leave the drawing in inconsistent DB state
    }
  }
}
