import React, { useEffect, useRef, useMemo } from 'react';
import clsx from 'clsx';
import { EditorState, Range, Compartment, Prec } from '@codemirror/state';
import {
  EditorView,
  ViewPlugin,
  Decoration,
  WidgetType,
  keymap,
  placeholder as cmPlaceholder,
  drawSelection,
  ViewUpdate,
  DecorationSet,
} from '@codemirror/view';
import { syntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { searchKeymap } from '@codemirror/search';

export interface NotesEditorProps {
  value: string;
  onChange: (markdown: string) => void;
  onSave?: (markdown: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
}

class CheckboxWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly pos: number
  ) {
    super();
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'cm-task-checkbox';
    input.checked = this.checked;
    input.setAttribute('aria-label', this.checked ? 'Completed task' : 'Incomplete task');

    input.addEventListener('click', (e) => {
      e.stopPropagation();
      const newChar = this.checked ? ' ' : 'x';
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: newChar },
      });
    });

    return input;
  }

  eq(other: CheckboxWidget): boolean {
    return this.checked === other.checked && this.pos === other.pos;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildLivePreview(view: EditorView): DecorationSet {
  const { state } = view;
  const items: Range<Decoration>[] = [];

  // Identify lines that contain the cursor / active selection
  const activeLines = new Set<number>();
  for (const range of state.selection.ranges) {
    const startLine = state.doc.lineAt(range.from).number;
    const endLine = state.doc.lineAt(range.to).number;
    for (let l = startLine; l <= endLine; l++) {
      activeLines.add(l);
    }
  }

  // 1. Line-level decorations (headings, blockquotes, checkboxes)
  for (let lineNum = 1; lineNum <= state.doc.lines; lineNum++) {
    const line = state.doc.line(lineNum);
    const lineText = line.text;
    const isActive = activeLines.has(lineNum);

    // Headings (# through ######)
    const headingMatch = lineText.match(/^(#{1,6})\s+/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      items.push(Decoration.line({ class: `cm-heading cm-heading-${level}` }).range(line.from));
      // Formatting mark for the '# ' symbols - dim when not on active line
      if (!isActive) {
        items.push(
          Decoration.mark({ class: 'cm-formatting-mark' }).range(
            line.from,
            line.from + headingMatch[0].length
          )
        );
      }
    }

    // Blockquote
    const quoteMatch = lineText.match(/^>\s*/);
    if (quoteMatch) {
      items.push(Decoration.line({ class: 'cm-blockquote-line' }).range(line.from));
      if (!isActive) {
        items.push(
          Decoration.mark({ class: 'cm-formatting-mark' }).range(
            line.from,
            line.from + quoteMatch[0].length
          )
        );
      }
    }

    // Task list checkboxes (- [ ] or - [x] or * [ ] or + [ ] or 1. [ ])
    const taskMatch = lineText.match(/^(\s*(?:[-*+]|\d+\.)\s*)\[([ xX])\]/);
    if (taskMatch) {
      const boxFrom = line.from + taskMatch[1].length;
      const boxTo = boxFrom + 3;
      const charPos = boxFrom + 1;
      const checked = taskMatch[2].toLowerCase() === 'x';
      items.push(
        Decoration.replace({
          widget: new CheckboxWidget(checked, charPos),
        }).range(boxFrom, boxTo)
      );
    }
  }

  // 2. Syntax-tree decorations (inline code, bold, italic, fenced code lines)
  const tree = syntaxTree(state);
  tree.iterate({
    enter(node) {
      const { name, from, to } = node;
      const nodeStartLine = state.doc.lineAt(from).number;
      const isActive = activeLines.has(nodeStartLine);

      if (name === 'FencedCode') {
        const startLine = state.doc.lineAt(from).number;
        const endLine = state.doc.lineAt(to).number;
        for (let l = startLine; l <= endLine; l++) {
          const lObj = state.doc.line(l);
          items.push(Decoration.line({ class: 'cm-fenced-code-line' }).range(lObj.from));
        }
      } else if (name === 'StrongEmphasis') {
        items.push(Decoration.mark({ class: 'cm-strong' }).range(from, to));
      } else if (name === 'Emphasis') {
        items.push(Decoration.mark({ class: 'cm-emphasis' }).range(from, to));
      } else if (name === 'InlineCode') {
        items.push(Decoration.mark({ class: 'cm-inline-code' }).range(from, to));
      } else if (name === 'EmphasisMark' || name === 'CodeMark') {
        if (!isActive) {
          items.push(Decoration.mark({ class: 'cm-formatting-mark' }).range(from, to));
        }
      }
    },
  });

  return Decoration.set(items, true);
}

const livePreviewPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = buildLivePreview(view);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildLivePreview(update.view);
      }
    }
  },
  {
    decorations: (v) => v.decorations,
  }
);

