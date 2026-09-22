import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  Plus,
  Trash2,
  Pin,
  PinOff,
  Eye,
  Edit3,
  FileText,
  Link as LinkIcon,
  AlertTriangle,
  ChevronLeft,
} from 'lucide-react';
import {
  listNotes,
  createNote,
  updateNote,
  deleteNote,
  togglePin,
  noteByTitle,
} from '../services/notes';
import { parseLinks, upsertLinks, backlinksOf, type LinkRef, type BacklinkItem } from '../services/linking';
import { renderMarkdown } from '../services/markdown';
import { I18nService } from '../services/i18n';
import { IconButton } from './ui';
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
  const [loading, setLoading] = useState(true);

  // Editor states
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [isPreview, setIsPreview] = useState(false);
  const [backlinks, setBacklinks] = useState<BacklinkItem[]>([]);

  /**
   * The note+body combination whose links were found to be broken.
   *
   * Keeping the key rather than a flag makes the answer follow the text: editing
   * the body invalidates it by construction, so no effect has to clear it.
   */
  const [brokenForKey, setBrokenForKey] = useState<string | null>(null);

  // Mobile / narrow view list collapse state
  const [mobileShowList, setMobileShowList] = useState(false);

  // Autocomplete state
  const [autocomplete, setAutocomplete] = useState<AutocompleteState | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Keep track of the currently loaded note to avoid overwriting on note switch
  const currentNote = useMemo(
    () => notes.find((n) => n.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  // Reload notes list
  const reloadNotes = useCallback(async (preserveSelectedId?: string | null) => {
    try {
      const items = await listNotes();
      setNotes(items);
      let nextId: string | null = null;
      setSelectedNoteId((prev) => {
        const targetId = preserveSelectedId !== undefined ? preserveSelectedId : prev;
        if (targetId && items.some((n) => n.id === targetId)) {
          nextId = targetId;
          return targetId;
        }
        nextId = items.length > 0 ? items[0].id : null;
        return nextId;
      });
      const active = items.find((n) => n.id === (preserveSelectedId !== undefined ? preserveSelectedId : items[0]?.id)) ?? null;
      if (active) {
        setTitle(active.title || '');
        setBody(active.body || '');
        void backlinksOf('note', active.id).then((bl) => {
          setBacklinks(bl || []);
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load
  useEffect(() => {
    void reloadNotes();
  }, [reloadNotes]);

  /**
   * The editor's draft follows the selected note, but only until the user types.
   *
   * This is React's "adjusting state when a prop changes" pattern: the comparison
   * happens during render, so switching notes shows the new text immediately. An
   * effect would paint the previous note's body for one frame and then correct
   * itself, which is both a flash and a cascading render.
   */
  const [editedNoteId, setEditedNoteId] = useState<string | null>(null);
  if (currentNote && editedNoteId !== currentNote.id) {
    setEditedNoteId(currentNote.id);
    setTitle(currentNote.title || '');
    setBody(currentNote.body || '');
    setIsPreview(false);
    setAutocomplete(null);
  }
  if (!currentNote && editedNoteId !== null) {
    setEditedNoteId(null);
    setTitle('');
    setBody('');
    setBacklinks([]);
    setAutocomplete(null);
  }

  // Backlinks for the note on screen. Only the completion writes state.
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
        setSelectedNoteId(targetId);
        setMobileShowList(false);
      }
    };
    window.addEventListener('tempo:reveal', handleReveal);
    return () => window.removeEventListener('tempo:reveal', handleReveal);
  }, []);

  // Check broken links and persist links whenever body changes / blurs
  const syncLinks = useCallback(
    async (noteId: string, markdownText: string) => {
      const titles = parseLinks(markdownText);
      const validLinks: LinkRef[] = [];

      for (const linkTitle of titles) {
        const found = await noteByTitle(linkTitle);
        if (found && found.id) {
          validLinks.push({ kind: 'note', id: found.id });
        }
        // A title that matches nothing is not linked, but its text stays in the
        // body: the broken-link indicator is derived from the text, not from here.
      }

      await upsertLinks({ kind: 'note', id: noteId }, validLinks);
    },
    []
  );

  /** Whether the body on screen has a link that leads nowhere. */
  const linkCheckKey = currentNote ? `${currentNote.id}:${body}` : null;
  const hasBrokenLink = linkCheckKey !== null && brokenForKey === linkCheckKey;

  // Initial check of broken links whenever body or note changes
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

  // Create new note
  const handleCreateNote = async () => {
    const newNote = await createNote({ title: '', body: '' });
    await reloadNotes(newNote.id);
    setMobileShowList(false);
  };

  // Delete current note
  const handleDeleteNote = async (id: string) => {
    await deleteNote(id);
    await reloadNotes();
  };

  // Toggle pin
  const handleTogglePin = async (id: string) => {
    await togglePin(id);
    await reloadNotes();
  };

  // Title save on blur
  const handleTitleBlur = async () => {
    if (!currentNote) return;
    if (title !== currentNote.title) {
      await updateNote(currentNote.id, { title });
      await reloadNotes(currentNote.id);
    }
  };

  // Body save on blur
  const handleBodyBlur = async () => {
    if (!currentNote) return;
    if (body !== currentNote.body) {
      await updateNote(currentNote.id, { body });
      await syncLinks(currentNote.id, body);
      await reloadNotes(currentNote.id);
    }
  };

  // Check for `[[` autocomplete on body textarea change
  const handleBodyChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newBody = e.target.value;
    const cursorPos =
      typeof e.target.selectionStart === 'number'
        ? e.target.selectionStart
        : newBody.length;
    setBody(newBody);

    // Look backward from cursor for open `[[`
    const textBeforeCursor = newBody.slice(0, cursorPos);
    const lastOpenIndex = textBeforeCursor.lastIndexOf('[[');

    if (lastOpenIndex !== -1) {
      const queryText = textBeforeCursor.slice(lastOpenIndex + 2);
      // Autocomplete valid if no newline or closing `]]` between `[[` and cursor
      if (!queryText.includes('\n') && !queryText.includes(']]')) {
        setAutocomplete({
          active: true,
          query: queryText,
          cursorStart: lastOpenIndex,
          cursorEnd: cursorPos,
          selectedIndex: 0,
        });
        return;
      }
    }

    setAutocomplete(null);
  };

  // Autocomplete filtered suggestions
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
      if (!autocomplete || !currentNote) return;

      const before = body.slice(0, autocomplete.cursorStart);
      const after = body.slice(autocomplete.cursorEnd);
      const inserted = `[[${linkTitle}]]`;
      const nextBody = `${before}${inserted}${after}`;

      setBody(nextBody);
      setAutocomplete(null);

      // Save to note
      await updateNote(currentNote.id, { body: nextBody });
      await syncLinks(currentNote.id, nextBody);
      await reloadNotes(currentNote.id);

      // Focus textarea and set cursor after `]]`
      const newCursorPos = autocomplete.cursorStart + inserted.length;
      setTimeout(() => {
        if (textareaRef.current) {
          textareaRef.current.focus();
          textareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
        }
      }, 0);
    },
    [autocomplete, body, currentNote, syncLinks, reloadNotes]
  );

  // Handle creating target note when link target does not exist
  const handleCreateTargetAndLink = useCallback(
    async (targetTitle: string) => {
      if (!targetTitle.trim() || !currentNote) return;
      const created = await createNote({ title: targetTitle.trim(), body: '' });
      await insertLink(created.title);
    },
    [currentNote, insertLink]
  );

  // Keyboard navigation for autocomplete popup
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!autocomplete) return;

    const totalItems = suggestions.length > 0 ? suggestions.length : 1; // 1 for "Create note" item

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAutocomplete((prev) =>
        prev ? { ...prev, selectedIndex: (prev.selectedIndex + 1) % totalItems } : null
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAutocomplete((prev) =>
        prev
          ? {
              ...prev,
              selectedIndex: (prev.selectedIndex - 1 + totalItems) % totalItems,
            }
          : null
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (suggestions.length > 0) {
        const item = suggestions[autocomplete.selectedIndex] ?? suggestions[0];
        void insertLink(item);
      } else {
        // Create note target
        void handleCreateTargetAndLink(autocomplete.query);
      }
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setAutocomplete(null);
    }
  };

  // Helper to format item label
  const getNoteLabel = (n: NoteItem) => {
    if (n.title && n.title.trim()) return n.title;
    const firstLine = n.body.split('\n')[0].trim();
    return firstLine || t.notesEmpty;
  };

  return (
    <div className="flex h-full w-full overflow-hidden bg-[var(--bg)] text-[var(--text)]">
      {/* Left Pane: Notes List (collapses on narrow screens) */}
      <div
        className={`flex flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-all duration-200
          ${
            mobileShowList
              ? 'absolute inset-0 z-20 flex w-full md:relative md:w-64 lg:w-72'
              : 'hidden md:flex md:w-64 lg:w-72'
          }`}
      >
        {/* Header with New Note button */}
        <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
          <div className="flex items-center space-x-2">
            <FileText className="h-4 w-4 text-[var(--accent)]" />
            <span className="text-sm font-semibold tracking-tight text-[var(--text)]">
              {t.titleNotes}
            </span>
            <span className="rounded-full bg-[var(--elevated)] border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--text-muted)]">
              {notes.length}
            </span>
          </div>
          <IconButton
            icon={<Plus size={16} />}
            label={t.notesNew}
            onClick={handleCreateNote}
          />
        </div>

        {/* Notes Items List */}
        <div className="flex-1 overflow-y-auto divide-y divide-[var(--border)]/30">
          {loading ? (
            <div className="p-4 text-center text-xs text-[var(--text-muted)]">...</div>
          ) : notes.length === 0 ? (
            <div className="p-8 text-center text-xs text-[var(--text-muted)]">
              {t.notesEmpty}
            </div>
          ) : (
            notes.map((item) => {
              const isSelected = item.id === selectedNoteId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setSelectedNoteId(item.id);
                    setMobileShowList(false);
                  }}
                  className={`group relative flex w-full flex-col p-3 text-left transition-colors ${
                    isSelected
                      ? 'bg-[var(--accent-soft)] text-[var(--text)]'
                      : 'hover:bg-[var(--surface-hover)] text-[var(--text-muted)]'
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
                    <span className="flex-shrink-0 text-[10px]">
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
      </div>

      {/* Right Pane: Selected Note Editor / Preview & Backlinks */}
      <div className="relative flex flex-1 flex-col overflow-hidden bg-[var(--bg)]">
        {currentNote ? (
          <>
            {/* Editor Toolbar */}
            <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-2 bg-[var(--surface)] select-none">
              <div className="flex items-center space-x-2">
                {/* Back to list on narrow viewport */}
                <button
                  type="button"
                  onClick={() => setMobileShowList(true)}
                  className="flex items-center text-xs text-[var(--text-muted)] hover:text-[var(--text)] md:hidden"
                >
                  <ChevronLeft className="mr-1 h-4 w-4" />
                  {t.titleNotes}
                </button>

                {/* Broken link warning */}
                {hasBrokenLink && (
                  <div className="flex items-center space-x-1 text-[var(--phase-focus,#F59E0B)] text-xs px-2 py-0.5 rounded-md bg-[var(--phase-focus,#F59E0B)]/10 border border-[var(--phase-focus,#F59E0B)]/20">
                    <AlertTriangle className="h-3.5 w-3.5" />
                    <span>{t.notesBrokenLink}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center space-x-1">
                {/* Preview toggle */}
                <IconButton
                  icon={isPreview ? <Edit3 size={16} /> : <Eye size={16} />}
                  label={t.notesPreview}
                  active={isPreview}
                  onClick={() => setIsPreview(!isPreview)}
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

            {/* Main Content Area */}
            <div className="flex flex-1 flex-col overflow-y-auto p-4 md:p-6 space-y-4">
              {/* Title Input */}
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={handleTitleBlur}
                placeholder={t.titleNotes}
                className="w-full bg-transparent text-lg font-semibold tracking-tight text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
              />

              {/* Body: Edit or Preview */}
              <div className="relative flex-1 min-h-[220px]">
                {isPreview ? (
                  <div
                    data-testid="notes-markdown-preview"
                    className="prose dark:prose-invert max-w-none text-[var(--text)] leading-relaxed"
                  >
                    {renderMarkdown(body, 'preview-')}
                  </div>
                ) : (
                  <>
                    <textarea
                      ref={textareaRef}
                      value={body}
                      onChange={handleBodyChange}
                      onBlur={handleBodyBlur}
                      onKeyDown={handleKeyDown}
                      placeholder={t.notesBody}
                      className="h-full min-h-[260px] w-full resize-none bg-transparent font-mono text-sm leading-relaxed text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none"
                    />

                    {/* Autocomplete Popup */}
                    {autocomplete && (
                      <div
                        data-testid="notes-autocomplete"
                        className="absolute left-4 top-16 z-30 w-72 rounded-[10px] border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden"
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
                  </>
                )}
              </div>

              {/* Backlinks Panel */}
              <div data-testid="notes-backlinks-panel" className="mt-8 border-t border-[var(--border)] pt-4">
                <div className="flex items-center space-x-2 text-xs font-medium uppercase tracking-wider text-[var(--text-muted)]">
                  <LinkIcon className="h-3.5 w-3.5" />
                  <span>{t.notesBacklinks}</span>
                  {backlinks.length > 0 && (
                    <span className="rounded-full bg-[var(--border)]/40 px-1.5 py-0.2 text-[10px]">
                      {backlinks.length}
                    </span>
                  )}
                </div>

                <div className="mt-2">
                  {backlinks.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)]/60">{t.notesNoBacklinks}</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {backlinks.map((bl) => (
                        <button
                          key={`${bl.kind}-${bl.id}`}
                          type="button"
                          onClick={() => {
                            if (bl.kind === 'note') {
                              setSelectedNoteId(bl.id);
                            }
                          }}
                          className="flex items-center space-x-1.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors"
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
          /* Empty state when no note is selected or exist */
          <div className="flex h-full flex-col items-center justify-center p-8 text-center">
            <FileText className="h-10 w-10 text-[var(--text-faint)] mb-3" />
            <p className="text-sm font-medium text-[var(--text)]">{t.notesEmpty}</p>
            <div className="mt-4">
              <IconButton
                icon={<Plus size={16} />}
                label={t.notesNew}
                onClick={handleCreateNote}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
