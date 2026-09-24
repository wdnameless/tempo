import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { SttNotices } from '../SttNotices';
import * as sttEvents from '../../services/sttEvents';
import { I18nService } from '../../services/i18n';

vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(),
}));

describe('SttNotices', () => {
  let eventHandler: sttEvents.SttEventHandler | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    eventHandler = null;
    vi.mocked(sttEvents.onSttEvent).mockImplementation((handler) => {
      eventHandler = handler;
      return () => {
        eventHandler = null;
      };
    });
    I18nService.setLang('ru');
  });

  afterEach(() => {
    I18nService.setLang('ru');
  });

  it('renders nothing when there is nothing to say', () => {
    const { container } = render(<SttNotices />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('stt-notices')).toBeNull();
  });

  it('renders a notice with readable text for speech-error', () => {
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'speech-error',
        code: 'no_microphone',
        message: 'Microphone unavailable',
      });
    });

    const item = screen.getByTestId('stt-notice-item');
    expect(item).toBeDefined();
    expect(item.getAttribute('data-type')).toBe('speech-error');
    expect(item.getAttribute('data-severity')).toBe('error');
    // Russian locale translation
    expect(screen.getByText('Микрофон недоступен')).toBeDefined();
  });

  it('renders a notice with readable text for hotkey-error', () => {
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'hotkey-error',
        hotkey: 'Ctrl+Shift+Space',
        message: 'Already registered by system',
      });
    });

    const item = screen.getByTestId('stt-notice-item');
    expect(item).toBeDefined();
    expect(item.getAttribute('data-type')).toBe('hotkey-error');
    expect(item.getAttribute('data-severity')).toBe('error');
    expect(
      screen.getByText(/Не удалось активировать клавишу Ctrl\+Shift\+Space: Already registered by system/)
    ).toBeDefined();
  });

  it('renders a notice with readable text for vad-fallback', () => {
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'vad-fallback',
        backend: 'energy',
        reason: 'Silero model initialization failed',
      });
    });

    const item = screen.getByTestId('stt-notice-item');
    expect(item).toBeDefined();
    expect(item.getAttribute('data-type')).toBe('vad-fallback');
    expect(item.getAttribute('data-severity')).toBe('warning');
    expect(
      screen.getByText(/Детектор голоса переключён на energy: Silero model initialization failed/)
    ).toBeDefined();
  });

  it('renders a notice with readable text for model-failed', () => {
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'model-failed',
        modelId: 'whisper-base',
        error: 'disk_full',
      });
    });

    const item = screen.getByTestId('stt-notice-item');
    expect(item).toBeDefined();
    expect(item.getAttribute('data-type')).toBe('model-failed');
    expect(item.getAttribute('data-severity')).toBe('error');
    // Maps disk_full to human wording
    expect(
      screen.getByText(/Не удалось загрузить модель whisper-base: Недостаточно места на диске/)
    ).toBeDefined();
  });

  it('clicking notice dismisses it', () => {
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'speech-error',
        code: 'no_model',
        message: 'No model loaded',
      });
    });

    const item = screen.getByTestId('stt-notice-item');
    expect(item).toBeDefined();

    act(() => {
      fireEvent.click(item);
    });

    expect(screen.queryByTestId('stt-notice-item')).toBeNull();
    expect(screen.queryByTestId('stt-notices')).toBeNull();
  });

  it('clicking dismiss button dismisses only that notice', () => {
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'speech-error',
        code: 'no_model',
        message: 'No model',
      });
      eventHandler?.({
        type: 'hotkey-error',
        hotkey: 'F8',
        message: 'Conflict',
      });
    });

    const dismissButtons = screen.getAllByTestId('stt-notice-dismiss');
    expect(dismissButtons.length).toBe(2);

    act(() => {
      fireEvent.click(dismissButtons[0]);
    });

    const remaining = screen.getAllByTestId('stt-notice-item');
    expect(remaining.length).toBe(1);
    expect(remaining[0].getAttribute('data-type')).toBe('hotkey-error');
  });

  it('an unknown event type does not crash and renders nothing', () => {
    const { container } = render(<SttNotices />);

    expect(() => {
      act(() => {
        const unknownEvent = { type: 'completely-unknown-event', foo: 'bar' } as unknown as sttEvents.SttEvent;
        eventHandler?.(unknownEvent);
      });
    }).not.toThrow();

    expect(container.firstChild).toBeNull();
    expect(screen.queryByTestId('stt-notices')).toBeNull();
  });

  it('automatically dismisses notice after 8 seconds', () => {
    vi.useFakeTimers();
    try {
      render(<SttNotices autoDismissMs={8000} />);

      act(() => {
        eventHandler?.({
          type: 'speech-error',
          code: 'no_microphone',
          message: 'Mic error',
        });
      });

      expect(screen.getByTestId('stt-notice-item')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(7999);
      });
      expect(screen.getByTestId('stt-notice-item')).toBeDefined();

      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByTestId('stt-notice-item')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders readable text in English locale for all events', () => {
    I18nService.setLang('en');
    render(<SttNotices />);

    act(() => {
      eventHandler?.({
        type: 'speech-error',
        code: 'no_microphone',
        message: 'Microphone unavailable',
      });
      eventHandler?.({
        type: 'hotkey-error',
        hotkey: 'Ctrl+Alt+D',
        message: 'Conflict',
      });
      eventHandler?.({
        type: 'vad-fallback',
        backend: 'energy',
        reason: 'Low memory',
      });
      eventHandler?.({
        type: 'model-failed',
        modelId: 'whisper-small',
        error: 'network_error',
      });
    });

    expect(screen.getByText('Microphone unavailable')).toBeDefined();
    expect(screen.getByText(/Failed to register shortcut Ctrl\+Alt\+D: Conflict/)).toBeDefined();
    expect(screen.getByText(/Voice detector switched to energy: Low memory/)).toBeDefined();
    expect(screen.getByText(/Failed to load model whisper-small/)).toBeDefined();
  });

  it('never steals focus: tabIndex is -1 on interactive elements and activeElement is not taken', () => {
    const { container } = render(
      <div>
        <input data-testid="outside-input" type="text" autoFocus />
        <SttNotices />
      </div>
    );

    const outsideInput = screen.getByTestId('outside-input');
    outsideInput.focus();
    expect(document.activeElement).toBe(outsideInput);

    act(() => {
      eventHandler?.({
        type: 'speech-error',
        code: 'no_microphone',
        message: 'Mic error',
      });
    });

    // Active focus must remain in outside input
    expect(document.activeElement).toBe(outsideInput);

    const noticeRegion = container.querySelector('[role="region"]');
    expect(noticeRegion?.getAttribute('tabindex')).toBe('-1');

    const noticeItem = screen.getByTestId('stt-notice-item');
    expect(noticeItem.getAttribute('tabindex')).toBe('-1');

    const dismissBtn = screen.getByTestId('stt-notice-dismiss');
    expect(dismissBtn.getAttribute('tabindex')).toBe('-1');
  });
});
