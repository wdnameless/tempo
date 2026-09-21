import { describe, expect, it } from 'vitest';
import { themeFromTokens } from '../themes';
import { ACCENTS, DEFAULT_ACCENT, type AccentId } from '../design';

const accentIds = Object.keys(ACCENTS) as AccentId[];

describe('themeFromTokens bridge', () => {
  it.each(accentIds)('maps %s accent to valid ThemeColors', (accent) => {
    const theme = themeFromTokens(accent);
    expect(theme.accent).toBe(ACCENTS[accent]);
    expect(theme.ringProgress).toBe(ACCENTS[accent]);
    expect(theme.bg).toBe('var(--bg)');
    expect(theme.surface).toBe('var(--surface)');
    expect(theme.cardBg).toBe('var(--elevated)');
    expect(theme.border).toBe('var(--border)');
    expect(theme.text).toBe('var(--text)');
    expect(theme.subtext).toBe('var(--text-muted)');
    expect(theme.ringTrack).toBe('var(--border)');
    expect(theme.ticks).toBe('var(--text-faint)');
    expect(theme.accentGlow).toContain('rgba');
    expect(theme.id).toBe(accent);
    expect(theme.name).toBe(accent);
  });

  it('falls back to default accent when given invalid accent', () => {
    // @ts-expect-error testing invalid input fallback
    const theme = themeFromTokens('invalid-theme-id');
    expect(theme.accent).toBe(ACCENTS[DEFAULT_ACCENT]);
    expect(theme.id).toBe(DEFAULT_ACCENT);
  });
});
