import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NotesView } from '../NotesView';
import * as notesService from '../../services/notes';
import * as linkingService from '../../services/linking';
import { I18nService } from '../../services/i18n';
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

describe('NotesView', () => {
  const t = I18nService.t();

  const mockNotes: NoteItem[] = [
    {
      id: 'note-1',
      title: 'First Note',
      body: 'Hello world #tag',
      pinned: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
    },
    {
      id: 'note-2',
      title: 'Second Note',
      body: 'Body of second note with [[First Note]]',
      pinned: false,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T12:00:00Z',
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(notesService.listNotes).mockResolvedValue([...mockNotes]);
    vi.mocked(notesService.noteByTitle).mockImplementation(async (title: string) => {
      const found = mockNotes.find(
        (n) => n.title.toLowerCase() === title.trim().toLowerCase()
      );
      return found ?? null;
    });
    vi.mocked(linkingService.parseLinks).mockReturnValue([]);
    vi.mocked(linkingService.upsertLinks).mockResolvedValue(0);
    vi.mocked(linkingService.backlinksOf).mockResolvedValue([]);
  });

  it('renders notes in the returned order and selects the first one', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(notesService.listNotes).toHaveBeenCalled();
    });

    // Check titles rendered
    expect(screen.getByText('First Note')).toBeDefined();
    expect(screen.getByText('Second Note')).toBeDefined();

    // Selecting note-1 shows its body in the textarea
    const textarea = screen.getByPlaceholderText(t.notesBody) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Hello world #tag');
  });

  it('selecting a note shows its body and updates the editor', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('Second Note')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Second Note'));

    const textarea = screen.getByPlaceholderText(t.notesBody) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Body of second note with [[First Note]]');
  });

  it('editing and blurring calls updateNote and upserts links', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    const textarea = screen.getByPlaceholderText(t.notesBody) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated body [[Second Note]]' } });

    vi.mocked(linkingService.parseLinks).mockReturnValue(['Second Note']);

    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(notesService.updateNote).toHaveBeenCalledWith('note-1', {
        body: 'Updated body [[Second Note]]',
      });
      expect(linkingService.upsertLinks).toHaveBeenCalledWith(
        { kind: 'note', id: 'note-1' },
        [{ kind: 'note', id: 'note-2' }]
      );
    });
  });

  it('the preview toggle shows rendered markdown', async () => {
    render(<NotesView />);

    // Wait for the note to load and textarea to appear
    const textarea = await screen.findByPlaceholderText(t.notesBody);
    expect((textarea as HTMLTextAreaElement).value).toBe('Hello world #tag');

    // Click the preview toggle button
    const previewBtn = screen.getByLabelText(t.notesPreview);
    fireEvent.click(previewBtn);

    // Textarea should not be rendered in preview mode
    expect(screen.queryByPlaceholderText(t.notesBody)).toBeNull();
    // Rendered content is present inside markdown container
    const previewContainer = screen.getByTestId('notes-markdown-preview');
    expect(previewContainer.textContent).toContain('Hello world #tag');
  });
  it('typing [[ lists suggestions and inserting one puts the title in the body', async () => {
    render(<NotesView />);

    const textarea = await screen.findByPlaceholderText(t.notesBody) as HTMLTextAreaElement;
    // Type [[Sec
    fireEvent.change(textarea, {
      target: { value: 'Link to [[Sec', selectionStart: 13 },
    });
    // Should show autocomplete popup with "Second Note" suggestion
    await waitFor(() => {
      expect(screen.getByTestId('notes-autocomplete')).toBeDefined();
    });
    expect(within(screen.getByTestId('notes-autocomplete')).getByText('Second Note')).toBeDefined();

    // Press Enter to insert suggestion
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(notesService.updateNote).toHaveBeenCalledWith('note-1', {
        body: 'Link to [[Second Note]]',
      });
    });
  });

  it('a body with a link to a missing title shows notesBrokenLink', async () => {
    vi.mocked(linkingService.parseLinks).mockReturnValue(['Nonexistent Note']);
    vi.mocked(notesService.noteByTitle).mockResolvedValue(null);

    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    // Notice notesBrokenLink warning
    await waitFor(() => {
      expect(screen.getByText(t.notesBrokenLink)).toBeDefined();
    });
  });

  it('the backlinks panel lists what backlinksOf returned and shows empty message when empty', async () => {
    vi.mocked(linkingService.backlinksOf).mockResolvedValue([
      { kind: 'note', id: 'note-2', title: 'Second Note' },
    ]);

    const { unmount } = render(<NotesView />);

    await screen.findByPlaceholderText(t.notesBody);

    // Backlinks list Second Note
    await waitFor(() => {
      expect(screen.getByTestId('notes-backlinks-panel')).toBeDefined();
    });
    expect(within(screen.getByTestId('notes-backlinks-panel')).getByText('Second Note')).toBeDefined();

    unmount();

    // Now when backlinksOf returns empty list
    vi.mocked(linkingService.backlinksOf).mockResolvedValue([]);
    render(<NotesView />);
    await screen.findByPlaceholderText(t.notesBody);

    await waitFor(() => {
      expect(screen.getByText(t.notesNoBacklinks)).toBeDefined();
    });
  });

  it('pin calls togglePin and reloads notes', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    // Note 1 is pinned, so the button label should be notesUnpin
    const pinBtn = screen.getByLabelText(t.notesUnpin);
    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(notesService.togglePin).toHaveBeenCalledWith('note-1');
    });
  });
});
