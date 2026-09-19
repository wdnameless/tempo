import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { useState } from 'react';
import type { NoteItem } from '../../types';
import { NotesView } from '../NotesView';

vi.mock('../services/sound', () => ({
  soundService: { playCountdownTick: vi.fn(), playUiClick: vi.fn() },
}));

const theme = {
  id: 'winter' as const,
  name: 'Winter',
  bg: '#050505',
  surface: '#0a0a0a',
  cardBg: '#0f0f0f',
  border: '#27272a',
  text: '#fafafa',
  subtext: '#a1a1aa',
  accent: '#ff7a1a',
  accentGlow: 'rgba(255,122,26,0.28)',
  ringTrack: '#1c1c1f',
  ringProgress: '#ff7a1a',
  ticks: '#3f3f46',
};

function Harness({ initial = [] as NoteItem[] }: { initial?: NoteItem[] }) {
  const [notes, setNotes] = useState(initial);
  return (
    <NotesView theme={theme} notes={notes} onUpdateNotes={setNotes} alarms={[]} />
  );
}

describe('NotesView', () => {
  beforeEach(cleanup);

  it('shows the empty state until the first note', () => {
    render(<Harness />);

    expect(screen.getByText(/Пока пусто/)).toBeDefined();
  });

  it('writes a note and shows it', () => {
    render(<Harness />);

    act(() => {
      screen.getByTitle('Новая заметка').click();
    });
    fireEvent.change(screen.getByLabelText('Заголовок заметки'), { target: { value: 'Идеи' } });
    fireEvent.change(screen.getByLabelText('Текст заметки'), {
      target: { value: '**важно** и *курсив*' },
    });
    act(() => {
      screen.getByText('Сохранить').click();
    });

    expect(screen.getByText('Идеи')).toBeDefined();
    // Markdown renders as markup, not as literal asterisks.
    expect(screen.getByText('важно').tagName).toBe('STRONG');
    expect(screen.getByText('курсив').tagName).toBe('EM');
  });

  it('pins a note ahead of the rest', () => {
    render(
      <Harness
        initial={[
          { id: 'a', title: 'Обычная', body: '', pinned: false, createdAt: '', updatedAt: '1' },
          { id: 'b', title: 'Закреплённая', body: '', pinned: true, createdAt: '', updatedAt: '0' },
        ]}
      />,
    );

    const rows = screen.getAllByTitle('Открыть для редактирования');
    // Pinned first, even though it was updated earlier.
    expect(rows[0].textContent).toContain('Закреплённая');
  });

  it('deletes a note', () => {
    render(
      <Harness
        initial={[{ id: 'a', title: 'Удалить меня', body: '', pinned: false, createdAt: '', updatedAt: '' }]}
      />,
    );

    act(() => {
      screen.getByTitle('Удалить').click();
    });

    expect(screen.getByText(/Пока пусто/)).toBeDefined();
  });

  it('refuses to save an empty note', () => {
    render(<Harness />);
    act(() => {
      screen.getByTitle('Новая заметка').click();
    });

    // Both fields empty → the save button is disabled, not silently dropped.
    const saveButton = screen.getByText('Сохранить') as HTMLButtonElement;
    expect(saveButton.disabled).toBe(true);
  });

  it('edits a note in place', () => {
    render(
      <Harness
        initial={[{ id: 'a', title: 'Старое', body: 'тело', pinned: false, createdAt: '', updatedAt: '' }]}
      />,
    );

    act(() => {
      screen.getByTitle('Открыть для редактирования').click();
    });

    // The editor is pre-filled with the existing note.
    const titleInput = screen.getByLabelText('Заголовок заметки') as HTMLInputElement;
    expect(titleInput.value).toBe('Старое');
  });
});
