import { invoke } from '@tauri-apps/api/core';

export interface LinkRef {
  kind: 'note' | 'task' | 'recording' | 'drawing';
  id: string;
}

export interface BacklinkItem {
  kind: string;
  id: string;
  title: string;
}

/**
 * Extracts titles enclosed in [[wiki links]].
 * Trims whitespace inside the brackets, ignores unclosed [[, and de-duplicates
 * preserving appearance order.
 */
export function parseLinks(markdown: string): string[] {
  if (!markdown) return [];

  const regex = /\[\[([^\][\n\r]+)\]\]/g;
  const seen = new Set<string>();
  const results: string[] = [];

  let match: RegExpExecArray | null;
  while ((match = regex.exec(markdown)) !== null) {
    const trimmed = match[1].trim();
    if (trimmed.length > 0 && !seen.has(trimmed)) {
      seen.add(trimmed);
      results.push(trimmed);
    }
  }

  return results;
}

/**
 * Atomically replaces the outgoing links from (from.kind, from.id) to the target set.
 */
export async function upsertLinks(from: LinkRef, to: LinkRef[]): Promise<number> {
  return await invoke<number>('links_set', {
    fromKind: from.kind,
    fromId: from.id,
    to: to.map((target) => ({
      kind: target.kind,
      id: target.id,
    })),
  });
}

/**
 * Returns all active (non-deleted) items that link TO (kind, id).
 */
export async function backlinksOf(kind: string, id: string): Promise<BacklinkItem[]> {
  return await invoke<BacklinkItem[]>('links_backlinks', {
    kind,
    id,
  });
}

/**
 * Returns all outgoing links from (kind, id).
 */
export async function linksOf(kind: string, id: string): Promise<LinkRef[]> {
  const rows = await invoke<Array<{
    from_kind: string;
    from_id: string;
    to_kind: 'note' | 'task' | 'recording' | 'drawing';
    to_id: string;
  }>>('db_list', {
    table: 'links',
    includeDeleted: false,
  });

  return rows
    .filter((r) => r.from_kind === kind && r.from_id === id)
    .map((r) => ({
      kind: r.to_kind,
      id: r.to_id,
    }));
}
