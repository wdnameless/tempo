import React, { useMemo, useState } from 'react';
import { Plus, Trash2, Pin, PinOff, Edit3 } from 'lucide-react';
import type { AlarmItem, NoteItem, ThemeColors } from '../types';
import { renderMarkdown } from '../services/markdown';
import { soundService } from '../services/sound';

interface NotesViewProps {
  theme: ThemeColors;
  notes: NoteItem[];
  onUpdateNotes: (notes: NoteItem[]) => void;
  alarms?: AlarmItem[];
}

let noteSeq = 0;
function createNoteId(): string {
  noteSeq += 1;
  return `note_${Date.now()}_${noteSeq}`;
}

/** Human label for what a note is attached to. */
function attachmentLabel(note: NoteItem): string | null {
  if (note.alarmId) return 'будильник';
  return null;
}

/**
 * A place to write things down.
 *
 * Notes are written in a small Markdown subset — headings, emphasis, lists,
 * code, links — and rendered readably. They can stand alone, hang on a specific
 * alarm, or hang on a step of a program, so "записать важное" and "описание к
 * уведомлению" are the same feature at different scopes.
 */
export const NotesView: React.FC<NotesViewProps> = ({
  theme,
  notes,
  onUpdateNotes,
  alarms = [],
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [attachTo, setAttachTo] = useState<string>('none');

  const sorted = useMemo(
    () =>
      [...notes].sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return b.updatedAt.localeCompare(a.updatedAt);
      }),
    [notes],
  );

  const editing = notes.find((n) => n.id === editingId) ?? null;

  /** Starts a fresh note, or loads the selected one into the editor. */
  const beginEdit = (note: NoteItem | null) => {
    soundService.playCountdownTick();
    setEditingId(note ? note.id : 'new');
    setTitle(note?.title ?? '');
    setBody(note?.body ?? '');
    setAttachTo(note?.alarmId ? `alarm:${note.alarmId}` : 'none');
  };

  const save = () => {
    if (!title.trim() && !body.trim()) return;
    soundService.playCountdownTick();
    const now = new Date().toISOString();

    const attachment = parseAttachment(attachTo);
    if (editingId && editingId !== 'new' && editing) {
      onUpdateNotes(
        notes.map((n) =>
          n.id === editingId
            ? { ...n, title: title.trim(), body, ...attachment, updatedAt: now }
            : n,
        ),
      );
    } else {
      onUpdateNotes([
        ...notes,
        {
          id: createNoteId(),
          title: title.trim(),
          body,
          pinned: false,
          ...attachment,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    }
    setEditingId(null);
    setTitle('');
    setBody('');
    setAttachTo('none');
  };

  const remove = (id: string) => {
    soundService.playCountdownTick();
    onUpdateNotes(notes.filter((n) => n.id !== id));
    if (editingId === id) setEditingId(null);
  };

  const togglePin = (id: string) => {
    soundService.playCountdownTick();
    onUpdateNotes(notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n)));
  };

  /** "none" | "alarm:<id>" → attachment fields. */
  function parseAttachment(value: string): Pick<NoteItem, 'alarmId' | 'scheduleId'> {
    if (value.startsWith('alarm:')) {
      return { alarmId: value.slice('alarm:'.length), scheduleId: undefined };
    }
    return { alarmId: undefined, scheduleId: undefined };
  }

  const attachOptions = useMemo(() => {
    const options: Array<{ value: string; label: string }> = [{ value: 'none', label: 'Без привязки' }];
    for (const alarm of alarms) {
      options.push({ value: `alarm:${alarm.id}`, label: `Будильник · ${alarm.label || alarm.title || alarm.time}` });
    }
    return options;
  }, [alarms]);

  return (
    <div className="flex flex-col w-full max-w-[340px] px-1 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-wider uppercase opacity-90">Заметки</span>
        <button
          onClick={() => beginEdit(null)}
          className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold rounded-lg border transition-colors shrink-0"
          style={{ borderColor: theme.border, color: theme.subtext }}
          title="Новая заметка"
        >
          <Plus size={11} /> Новая
        </button>
      </div>

      {/* Editor */}
      {editingId !== null && (
        <div
          className="rounded-2xl border p-3 space-y-2"
          style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}
        >
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Заголовок (необязательно)"
            className="w-full bg-black/40 text-xs px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none font-semibold"
            style={{ color: theme.text }}
            aria-label="Заголовок заметки"
          />
          <select
            value={attachTo}
            onChange={(e) => setAttachTo(e.target.value)}
            className="w-full bg-black/40 text-[10px] px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none"
            style={{ color: theme.text }}
            aria-label="Привязать заметку"
          >
            {attachOptions.map((o) => (
              <option key={o.value} value={o.value} className="bg-neutral-900">
                {o.label}
              </option>
            ))}
          </select>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Пишите в Markdown: **жирный**, *курсив*, - списки, `код`, [ссылки](https://...)"
            className="w-full bg-black/40 text-xs px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none font-mono leading-relaxed"
            style={{ color: theme.text }}
            aria-label="Текст заметки"
          />
          <div className="flex items-center justify-end space-x-2 pt-1">
            <button
              onClick={() => setEditingId(null)}
              className="px-2.5 py-1 text-xs rounded-lg hover:bg-white/5 opacity-70"
            >
              Отмена
            </button>
            <button
              onClick={save}
              disabled={!title.trim() && !body.trim()}
              className="flex items-center space-x-1 px-3 py-1 text-xs font-bold rounded-lg shadow-sm disabled:opacity-30"
              style={{ backgroundColor: '#fafafa', color: '#0a0a0a' }}
            >
              Сохранить
            </button>
          </div>
        </div>
      )}

      {sorted.length === 0 && editingId === null && (
        <div
          className="rounded-2xl border px-4 py-6 text-center"
          style={{ backgroundColor: theme.surface, borderColor: theme.border }}
        >
          <Edit3 size={18} className="mx-auto mb-2 opacity-40" style={{ color: theme.subtext }} />
          <span className="text-[11px] leading-relaxed" style={{ color: theme.subtext }}>
            Пока пусто. Заметка может стоять сама по себе, висеть на будильнике или на шаге программы.
          </span>
        </div>
      )}

      <div className="flex flex-col space-y-2">
        {sorted.map((note) => (
          <div
            key={note.id}
            className="rounded-2xl border p-3"
            style={{
              backgroundColor: note.pinned ? theme.cardBg : theme.surface,
              borderColor: theme.border,
            }}
          >
            <div className="flex items-start justify-between gap-2">
              <button
                onClick={() => beginEdit(note)}
                className="flex-1 text-left min-w-0"
                title="Открыть для редактирования"
              >
                {note.title && (
                  <span className="block text-xs font-semibold truncate" style={{ color: theme.text }}>
                    {note.title}
                  </span>
                )}
                {attachmentLabel(note) && (
                  <span className="block text-[9px] uppercase tracking-wider opacity-60" style={{ color: theme.subtext }}>
                    {attachmentLabel(note)}
                  </span>
                )}
              </button>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  onClick={() => togglePin(note.id)}
                  className="p-1 rounded transition-colors hover:bg-white/10"
                  style={{ color: note.pinned ? theme.accent : theme.subtext }}
                  title={note.pinned ? 'Открепить' : 'Закрепить'}
                >
                  {note.pinned ? <PinOff size={12} /> : <Pin size={12} />}
                </button>
                <button
                  onClick={() => remove(note.id)}
                  className="p-1 rounded transition-colors hover:bg-red-500/20 text-red-400 opacity-50 hover:opacity-100"
                  title="Удалить"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            </div>

            {note.body && (
              <div
                className="mt-1.5 text-[11px] leading-relaxed space-y-1 break-words"
                style={{ color: theme.text }}
              >
                {renderMarkdown(note.body, note.id)}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};