const editorTheme = EditorView.theme({
  '&': {
    color: 'var(--text, #ffffff)',
    backgroundColor: 'transparent',
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    fontSize: '0.9375rem',
    lineHeight: '1.65',
    userSelect: 'text',
    WebkitUserSelect: 'text',
    height: '100%',
  },
  '.cm-content': {
    caretColor: 'var(--accent, #ffffff)',
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    userSelect: 'text',
    WebkitUserSelect: 'text',
    padding: '16px 20px',
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--accent, #ffffff)',
    borderLeftWidth: '2px',
  },
  '&.cm-focused .cm-cursor': {
    borderLeftColor: 'var(--accent, #ffffff)',
  },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--accent-soft, rgba(255, 255, 255, 0.14)) !important',
  },
  '.cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '.cm-scroller': {
    fontFamily: 'inherit',
    lineHeight: '1.65',
    overflow: 'auto',
    userSelect: 'text',
    WebkitUserSelect: 'text',
  },
  '.cm-placeholder': {
    color: 'var(--text-faint, rgba(255, 255, 255, 0.25))',
    fontStyle: 'italic',
  },
  // Headings
  '.cm-heading': {
    fontWeight: '600',
    color: 'var(--text, #ffffff)',
  },
  '.cm-heading-1': {
    fontSize: '1.75rem',
    fontWeight: '700',
    lineHeight: '2.25rem',
    margin: '8px 0 4px 0',
  },
  '.cm-heading-2': {
    fontSize: '1.375rem',
    fontWeight: '600',
    lineHeight: '1.875rem',
    margin: '6px 0 4px 0',
  },
  '.cm-heading-3': {
    fontSize: '1.125rem',
    fontWeight: '600',
    lineHeight: '1.625rem',
    margin: '4px 0 2px 0',
  },
  '.cm-heading-4, .cm-heading-5, .cm-heading-6': {
    fontSize: '1rem',
    fontWeight: '600',
    lineHeight: '1.5rem',
  },
  // Inline styles
  '.cm-strong': {
    fontWeight: '700',
    color: 'var(--text, #ffffff)',
  },
  '.cm-emphasis': {
    fontStyle: 'italic',
    color: 'var(--text, #ffffff)',
  },
  '.cm-inline-code': {
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    fontSize: '0.85em',
    backgroundColor: 'var(--elevated, rgba(255, 255, 255, 0.08))',
    color: 'var(--accent, #ffffff)',
    padding: '2px 5px',
    borderRadius: '4px',
    border: '1px solid var(--border, rgba(255, 255, 255, 0.12))',
  },
  '.cm-fenced-code-line': {
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    fontSize: '0.85em',
    backgroundColor: 'var(--surface, #0a0a0c)',
    paddingLeft: '14px',
    paddingRight: '14px',
  },
  '.cm-blockquote-line': {
    borderLeft: '3px solid var(--border-strong, rgba(255, 255, 255, 0.3))',
    paddingLeft: '14px',
    color: 'var(--text-muted, rgba(255, 255, 255, 0.55))',
    fontStyle: 'italic',
  },
  '.cm-formatting-mark': {
    color: 'var(--text-faint, rgba(255, 255, 255, 0.25))',
    opacity: '0.4',
    fontWeight: '400',
    fontStyle: 'normal',
  },
  '.cm-task-checkbox': {
    appearance: 'none',
    WebkitAppearance: 'none',
    width: '15px',
    height: '15px',
    border: '1.5px solid var(--border-strong, rgba(255, 255, 255, 0.35))',
    borderRadius: '4px',
    backgroundColor: 'transparent',
    cursor: 'pointer',
    verticalAlign: '-2px',
    marginRight: '8px',
    position: 'relative',
    display: 'inline-block',
    outline: 'none',
    transition: 'background-color 0.12s, border-color 0.12s',
  },
  '.cm-task-checkbox:checked': {
    backgroundColor: 'var(--accent, #ffffff)',
    borderColor: 'var(--accent, #ffffff)',
  },
  '.cm-task-checkbox:checked::after': {
    content: '""',
    position: 'absolute',
    left: '4px',
    top: '1px',
    width: '4px',
    height: '8px',
    border: 'solid var(--accent-contrast, #000000)',
    borderWidth: '0 2px 2px 0',
    transform: 'rotate(45deg)',
  },
  '.cm-task-checkbox:focus-visible': {
    outline: '2px solid var(--accent, #ffffff)',
    outlineOffset: '2px',
  },
});

export function NotesEditor({
  value,
  onChange,
  onSave,
  placeholder,
  autoFocus,
  className,
}: NotesEditorProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSaveRef = useRef(onSave);
  const lastValueRef = useRef(value);

  const placeholderCompartment = useMemo(() => new Compartment(), []);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    onSaveRef.current = onSave;
  }, [onSave]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const saveKeymap = Prec.highest(
      keymap.of([
        {
          key: 'Mod-s',
          run: (view: EditorView) => {
            onSaveRef.current?.(view.state.doc.toString());
            return true;
          },
        },
      ])
    );

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const docString = update.state.doc.toString();
        lastValueRef.current = docString;
        onChangeRef.current?.(docString);
      }
    });

    const domHandlers = EditorView.domEventHandlers({
      blur: (_event, view) => {
        onSaveRef.current?.(view.state.doc.toString());
      },
    });

    const startState = EditorState.create({
      doc: value,
      extensions: [
        editorTheme,
        EditorView.lineWrapping,
        history(),
        drawSelection(),
        saveKeymap,
        keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab]),
        markdown({ base: markdownLanguage }),
        livePreviewPlugin,
        updateListener,
        domHandlers,
        placeholderCompartment.of(placeholder ? cmPlaceholder(placeholder) : []),
      ],
    });

    const view = new EditorView({
      state: startState,
      parent: container,
    });

    viewRef.current = view;
    lastValueRef.current = value;

    if (autoFocus) {
      view.focus();
    }

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (value === lastValueRef.current) return;
    const currentDoc = view.state.doc.toString();
    if (value !== currentDoc) {
      lastValueRef.current = value;
      view.dispatch({
        changes: { from: 0, to: currentDoc.length, insert: value },
      });
    }
  }, [value]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: placeholderCompartment.reconfigure(
        placeholder ? cmPlaceholder(placeholder) : []
      ),
    });
  }, [placeholder, placeholderCompartment]);

  return (
    <div
      ref={containerRef}
      className={clsx(
        'relative w-full h-full min-h-[120px] select-text overflow-hidden',
        className
      )}
      style={{
        userSelect: 'text',
        WebkitUserSelect: 'text',
      }}
      data-testid="notes-editor"
    />
  );
}
