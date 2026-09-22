import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  noteByTitle,
  reindexVault,
  renameNotePath,
} from '../notes';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));
vi.mock('../platform', () => ({
  isTauri: () => true,
}));

describe('Notes domain service (notes.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('listNotes & sorting', () => {
    it('sorts pinned first, then by updatedAt descending', async () => {
      mockInvoke.mockResolvedValueOnce([
        {
          id: 'n1',
          title: 'Unpinned Recent',
          body_md: 'body 1',
          pinned: 0,
          updated_at: '2026-09-20T12:00:00.000Z',
          deleted_at: null,
        },
        {
          id: 'n2',
          title: 'Pinned Old',
          body_md: 'body 2',
          pinned: 1,
          updated_at: '2026-09-19T10:00:00.000Z',
          deleted_at: null,
        },
        {
          id: 'n3',
          title: 'Pinned Newer',
          body_md: 'body 3',
          pinned: 1,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
        {
          id: 'n4',
          title: 'Unpinned Old',
          body_md: 'body 4',
          pinned: 0,
          updated_at: '2026-09-18T10:00:00.000Z',
          deleted_at: null,
        },
      ]);

      const notes = await listNotes();

      expect(mockInvoke).toHaveBeenCalledWith('db_list', {
        table: 'notes',
        includeDeleted: false,
      });
      // Pinned first (n3 newer, then n2), then unpinned (n1 newer, then n4)
      expect(notes.map((n) => n.id)).toEqual(['n3', 'n2', 'n1', 'n4']);
      expect(notes[0].pinned).toBe(true);
      expect(notes[1].pinned).toBe(true);
      expect(notes[2].pinned).toBe(false);
      expect(notes[3].pinned).toBe(false);
    });
  });

  describe('noteByTitle', () => {
    it('finds a note comparing case-insensitively and with trimmed whitespace', async () => {
      mockInvoke.mockResolvedValue([
        {
          id: 'n1',
          title: 'Встреча команды',
          body_md: '',
          pinned: 0,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
      ]);

      const match1 = await noteByTitle('Встреча команды');
      expect(match1?.id).toBe('n1');

      const match2 = await noteByTitle('  встреча команды  ');
      expect(match2?.id).toBe('n1');

      const match3 = await noteByTitle('ВСТРЕЧА КОМАНДЫ');
      expect(match3?.id).toBe('n1');

      const matchMissing = await noteByTitle('Другая заметка');
      expect(matchMissing).toBeNull();

      const matchEmpty = await noteByTitle('   ');
      expect(matchEmpty).toBeNull();
    });

    it('matches first line of body when note title is empty', async () => {
      mockInvoke.mockResolvedValue([
        {
          id: 'n1',
          title: '',
          body_md: 'Meeting with Alex\nSome details here',
          pinned: 0,
          updated_at: '2026-09-20T10:00:00.000Z',
          deleted_at: null,
        },
      ]);

      const found = await noteByTitle('Meeting with Alex');
      expect(found?.id).toBe('n1');
    });
  });

  describe('createNote', () => {
    it('creates note, syncs outgoing links to existing targets, and reindexes', async () => {
      // 1. insert call
      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_insert') {
          const row = args.row as Record<string, unknown>;
          return {
            ...row,
            created_at: '2026-09-20T10:00:00.000Z',
            updated_at: '2026-09-20T10:00:00.000Z',
            deleted_at: null,
          };
        }
        if (cmd === 'db_list' && args.table === 'notes') {
          return [
            {
              id: 'target-1',
              title: 'Target Note',
              body_md: '',
              pinned: 0,
              updated_at: '2026-09-20T10:00:00.000Z',
              deleted_at: null,
            },
          ];
        }
        if (cmd === 'links_set') {
          return 1;
        }
        if (cmd === 'db_reindex') {
          return 1;
        }
        return null;
      });

      const note = await createNote({
        title: 'My First Note',
        body: 'Check out [[Target Note]] and non-existing [[Ghost Note]]!',
        pinned: true,
      });

      expect(note.title).toBe('My First Note');
      expect(note.pinned).toBe(true);

      // Verify outgoing link synced only to existing target
      expect(mockInvoke).toHaveBeenCalledWith('links_set', {
        fromKind: 'note',
        fromId: note.id,
        to: [{ kind: 'note', id: 'target-1' }],
      });

      // Verify reindex called for 'note'
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'note' });
    });

    it('auto-increments filename to Untitled 1.md when Untitled.md already exists', async () => {
      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get' && args.id === 'file:Untitled.md') {
          return {
            id: 'file:Untitled.md',
            title: '',
            body_md: 'Previous Untitled note',
            pinned: 0,
            path: 'Untitled.md',
            updated_at: '2026-09-20T10:00:00.000Z',
            deleted_at: null,
          };
        }
        if (cmd === 'db_insert') {
          const row = args.row as Record<string, unknown>;
          return {
            ...row,
            created_at: '2026-09-20T10:00:00.000Z',
            updated_at: '2026-09-20T10:00:00.000Z',
            deleted_at: null,
          };
        }
        if (cmd === 'links_set' || cmd === 'db_reindex') return 1;
        if (cmd === 'db_list') return [];
        return null;
      });

      const note = await createNote();
      expect(note.path).toBe('Untitled 1.md');
      expect(note.id).toBe('file:Untitled 1.md');
      expect(mockInvoke).not.toHaveBeenCalledWith('db_update', expect.objectContaining({ id: 'file:Untitled.md' }));
    });
  });

  describe('updateNote', () => {
    it('detects title change and rewrites [[old title]] in all notes that linked to it', async () => {
      const noteA = {
        id: 'note-a',
        title: 'Project Roadmap',
        body_md: 'Roadmap details',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      const noteB = {
        id: 'note-b',
        title: 'Daily Plan',
        body_md: 'Refer to [[Project Roadmap]] for context.',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      const noteC = {
        id: 'note-c',
        title: 'Another Linker',
        body_md: 'Also sees [[Project Roadmap]] here.',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get') {
          if (args.id === 'note-a') return noteA;
          if (args.id === 'note-b') return noteB;
          if (args.id === 'note-c') return noteC;
        }
        if (cmd === 'links_backlinks') {
          return [
            { kind: 'note', id: 'note-b', title: 'Daily Plan' },
            { kind: 'note', id: 'note-c', title: 'Another Linker' },
          ];
        }
        if (cmd === 'db_update') {
          const patch = args.patch as Record<string, unknown>;
          return {
            ...(args.id === 'note-a' ? noteA : args.id === 'note-b' ? noteB : noteC),
            ...patch,
            updated_at: '2026-09-20T11:00:00.000Z',
          };
        }
        if (cmd === 'db_list') return [noteA, noteB, noteC];
        if (cmd === 'links_set') return 1;
        if (cmd === 'db_reindex') return 1;
        return null;
      });

      const updated = await updateNote('note-a', {
        title: 'Tempo Roadmap',
      });

      expect(updated.title).toBe('Tempo Roadmap');

      // Note B should have [[Project Roadmap]] replaced by [[Tempo Roadmap]]
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'notes',
        id: 'note-b',
        patch: { body_md: 'Refer to [[Tempo Roadmap]] for context.' },
      });

      // Note C should have [[Project Roadmap]] replaced by [[Tempo Roadmap]]
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'notes',
        id: 'note-c',
        patch: { body_md: 'Also sees [[Tempo Roadmap]] here.' },
      });

      // Reindex should be called
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'note' });
    });

    it('updates body and syncs outgoing links', async () => {
      const note = {
        id: 'n1',
        title: 'Note 1',
        body_md: 'Old body',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      const target = {
        id: 'n2',
        title: 'Target',
        body_md: '',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get') return note;
        if (cmd === 'db_list') return [note, target];
        if (cmd === 'db_update') {
          return { ...note, ...(args.patch as Record<string, unknown>) };
        }
        if (cmd === 'links_set') return 1;
        if (cmd === 'db_reindex') return 1;
        return null;
      });

      await updateNote('n1', {
        body: 'New body linking to [[Target]]',
      });

      expect(mockInvoke).toHaveBeenCalledWith('links_set', {
        fromKind: 'note',
        fromId: 'n1',
        to: [{ kind: 'note', id: 'n2' }],
      });
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'note' });
    });
  });

  describe('togglePin', () => {
    it('toggles pinned state from false to true and vice versa', async () => {
      const note = {
        id: 'n1',
        title: 'Note 1',
        body_md: '',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get') return note;
        if (cmd === 'db_update') {
          return { ...note, ...(args.patch as Record<string, unknown>) };
        }
        if (cmd === 'db_reindex') return 1;
        return null;
      });

      const updated = await togglePin('n1');
      expect(updated.pinned).toBe(true);
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'notes',
        id: 'n1',
        patch: { pinned: 1 },
      });
    });
  });

  describe('deleteNote', () => {
    it('soft-deletes the note and removes links in both directions', async () => {
      const referrer = {
        id: 'n2',
        title: 'Referrer',
        body_md: 'Links to [[To Delete]]',
        pinned: 0,
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_delete') return null;
        if (cmd === 'links_backlinks') {
          return [{ kind: 'note', id: 'n2', title: 'Referrer' }];
        }
        if (cmd === 'db_get' && args.id === 'n2') return referrer;
        if (cmd === 'db_list') return [referrer]; // noteToDelete is deleted
        if (cmd === 'links_set') return 0;
        if (cmd === 'db_reindex') return 1;
        return null;
      });

      await deleteNote('n1');

      // 1. Soft-delete called
      expect(mockInvoke).toHaveBeenCalledWith('db_delete', {
        table: 'notes',
        id: 'n1',
      });

      // 2. Clear outgoing links of n1
      expect(mockInvoke).toHaveBeenCalledWith('links_set', {
        fromKind: 'note',
        fromId: 'n1',
        to: [],
      });

      // 3. Referrer n2 gets outgoing links re-synced (to [] since target n1 is gone)
      expect(mockInvoke).toHaveBeenCalledWith('links_set', {
        fromKind: 'note',
        fromId: 'n2',
        to: [],
      });

      // 4. Reindex called
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'note' });
    });
  });

  describe('updateNote heading and file sync', () => {
    it('updates markdown heading in body when title changes', async () => {
      const noteA = {
        id: 'file:test.md',
        title: 'Old Title',
        body_md: '# Old Title\n\nSome body text',
        pinned: 0,
        path: 'test.md',
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get' && args.id === 'file:test.md') return noteA;
        if (cmd === 'links_backlinks') return [];
        if (cmd === 'db_update') {
          return { ...noteA, ...(args.patch as Record<string, unknown>) };
        }
        if (cmd === 'db_list') return [noteA];
        if (cmd === 'links_set' || cmd === 'db_reindex') return 1;
        return null;
      });

      const updated = await updateNote('file:test.md', { title: 'New Title' });
      expect(updated.title).toBe('New Title');
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'notes',
        id: 'file:test.md',
        patch: expect.objectContaining({
          title: 'New Title',
          body_md: '# New Title\n\nSome body text',
        }),
      });
    });
  });

  describe('reindexVault soft-deleted restore', () => {
    it('un-deletes existing soft-deleted note with deleted_at = null', async () => {
      const softDeletedNote = {
        id: 'file:existing.md',
        title: 'Existing',
        body_md: 'Old content',
        pinned: 0,
        path: 'existing.md',
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: '2026-09-21T10:00:00.000Z',
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_list' && args.table === 'notes') {
          if (args.includeDeleted) {
            return [softDeletedNote];
          }
          return [];
        }
        if (cmd === 'vault_list') {
          return [
            { path: 'existing.md', name: 'existing.md', isDir: false, children: [] },
          ];
        }
        if (cmd === 'vault_read') {
          return '# Existing\n\nNew disk content';
        }
        if (cmd === 'db_update') {
          return {
            ...softDeletedNote,
            ...(args.patch as Record<string, unknown>),
            deleted_at: null,
          };
        }
        if (cmd === 'links_set' || cmd === 'db_reindex') return 1;
        return null;
      });

      await reindexVault();

      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'notes',
        id: 'file:existing.md',
        patch: expect.objectContaining({
          deleted_at: null,
          body_md: '# Existing\n\nNew disk content',
        }),
      });
      // Must NOT create a fallback UUID row
      expect(mockInvoke).not.toHaveBeenCalledWith('db_insert', expect.anything());
    });
  });

  describe('renameNotePath', () => {
    it('migrates DB row from old path to new path and rewrites backlinks', async () => {
      const oldNote = {
        id: 'file:OldName.md',
        title: 'OldName',
        body_md: '# OldName\nContent',
        pinned: 0,
        path: 'OldName.md',
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      const referringNote = {
        id: 'file:Referrer.md',
        title: 'Referrer',
        body_md: 'Check [[OldName]] here.',
        pinned: 0,
        path: 'Referrer.md',
        updated_at: '2026-09-20T10:00:00.000Z',
        deleted_at: null,
      };

      mockInvoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
        if (cmd === 'db_get') {
          if (args.id === 'file:OldName.md') return oldNote;
          if (args.id === 'file:Referrer.md') return referringNote;
          return null;
        }
        if (cmd === 'links_backlinks') {
          return [{ kind: 'note', id: 'file:Referrer.md', title: 'Referrer' }];
        }
        if (cmd === 'db_insert') {
          return {
            ...(args.row as Record<string, unknown>),
            created_at: '2026-09-20T11:00:00.000Z',
            updated_at: '2026-09-20T11:00:00.000Z',
            deleted_at: null,
          };
        }
        if (cmd === 'db_delete') return null;
        if (cmd === 'db_update') {
          return { ...referringNote, ...(args.patch as Record<string, unknown>) };
        }
        if (cmd === 'db_list') return [referringNote];
        if (cmd === 'links_set' || cmd === 'db_reindex') return 1;
        return null;
      });

      await renameNotePath('OldName.md', 'NewName.md');

      // Old row removed
      expect(mockInvoke).toHaveBeenCalledWith('db_delete', {
        table: 'notes',
        id: 'file:OldName.md',
      });

      // New row inserted with new path
      expect(mockInvoke).toHaveBeenCalledWith('db_insert', {
        table: 'notes',
        row: expect.objectContaining({
          id: 'file:NewName.md',
          path: 'NewName.md',
        }),
      });

      // Referrer note body rewritten
      expect(mockInvoke).toHaveBeenCalledWith('db_update', {
        table: 'notes',
        id: 'file:Referrer.md',
        patch: expect.objectContaining({
          body_md: 'Check [[NewName]] here.',
        }),
      });
    });
  });
});
