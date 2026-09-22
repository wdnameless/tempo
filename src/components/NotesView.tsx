import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  Trash2,
  Pin,
  PinOff,
  FileText,
  Link as LinkIcon,
  AlertTriangle,
  ChevronLeft,
  RefreshCw,
  Folder,
  List,
} from 'lucide-react';
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  noteByTitle,
  noteByPath,
  reindexVault,
  migrateNotesToFiles,
} from '../services/notes';
import { readNoteFile, writeNoteFile } from '../services/vault';
import { parseLinks, upsertLinks, backlinksOf, type LinkRef, type BacklinkItem } from '../services/linking';
import { I18nService } from '../services/i18n';
import { onDataChanged, emitDataChanged } from '../services/appEvents';
import { Card, ScreenHeader, EmptyState, IconButton, Divider } from './ui';
import { NotesEditor } from './NotesEditor';
import { NotesTree } from './NotesTree';
import type { NoteItem } from '../types';

interface AutocompleteState {
  active: boolean;
  query: string;
  cursorStart: number;
  cursorEnd: number;
  selectedIndex: number;
}

export function NotesView(): React.ReactElement {
  const t = I18nService.t();

  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sidebarMode, setSidebarMode] = useState<'tree' | 'list'>('list');

  // Editor states
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [lastSavedBody, setLastSavedBody] = useState('');
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);
  const [externalConflict, setExternalConflict] = useState<{ diskContent: string } | null>(null);

  const [loadedNoteId, setLoadedNoteId] = useState<string | null>(null);
  const loadedNoteIdRef = useRef<string | null>(null);
  const selectedNoteIdRef = useRef<string | null>(null);

  useEffect(() => {
    selectedNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);
  /**
   * The note+body combination whose links were found to be broken.
   */
  const [brokenForKey, setBrokenForKey] = useState<string | null>(null);

  // Mobile / narrow view list collapse state
  const [mobileShowList, setMobileShowList] = useState(false);

  // Autocomplete state
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const saveTimeoutRef = useRef<number | null>(null);

  // Keep track of the currently loaded note
  const currentNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  // Reload notes list
  const reloadNotes = useCallback(async (preserveSelectedId?: string | null) => {
    try {
      const items = await listNotes();
      setNotes(items);
      const targetId = preserveSelectedId !== undefined ? preserveSelectedId : selectedNoteIdRef.current;
      const active = (targetId ? items.find((n) => n.id === targetId) : null) ?? items[0] ?? null;
      const nextId = active?.id ?? null;
      setSelectedNoteId(nextId);
      selectedNoteIdRef.current = nextId;

      if (active) {
        setTitle(active.title || '');
        const activePath = active.path || (active.id.startsWith('file:') ? active.id.slice(5) : null);
        setSelectedPath(activePath);

        let initialBody = active.body || '';
        if (activePath) {
          try {
            initialBody = await readNoteFile(activePath);
          } catch {
            initialBody = active.body || '';
          }
        }
        setBody(initialBody);
        setLastSavedBody(initialBody);
        loadedNoteIdRef.current = active.id;
        setLoadedNoteId(active.id);

        void backlinksOf('note', active.id).then((bl) => {
          setBacklinks(bl || []);
        });
      } else {
        setTitle('');
        setSelectedPath(null);
        setBody('');
        setLastSavedBody('');
        loadedNoteIdRef.current = null;
        setLoadedNoteId(null);
        setBacklinks([]);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load and live data sync
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await migrateNotesToFiles();
      } catch (err) {
        console.error('Migration failed:', err);
      }
      if (active) {
        await reloadNotes();
      }
    })();

    const unsub = onDataChanged((table) => {
      if (table === 'notes') {
        void reloadNotes();
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, [reloadNotes]);

  // Clean up save timer on unmount
  useEffect(() => {
    return () => {
      clearTimeout(saveTimeoutRef.current ?? undefined);
    };
  }, []);

  // Backlinks for the note on screen
  useEffect(() => {
    if (!currentNote) return;
    let cancelled = false;
    void backlinksOf('note', currentNote.id).then((found) => {
      if (!cancelled) setBacklinks(found ?? []);
    });
    return () => {
      cancelled = true;
    };
  }, [currentNote]);

  // Listen to tempo:reveal events to jump to a specific note
  useEffect(() => {
    const handleReveal = (e: Event) => {
      const custom = e as CustomEvent<{ id?: string; kind?: string; row_id?: string }>;
      const targetId = custom.detail?.id || custom.detail?.row_id;
      if (targetId) {
        setMobileShowList(false);
        void reloadNotes(targetId);
      }
    };
    window.addEventListener('tempo:reveal', handleReveal);
    return () => window.removeEventListener('tempo:reveal', handleReveal);
  }, [reloadNotes]);
  // Sync outgoing links
  const syncLinks = useCallback(
    async (noteId: string, markdownText: string) => {
      const titles = parseLinks(markdownText);
      const validLinks: LinkRef[] = [];

      for (const linkTitle of titles) {
        const found = await noteByTitle(linkTitle);
        if (found && found.id) {
          validLinks.push({ kind: 'note', id: found.id });
        }
      }

      await upsertLinks({ kind: 'note', id: noteId }, validLinks);
    },
    []
  );

  /** Whether the body on screen has a link that leads nowhere */
  const linkCheckKey = currentNote ? `${currentNote.id}:${body}` : null;
  const hasBrokenLink = linkCheckKey !== null && brokenForKey === linkCheckKey;

  // Check broken links whenever body changes
  useEffect(() => {
    if (!currentNote) return;
    const key = `${currentNote.id}:${body}`;
    const titles = parseLinks(body);
    let cancelled = false;

    void (async () => {
      for (const linkTitle of titles) {
        const found = await noteByTitle(linkTitle);
        if (!found) {
          if (!cancelled) setBrokenForKey(key);
          return;
        }
      }
      if (!cancelled) setBrokenForKey((prev) => (prev === key ? null : prev));
    })();

    return () => {
      cancelled = true;
    };
  }, [currentNote, body]);

  // Save current note to file and DB
  const saveCurrentNote = useCallback(
    async (bodyToSave: string, titleToSave?: string) => {
      if (!selectedNoteId) return;
      if (loadedNoteIdRef.current !== selectedNoteId) {
        return;
      }
      const targetTitle = titleToSave !== undefined ? titleToSave : title;
      const filePath = selectedPath;

      if (filePath) {
        try {
          await writeNoteFile(filePath, bodyToSave);
        } catch (err) {
          console.error(`Failed to write note file ${filePath}:`, err);
        }
      }

      try {
        await updateNote(selectedNoteId, { title: targetTitle, body: bodyToSave });
        await syncLinks(selectedNoteId, bodyToSave);
        emitDataChanged('notes', [selectedNoteId]);
      } catch (err) {
        console.error(`Failed to update note ${selectedNoteId}:`, err);
      }

      setLastSavedBody(bodyToSave);
    },
    [selectedNoteId, selectedPath, title, syncLinks]
  );

  // Handle editor text change (debounced write)
  const handleBodyChange = useCallback(
    (newBody: string) => {
      if (loadedNoteIdRef.current !== selectedNoteId) {
        return;
      }
      setBody(newBody);
      // Check [[ autocomplete
      const lastOpenIndex = newBody.lastIndexOf('[[');
      if (lastOpenIndex !== -1) {
        const queryText = newBody.slice(lastOpenIndex + 2);
        if (!queryText.includes('\n') && !queryText.includes(']]')) {
          setAutocomplete({
            active: true,
            query: queryText,
            cursorStart: lastOpenIndex,
            cursorEnd: lastOpenIndex + 2 + queryText.length,
            selectedIndex: 0,
          });
        } else {
          setAutocomplete(null);
        }
      } else {
        setAutocomplete(null);
      }

      // Debounce auto-save
      clearTimeout(saveTimeoutRef.current ?? undefined);
      saveTimeoutRef.current = window.setTimeout(() => {
        void saveCurrentNote(newBody);
      }, 500);
    },
    [saveCurrentNote, selectedNoteId]
  );

  // Immediate save on Ctrl+S / blur
  const handleEditorSave = useCallback(
    (markdownText: string) => {
      if (loadedNoteIdRef.current !== selectedNoteId) {
        return;
      }
      clearTimeout(saveTimeoutRef.current ?? undefined);
      void saveCurrentNote(markdownText);
    },
    [saveCurrentNote, selectedNoteId]
  );

  // Select note from tree by relative path
  const handleSelectPath = async (path: string) => {
    if (selectedNoteId && body !== lastSavedBody) {
      await saveCurrentNote(body);
    }

    if (!path) {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
        saveTimeoutRef.current = null;
      }
      setSelectedNoteId(null);
      selectedNoteIdRef.current = null;
      setSelectedPath(null);
      loadedNoteIdRef.current = null;
      setLoadedNoteId(null);
      setTitle('');
      setBody('');
      setLastSavedBody('');
      setBacklinks([]);
      setExternalConflict(null);
      return;
    }

    loadedNoteIdRef.current = null;
    setLoadedNoteId(null);
    setSelectedPath(path);
    setExternalConflict(null);

    let note = await noteByPath(path);
    if (!note) {
      await reindexVault();
      note = await noteByPath(path);
    }

    if (note) {
      setSelectedNoteId(note.id);
      selectedNoteIdRef.current = note.id;
      setTitle(note.title || '');
      try {
        const diskContent = await readNoteFile(path);
        setBody(diskContent);
        setLastSavedBody(diskContent);
      } catch {
        setBody(note.body || '');
        setLastSavedBody(note.body || '');
      }
      loadedNoteIdRef.current = note.id;
      setLoadedNoteId(note.id);
      void backlinksOf('note', note.id).then(setBacklinks);
    }
  };

  // Select note from list
  const handleSelectNoteItem = async (item: NoteItem) => {
    if (selectedNoteId && body !== lastSavedBody) {
      await saveCurrentNote(body);
    }

    loadedNoteIdRef.current = null;
    setLoadedNoteId(null);
    setSelectedNoteId(item.id);
    setTitle(item.title || '');
    setExternalConflict(null);
    const filePath = item.path || (item.id.startsWith('file:') ? item.id.slice(5) : null);
    setSelectedPath(filePath);

    let content = item.body || '';
    if (filePath) {
      try {
        content = await readNoteFile(filePath);
      } catch {
        content = item.body || '';
      }
    }

    setBody(content);
    setLastSavedBody(content);
    void backlinksOf('note', item.id).then(setBacklinks);
    loadedNoteIdRef.current = item.id;
    setLoadedNoteId(item.id);
  };

  // Refresh current note from disk (R08)
  const handleRefreshNote = async () => {
    const filePath = selectedPath || (currentNote?.path);
    if (!filePath) {
      await reloadNotes(selectedNoteId);
      return;
    }

    let hasConflict = false;
    try {
      const diskContent = await readNoteFile(filePath);
      if (diskContent !== body) {
        if (body !== lastSavedBody) {
          // Unsaved editor changes conflict with external disk modification
          setExternalConflict({ diskContent });
          hasConflict = true;
        } else {
          // Clean reload from disk
          setBody(diskContent);
          setLastSavedBody(diskContent);
          if (selectedNoteId) {
            await updateNote(selectedNoteId, { body: diskContent });
            await syncLinks(selectedNoteId, diskContent);
            emitDataChanged('notes', [selectedNoteId]);
          }
        }
      }
    } catch (err) {
      console.error('Failed to read note file on refresh:', err);
    }

    if (!hasConflict) {
      await reloadNotes(selectedNoteId);
    }
  };

  // Resolve conflict by accepting disk content
  const handleReloadFromDisk = async () => {
    if (!externalConflict) return;
    const diskContent = externalConflict.diskContent;
    setBody(diskContent);
    setLastSavedBody(diskContent);
    setExternalConflict(null);
    if (selectedNoteId) {
      await updateNote(selectedNoteId, { body: diskContent });
      await syncLinks(selectedNoteId, diskContent);
      emitDataChanged('notes', [selectedNoteId]);
    }
  };

  // Resolve conflict by overwriting disk with editor draft
  const handleKeepMyVersion = async () => {
    setExternalConflict(null);
    await saveCurrentNote(body);
  };

  // Create new note
  const handleCreateNote = async () => {
    const newNote = await createNote({ title: '', body: '' });
    emitDataChanged('notes');
    await reloadNotes(newNote.id);
    setMobileShowList(false);
  };

  // Delete current note
  const handleDeleteNote = async (id: string) => {
    await deleteNote(id);
    emitDataChanged('notes');
    await reloadNotes();
  };

  // Toggle pin
  const handleTogglePin = async (id: string) => {
    await togglePin(id);
    emitDataChanged('notes');
    await reloadNotes(id);
  };

  // Title save on blur
  const handleTitleBlur = async () => {
    if (!currentNote || title === currentNote.title) return;
    await updateNote(currentNote.id, { title, body });
    emitDataChanged('notes', [currentNote.id]);
    await reloadNotes(currentNote.id);
  };

  // Filtered suggestions for [[ link autocomplete
  const suggestions = useMemo(() => {
    if (!autocomplete) return [];
    const q = autocomplete.query.trim().toLowerCase();
    return notes
      .filter((n) => n.id !== currentNote?.id)
      .map((n) => n.title || n.body.split('\n')[0] || '')
      .filter((t) => Boolean(t) && t.toLowerCase().includes(q));
  }, [autocomplete, notes, currentNote?.id]);

  // Insert link into body at cursor
  const insertLink = useCallback(
    async (linkTitle: string) => {
      if (!autocomplete || !selectedNoteId) return;

      const before = body.slice(0, autocomplete.cursorStart);
      const after = body.slice(autocomplete.cursorEnd);
      const inserted = `[[${linkTitle}]]`;
      const nextBody = `${before}${inserted}${after}`;

      setBody(nextBody);
      setAutocomplete(null);
      await saveCurrentNote(nextBody);
    },
    [autocomplete, body, selectedNoteId, saveCurrentNote]
  );

  // Handle creating target note when link target does not exist
  const handleCreateTargetAndLink = useCallback(
    async (targetTitle: string) => {
      if (!targetTitle.trim()) return;
      const created = await createNote({ title: targetTitle.trim(), body: '' });
      await insertLink(created.title);
    },
    [insertLink]
  );

  const getNoteLabel = (n: NoteItem) => {
    if (n.title && n.title.trim()) return n.title;
    const firstLine = n.body.split('\n')[0].trim();
    return firstLine || t.notesEmpty;
  };

  return (
    <div className="flex flex-col h-full w-full select-none space-y-4 text-[var(--text)]">
      <ScreenHeader
        title={
          <div className="flex items-center gap-2">
            <FileText size={18} style={{ color: 'var(--accent)' }} />
            <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
              {t.titleNotes}
            </span>
            <span
              className="text-xs px-2 py-0.5 rounded-full font-mono font-medium"
              style={{
                backgroundColor: 'var(--elevated)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              {notes.length}
            </span>
          </div>
        }
        action={
          <button
            type="button"
            onClick={handleCreateNote}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] font-medium text-xs shadow-xs transition-opacity hover:opacity-90 bg-[var(--accent)] text-[var(--bg)]"
          >
            <Plus size={14} />
            <span>{t.notesNew}</span>
          </button>
        }
        className="pb-0"
      />

      <Card variant="surface" padding="none" className="flex flex-1 overflow-hidden min-h-0 relative border border-[var(--border)]">
        {/* Left Pane: Notes List / Vault Tree */}
        <div
          className={`flex flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-all duration-200 ${
            mobileShowList
              ? 'absolute inset-0 z-20 flex w-full md:relative md:w-64 lg:w-72'
              : 'hidden md:flex md:w-64 lg:w-72'
          }`}
        >
          {/* View mode toggle: Tree vs List */}
          <div className="flex border-b border-[var(--border)] bg-[var(--surface)] select-none">
            <button
              type="button"
              data-testid="notes-tab-tree"
              onClick={() => setSidebarMode('tree')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                sidebarMode === 'tree'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <Folder size={14} />
              <span>{t.vaultTitle}</span>
            </button>
            <button
              type="button"
              data-testid="notes-tab-list"
              onClick={() => setSidebarMode('list')}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer ${
                sidebarMode === 'list'
                  ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              <List size={14} />
              <span>{t.titleNotes}</span>
            </button>
          </div>

          {sidebarMode === 'tree' ? (
            <NotesTree
              currentPath={selectedPath}
              onSelectNote={handleSelectPath}
              onRefresh={handleRefreshNote}
              className="flex-1"
            />
          ) : (
            <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]/40">
              {loading ? (
                <div className="p-4 text-center text-xs text-[var(--text-muted)]">...</div>
              ) : notes.length === 0 ? (
                <div className="p-4">
                  <EmptyState
                    icon={<FileText className="w-8 h-8 text-[var(--text-faint)]" />}
                    title={t.notesEmpty}
                    action={
                      <button
                        type="button"
                        onClick={handleCreateNote}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] font-medium text-xs shadow-xs transition-opacity hover:opacity-90 bg-[var(--accent)] text-[var(--bg)]"
                      >
                        <Plus size={14} />
                        <span>{t.notesNew}</span>
                      </button>
                    }
                  />
                </div>
              ) : (
                notes.map((item) => {
                  const isSelected = item.id === selectedNoteId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        void handleSelectNoteItem(item);
                        setMobileShowList(false);
                      }}
                      className={`group relative flex w-full flex-col p-3 text-left transition-colors cursor-pointer ${
                        isSelected
                          ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                          : 'hover:bg-[var(--elevated)] text-[var(--text-muted)]'
                      }`}
                    >
                      <div className="flex w-full items-center justify-between">
                        <span
                          className={`truncate text-sm font-medium ${
                            isSelected ? 'text-[var(--accent)]' : 'text-[var(--text)]'
                          }`}
                        >
                          {getNoteLabel(item)}
                        </span>
                        {item.pinned && (
                          <Pin className="h-3.5 w-3.5 flex-shrink-0 text-[var(--accent)] ml-1" />
                        )}
                      </div>
                      <div className="mt-1 flex items-center justify-between text-xs text-[var(--text-muted)]">
                        <span className="truncate pr-2">
                          {item.body.split('\n')[0] || ''}
                        </span>
                        <span className="flex-shrink-0 text-[10px] text-[var(--text-faint)]">
                          {new Date(item.updatedAt).toLocaleDateString(undefined, {
                            month: 'numeric',
                            day: 'numeric',
                          })}
                        </span>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Right Pane: Editor & Backlinks */}
        <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--surface)]">
          {currentNote ? (
            <>
              {/* Editor Toolbar */}
              <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2 bg-[var(--surface)] select-none">
                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={() => setMobileShowList(true)}
                    className="flex items-center text-xs text-[var(--text-muted)] hover:text-[var(--text)] md:hidden cursor-pointer"
                  >
                    <ChevronLeft className="mr-1 h-4 w-4" />
                    {t.titleNotes}
                  </button>

                  {/* Broken link warning */}
                  {hasBrokenLink && (
                    <div className="flex items-center space-x-1 text-[var(--accent-amber,#F59E0B)] text-xs px-2 py-0.5 rounded-[6px] bg-[var(--elevated)] border border-[var(--accent-amber,#F59E0B)]/30">
                      <AlertTriangle className="h-3.5 w-3.5" />
                      <span>{t.notesBrokenLink}</span>
                    </div>
                  )}
                </div>

                <div className="flex items-center space-x-1">
                  {/* Refresh from disk */}
                  <IconButton
                    icon={<RefreshCw size={16} />}
                    label={t.vaultRefresh}
                    onClick={() => void handleRefreshNote()}
                  />

                  {/* Pin toggle */}
                  <IconButton
                    icon={currentNote.pinned ? <PinOff size={16} /> : <Pin size={16} />}
                    label={currentNote.pinned ? t.notesUnpin : t.notesPin}
                    active={currentNote.pinned}
                    onClick={() => handleTogglePin(currentNote.id)}
                  />

                  {/* Delete note */}
                  <IconButton
                    icon={<Trash2 size={16} />}
                    label={t.notesDelete}
                    onClick={() => handleDeleteNote(currentNote.id)}
                  />
                </div>
              </div>

              {/* External Modification Warning Banner (R08) */}
              {externalConflict && (
                <div
                  data-testid="vault-conflict-banner"
                  className="mx-4 mt-3 flex items-center justify-between p-3 rounded-[8px] bg-[var(--accent-amber,#F59E0B)]/15 border border-[var(--accent-amber,#F59E0B)]/40 text-xs text-[var(--text)]"
                >
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-[var(--accent-amber,#F59E0B)] flex-shrink-0" />
                    <div>
                      <div className="font-semibold">{t.vaultExternalChanged}</div>
                      <div className="text-[var(--text-muted)] text-[11px]">{t.notesUnsaved}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      data-testid="vault-reload-btn"
                      onClick={() => void handleReloadFromDisk()}
                      className="px-2.5 py-1 rounded-[6px] bg-[var(--surface)] hover:bg-[var(--elevated)] border border-[var(--border)] font-medium text-xs cursor-pointer"
                    >
                      {t.vaultReload}
                    </button>
                    <button
                      type="button"
                      data-testid="vault-keep-mine-btn"
                      onClick={() => void handleKeepMyVersion()}
                      className="px-2.5 py-1 rounded-[6px] bg-[var(--accent)] text-[var(--bg)] font-medium text-xs cursor-pointer hover:opacity-90"
                    >
                      {t.vaultKeepMine}
                    </button>
                  </div>
                </div>
              )}

              {/* Main Content Area */}
              <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6 space-y-3 select-text">
                {/* Title Input */}
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onBlur={() => void handleTitleBlur()}
                  placeholder={t.titleNotes}
                  className="w-full bg-transparent text-lg font-semibold tracking-tight text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
                />

                <Divider />

                {/* Body: Live-preview Markdown Editor (R05/R12) */}
                <div className="relative flex-1 min-h-[260px] flex flex-col">
                  {loadedNoteId === currentNote.id ? (
                    <NotesEditor
                      key={currentNote.id}
                      value={body}
                      onChange={handleBodyChange}
                      onSave={handleEditorSave}
                      placeholder={t.editorPlaceholder}
                      autoFocus
                      className="flex-1 min-h-[260px]"
                    />
                  ) : (
                    <div className="flex-1 p-4 text-xs text-[var(--text-muted)]">...</div>
                  )}
                  {/* Autocomplete Popup for [[ */}
                  {autocomplete && (
                    <div
                      data-testid="notes-autocomplete"
                      className="absolute left-4 top-16 z-30 w-72 rounded-[10px] border border-[var(--border)] bg-[var(--elevated)] shadow-lg overflow-hidden"
                    >
                      <div className="px-3 py-1.5 text-[11px] font-medium text-[var(--text-muted)] border-b border-[var(--border)]">
                        {t.notesLinkHint}
                      </div>
                      <div className="max-h-48 overflow-y-auto py-1">
                        {suggestions.length > 0 ? (
                          suggestions.map((suggestion, index) => {
                            const isSelected = index === autocomplete.selectedIndex;
                            return (
                              <button
                                key={suggestion}
                                type="button"
                                onClick={() => void insertLink(suggestion)}
                                className={`flex w-full items-center px-3 py-1.5 text-left text-xs ${
                                  isSelected
                                    ? 'bg-[var(--accent)] text-[var(--bg)]'
                                    : 'text-[var(--text)] hover:bg-[var(--surface-hover)]'
                                }`}
                              >
                                <LinkIcon className="mr-2 h-3.5 w-3.5 opacity-70" />
                                <span className="truncate">{suggestion}</span>
                              </button>
                            );
                          })
                        ) : (
                          <button
                            type="button"
                            onClick={() =>
                              void handleCreateTargetAndLink(autocomplete.query)
                            }
                            className="flex w-full items-center px-3 py-1.5 text-left text-xs bg-[var(--accent-soft)] text-[var(--accent)] hover:bg-[var(--accent)]/20"
                          >
                            <Plus className="mr-2 h-3.5 w-3.5" />
                            <span className="truncate">
                              {t.notesCreateTarget.replace(
                                '{title}',
                                autocomplete.query
                              )}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {/* Backlinks Panel */}
                <div data-testid="notes-backlinks-panel" className="mt-8 border-t border-[var(--border)] pt-4">
                  <div className="flex items-center space-x-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                    <LinkIcon className="h-3.5 w-3.5" />
                    <span>{t.notesBacklinks}</span>
                    {backlinks.length > 0 && (
                      <span className="rounded-full bg-[var(--elevated)] border border-[var(--border)] px-1.5 py-0.2 text-[10px]">
                        {backlinks.length}
                      </span>
                    )}
                  </div>

                  <div className="mt-2">
                    {backlinks.length === 0 ? (
                      <p className="text-xs text-[var(--text-muted)]">{t.notesNoBacklinks}</p>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {backlinks.map((bl) => (
                          <button
                            key={`${bl.kind}-${bl.id}`}
                            type="button"
                            onClick={() => {
                              if (bl.kind === 'note') {
                                const match = notes.find((n) => n.id === bl.id);
                                if (match) {
                                  void handleSelectNoteItem(match);
                                } else {
                                  void reloadNotes(bl.id);
                                }
                              }
                            }}
                            className="flex items-center space-x-1.5 rounded-[8px] border border-[var(--border)] bg-[var(--elevated)] px-2.5 py-1 text-xs text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors cursor-pointer"
                          >
                            <FileText className="h-3 w-3 text-[var(--text-muted)]" />
                            <span>{bl.title || t.titleNotes}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </>
          ) : (
            /* Empty state when no note is selected */
            <div className="flex h-full flex-1 flex-col items-center justify-center p-8">
              <EmptyState
                icon={<FileText className="w-10 h-10 text-[var(--text-faint)]" />}
                title={t.notesEmpty}
                action={
                  <button
                    type="button"
                    onClick={handleCreateNote}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] font-medium text-xs shadow-xs transition-opacity hover:opacity-90 bg-[var(--accent)] text-[var(--bg)]"
                  >
                    <Plus size={14} />
                    <span>{t.notesNew}</span>
                  </button>
                }
              />
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
