export interface Palette {
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
}



export type AccentId =
  | 'white'
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'violet'
  | 'blue'
  | 'teal'
  | 'green';

export const DEFAULT_ACCENT: AccentId = 'white';

export const ACCENTS: Record<AccentId, string> = {
  white: '#FFFFFF',
  amber: '#F59E0B',
  orange: '#F97316',
  red: '#EF4444',
  pink: '#EC4899',
  violet: '#8B5CF6',
  blue: '#3B82F6',
  teal: '#14B8A6',
  green: '#22C55E',
};

export const SPACE = [0, 4, 8, 12, 16, 24, 32, 48] as const;

export const RADII = {
  sm: 6,
  md: 10,
  lg: 14,
  xl: 20,
} as const;

export const TYPE = {
  display: {
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    fontSize: '2rem',
    lineHeight: '2.5rem',
    fontWeight: 600,
    letterSpacing: '-0.02em',
  },
  title: {
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    fontSize: '1.25rem',
    lineHeight: '1.75rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
  },
  body: {
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 400,
  },
  label: {
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 500,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  caption: {
    fontFamily: "var(--font-sans, 'Inter Variable', Inter, sans-serif)",
    fontSize: '0.75rem',
    lineHeight: '1rem',
    fontWeight: 400,
  },
  mono: {
    fontFamily: "var(--font-mono, 'JetBrains Mono', monospace)",
    fontSize: '0.875rem',
    lineHeight: '1.25rem',
    fontWeight: 400,
    fontVariantNumeric: 'tabular-nums',
  },
} as const;

/**
 * The hue each timer phase paints with.
 *
 * One source for the background gradient, the dial arc and the mini overlay, so
 * a break cannot look like focus in one place and like rest in another.
 */
export const PHASE_COLORS = {
  focus: '#F59E0B',
  short_rest: '#14B8A6',
  long_rest: '#6366F1',
  idle: '#6B7280',
} as const;

export type PhaseColorKey = keyof typeof PHASE_COLORS;

export function hexToRgba(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function applyAccent(id: AccentId): void {
  const color = ACCENTS[id] ?? ACCENTS[DEFAULT_ACCENT];
  if (typeof document !== 'undefined' && document.documentElement) {
    document.documentElement.style.setProperty('--accent', color);
    document.documentElement.style.setProperty('--accent-soft', hexToRgba(color, 0.14));
  }
}

export const CSS_VARS = {
  bg: 'var(--bg)',
  surface: 'var(--surface)',
  surfaceHover: 'var(--surface-hover)',
  elevated: 'var(--elevated)',
  text: 'var(--text)',
  textMuted: 'var(--text-muted)',
  textFaint: 'var(--text-faint)',
  border: 'var(--border)',
  borderStrong: 'var(--border-strong)',
  accent: 'var(--accent)',
  accentSoft: 'var(--accent-soft)',
} as const;
