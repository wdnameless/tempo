import React from 'react';

export interface CardProps {
  /** The content inside the card */
  children: React.ReactNode;
  /** Background and elevation variant */
  variant?: 'surface' | 'elevated' | 'ghost';
  /** Padding scale: none (0), sm (12px), md (16px), lg (24px) */
  padding?: 'none' | 'sm' | 'md' | 'lg';
  /** Additional CSS class names */
  className?: string;
  /** Optional click handler making the card interactive */
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
  /** Optional inline styles */
  style?: React.CSSProperties;
}

const PADDING_MAP = {
  none: 'p-0',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-6',
};

const VARIANT_BG = {
  surface: 'bg-[var(--surface)] border border-[var(--border)]',
  elevated: 'bg-[var(--elevated)] border border-[var(--border)]',
  ghost: 'bg-transparent border border-transparent',
};

/**
 * Surface container for grouped content, forms, and list items.
 */
export function Card({
  children,
  variant = 'surface',
  padding = 'md',
  className = '',
  onClick,
  style,
}: CardProps) {
  const isClickable = Boolean(onClick);

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onClick?.(e as unknown as React.MouseEvent<HTMLDivElement>);
              }
            }
          : undefined
      }
      className={`rounded-[14px] transition-colors ${VARIANT_BG[variant]} ${PADDING_MAP[padding]} ${
        isClickable
          ? 'cursor-pointer hover:border-[var(--border-strong)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]'
          : ''
      } ${className}`}
      style={style}
    >
      {children}
    </div>
  );
}
