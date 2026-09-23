import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { TitleBar } from '../TitleBar';
import { currentVersion, checkForUpdate, installUpdate, type UpdateInfo } from '../../services/update';
import { I18nService } from '../../services/i18n';

vi.mock('../../services/update', () => ({
  currentVersion: vi.fn(),
  checkForUpdate: vi.fn(),
  installUpdate: vi.fn(),
}));

describe('TitleBar', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(currentVersion).mockResolvedValue('0.18.2');
    vi.mocked(checkForUpdate).mockResolvedValue({ status: 'current' });
    vi.mocked(installUpdate).mockResolvedValue({ ok: true });
    I18nService.setLang('ru');
  });

  afterEach(() => {
    cleanup();
  });

  it('removes the underline bar under the top-left logo while keeping TEMPO text', async () => {
    const { container } = render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    expect(screen.getByText('TEMPO')).toBeDefined();
    const underline = container.querySelector('.h-\\[2px\\]');
    expect(underline).toBeNull();
  });

  it('does not render TEMPO in the right-hand cluster', async () => {
    const { container } = render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    const root = container.firstElementChild;
    expect(root?.children.length).toBe(2);
    const rightCluster = root?.children[1];
    expect(rightCluster).toBeDefined();
    expect(rightCluster?.textContent).not.toContain('TEMPO');

    const tempoElements = screen.getAllByText('TEMPO');
    expect(tempoElements).toHaveLength(1);
  });

  it('renders the version resolved from currentVersion()', async () => {
    render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 50);
    await promise;

    expect(screen.getByText(/0\.18\.2/)).toBeDefined();
  });

  it('shows nothing when currentVersion rejects', async () => {
    vi.mocked(currentVersion).mockRejectedValue(new Error('fail'));

    render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 50);
    await promise;

    expect(screen.queryByText(/0\.18\.2/)).toBeNull();
  });

  it('keeps compact-mode branch working properly with localized labels', async () => {
    const onToggleCompact = vi.fn();
    const onToggleOverlay = vi.fn();

    render(
      <TitleBar
        isCompact={true}
        isPinned={false}
        onToggleCompact={onToggleCompact}
        onToggleOverlay={onToggleOverlay}
        onTogglePin={vi.fn()}
      />,
    );

    expect(screen.queryByText('TEMPO')).toBeNull();

    const expandBtn = screen.getByTestId('compact-expand-button');
    expect(expandBtn).toBeDefined();
    fireEvent.click(expandBtn);
    expect(onToggleCompact).toHaveBeenCalledTimes(1);

    const overlayBtn = screen.getByTestId('compact-overlay-button');
    expect(overlayBtn).toBeDefined();
    fireEvent.click(overlayBtn);
    expect(onToggleOverlay).toHaveBeenCalledTimes(1);
  });

  it('uses localized titles for window controls without hardcoded strings', () => {
    render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    const t = I18nService.t();
    expect(screen.getByTitle(t.titleBarMinimize)).toBeDefined();
    expect(screen.getByTitle(t.titleBarMaximize)).toBeDefined();
    expect(screen.getByTitle(t.titleBarCloseToTray)).toBeDefined();
    expect(screen.getByTitle(t.titleBarPin)).toBeDefined();
    expect(screen.getByTitle(t.titleBarCompact)).toBeDefined();
  });

  describe('Update state machine', () => {
    it('starts in idle state and renders updateIdle label', () => {
      render(
        <TitleBar
          isCompact={false}
          isPinned={false}
          onToggleCompact={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );

      const t = I18nService.t();
      const updateBtn = screen.getByTestId('update-button');
      expect(updateBtn.textContent).toContain(t.updateIdle);
    });

    it('transitions idle -> checking -> up_to_date -> idle when no update is found', async () => {
      vi.useFakeTimers();
      let resolveCheck!: (val: { status: 'current' }) => void;
      const checkPromise = new Promise<{ status: 'current' } | { status: 'update'; info: UpdateInfo } | { status: 'error'; message: string }>((res) => {
        resolveCheck = res;
      });
      vi.mocked(checkForUpdate).mockReturnValue(checkPromise);

      render(
        <TitleBar
          isCompact={false}
          isPinned={false}
          onToggleCompact={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );

      const t = I18nService.t();
      const updateBtn = screen.getByTestId('update-button');
      expect(updateBtn.textContent).toContain(t.updateIdle);

      // Click to check
      await act(async () => {
        fireEvent.click(updateBtn);
      });

      // Checking state
      expect(updateBtn.textContent).toContain(t.updateChecking);
      expect(vi.mocked(checkForUpdate)).toHaveBeenCalledTimes(1);

      // Resolve check as current
      await act(async () => {
        resolveCheck({ status: 'current' });
      });

      expect(updateBtn.textContent).toContain(t.updateUpToDate);

      // After 3 seconds, returns to idle
      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(updateBtn.textContent).toContain(t.updateIdle);
      vi.useRealTimers();
    });

    it('transitions idle -> checking -> available -> downloading -> ready -> restart on click flow', async () => {
      vi.mocked(checkForUpdate).mockResolvedValue({
        status: 'update',
        info: { version: '0.19.0', notes: 'New release', portable: false },
      });

      vi.mocked(installUpdate).mockImplementation(async (_info, onProgress) => {
        onProgress?.(50, 100);
        return { ok: true };
      });

      render(
        <TitleBar
          isCompact={false}
          isPinned={false}
          onToggleCompact={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );

      const t = I18nService.t();
      const updateBtn = screen.getByTestId('update-button');

      // 1. Idle -> Click -> checks and finds update -> Available
      await act(async () => {
        fireEvent.click(updateBtn);
      });

      const availableLabel = t.updateAvailable.replace('{version}', '0.19.0');
      expect(updateBtn.textContent).toContain(availableLabel);

      // 2. Click available -> starts downloading & calls installUpdate
      await act(async () => {
        fireEvent.click(updateBtn);
      });

      expect(vi.mocked(installUpdate)).toHaveBeenCalledWith(
        expect.objectContaining({ version: '0.19.0' }),
        expect.any(Function),
      );

      // Ready state after installUpdate succeeds
      expect(updateBtn.textContent).toContain(t.updateReady);

      // 3. Click ready -> calls installUpdate again (to restart)
      await act(async () => {
        fireEvent.click(updateBtn);
      });
      expect(vi.mocked(installUpdate)).toHaveBeenCalledTimes(2);
    });

    it('supports receiving initialUpdateInfo from background check and shows updateAvailable', () => {
      render(
        <TitleBar
          isCompact={false}
          isPinned={false}
          onToggleCompact={vi.fn()}
          onTogglePin={vi.fn()}
          initialUpdateInfo={{ version: '0.20.0', notes: 'Test', portable: true }}
        />,
      );

      const t = I18nService.t();
      const expected = t.updateAvailable.replace('{version}', '0.20.0');
      const updateBtn = screen.getByTestId('update-button');
      expect(updateBtn.textContent).toContain(expected);
    });

    it('handles check error with updateFailed and reverts to idle', async () => {
      vi.useFakeTimers();
      vi.mocked(checkForUpdate).mockResolvedValue({ status: 'error', message: 'network err' });

      render(
        <TitleBar
          isCompact={false}
          isPinned={false}
          onToggleCompact={vi.fn()}
          onTogglePin={vi.fn()}
        />,
      );

      const t = I18nService.t();
      const updateBtn = screen.getByTestId('update-button');

      await act(async () => {
        fireEvent.click(updateBtn);
      });

      expect(updateBtn.textContent).toContain(t.updateFailed);

      act(() => {
        vi.advanceTimersByTime(3000);
      });

      expect(updateBtn.textContent).toContain(t.updateIdle);
      vi.useRealTimers();
    });
  });
});
