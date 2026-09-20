import type { LucideIcon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export interface SearchHit {
  kind: string;
  row_id: string;
  title: string;
  body: string;
  rank: number;
}

export interface SearchSource {
  /** Matches kind column in search_fts */
  kind: string;
  /** i18n key and icon for the results group */
  labelKey: string;
  icon: LucideIcon;
  /** Target navigation for the hit */
  open(hit: SearchHit): void;
}

export interface Command {
  id: string;
  titleKey: string;
  hintKey?: string;
  keys?: string[];
  icon: LucideIcon;
  run(): void | Promise<void>;
}

const searchSources: SearchSource[] = [];
const commands: Command[] = [];

export function registerSearchSource(src: SearchSource): () => void {
  searchSources.push(src);
  return () => {
    const idx = searchSources.indexOf(src);
    if (idx !== -1) {
      searchSources.splice(idx, 1);
    }
  };
}

export function listSearchSources(): SearchSource[] {
  return [...searchSources];
}

export function registerCommand(cmd: Command): () => void {
  commands.push(cmd);
  return () => {
    const idx = commands.indexOf(cmd);
    if (idx !== -1) {
      commands.splice(idx, 1);
    }
  };
}

export function listCommands(): Command[] {
  return [...commands];
}

/**
 * Full-text search across indexed entities.
 * Returns an empty array immediately without IPC if the query is empty or whitespace-only.
 */
export async function searchAll(q: string, limit?: number): Promise<SearchHit[]> {
  const trimmed = q.trim();
  if (!trimmed) {
    return [];
  }
  return invoke<SearchHit[]>('db_search', { query: trimmed, limit });
}

/**
 * Rebuild full-text search index; without argument - reindexes all kinds.
 */
export async function reindex(kind?: string): Promise<number> {
  return invoke<number>('db_reindex', { kind });
}
