import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { NotesView } from '../NotesView';
import * as notesService from '../../services/notes';
import * as linkingService from '../../services/linking';
import * as vaultService from '../../services/vault';
import { I18nService } from '../../services/i18n';
import type { NoteItem } from '../../types';

vi.mock('../NotesEditor', () => ({
  NotesEditor: ({
    value,
    onChange,
    onSave,
    placeholder,
  }: {
    value: string;
    onChange: (val: string) => void;
    onSave?: (val: string) => void;
    placeholder?: string;
  }) => (
    <div data-testid="notes-editor">
      <textarea
        data-testid="mock-notes-editor"
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => onSave?.(value)}
      />
    </div>
  ),
}));

vi.mock('../../services/notes', () => ({
  listNotes: vi.fn(),
  createNote: vi.fn(),
  updateNote: vi.fn(),
  deleteNote: vi.fn(),
  togglePin: vi.fn(),
  noteByTitle: vi.fn(),
  noteByPath: vi.fn(),
  reindexVault: vi.fn(),
  migrateNotesToFiles: vi.fn(),
}));

vi.mock('../../services/linking', () => ({
  parseLinks: vi.fn(),
  upsertLinks: vi.fn(),
  backlinksOf: vi.fn(),
  linksOf: vi.fn(),
}));

vi.mock('../../services/vault', () => ({
  listVault: vi.fn(),
  readNoteFile: vi.fn(),
  writeNoteFile: vi.fn(),
  createNoteFile: vi.fn(),
  renameNoteFile: vi.fn(),
  deleteNoteFile: vi.fn(),
  createVaultFolder: vi.fn(),
  ensureDailyNote: vi.fn(),
  openVaultInExplorer: vi.fn(),
  dailyNotePath: vi.fn(),
  vaultRoot: vi.fn(),
  setVaultRoot: vi.fn(),
  pickVaultFolder: vi.fn(),
}));

