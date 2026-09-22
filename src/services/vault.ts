// src/services/vault.ts
// Local markdown vault service: typed wrapper over Tauri Rust vault commands.

import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';

export interface VaultEntry {
  path: string;
  name: string;
  isDir: boolean;
  children: VaultEntry[];
}
function formatError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (typeof err === 'string') return new Error(err);
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = err.message;
    return new Error(typeof msg === 'string' ? msg : String(msg));
  }
  return new Error(String(err));
}

// In-memory mock store for non-Tauri / browser dev environment
const mockFiles = new Map<string, string>();
const mockFolders = new Set<string>();
let mockVaultRoot = '/mock/vault';

export function dailyNotePath(dateIso: string): string {
  const d = dateIso.slice(0, 10);
  const parts = d.split('-');
  if (parts.length === 3) {
    const [year, month, day] = parts;
    return `Journal/${year}/${month}/${year}-${month}-${day}.md`;
  }
  const date = new Date(dateIso);
  if (!isNaN(date.getTime())) {
    const year = date.getFullYear().toString();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    return `Journal/${year}/${month}/${year}-${month}-${day}.md`;
  }
  return `Journal/${d}.md`;
}

export async function vaultRoot(): Promise<string> {
  if (!isTauri()) return mockVaultRoot;
  try {
    return await invoke<string>('vault_root');
  } catch (e) {
    throw formatError(e);
  }
}

export async function setVaultRoot(path: string): Promise<string> {
  if (!isTauri()) {
    mockVaultRoot = path;
    return path;
  }
  try {
    return await invoke<string>('vault_set_root', { path });
  } catch (e) {
    throw formatError(e);
  }
}

export async function pickVaultFolder(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    return await invoke<string | null>('vault_pick_folder');
  } catch (e) {
    throw formatError(e);
  }
}

export async function listVault(): Promise<VaultEntry[]> {
  if (!isTauri()) {
    // Build tree from mock data
    const rootEntries: VaultEntry[] = [];
    const allPaths = [...mockFolders, ...mockFiles.keys()].sort();
    for (const p of allPaths) {
      const isDir = mockFolders.has(p);
      if (!isDir && !p.endsWith('.md')) continue;
      const parts = p.split('/');
      if (parts.length === 1) {
        rootEntries.push({
          path: p,
          name: parts[0],
          isDir,
          children: [],
        });
      }
    }
    return rootEntries;
  }
  try {
    return await invoke<VaultEntry[]>('vault_list');
  } catch (e) {
    throw formatError(e);
  }
}

export async function readNoteFile(path: string): Promise<string> {
  if (!isTauri()) {
    const content = mockFiles.get(path);
    if (content === undefined) {
      throw new Error(`File not found: ${path}`);
    }
    return content;
  }
  try {
    return await invoke<string>('vault_read', { path });
  } catch (e) {
    throw formatError(e);
  }
}

export async function writeNoteFile(path: string, content: string): Promise<void> {
  if (!isTauri()) {
    mockFiles.set(path, content);
    return;
  }
  try {
    await invoke('vault_write', { path, content });
  } catch (e) {
    throw formatError(e);
  }
}

export async function createNoteFile(path: string, content = ''): Promise<void> {
  if (!isTauri()) {
    if (mockFiles.has(path)) {
      throw new Error(`File already exists: ${path}`);
    }
    mockFiles.set(path, content);
    return;
  }
  try {
    await invoke('vault_create', { path, content });
  } catch (e) {
    throw formatError(e);
  }
}

export async function renameNoteFile(from: string, to: string): Promise<void> {
  if (!isTauri()) {
    if (mockFiles.has(from)) {
      const content = mockFiles.get(from)!;
      mockFiles.delete(from);
      mockFiles.set(to, content);
    } else if (mockFolders.has(from)) {
      mockFolders.delete(from);
      mockFolders.add(to);
      for (const [key, val] of [...mockFiles.entries()]) {
        if (key.startsWith(from + '/')) {
          mockFiles.delete(key);
          mockFiles.set(to + key.slice(from.length), val);
        }
      }
    } else {
      throw new Error(`Path not found: ${from}`);
    }
    return;
  }
  try {
    await invoke('vault_rename', { from, to });
  } catch (e) {
    throw formatError(e);
  }
}

export async function deleteNoteFile(path: string): Promise<void> {
  if (!isTauri()) {
    if (mockFiles.has(path)) {
      mockFiles.delete(path);
    } else if (mockFolders.has(path)) {
      mockFolders.delete(path);
      for (const key of [...mockFiles.keys()]) {
        if (key.startsWith(path + '/')) {
          mockFiles.delete(key);
        }
      }
    } else {
      throw new Error(`Path not found: ${path}`);
    }
    return;
  }
  try {
    await invoke('vault_delete', { path });
  } catch (e) {
    throw formatError(e);
  }
}

export async function createVaultFolder(path: string): Promise<void> {
  if (!isTauri()) {
    mockFolders.add(path);
    return;
  }
  try {
    await invoke('vault_mkdir', { path });
  } catch (e) {
    throw formatError(e);
  }
}

export async function ensureDailyNote(dateIso: string): Promise<string> {
  const relPath = dailyNotePath(dateIso);
  if (!isTauri()) {
    if (!mockFiles.has(relPath)) {
      const day = dateIso.slice(0, 10);
      const template = `# ${day}\n\n## \n`;
      mockFiles.set(relPath, template);
    }
    return relPath;
  }
  try {
    return await invoke<string>('vault_daily', { dateIso });
  } catch (e) {
    throw formatError(e);
  }
}

export async function openVaultInExplorer(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('vault_open');
  } catch (e) {
    throw formatError(e);
  }
}
