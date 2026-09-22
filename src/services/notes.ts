import { repo } from './db';
import { noteFromRow, type NoteRow } from './store';
import { reindex } from './search';
import { parseLinks, upsertLinks, backlinksOf } from './linking';
import {
  listVault,
  readNoteFile,
  writeNoteFile,
  createNoteFile,
  deleteNoteFile,
  type VaultEntry,
} from './vault';
import type { NoteItem } from '../types';
import { getPref, setPref } from './settings';

declare module '../types' {
  interface NoteItem {
    path?: string;
  }
}

declare module './store' {
  interface NoteRow {
    path?: string | null;
  }
}

export interface CreateNoteInput {
  title?: string;
  body?: string;
  pinned?: boolean;
  path?: string;
}

const noteRepo = repo<NoteRow>('notes');
interface NoteRepoWithId {
  insert(data: Omit<NoteRow, 'updated_at' | 'deleted_at'>): Promise<NoteRow>;
}
// SAFETY: Backend db_insert accepts and preserves custom id on row object
const noteRepoWithId = noteRepo as unknown as NoteRepoWithId;
function getNoteFilePath(row: NoteRow): string | null {
  if (row.path) return row.path;
  if (row.id && row.id.startsWith('file:')) return row.id.slice(5);
  return null;
}

/**
 * Escapes regex special characters in a string.
 */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Helper to sync outgoing links from a note body to other existing notes.
 * If target note doesn't exist yet, it is not linked in DB (the UI can offer to create it).
 */
async function syncOutgoingLinks(noteId: string, body: string, allActiveNotes?: NoteItem[]): Promise<void> {
  const titles = parseLinks(body);
  if (titles.length === 0) {
    await upsertLinks({ kind: 'note', id: noteId }, []);
    return;
  }

  const notes = allActiveNotes ?? (await noteRepo.all()).map(noteFromRow);
  const targets: { kind: 'note'; id: string }[] = [];

  for (const title of titles) {
    const trimmedLower = title.trim().toLowerCase();
    const match = notes.find(
      (n) => n.id !== noteId && n.title.trim().toLowerCase() === trimmedLower
    );
    if (match) {
      targets.push({ kind: 'note', id: match.id });
    }
  }

  await upsertLinks({ kind: 'note', id: noteId }, targets);
}

/**
 * Lists all active notes sorted pinned first, then by updatedAt descending.
 */
