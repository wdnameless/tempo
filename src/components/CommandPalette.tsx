import { useState, useEffect, useRef, ReactElement } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { I18nService } from '../services/i18n';
import {
  SearchHit,
  SearchSource,
  Command,
  listCommands,
  listSearchSources,
  searchAll,
} from '../services/search';
import { Kbd } from './ui/Kbd';

interface HighlightMatchProps {
  text: string;
  query: string;
}

/**
 * Escapes characters with special meaning in regular expressions.
 */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Translates a key using I18nService, falling back to the raw key if not found.
 */
function translate(key: string): string {
  const t = I18nService.t();
  if (key in t) {
    // SAFETY: Dynamic translation key lookup from command metadata
    const val = (t as unknown as Record<string, unknown>)[key];
    if (typeof val === 'string') {
      return val;
    }
  }
  return key;
}

/**
 * Renders text with matched query substrings wrapped in <mark> tags.
 * Pure text rendering without inner HTML injection to maintain strict CSP security.
 */
export function HighlightMatch({ text, query }: HighlightMatchProps): ReactElement {
  const q = query.trim();
  if (!q) {
    return <>{text}</>;
  }

  const escaped = escapeRegex(q);
  const regex = new RegExp(`(${escaped})`, 'gi');
  const parts = text.split(regex);

  return (
    <>
      {parts.map((part, index) => {
        if (part.toLowerCase() === q.toLowerCase()) {
          return (
            <mark
              key={index}
              className="bg-transparent font-semibold"
              style={{ color: 'var(--accent)' }}
            >
              {part}
            </mark>
          );
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

type PaletteItem =
  | {
      type: 'command';
      id: string;
      item: Command;
      title: string;
      hint?: string;
    }
  | {
      type: 'hit';
      id: string;
      item: SearchHit;
      source?: SearchSource;
      title: string;
      hint?: string;
    };

interface ItemGroup {
  id: string;
  label: string;
  items: PaletteItem[];
}

export function CommandPalette(): ReactElement | null {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  /**
   * Hits together with the query they answer.
   *
   * Keeping them tied like this means a stale answer stops being shown the moment
   * the query moves on, without an effect clearing state on every keystroke —
   * which is a cascading render and the reason this was a lint error.
   */
  const [resultsFor, setResultsFor] = useState<{ query: string; hits: SearchHit[] }>({
    query: '',
    hits: [],
  });
  const [selectedIndex, setSelectedIndex] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const t = I18nService.t();

  // Listen for tempo:spotlight event to toggle/open palette
  useEffect(() => {
    const handleSpotlight = () => {
      setIsOpen((prev) => {
        if (!prev) {
          // Opening starts a fresh search: the results are keyed by query, so
          // clearing the query clears what is shown.
          setQuery('');
          setResultsFor({ query: '', hits: [] });
          setSelectedIndex(0);
        }
        return !prev;
      });
    };

    window.addEventListener('tempo:spotlight', handleSpotlight);
    return () => {
      window.removeEventListener('tempo:spotlight', handleSpotlight);
    };
  }, []);

  // Keyboard navigation & global shortcuts when open
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setIsOpen(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isOpen]);

  // Autofocus input when opened
  useEffect(() => {
    if (isOpen) {
      // Small timeout to ensure DOM mount and focus
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 20);
      return () => clearTimeout(timer);
    }
  }, [isOpen]);

  // Execute full-text search when query changes. Only the async completion sets
  // state; everything the render needs is derived below.
  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    let isCurrent = true;

    searchAll(trimmed)
      .then((hits) => {
        if (isCurrent) setResultsFor({ query: trimmed, hits });
      })
      .catch((err) => {
        if (isCurrent) {
          console.error('[CommandPalette] searchAll failed:', err);
          setResultsFor({ query: trimmed, hits: [] });
        }
      });

    return () => {
      isCurrent = false;
    };
  }, [query]);

  /** The hits that belong to the query on screen; empty while a new one is in flight. */
  const trimmedQuery = query.trim();
  const isSearching = trimmedQuery !== '' && resultsFor.query !== trimmedQuery;

  // Prepare commands and search sources
  // Read per render, not memoised: the registry is filled by a startup effect
  // that runs after this component's first render, so a memo would cache it empty.
  const commands = listCommands();
  const sources = listSearchSources();

  // Build grouped items according to whether query is empty or present
  const groups: ItemGroup[] = (() => {
    // Hits for the query currently on screen: a late answer for an abandoned
    // query is ignored rather than flashed.
    const searchResults = resultsFor.query === trimmedQuery ? resultsFor.hits : [];
    const trimmed = query.trim().toLowerCase();
    const resultGroups: ItemGroup[] = [];

    // Filter commands by substring
    const filteredCommands = commands.filter((cmd) => {
      if (!trimmed) return true;
      const title = translate(cmd.titleKey).toLowerCase();
      const hint = cmd.hintKey ? translate(cmd.hintKey).toLowerCase() : '';
      return title.includes(trimmed) || hint.includes(trimmed) || cmd.id.toLowerCase().includes(trimmed);
    });

    if (filteredCommands.length > 0) {
      resultGroups.push({
        id: 'commands',
        label: t.searchGroupCommands,
        items: filteredCommands.map((cmd) => ({
          type: 'command',
          id: `cmd:${cmd.id}`,
          item: cmd,
          title: translate(cmd.titleKey),
          hint: cmd.hintKey ? translate(cmd.hintKey) : undefined,
        })),
      });
    }

    // When query is present, group content hits by source kind
    if (trimmed && searchResults.length > 0) {
      const hitsByKind = new Map<string, SearchHit[]>();
      for (const hit of searchResults) {
        const list = hitsByKind.get(hit.kind) ?? [];
        list.push(hit);
        hitsByKind.set(hit.kind, list);
      }

      // First add registered sources in their registered order
      const processedKinds = new Set<string>();
      for (const src of sources) {
        const hits = hitsByKind.get(src.kind);
        if (hits && hits.length > 0) {
          processedKinds.add(src.kind);
          resultGroups.push({
            id: `source:${src.kind}`,
            label: translate(src.labelKey),
            items: hits.map((hit) => ({
              type: 'hit',
              id: `hit:${hit.kind}:${hit.row_id}`,
              item: hit,
              source: src,
              title: hit.title,
              hint: hit.body,
            })),
          });
        }
      }

      // Add any additional kinds from search results not explicitly in sources registry
      for (const [kind, hits] of hitsByKind.entries()) {
        if (!processedKinds.has(kind) && hits.length > 0) {
          resultGroups.push({
            id: `source:${kind}`,
            label: kind,
            items: hits.map((hit) => ({
              type: 'hit',
              id: `hit:${hit.kind}:${hit.row_id}`,
              item: hit,
              title: hit.title,
              hint: hit.body,
            })),
          });
        }
      }
    }

    return resultGroups;
  })();

  // Flattened items for keyboard indexing
  const flatItems = groups.flatMap((g) => g.items);

  // Clamped where it is used: a shorter list must not point past its end, and
  // writing the clamp back into state would re-render on every list change.
  const activeIndex = flatItems.length === 0 ? 0 : Math.min(selectedIndex, flatItems.length - 1);

  // Scroll active item into view
  useEffect(() => {
    if (!listRef.current || flatItems.length === 0) return;
    const activeEl = listRef.current.querySelector<HTMLElement>('[data-active="true"]');
    if (activeEl) {
      activeEl.scrollIntoView({ block: 'nearest' });
    }
  }, [activeIndex, flatItems]);

  const executeItem = (item: PaletteItem) => {
    setIsOpen(false);
    if (item.type === 'command') {
      try {
        void item.item.run();
      } catch (err) {
        console.error('[CommandPalette] Command execution error:', err);
      }
    } else {
      if (item.source && item.source.open) {
        try {
          item.source.open(item.item);
        } catch (err) {
          console.error('[CommandPalette] Source open error:', err);
        }
      }
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (flatItems.length > 0) {
        setSelectedIndex((prev) => (prev + 1) % flatItems.length);
      }
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (flatItems.length > 0) {
        setSelectedIndex((prev) => (prev - 1 + flatItems.length) % flatItems.length);
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const current = flatItems[activeIndex];
      if (current) {
        executeItem(current);
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  let cumulativeIndex = 0;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t.paletteDialogLabel}
      data-testid="command-palette-dialog"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] px-4 pointer-events-auto select-none"
    >
      {/* Backdrop */}
      <div
        data-testid="command-palette-backdrop"
        className="fixed inset-0 transition-opacity bg-black/60 backdrop-blur-xs"
        onClick={() => setIsOpen(false)}
      />

      {/* Palette Container */}
      <div
        className="relative w-full max-w-[620px] flex flex-col rounded-xl overflow-hidden shadow-2xl border transition-all duration-150 animate-in fade-in zoom-in-95"
        style={{
          backgroundColor: 'var(--elevated)',
          borderColor: 'var(--border)',
          color: 'var(--text)',
        }}
      >
        {/* Search Input Box */}
        <div
          className="flex items-center gap-3 px-4 py-3.5 border-b"
          style={{ borderColor: 'var(--border)' }}
        >
          {isSearching ? (
            <Loader2
              className="w-5 h-5 animate-spin"
              style={{ color: 'var(--accent)' }}
              aria-hidden="true"
            />
          ) : (
            <Search
              className="w-5 h-5"
              style={{ color: 'var(--text-muted)' }}
              aria-hidden="true"
            />
          )}

          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls="command-palette-results"
            className="flex-1 bg-transparent border-0 outline-hidden text-[15px] leading-relaxed placeholder:text-muted focus:ring-0 focus:outline-hidden"
            style={{ color: 'var(--text)' }}
            placeholder={t.searchPlaceholder}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            onKeyDown={handleInputKeyDown}
          />

          <Kbd keys={['Esc']} />
        </div>

        {/* Results List */}
        <div
          id="command-palette-results"
          data-testid="command-palette-results"
          ref={listRef}
          role="listbox"
          className="max-h-[380px] overflow-y-auto py-2 px-1.5 focus:outline-hidden space-y-3"
        >
          {flatItems.length === 0 ? (
            <div
              className="py-12 text-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              {query.trim() ? t.searchNoResults : t.searchEmpty}
            </div>
          ) : (
            groups.map((group) => {
              const groupStartIndex = cumulativeIndex;
              cumulativeIndex += group.items.length;

              return (
                <div key={group.id} className="space-y-1">
                  {/* Group Header */}
                  <div
                    className="px-3 py-1 text-xs font-semibold uppercase tracking-wider select-none"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {group.label}
                  </div>

                  {/* Group Items */}
                  <div className="space-y-0.5">
                    {group.items.map((item, itemOffset) => {
                      const itemIndex = groupStartIndex + itemOffset;
                      const isSelected = itemIndex === activeIndex;

                      const Icon =
                        item.type === 'command'
                          ? item.item.icon
                          : item.source?.icon || Search;

                      return (
                        <div
                          key={item.id}
                          role="option"
                          id={`palette-item-${itemIndex}`}
                          aria-selected={isSelected}
                          data-active={isSelected ? 'true' : 'false'}
                          onClick={() => executeItem(item)}
                          onMouseEnter={() => setSelectedIndex(itemIndex)}
                          className="flex items-center justify-between px-3 py-2 rounded-lg cursor-pointer transition-colors duration-100 text-sm"
                          style={{
                            backgroundColor: isSelected
                              ? 'var(--surface)'
                              : 'transparent',
                            color: isSelected
                              ? 'var(--text)'
                              : 'var(--text)',
                          }}
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <Icon
                              className="w-4 h-4 shrink-0"
                              style={{
                                color: isSelected
                                  ? 'var(--accent)'
                                  : 'var(--text-muted)',
                              }}
                              aria-hidden="true"
                            />
                            <span className="truncate">
                              <HighlightMatch
                                text={item.title}
                                query={query}
                              />
                            </span>
                          </div>

                          <div className="flex items-center gap-2 ml-3 shrink-0">
                            {item.hint && (
                              <span
                                className="text-xs truncate max-w-[160px]"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {item.hint}
                              </span>
                            )}
                            {item.type === 'command' && item.item.keys && (
                              <Kbd keys={item.item.keys} />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Footer info bar */}
        <div
          className="flex items-center justify-between px-4 py-2 border-t text-xs select-none"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--surface)',
            color: 'var(--text-muted)',
          }}
        >
          <div className="flex items-center gap-2">
            <span>↑↓</span>
            <span>Навигация</span>
          </div>
          <div className="flex items-center gap-2">
            <Kbd keys={['↵']} />
            <span>Выбрать</span>
          </div>
        </div>
      </div>
    </div>
  );
}
