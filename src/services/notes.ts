import { repo, type EntityMeta } from './db';
import { noteFromRow, type NoteRow } from './store';
import { reindex } from './search';
import { parseLinks, upsertLinks, backlinksOf } from './linking';
import type { NoteItem } from '../types';

export interface CreateNoteInput {
  title?: string;
  body?: string;
  pinned?: boolean;
}

const noteRepo = repo<NoteRow>('notes');

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
  const items = rows.map(noteFromRow);

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
 * Creates a new note, syncs its outgoing links, and reindexes.
 */
export async function createNote(input: CreateNoteInput = {}): Promise<NoteItem> {
  const title = input.title ?? '';
  const body = input.body ?? '';
  const pinned = Boolean(input.pinned);

  const rowData: Omit<NoteRow, keyof EntityMeta> = {
    title,
    body_md: body,
    pinned: pinned ? 1 : 0,
  };

  const row = await noteRepo.insert(rowData);
  const note = noteFromRow(row);

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
          // Replace only the exact old title inside [[old title]]
          // Links typed with different casing are normalized by noteByTitle instead
          const updatedBody = sourceRow.body_md.replace(linkRegex, `[[${newTitle}]]`);
          if (updatedBody !== sourceRow.body_md) {
            await noteRepo.update(bl.id, { body_md: updatedBody });
            // Re-sync outgoing links for the modified note as well
            await syncOutgoingLinks(bl.id, updatedBody);
          }
        }
      }
    }
  }

  const updatedRow = await noteRepo.update(id, {
    ...(patch.title !== undefined ? { title: newTitle } : {}),
    ...(patch.body !== undefined ? { body_md: newBody } : {}),
    ...(patch.pinned !== undefined ? { pinned: newPinned } : {}),
  });

  const updatedNote = noteFromRow(updatedRow);

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
        // Re-sync outgoing links for the referrer now that this note is deleted
        await syncOutgoingLinks(bl.id, sourceRow.body_md);
      }
    }
  }

  // 4. Reindex search
  await reindex('note');
}
