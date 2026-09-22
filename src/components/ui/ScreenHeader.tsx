import React from 'react';

export interface ScreenHeaderProps {
  /** Main screen title */
  title: React.ReactNode;
  /** Subtitle or contextual description below title */
  subtitle?: React.ReactNode;
  /** Action slot (buttons, controls) positioned on the right */
  action?: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Standard top header for primary application screens and views.
 */
export function ScreenHeader({
  title,
  subtitle,
  action,
  className = '',
}: ScreenHeaderProps) {
  return (
    <header className={`flex items-start justify-between gap-4 pb-4 select-none ${className}`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <h1
          className="text-lg font-semibold tracking-tight truncate"
          style={{ color: 'var(--text)' }}
        >
          {title}
        </h1>
        {subtitle && (
          <div
            className="text-xs leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            {subtitle}
          </div>
        )}
      </div>
      {action && <div className="flex items-center gap-2 shrink-0">{action}</div>}
    </header>
  );
}
