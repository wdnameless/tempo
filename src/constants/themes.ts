import { ACCENTS, DEFAULT_ACCENT, hexToRgba, type AccentId } from './design';
import type { ThemeColors, ThemeId } from '../types';

/**
 * Temporary bridge mapping the design system tokens onto the legacy ThemeColors
 * shape so nineteen existing screens continue to render during the migration.
 * Deleted when the last consumer is rewritten (wave 12).
 */
export function themeFromTokens(accentId: AccentId): ThemeColors {
  const accent = ACCENTS[accentId] ?? ACCENTS[DEFAULT_ACCENT];
  const safeId = (ACCENTS[accentId] ? accentId : DEFAULT_ACCENT) as ThemeId;

  return {
    id: safeId,
    name: safeId,
    bg: 'var(--bg)',
    surface: 'var(--surface)',
    cardBg: 'var(--elevated)',
    border: 'var(--border)',
    text: 'var(--text)',
    subtext: 'var(--text-muted)',
    accent,
    accentGlow: hexToRgba(accent, 0.3),
    ringTrack: 'var(--border)',
    ringProgress: accent,
    ticks: 'var(--text-faint)',
  };
}