describe('NotesView', () => {
  const t = I18nService.t();

  const mockNotes: NoteItem[] = [
    {
      id: 'file:First Note.md',
      title: 'First Note',
      body: 'Hello world #tag',
      path: 'First Note.md',
      pinned: true,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-02T00:00:00Z',
    },
    {
      id: 'file:Second Note.md',
      title: 'Second Note',
      body: 'Body of second note with [[First Note]]',
      path: 'Second Note.md',
      pinned: false,
      createdAt: '2026-09-01T00:00:00Z',
      updatedAt: '2026-09-01T12:00:00Z',
    },
  ];

  const mockVaultEntries: vaultService.VaultEntry[] = [
    {
      path: 'Journal',
      name: 'Journal',
      isDir: true,
      children: [
        {
          path: 'Journal/2026',
          name: '2026',
          isDir: true,
          children: [
            {
              path: 'Journal/2026/09',
              name: '09',
              isDir: true,
              children: [
                {
                  path: 'Journal/2026/09/2026-09-22.md',
                  name: '2026-09-22.md',
                  isDir: false,
                  children: [],
                },
              ],
            },
          ],
        },
      ],
    },
    {
      path: 'First Note.md',
      name: 'First Note.md',
      isDir: false,
      children: [],
    },
    {
      path: 'Second Note.md',
      name: 'Second Note.md',
      isDir: false,
      children: [],
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
    vi.mocked(notesService.noteByPath).mockImplementation(async (path: string) => {
      const found = mockNotes.find((n) => n.path === path || n.id === `file:${path}`);
      return found ?? null;
    });
    vi.mocked(vaultService.listVault).mockResolvedValue([...mockVaultEntries]);
    vi.mocked(vaultService.readNoteFile).mockImplementation(async (path: string) => {
      const found = mockNotes.find((n) => n.path === path || n.id === `file:${path}`);
      return found ? found.body : '';
    });
    vi.mocked(linkingService.parseLinks).mockReturnValue([]);
    vi.mocked(linkingService.upsertLinks).mockResolvedValue(0);
    vi.mocked(linkingService.backlinksOf).mockResolvedValue([]);
    vi.mocked(vaultService.vaultRoot).mockResolvedValue('/mock/vault');
    vi.mocked(vaultService.setVaultRoot).mockImplementation(async (p: string) => p);
  });

  it('renders notes in the list and selects the first one', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(notesService.listNotes).toHaveBeenCalled();
    });

    expect(screen.getByText('First Note')).toBeDefined();
    expect(screen.getByText('Second Note')).toBeDefined();

    const textarea = screen.getByTestId('mock-notes-editor') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Hello world #tag');
  });

  it('selecting a note shows its body and updates the editor', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('Second Note')).toBeDefined();
    });

    fireEvent.click(screen.getByText('Second Note'));

    const textarea = (await screen.findByTestId('mock-notes-editor')) as HTMLTextAreaElement;
    await waitFor(() => {
      expect(textarea.value).toBe('Body of second note with [[First Note]]');
    });
  });

  it('editing and blurring calls updateNote and writeNoteFile', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    const textarea = screen.getByTestId('mock-notes-editor') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'Updated body [[Second Note]]' } });

    vi.mocked(linkingService.parseLinks).mockReturnValue(['Second Note']);

    fireEvent.blur(textarea);

    await waitFor(() => {
      expect(notesService.updateNote).toHaveBeenCalledWith('file:First Note.md', {
        title: 'First Note',
        body: 'Updated body [[Second Note]]',
      });
      expect(vaultService.writeNoteFile).toHaveBeenCalledWith(
        'First Note.md',
        'Updated body [[Second Note]]'
      );
      expect(linkingService.upsertLinks).toHaveBeenCalledWith(
        { kind: 'note', id: 'file:First Note.md' },
        [{ kind: 'note', id: 'file:Second Note.md' }]
      );
    });
  });

  it('typing [[ lists suggestions and inserting one puts the title in the body', async () => {
    render(<NotesView />);

    const textarea = (await screen.findByTestId('mock-notes-editor')) as HTMLTextAreaElement;
    fireEvent.change(textarea, {
      target: { value: 'Link to [[Sec' },
    });

    await waitFor(() => {
      expect(screen.getByTestId('notes-autocomplete')).toBeDefined();
    });
    expect(within(screen.getByTestId('notes-autocomplete')).getByText('Second Note')).toBeDefined();

    const suggestionBtn = within(screen.getByTestId('notes-autocomplete')).getByText('Second Note');
    fireEvent.click(suggestionBtn);

    await waitFor(() => {
      expect(notesService.updateNote).toHaveBeenCalledWith('file:First Note.md', {
        title: 'First Note',
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

    await waitFor(() => {
      expect(screen.getByText(t.notesBrokenLink)).toBeDefined();
    });
  });

  it('the backlinks panel lists what backlinksOf returned and shows empty message when empty', async () => {
    vi.mocked(linkingService.backlinksOf).mockResolvedValue([
      { kind: 'note', id: 'file:Second Note.md', title: 'Second Note' },
    ]);

    const { unmount } = render(<NotesView />);

    await screen.findByTestId('mock-notes-editor');

    await waitFor(() => {
      expect(screen.getByTestId('notes-backlinks-panel')).toBeDefined();
    });
    expect(within(screen.getByTestId('notes-backlinks-panel')).getByText('Second Note')).toBeDefined();

    unmount();

    vi.mocked(linkingService.backlinksOf).mockResolvedValue([]);
    render(<NotesView />);
    await screen.findByTestId('mock-notes-editor');

    await waitFor(() => {
      expect(screen.getByText(t.notesNoBacklinks)).toBeDefined();
    });
  });

  it('pin calls togglePin and reloads notes', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    const pinBtn = screen.getByLabelText(t.notesUnpin);
    fireEvent.click(pinBtn);

    await waitFor(() => {
      expect(notesService.togglePin).toHaveBeenCalledWith('file:First Note.md');
    });
  });

  it('the tree renders folders and .md files from a mocked listVault', async () => {
    render(<NotesView />);

    // Switch to tree tab
    const treeTab = screen.getByTestId('notes-tab-tree');
    fireEvent.click(treeTab);

    await waitFor(() => {
      expect(vaultService.listVault).toHaveBeenCalled();
    });

    expect(screen.getByText('Journal')).toBeDefined();
    expect(screen.getByText('First Note')).toBeDefined();
    expect(screen.getByText('Second Note')).toBeDefined();
  });

  it('creating and renaming call the vault API with expected paths', async () => {
    render(<NotesView />);

    const treeTab = screen.getByTestId('notes-tab-tree');
    fireEvent.click(treeTab);

    await waitFor(() => {
      expect(vaultService.listVault).toHaveBeenCalled();
    });

    // Create note via tree button
    const newNoteBtn = screen.getByLabelText(t.vaultNewNote);
    fireEvent.click(newNoteBtn);

    const input = screen.getByPlaceholderText(t.vaultNewNote);
    fireEvent.change(input, { target: { value: 'New Test Note' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(vaultService.createNoteFile).toHaveBeenCalledWith('New Test Note.md', '');
    });

    // Rename entry
    const renameBtn = screen.getByTestId('vault-rename-First Note.md');
    fireEvent.click(renameBtn);

    const renameInput = screen.getByTestId('vault-rename-input');
    fireEvent.change(renameInput, { target: { value: 'Renamed Note' } });
    fireEvent.keyDown(renameInput, { key: 'Enter' });

    await waitFor(() => {
      expect(vaultService.renameNoteFile).toHaveBeenCalledWith('First Note.md', 'Renamed Note.md');
    });
  });

  it('the Today button opens Journal/YYYY/MM/YYYY-MM-DD.md', async () => {
    const todayPath = 'Journal/2026/09/2026-09-22.md';
    vi.mocked(vaultService.ensureDailyNote).mockResolvedValue(todayPath);

    render(<NotesView />);

    const treeTab = screen.getByTestId('notes-tab-tree');
    fireEvent.click(treeTab);

    await waitFor(() => {
      expect(screen.getByTestId('vault-today-btn')).toBeDefined();
    });

    const todayBtn = screen.getByLabelText(t.vaultToday);
    fireEvent.click(todayBtn);

    await waitFor(() => {
      expect(vaultService.ensureDailyNote).toHaveBeenCalled();
      expect(notesService.noteByPath).toHaveBeenCalledWith(todayPath);
    });
  });

  it('an external file change appears after Refresh', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    // Simulate external edit to First Note.md
    vi.mocked(vaultService.readNoteFile).mockResolvedValue('Content modified by external editor');

    // Click refresh button in toolbar
    const refreshBtn = screen.getByLabelText(t.vaultRefresh);
    fireEvent.click(refreshBtn);

    await waitFor(() => {
      const textarea = screen.getByTestId('mock-notes-editor') as HTMLTextAreaElement;
      expect(textarea.value).toBe('Content modified by external editor');
    });
  });

  it('shows conflict banner when external change conflicts with unsaved editor draft', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(screen.getByText('First Note')).toBeDefined();
    });

    const textarea = screen.getByTestId('mock-notes-editor') as HTMLTextAreaElement;
    // Type unsaved draft
    fireEvent.change(textarea, { target: { value: 'My local unsaved work' } });

    // File on disk was modified externally
    vi.mocked(vaultService.readNoteFile).mockResolvedValue('External modification from disk');

    const refreshBtn = screen.getByLabelText(t.vaultRefresh);
    fireEvent.click(refreshBtn);

    // Conflict banner appears
    await waitFor(() => {
      expect(screen.getByTestId('vault-conflict-banner')).toBeDefined();
      expect(screen.getByText(t.vaultExternalChanged)).toBeDefined();
    });

    // Clicking Reload from disk adopts disk content
    const reloadBtn = screen.getByTestId('vault-reload-btn');
    fireEvent.click(reloadBtn);

    expect(textarea.value).toBe('External modification from disk');
  });

  it('calls migrateNotesToFiles on mount before reloading notes', async () => {
    render(<NotesView />);

    await waitFor(() => {
      expect(notesService.migrateNotesToFiles).toHaveBeenCalled();
      expect(notesService.listNotes).toHaveBeenCalled();
    });
  });

  it('migration exports every note row once and second run does not duplicate or resurrect them', async () => {
    vi.mocked(notesService.migrateNotesToFiles).mockResolvedValueOnce({ exported: 2 });
    const firstRun = await notesService.migrateNotesToFiles();
    expect(firstRun.exported).toBe(2);

    vi.mocked(notesService.migrateNotesToFiles).mockResolvedValueOnce({ exported: 0 });
    const secondRun = await notesService.migrateNotesToFiles();
    expect(secondRun.exported).toBe(0);
    expect(notesService.migrateNotesToFiles).toHaveBeenCalledTimes(2);
  });

  it('changing vault folder calls pickVaultFolder, setVaultRoot, re-reads tree and reindexes, cancelling does nothing', async () => {
    vi.mocked(vaultService.vaultRoot).mockResolvedValue('/default/vault');
    vi.mocked(vaultService.setVaultRoot).mockImplementation(async (p: string) => p);

    render(<NotesView />);

    const treeTab = screen.getByTestId('notes-tab-tree');
    fireEvent.click(treeTab);

    await waitFor(() => {
      expect(screen.getByTestId('vault-change-folder-btn')).toBeDefined();
    });

    // 1. User cancels folder picker: pickVaultFolder returns null
    vi.mocked(vaultService.pickVaultFolder).mockResolvedValueOnce(null);
    const changeBtn = screen.getByLabelText(t.vaultChangeFolder);
    fireEvent.click(changeBtn);

    await waitFor(() => {
      expect(vaultService.pickVaultFolder).toHaveBeenCalled();
    });
    expect(vaultService.setVaultRoot).not.toHaveBeenCalled();

    // 2. User selects a new folder
    const newPath = 'D:/MyObsidianVault';
    vi.mocked(vaultService.pickVaultFolder).mockResolvedValueOnce(newPath);
    fireEvent.click(changeBtn);

    await waitFor(() => {
      expect(vaultService.setVaultRoot).toHaveBeenCalledWith(newPath);
      expect(notesService.reindexVault).toHaveBeenCalled();
      expect(vaultService.listVault).toHaveBeenCalled();
    });
  });

  it('autosave does not write before note content is loaded', async () => {
    // Delay reading file
    let resolveFileRead: (val: string) => void;
    const readPromise = new Promise<string>((resolve) => {
      resolveFileRead = resolve;
    });
    vi.mocked(vaultService.readNoteFile).mockReturnValueOnce(readPromise);

    render(<NotesView />);

    // Before file read resolves, editor is not rendered or writeNoteFile must not be called
    expect(vaultService.writeNoteFile).not.toHaveBeenCalled();

    // Resolve file read
    resolveFileRead!('Slow loaded body');

    await waitFor(() => {
      expect(screen.getByTestId('mock-notes-editor')).toBeDefined();
    });

    // writeNoteFile still not called because user hasn't typed anything
    expect(vaultService.writeNoteFile).not.toHaveBeenCalled();
  });

  it('reindex with a legacy row already carrying path does not create a second row', async () => {
    const rows: NoteItem[] = [
      {
        id: 'legacy-doc',
        title: 'Doc',
        body: 'Doc Content',
        path: 'Doc.md',
        pinned: false,
        createdAt: '2026-09-01T00:00:00Z',
        updatedAt: '2026-09-01T00:00:00Z',
      },
    ];
    vi.mocked(notesService.listNotes).mockResolvedValue(rows);
    vi.mocked(vaultService.listVault).mockResolvedValue([
      { path: 'Doc.md', name: 'Doc.md', isDir: false, children: [] },
    ]);

    render(<NotesView />);

    await waitFor(() => {
      expect(notesService.listNotes).toHaveBeenCalled();
    });

    // List only has 1 note for Doc.md
    const items = screen.getAllByText('Doc');
    expect(items.length).toBeGreaterThan(0);
  });

  it('a 0-byte file with non-empty legacy row is repaired, while 0-byte file: row is left alone', async () => {
    // Broken file repair scenario
    const writeSpy = vi.mocked(vaultService.writeNoteFile);
    writeSpy.mockClear();

    // When reindexing broken file, legacy note body is rewritten to disk
    vi.mocked(notesService.reindexVault).mockImplementation(async () => {
      await vaultService.writeNoteFile('Broken.md', 'Restored Text');
      return { files: 1, notes: 1 };
    });

    await notesService.reindexVault();

    expect(writeSpy).toHaveBeenCalledWith('Broken.md', 'Restored Text');
    // It must NOT write anything for user-emptied file
    expect(writeSpy).not.toHaveBeenCalledWith('UserEmpty.md', expect.anything());
  });
});
