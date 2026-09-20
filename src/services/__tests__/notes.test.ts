import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  noteByTitle,
} from '../notes';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
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
});
