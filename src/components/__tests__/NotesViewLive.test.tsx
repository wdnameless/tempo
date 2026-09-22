import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { NotesView } from '../NotesView';
import * as notesService from '../../services/notes';
import * as linkingService from '../../services/linking';
import { emitDataChanged } from '../../services/appEvents';
import type { NoteItem } from '../../types';

vi.mock('../../services/notes', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  togglePin: vi.fn(),
  noteByTitle: vi.fn(),
}));

vi.mock('../../services/linking', () => ({
  parseLinks: vi.fn(),
  upsertLinks: vi.fn(),
  backlinksOf: vi.fn(),
  linksOf: vi.fn(),
}));

describe('NotesView Live Data Sync', () => {
  const initialNote: NoteItem = {
    id: 'note-1',
    title: 'Initial Note',
    body: 'Initial note content',
    pinned: false,
    createdAt: '2026-09-01T00:00:00Z',
    updatedAt: '2026-09-01T00:00:00Z',
  };

  const assistantNote: NoteItem = {
    id: 'note-assistant',
    title: 'Assistant Created Note',
    body: 'Generated from schedule text',
    pinned: false,
    createdAt: '2026-09-22T12:00:00Z',
    updatedAt: '2026-09-22T12:00:00Z',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(linkingService.parseLinks).mockReturnValue([]);
    vi.mocked(linkingService.upsertLinks).mockResolvedValue(0);
    vi.mocked(linkingService.backlinksOf).mockResolvedValue([]);
    vi.mocked(linkingService.linksOf).mockResolvedValue([]);
  });

  it('re-reads and renders assistant-created note on emitDataChanged("notes") without remounting', async () => {
    let currentNotes = [initialNote];
    vi.mocked(notesService.listNotes).mockImplementation(async () => currentNotes);

    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('Initial Note')).toBeDefined();
    });
    expect(screen.queryByText('Assistant Created Note')).toBeNull();

    // Assistant writes a note to SQLite and fires data-changed
    currentNotes = [initialNote, assistantNote];
    emitDataChanged('notes', [assistantNote.id]);

    await waitFor(() => {
      expect(screen.getByText('Assistant Created Note')).toBeDefined();
    });
    expect(screen.getByText('Initial Note')).toBeDefined();
    expect(notesService.listNotes).toHaveBeenCalledTimes(2);
  });

  it('ignores data changes for unrelated tables', async () => {
    const currentNotes = [initialNote];
    vi.mocked(notesService.listNotes).mockImplementation(async () => currentNotes);

    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('Initial Note')).toBeDefined();
    });

    emitDataChanged('tasks', ['task-1']);
    emitDataChanged('alarms', ['alarm-1']);

    expect(notesService.listNotes).toHaveBeenCalledTimes(1);
  });
});
