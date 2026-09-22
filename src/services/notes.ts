import { invoke } from '@tauri-apps/api/core';
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
  update(id: string, patch: Partial<Omit<NoteRow, 'updated_at'>> & { deleted_at?: string | null }): Promise<NoteRow>;
}
// SAFETY: Backend db_insert and db_update accept custom id and deleted_at to un-delete rows
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
  return (
    notes.find((n) => {
      const matchTitle = n.title.trim().toLowerCase();
      if (matchTitle === target) return true;
      if (!matchTitle) {
        const firstLine = (n.body.split('\n')[0] || '').trim().toLowerCase();
        return firstLine === target;
      }
      return false;
    }) ?? null
  );
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
    const base = sanitized || 'Untitled';
    filePath = `${base}.md`;
    let counter = 1;
    while (true) {
      const id = `file:${filePath}`;
      const existingInDb = await noteRepo.byId(id);
      if (!existingInDb) {
        try {
          await createNoteFile(filePath, body);
          break;
        } catch (err) {
          const msg = String(err);
          if (msg.includes('already exists') || msg.includes('File already exists')) {
            filePath = `${base} ${counter}.md`;
            counter++;
            continue;
          }
          break;
        }
      } else {
        filePath = `${base} ${counter}.md`;
        counter++;
      }
    }
  } else {
    try {
      await createNoteFile(filePath, body);
    } catch (err) {
      const msg = String(err);
      if (!msg.includes('already exists')) {
        try {
          await writeNoteFile(filePath, body);
        } catch {
          // Vault file creation optional in mock/browser env
        }
      }
    }
  }

  const id = `file:${filePath}`;
  let row: NoteRow;

  const existing = await noteRepo.byId(id);
  if (existing) {
    row = await noteRepoWithId.update(id, {
      title,
      body_md: body,
      pinned: pinned ? 1 : 0,
      path: filePath,
      deleted_at: null,
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

async function updateNoteBodyAndFile(row: NoteRow, newBody: string): Promise<void> {
  await noteRepo.update(row.id, { body_md: newBody });
  await syncOutgoingLinks(row.id, newBody);
  const srcPath = getNoteFilePath(row);
  if (srcPath) {
    try {
      await writeNoteFile(srcPath, newBody);
    } catch {
      // ignore
    }
  }
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
  let newBody = patch.body !== undefined ? patch.body : current.body_md;
  const newPinned = patch.pinned !== undefined ? (patch.pinned ? 1 : 0) : current.pinned;

  const titleChanged = patch.title !== undefined && patch.title !== oldTitle;

  if (titleChanged) {
    if (/^#\s+/m.test(newBody)) {
      newBody = newBody.replace(/^#\s+.*$/m, `# ${newTitle}`);
    } else if (newTitle.trim()) {
      newBody = newBody ? `# ${newTitle}\n\n${newBody}` : `# ${newTitle}\n`;
    }
  }

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
            await updateNoteBodyAndFile(sourceRow, updatedBody);
          }
        }
      }
    }
  }

  const filePath = getNoteFilePath(current);
  if (filePath && (patch.body !== undefined || titleChanged)) {
    try {
      await writeNoteFile(filePath, newBody);
    } catch {
      // ignore
    }
  }

  const updatedRow = await noteRepo.update(id, {
    ...(patch.title !== undefined ? { title: newTitle } : {}),
    ...(titleChanged || patch.body !== undefined ? { body_md: newBody } : {}),
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
 * Renames a note file or folder path in SQLite:
 * Migrates DB row ID from file:oldPath to file:newPath,
 * rewrites [[wiki links]] in referring notes and on disk,
 * updates link graph and reindexes.
 */
export async function renameNotePath(oldPath: string, newPath: string): Promise<void> {
  const normOld = oldPath.replace(/\\/g, '/');
  const normNew = newPath.replace(/\\/g, '/');
  const oldId = `file:${normOld}`;
  const newId = `file:${normNew}`;

  const current = (await noteRepo.byId(oldId)) || (await noteRepo.all()).find((r) => r.path === normOld);
  let content = current?.body_md ?? '';
  try {
    content = await readNoteFile(normNew);
  } catch {
    // ignore
  }

  const oldTitleFromName = normOld.split('/').pop()?.replace(/\.md$/i, '') || '';
  const newTitleFromName = normNew.split('/').pop()?.replace(/\.md$/i, '') || '';
  const oldTitle = current?.title || oldTitleFromName;
  const newTitle = (!current?.title || current.title === oldTitleFromName) ? newTitleFromName : current.title;

  try {
    await noteRepoWithId.insert({
      id: newId,
      title: newTitle,
      body_md: content,
      pinned: current?.pinned ?? 0,
      path: normNew,
    });
  } catch {
    await noteRepoWithId.update(newId, {
      title: newTitle,
      body_md: content,
      pinned: current?.pinned ?? 0,
      path: normNew,
      deleted_at: null,
    });
  }

  if (current && current.id !== newId) {
    await noteRepo.remove(current.id);
  }

  // Rewrite wiki links in referring notes
  const targetLookupId = current ? current.id : oldId;
  const backlinks = await backlinksOf('note', targetLookupId);
  const titlesToRewrite: string[] = [];
  if (oldTitle.trim()) titlesToRewrite.push(oldTitle.trim());
  if (oldTitleFromName.trim() && oldTitleFromName.trim() !== oldTitle.trim()) {
    titlesToRewrite.push(oldTitleFromName.trim());
  }

  for (const bl of backlinks) {
    if (bl.kind === 'note') {
      const sourceRow = await noteRepo.byId(bl.id);
      if (sourceRow && sourceRow.body_md) {
        let updatedBody = sourceRow.body_md;
        for (const t of titlesToRewrite) {
          const re = new RegExp(`\\[\\[${escapeRegExp(t)}\\]\\]`, 'g');
          updatedBody = updatedBody.replace(re, `[[${newTitle}]]`);
        }
        if (updatedBody !== sourceRow.body_md) {
          await updateNoteBodyAndFile(sourceRow, updatedBody);
        }
      }
    }
  }

  await upsertLinks({ kind: 'note', id: targetLookupId }, []);
  await syncOutgoingLinks(newId, content);
  await reindex('note');
}

/**
 * Reindexes the vault: walks all .md files in the vault, updates notes table, syncs links, and reindexes FTS.
 */
async function repairEmptyFileFromLegacyRow(row: NoteRow): Promise<void> {
  if (!row.id.startsWith('file:') && row.body_md && row.body_md.trim().length > 0 && row.path) {
    let diskContent = '';
    let exists = true;
    try {
      diskContent = await readNoteFile(row.path);
    } catch {
      exists = false;
    }
    if (!exists || diskContent.trim().length === 0) {
      try {
        await writeNoteFile(row.path, row.body_md);
      } catch {
        // ignore
      }
    }
  }
}

/**
 * Reindexes the vault: walks all .md files in the vault, updates notes table, syncs links, and reindexes FTS.
 */
export async function reindexVault(): Promise<{ files: number; notes: number }> {
  // 1. Repair live user data:
  let rawRows: NoteRow[] | undefined;
  try {
    rawRows = await invoke<NoteRow[] | undefined>('db_list', { table: 'notes', includeDeleted: true });
  } catch {
    rawRows = await noteRepo.all();
  }
  if (rawRows) {
    for (const row of rawRows) {
      await repairEmptyFileFromLegacyRow(row);
    }
  }

  // 2. Walk vault entries
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
  let allRowsBefore: NoteRow[];
  try {
    const raw = await invoke<NoteRow[] | undefined>('db_list', { table: 'notes', includeDeleted: true });
    allRowsBefore = raw ?? (await noteRepo.all());
  } catch {
    allRowsBefore = await noteRepo.all();
  }

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
    const canonicalId = `file:${file.path}`;

    // Dedupe by path in reindexVault:
    // Before inserting file:<path>, look for any existing row with that path (whatever its id)
    // and update that row instead of adding a second one.
    const existingRowsForPath = allRowsBefore.filter(
      (r) => r.path === file.path || r.id === canonicalId
    );

    if (existingRowsForPath.length > 0) {
      const primary = existingRowsForPath.find((r) => r.id === canonicalId) ?? existingRowsForPath[0];

      if (primary.id !== canonicalId) {
        // Replace legacy row with canonical file: row
        try {
          await noteRepoWithId.insert({
            id: canonicalId,
            title,
            body_md: content,
            pinned: primary.pinned,
            path: file.path,
          });
          await noteRepo.remove(primary.id);
        } catch {
          await noteRepoWithId.update(canonicalId, {
            title,
            body_md: content,
            path: file.path,
            deleted_at: null,
          });
          await noteRepo.remove(primary.id);
        }
      } else {
        await noteRepoWithId.update(primary.id, {
          title,
          body_md: content,
          path: file.path,
          deleted_at: null,
        });
      }

      // Remove any duplicate rows for this path
      for (const dup of existingRowsForPath) {
        if (dup.id !== canonicalId && dup.id !== primary.id) {
          await noteRepo.remove(dup.id);
        }
      }
    } else {
      try {
        await noteRepoWithId.insert({
          id: canonicalId,
          title,
          body_md: content,
          pinned: 0,
          path: file.path,
        });
      } catch {
        try {
          await noteRepoWithId.update(canonicalId, {
            title,
            body_md: content,
            pinned: 0,
            path: file.path,
            deleted_at: null,
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
  }

  // 3. Prune rows whose path points to a file that no longer exists (both file: and legacy)
  const allRowsAfter = await noteRepo.all();
  for (const row of allRowsAfter) {
    const rowPath = row.path || (row.id.startsWith('file:') ? row.id.slice(5) : null);
    if (rowPath && !activePaths.has(rowPath)) {
      await noteRepo.remove(row.id);
      await upsertLinks({ kind: 'note', id: row.id }, []);
    }
  }

  // 4. Re-sync outgoing links for all active notes
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

  const rows = await noteRepo.all();
  const legacyRows = rows.filter((r) => !r.id.startsWith('file:'));

  if (alreadyMigrated && legacyRows.length === 0) {
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

  for (const row of legacyRows) {
    let fileName = row.path;
    if (!fileName) {
      let baseName = (row.title || '').trim().replace(/[<>:"/\\|?*]/g, '_');
      if (!baseName) {
        const firstLine = (row.body_md || '').split('\n')[0].trim().replace(/[<>:"/\\|?*]/g, '_');
        baseName = firstLine.slice(0, 50) || `Note-${row.id.slice(0, 8)}`;
      }
      fileName = `${baseName}.md`;
      let counter = 1;
      while (existingFiles.has(fileName)) {
        fileName = `${baseName} ${counter}.md`;
        counter++;
      }
    }
    existingFiles.add(fileName);

    let content = row.body_md || '';
    if (row.title && row.title.trim() && !content.startsWith('# ')) {
      content = `# ${row.title.trim()}\n\n${content}`;
    }

    try {
      // 1. Write the file
      await writeNoteFile(fileName, content);

      // 2. Atomic verification: read back and verify
      const readBack = await readNoteFile(fileName);
      if (readBack !== content) {
        console.error(`Export verification failed for ${fileName}: content mismatch`);
        continue;
      }

      // 3. Insert canonical file: row
      const newId = `file:${fileName}`;
      try {
        await noteRepoWithId.insert({
          id: newId,
          title: row.title,
          body_md: content,
          pinned: row.pinned,
          path: fileName,
        });
      } catch {
        await noteRepo.insert({
          title: row.title,
          body_md: content,
          pinned: row.pinned,
          path: fileName,
        });
      }

      // 4. Delete legacy row now that file is source of truth
      await noteRepo.remove(row.id);

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
