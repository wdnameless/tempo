import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { HotkeyRecorder } from '../HotkeyRecorder';
import * as stt from '../../../services/stt';
import { I18nService } from '../../../services/i18n';

vi.mock('../../../services/stt', () => ({
  validateHotkey: vi.fn(),
  suspendShortcuts: vi.fn(),
  resumeShortcuts: vi.fn(),
}));

describe('HotkeyRecorder', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stt.validateHotkey).mockResolvedValue();
    vi.mocked(stt.suspendShortcuts).mockResolvedValue();
    vi.mocked(stt.resumeShortcuts).mockResolvedValue();
  });

  it('presses Ctrl, presses Space, releases Ctrl, releases Space and asserts the saved accelerator is Ctrl+Space', async () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    // 1. Press Ctrl
    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();

    // 2. Press Space while Ctrl is held
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();

    // 3. Release Ctrl first
    fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft', ctrlKey: false });
    expect(onChange).not.toHaveBeenCalled();

    // 4. Release Space
    fireEvent.keyUp(window, { key: ' ', code: 'Space', ctrlKey: false });

    await waitFor(() => {
      expect(stt.validateHotkey).toHaveBeenCalledWith('Ctrl+Space');
      expect(onChange).toHaveBeenCalledWith('Ctrl+Space');
    });
  });

  it('lone modifier does not save', async () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    // Press Ctrl alone
    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    expect(onChange).not.toHaveBeenCalled();

    // Release Ctrl
    fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft', ctrlKey: false });
    expect(onChange).not.toHaveBeenCalled();
    expect(stt.validateHotkey).not.toHaveBeenCalled();

    // Recording is still active or reset, but nothing was committed
    expect(onChange).not.toHaveBeenCalled();
  });

  it('validates and saves Alt+Space', async () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    fireEvent.keyDown(window, { key: 'Alt', code: 'AltLeft', altKey: true });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', altKey: true });
    fireEvent.keyUp(window, { key: 'Alt', code: 'AltLeft', altKey: false });
    fireEvent.keyUp(window, { key: ' ', code: 'Space', altKey: false });

    await waitFor(() => {
      expect(stt.validateHotkey).toHaveBeenCalledWith('Alt+Space');
      expect(onChange).toHaveBeenCalledWith('Alt+Space');
    });
  });

  it('validates and saves Shift+Space', async () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    fireEvent.keyDown(window, { key: 'Shift', code: 'ShiftLeft', shiftKey: true });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', shiftKey: true });
    fireEvent.keyUp(window, { key: 'Shift', code: 'ShiftLeft', shiftKey: false });
    fireEvent.keyUp(window, { key: ' ', code: 'Space', shiftKey: false });

    await waitFor(() => {
      expect(stt.validateHotkey).toHaveBeenCalledWith('Shift+Space');
      expect(onChange).toHaveBeenCalledWith('Shift+Space');
    });
  });

  it('validates and saves single Space key', async () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    fireEvent.keyDown(window, { key: ' ', code: 'Space' });
    fireEvent.keyUp(window, { key: ' ', code: 'Space' });

    await waitFor(() => {
      expect(stt.validateHotkey).toHaveBeenCalledWith('Space');
      expect(onChange).toHaveBeenCalledWith('Space');
    });
  });

  it('saves combination when non-modifier is released before modifier', async () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true });

    // Release Space first
    fireEvent.keyUp(window, { key: ' ', code: 'Space', ctrlKey: true });

    await waitFor(() => {
      expect(stt.validateHotkey).toHaveBeenCalledWith('Ctrl+Space');
      expect(onChange).toHaveBeenCalledWith('Ctrl+Space');
    });

    // Release Ctrl after already committed
    fireEvent.keyUp(window, { key: 'Control', code: 'ControlLeft', ctrlKey: false });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('displays error and does not save when validation fails', async () => {
    vi.mocked(stt.validateHotkey).mockRejectedValueOnce(
      new Error("Shortcut 'Ctrl+Space' is already taken")
    );

    const onChange = vi.fn();
    render(<HotkeyRecorder value="" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    fireEvent.keyDown(window, { key: 'Control', code: 'ControlLeft', ctrlKey: true });
    fireEvent.keyDown(window, { key: ' ', code: 'Space', ctrlKey: true });
    fireEvent.keyUp(window, { key: ' ', code: 'Space', ctrlKey: true });

    await waitFor(() => {
      expect(screen.getByText("Shortcut 'Ctrl+Space' is already taken")).toBeDefined();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('allows clearing shortcut value with clear button', () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="Ctrl+Space" onChange={onChange} />);

    const clearBtn = screen.getByTitle(I18nService.t().speechClearShortcut);
    fireEvent.click(clearBtn);

    expect(onChange).toHaveBeenCalledWith('');
  });

  it('allows canceling recording without saving', () => {
    const onChange = vi.fn();
    render(<HotkeyRecorder value="Ctrl+S" onChange={onChange} />);

    const recorder = screen.getByTestId('hotkey-recorder');
    fireEvent.click(recorder);

    const cancelBtn = screen.getByText('Cancel');
    fireEvent.click(cancelBtn);

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText('Cancel')).toBeNull();
  });
});
