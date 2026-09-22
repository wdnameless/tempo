import React from 'react';

export interface EmptyStateProps {
  /** Optional icon or illustration slot */
  icon?: React.ReactNode;
  /** Primary message stating what is missing */
  title: React.ReactNode;
  /** Secondary explanatory text or hint */
  description?: React.ReactNode;
  /** Optional call-to-action button or link */
  action?: React.ReactNode;
  /** Additional CSS class names */
  className?: string;
}

/**
 * Minimalist placeholder displayed when lists or views contain no items.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center py-10 px-4 rounded-[14px] border border-dashed border-[var(--border)] ${className}`}
    >
      {icon && (
        <div className="mb-3 text-[var(--text-faint)] flex items-center justify-center">
          {icon}
        </div>
      )}
      <div
        className="text-sm font-medium leading-snug max-w-sm"
        style={{ color: 'var(--text)' }}
      >
        {title}
      </div>
      {description && (
        <div
          className="text-xs leading-relaxed mt-1 max-w-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          {description}
        </div>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