export async function listNotes(): Promise<NoteItem[]> {
  const rows = await noteRepo.all();
  const items = rows.map((r) => {
    const item = noteFromRow(r);
    const filePath = getNoteFilePath(r);
    if (filePath) {
      item.path = filePath;
    }
    return item;
  });

  return items.sort((a, b) => {
    if (a.pinned !== b.pinned) {
      return a.pinned ? -1 : 1;
    }
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

/**
 * Finds a note by title (case-insensitive and trimmed).
 */
export async function noteByTitle(title: string): Promise<NoteItem | null> {
  const target = title.trim().toLowerCase();
  if (!target) return null;

  const notes = await listNotes();
  return notes.find((n) => n.title.trim().toLowerCase() === target) ?? null;
}

/**
 * Finds a note by its vault path (relative to vault root).
 */
export async function noteByPath(path: string): Promise<NoteItem | null> {
  const normPath = path.replace(/\\/g, '/');
  const targetId = `file:${normPath}`;

  const direct = await noteRepo.byId(targetId);
  if (direct) {
    const item = noteFromRow(direct);
    item.path = normPath;
    return item;
  }

  const all = await noteRepo.all();
  const match = all.find(
    (r) => r.path === normPath || r.id === targetId || r.id.endsWith(`:${normPath}`)
  );
  if (match) {
    const item = noteFromRow(match);
    item.path = normPath;
    return item;
  }

  // Fallback: try reading file from vault and index on the fly
  try {
    const content = await readNoteFile(normPath);
    const fileName = normPath.split('/').pop() ?? normPath;
    const headingMatch = content.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : fileName.replace(/\.md$/i, '');

    const row = await noteRepoWithId.insert({
      id: targetId,
      title,
      body_md: content,
      pinned: 0,
      path: normPath,
    });
    await syncOutgoingLinks(targetId, content);
    await reindex('note');
    const item = noteFromRow(row);
    item.path = normPath;
    return item;
  } catch {
    return null;
  }
}

/**
 * Creates a new note, writes the file to the vault, syncs its outgoing links, and reindexes.
 */
export async function createNote(input: CreateNoteInput = {}): Promise<NoteItem> {
  const title = input.title ?? '';
  const body = input.body ?? '';
  const pinned = Boolean(input.pinned);

  let filePath = input.path;
  if (!filePath) {
    const sanitized = title.trim().replace(/[<>:"/\\|?*]/g, '_');
    filePath = sanitized ? `${sanitized}.md` : 'Untitled.md';
  }

  try {
    await createNoteFile(filePath, body);
  } catch {
    try {
      await writeNoteFile(filePath, body);
    } catch {
      // Vault file creation optional in mock/browser env
    }
  }

  const id = `file:${filePath}`;
  let row: NoteRow;

  const existing = await noteRepo.byId(id);
  if (existing) {
    row = await noteRepo.update(id, {
      title,
      body_md: body,
      pinned: pinned ? 1 : 0,
      path: filePath,
    });
  } else {
    try {
      row = await noteRepoWithId.insert({
        id,
        title,
        body_md: body,
        pinned: pinned ? 1 : 0,
        path: filePath,
      });
    } catch {
      row = await noteRepo.insert({
        title,
        body_md: body,
        pinned: pinned ? 1 : 0,
        path: filePath,
      });
    }
  }

  const note = noteFromRow(row);
  note.path = filePath;

  await syncOutgoingLinks(note.id, body);
  await reindex('note');

  return note;
}

/**
 * Updates a note. If title changes, rewrites [[old title]] in all notes that linked to it.
 * Only replaces the exact old title; a link typed with different casing or spacing is normalized by noteByTitle instead.
 * Syncs outgoing links and reindexes.
 */
export async function updateNote(
  id: string,
  patch: { title?: string; body?: string; pinned?: boolean }
): Promise<NoteItem> {
  const current = await noteRepo.byId(id);
  if (!current) {
    throw new Error(`Note not found: ${id}`);
  }

  const oldTitle = current.title;
  const newTitle = patch.title !== undefined ? patch.title : current.title;
  const newBody = patch.body !== undefined ? patch.body : current.body_md;
  const newPinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : current.pinned;

  const titleChanged = patch.title !== undefined && patch.title !== oldTitle;

  // If title changed and had a non-empty old title, rewrite references in referring notes
  if (titleChanged && oldTitle.trim().length > 0) {
    const backlinks = await backlinksOf('note', id);
    const escapedOld = escapeRegExp(oldTitle);
    const linkRegex = new RegExp(`\\[\\[${escapedOld}\\]\\]`, 'g');

    for (const bl of backlinks) {
      if (bl.kind === 'note') {
        const sourceRow = await noteRepo.byId(bl.id);
        if (sourceRow && sourceRow.body_md) {
          const updatedBody = sourceRow.body_md.replace(linkRegex, `[[${newTitle}]]`);
          if (updatedBody !== sourceRow.body_md) {
            await noteRepo.update(bl.id, { body_md: updatedBody });
            await syncOutgoingLinks(bl.id, updatedBody);
            const srcPath = getNoteFilePath(sourceRow);
            if (srcPath) {
              try {
                await writeNoteFile(srcPath, updatedBody);
              } catch {
                // ignore
              }
            }
          }
        }
      }
    }
  }

  const filePath = getNoteFilePath(current);
  if (filePath && patch.body !== undefined) {
    try {
      await writeNoteFile(filePath, newBody);
    } catch {
      // ignore
    }
  }

  const updatedRow = await noteRepo.update(id, {
    ...(patch.title !== undefined ? { title: newTitle } : {}),
    ...(patch.body !== undefined ? { body_md: newBody } : {}),
    ...(patch.pinned !== undefined ? { pinned: newPinned } : {}),
  });

  const updatedNote = noteFromRow(updatedRow);
  if (filePath) {
    updatedNote.path = filePath;
  }

  if (patch.body !== undefined) {
    await syncOutgoingLinks(id, newBody);
  }

  await reindex('note');

  return updatedNote;
}

/**
 * Toggles the pinned state of a note.
 */
export async function togglePin(id: string): Promise<NoteItem> {
  const current = await noteRepo.byId(id);
  if (!current) {
    throw new Error(`Note not found: ${id}`);
  }

  const isPinned = current.pinned === 1;
  return await updateNote(id, { pinned: !isPinned });
}

/**
 * Soft-deletes a note AND removes links in both directions.
 * Links must be removed in both directions so deleted notes vanish from backlinks panels.
 */
export async function deleteNote(id: string): Promise<void> {
  const current = await noteRepo.byId(id);
  if (current) {
    const filePath = getNoteFilePath(current);
    if (filePath) {
      try {
        await deleteNoteFile(filePath);
      } catch {
        // ignore
      }
    }
  }

  // 1. Soft-delete the note
  await noteRepo.remove(id);

  // 2. Clear outgoing links from this note
  await upsertLinks({ kind: 'note', id }, []);

  // 3. Remove incoming links to this note from all notes that linked to it
  const backlinks = await backlinksOf('note', id);
  for (const bl of backlinks) {
    if (bl.kind === 'note') {
      const sourceRow = await noteRepo.byId(bl.id);
      if (sourceRow) {
        await syncOutgoingLinks(bl.id, sourceRow.body_md);
      }
    }
  }

  // 4. Reindex search
  await reindex('note');
}

/**
 * Reindexes the vault: walks all .md files in the vault, updates notes table, syncs links, and reindexes FTS.
 */
export async function reindexVault(): Promise<{ files: number; notes: number }> {
  const entries = await listVault();
  const fileEntries: VaultEntry[] = [];
  function collect(nodes: VaultEntry[]) {
    for (const node of nodes) {
      if (!node.isDir) {
        fileEntries.push(node);
      } else {
        collect(node.children);
      }
    }
  }
  collect(entries);

  const activePaths = new Set<string>();

  for (const file of fileEntries) {
    activePaths.add(file.path);
    let content: string;
    try {
      content = await readNoteFile(file.path);
    } catch (err) {
      console.error(`Failed to read note file ${file.path}:`, err);
      continue;
    }

    const headingMatch = content.match(/^#\s+(.+)$/m);
    const title = headingMatch ? headingMatch[1].trim() : file.name.replace(/\.md$/i, '');
    const id = `file:${file.path}`;

    const existing = await noteRepo.byId(id);
    if (existing) {
      await noteRepo.update(id, {
        title,
        body_md: content,
        ...(existing.path !== file.path ? { path: file.path } : {}),
      });
    } else {
      try {
        await noteRepoWithId.insert({
          id,
          title,
          body_md: content,
          pinned: 0,
          path: file.path,
        });
      } catch {
        await noteRepo.insert({
          title,
          body_md: content,
          pinned: 0,
          path: file.path,
        });
      }
    }
  }

  // Prune deleted file: notes
  const allRows = await noteRepo.all();
  for (const row of allRows) {
    if (row.id.startsWith('file:') && !activePaths.has(row.id.slice(5))) {
      await noteRepo.remove(row.id);
      await upsertLinks({ kind: 'note', id: row.id }, []);
    }
  }

  // Re-sync outgoing links for all notes
  const updatedRows = await noteRepo.all();
  const allNotes = updatedRows.map(noteFromRow);
  for (const note of allNotes) {
    await syncOutgoingLinks(note.id, note.body, allNotes);
  }

  await reindex('note');

  return { files: fileEntries.length, notes: allNotes.length };
}

/**
 * One-time migration: exports all existing database notes to markdown files in the vault.
 */
export async function migrateNotesToFiles(): Promise<{ exported: number }> {
  const alreadyMigrated = getPref<boolean>('tempo_vault_migrated', false);
  if (alreadyMigrated) {
    return { exported: 0 };
  }

  const rows = await noteRepo.all();
  const toExport = rows.filter((r) => !r.path && !r.id.startsWith('file:'));
  if (toExport.length === 0) {
    await setPref('tempo_vault_migrated', true);
    return { exported: 0 };
  }
  let exported = 0;
  const existingFiles = new Set<string>();
  try {
    const vaultFiles = await listVault();
    const collectPaths = (nodes: VaultEntry[]) => {
      for (const n of nodes) {
        if (!n.isDir) existingFiles.add(n.path);
        else collectPaths(n.children);
      }
    };
    collectPaths(vaultFiles);
  } catch {
    // ignore
  }

  for (const row of toExport) {
    let baseName = (row.title || '').trim().replace(/[<>:"/\\|?*]/g, '_');
    if (!baseName) {
      const firstLine = (row.body_md || '').split('\n')[0].trim().replace(/[<>:"/\\|?*]/g, '_');
      baseName = firstLine.slice(0, 50) || `Note-${row.id.slice(0, 8)}`;
    }
    let fileName = `${baseName}.md`;
    let counter = 1;
    while (existingFiles.has(fileName)) {
      fileName = `${baseName} ${counter}.md`;
      counter++;
    }
    existingFiles.add(fileName);

    let content = row.body_md || '';
    if (row.title && row.title.trim() && !content.startsWith('# ')) {
      content = `# ${row.title.trim()}\n\n${content}`;
    }

    try {
      await writeNoteFile(fileName, content);
      await noteRepo.update(row.id, { path: fileName });
      exported++;
    } catch (err) {
      console.error(`Failed to export note ${row.id} to file:`, err);
    }
  }

  await setPref('tempo_vault_migrated', true);
  if (exported > 0) {
    await reindexVault();
  }

  return { exported };
}
