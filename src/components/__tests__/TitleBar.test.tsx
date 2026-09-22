import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent } from '@testing-library/react';
import { TitleBar } from '../TitleBar';
import { currentVersion } from '../../services/update';

vi.mock('../../services/update', () => ({
  currentVersion: vi.fn(),
}));

describe('TitleBar', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('removes the underline bar under the top-left logo while keeping TEMPO text', async () => {
    vi.mocked(currentVersion).mockResolvedValue('0.18.2');

    const { container } = render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    // TEMPO text in the top-left logo exists
    expect(screen.getByText('TEMPO')).toBeDefined();

    // The underline bar (.w-5.h-[2px].bg-white) is completely removed
    const underline = container.querySelector('.h-\\[2px\\]');
    expect(underline).toBeNull();
  });

  it('does not render TEMPO in the right-hand cluster', async () => {
    vi.mocked(currentVersion).mockResolvedValue('0.18.2');

    const { container } = render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    // Root div has two direct flex children: [0] logo cluster, [1] right cluster
    const root = container.firstElementChild;
    expect(root?.children.length).toBe(2);
    const rightCluster = root?.children[1];
    expect(rightCluster).toBeDefined();

    // Right cluster must not contain the word TEMPO
    expect(rightCluster?.textContent).not.toContain('TEMPO');

    // Across the entire TitleBar, TEMPO only appears once (in the left logo)
    const tempoElements = screen.getAllByText('TEMPO');
    expect(tempoElements).toHaveLength(1);
  });

  it('renders the version resolved from currentVersion()', async () => {
    vi.mocked(currentVersion).mockResolvedValue('0.18.2');

    render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    const versionElement = await screen.findByText('v0.18.2');
    expect(versionElement).toBeDefined();
    expect(currentVersion).toHaveBeenCalledTimes(1);
  });

  it('shows nothing rather than a fake number when in browser (dev) or on error', async () => {
    vi.mocked(currentVersion).mockResolvedValue('dev');

    const { container } = render(
      <TitleBar
        isCompact={false}
        isPinned={false}
        onToggleCompact={vi.fn()}
        onTogglePin={vi.fn()}
      />,
    );

    // Give microtasks time to run
    const { promise, resolve } = Promise.withResolvers<void>();
    setTimeout(resolve, 50);
    await promise;

    // Must not show "dev", "0.16.0", or any version text
    expect(screen.queryByText(/0\.16\.0/)).toBeNull();
    expect(screen.queryByText(/dev/i)).toBeNull();
    expect(screen.queryByText(/unknown/i)).toBeNull();

    // Right cluster should not contain any version text
    const root = container.firstElementChild;
    const rightCluster = root?.children[1];
    expect(rightCluster?.querySelector('.font-mono')).toBeNull();
  });

  it('shows nothing when currentVersion rejects', async () => {
    vi.mocked(currentVersion).mockRejectedValue(new Error('Tauri not available'));

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

    expect(screen.queryByText(/0\.16\.0/)).toBeNull();
    expect(screen.queryByText(/v\d/)).toBeNull();
  });

  it('keeps compact-mode branch working properly', async () => {
    vi.mocked(currentVersion).mockResolvedValue('0.18.2');
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

    // In compact mode, logo TEMPO is not rendered
    expect(screen.queryByText('TEMPO')).toBeNull();

    // Compact mode buttons are available
    const expandBtn = screen.getByTitle('Развернуть окно');
    expect(expandBtn).toBeDefined();
    fireEvent.click(expandBtn);
    expect(onToggleCompact).toHaveBeenCalledTimes(1);

    const overlayBtn = screen.getByTitle('Мини-оверлей поверх всех окон');
    expect(overlayBtn).toBeDefined();
    fireEvent.click(overlayBtn);
    expect(onToggleOverlay).toHaveBeenCalledTimes(1);
  });
});
