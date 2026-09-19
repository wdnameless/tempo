import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QualityPrompt } from '../QualityPrompt';
import { themeFromTokens } from '../../constants/themes';

// The real palette: a hand-written partial theme drifts from ThemeColors and
// hides the drift behind a cast.
const mockTheme = themeFromTokens('amber');

describe('QualityPrompt', () => {
  it('renders rating buttons 1 through 10', () => {
    render(
      <QualityPrompt
        theme={mockTheme}
        onRate={vi.fn()}
        onSkip={vi.fn()}
        directionName="Разработка"
        directionColor="#ff0000"
      />
    );

    expect(screen.getByText('Блок завершён: Разработка')).toBeTruthy();
    expect(screen.getByText('Как оцениваете качество фокуса? (1–10)')).toBeTruthy();

    for (let i = 1; i <= 10; i++) {
      expect(screen.getByRole('button', { name: String(i) })).toBeTruthy();
    }
    expect(screen.getByRole('button', { name: 'Пропустить' })).toBeTruthy();
  });

  it('calls onRate with selected quality when clicked', () => {
    const onRate = vi.fn();
    const onSkip = vi.fn();

    render(
      <QualityPrompt
        theme={mockTheme}
        onRate={onRate}
        onSkip={onSkip}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: '8' }));
    expect(onRate).toHaveBeenCalledWith(8);
    expect(onSkip).not.toHaveBeenCalled();
  });

  it('calls onSkip when skip button is clicked without calling onRate', () => {
    const onRate = vi.fn();
    const onSkip = vi.fn();

    render(
      <QualityPrompt
        theme={mockTheme}
        onRate={onRate}
        onSkip={onSkip}
      />
    );

    fireEvent.click(screen.getByRole('button', { name: 'Пропустить' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
    expect(onRate).not.toHaveBeenCalled();
  });
});
