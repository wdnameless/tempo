import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { NotesEditor } from '../NotesEditor';
import { I18nService } from '../../services/i18n';

describe('NotesEditor', () => {
  it('renders initial value and allows text selection on root', () => {
    const { getByTestId, container } = render(
      <NotesEditor value="Hello world" onChange={vi.fn()} />
    );

    const root = getByTestId('notes-editor');
    expect(root).toBeDefined();
    expect(root.style.userSelect).toBe('text');
    expect(root.className).toContain('select-text');

    const content = container.querySelector('.cm-content');
    expect(content).not.toBeNull();
    expect(content?.textContent).toContain('Hello world');
  });

  it('renders heading decorations on heading lines', () => {
    const { container } = render(
      <NotesEditor
        value={`# Big Heading
## Medium Heading
### Small Heading
Normal text`}
        onChange={vi.fn()}
      />
    );

    const h1 = container.querySelector('.cm-heading-1');
    expect(h1).not.toBeNull();
    expect(h1?.textContent).toContain('Big Heading');

    const h2 = container.querySelector('.cm-heading-2');
    expect(h2).not.toBeNull();
    expect(h2?.textContent).toContain('Medium Heading');

    const h3 = container.querySelector('.cm-heading-3');
    expect(h3).not.toBeNull();
    expect(h3?.textContent).toContain('Small Heading');
  });

  it('renders blockquote and inline formatting decorations', () => {
    const { container } = render(
      <NotesEditor
        value={`> Quote line
**bold text** and *italic text* and \`code\``}
        onChange={vi.fn()}
      />
    );

    const quote = container.querySelector('.cm-blockquote-line');
    expect(quote).not.toBeNull();

    const bold = container.querySelector('.cm-strong');
    expect(bold).not.toBeNull();
    expect(bold?.textContent).toBe('**bold text**');

    const italic = container.querySelector('.cm-emphasis');
    expect(italic).not.toBeNull();
    expect(italic?.textContent).toBe('*italic text*');

    const inlineCode = container.querySelector('.cm-inline-code');
    expect(inlineCode).not.toBeNull();
    expect(inlineCode?.textContent).toBe('`code`');
  });

  it('renders a clickable checkbox that toggles - [ ] to - [x] in the value', () => {
    const onChange = vi.fn();
    render(<NotesEditor value="- [ ] Buy milk" onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(false);
    expect(checkbox.getAttribute('aria-label')).toBe(I18nService.t().notesTaskIncomplete);

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith('- [x] Buy milk');
  });

  it('toggles - [x] back to - [ ] when clicked', () => {
    const onChange = vi.fn();
    render(<NotesEditor value="- [x] Done task" onChange={onChange} />);

    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox).not.toBeNull();
    expect(checkbox.checked).toBe(true);
    expect(checkbox.getAttribute('aria-label')).toBe(I18nService.t().notesTaskCompleted);

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith('- [ ] Done task');
  });

  it('respects custom task checkbox labels', () => {
    render(
      <NotesEditor
        value="- [ ] Pending task"
        onChange={vi.fn()}
        taskIncompleteLabel="Custom incomplete"
      />
    );
    const checkbox = screen.getByRole('checkbox') as HTMLInputElement;
    expect(checkbox.getAttribute('aria-label')).toBe('Custom incomplete');
  });

  it('calls onSave on Ctrl+S with the current text', () => {
    const onSave = vi.fn();
    const { container } = render(
      <NotesEditor value="Note content" onChange={vi.fn()} onSave={onSave} />
    );

    const content = container.querySelector('.cm-content');
    expect(content).not.toBeNull();

    fireEvent.keyDown(content!, { key: 's', ctrlKey: true });
    expect(onSave).toHaveBeenCalledWith('Note content');
  });

  it('calls onSave on blur with the current text', () => {
    const onSave = vi.fn();
    const { container } = render(
      <NotesEditor value="Blur content" onChange={vi.fn()} onSave={onSave} />
    );

    const content = container.querySelector('.cm-content');
    expect(content).not.toBeNull();

    fireEvent.blur(content!);
    expect(onSave).toHaveBeenCalledWith('Blur content');
  });

  it('typing updates onChange with the markdown', () => {
    const onChange = vi.fn();
    const { container } = render(
      <NotesEditor value="initial" onChange={onChange} />
    );

    const cmEditor = container.querySelector('.cm-editor') as HTMLElement;
    expect(cmEditor).not.toBeNull();

    const view = EditorView.findFromDOM(cmEditor);
    expect(view).not.toBeNull();

    view!.dispatch({
      changes: { from: view!.state.doc.length, insert: ' addition' },
    });

    expect(onChange).toHaveBeenCalledWith('initial addition');
  });

  it('updates editor content when value prop changes externally', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(
      <NotesEditor value="first text" onChange={onChange} />
    );

    const content = container.querySelector('.cm-content');
    expect(content?.textContent).toContain('first text');

    rerender(<NotesEditor value="second text" onChange={onChange} />);
    expect(content?.textContent).toContain('second text');
  });
});
