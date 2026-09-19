export interface Palette {
  bg: string;
  surface: string;
  elevated: string;
  text: string;
  textMuted: string;
  textFaint: string;
  border: string;
}

export const PALETTE: Palette = {
  bg: '#0A0A0B',
  surface: '#101012',
  elevated: '#17171B',
  text: '#EDEDF0',
  textMuted: '#9A9AA5',
  textFaint: '#5C5C66',
  border: '#232329',
};

export type AccentId =
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'violet'
  | 'blue'
  | 'teal'
  | 'green';

export const DEFAULT_ACCENT: AccentId = 'amber';

export const ACCENTS: Record<AccentId, string> = {
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
