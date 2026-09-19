import React from 'react';

export interface RowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  control?: React.ReactNode;
  onPress?: () => void;
  disabled?: boolean | string;
}

export function Row({
  label,
  description,
  control,
  onPress,
  disabled = false,
}: RowProps) {
  const isDisabled = Boolean(disabled);
  const disabledReason = typeof disabled === 'string' ? disabled : undefined;
  const isClickable = Boolean(onPress) && !isDisabled;

  const handleClick = () => {
    if (isClickable && onPress) {
      onPress();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (isClickable && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      onPress?.();
    }
  };

  return (
    <div
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={handleClick}
      onKeyDown={isClickable ? handleKeyDown : undefined}
      aria-disabled={isDisabled ? true : undefined}
      className={`group flex items-center justify-between gap-4 py-3 px-3.5 rounded-[10px] transition-colors ${
        isClickable
          ? 'cursor-pointer hover:bg-[var(--elevated)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]'
          : ''
      } ${isDisabled ? 'opacity-45 cursor-not-allowed select-none' : ''}`}
      style={{
        backgroundColor: isClickable ? undefined : 'transparent',
      }}
    >
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div
          className="text-sm font-medium leading-snug truncate"
          style={{ color: 'var(--text)' }}
        >
          {label}
        </div>
        {description && (
          <div
            className="text-xs leading-relaxed"
            style={{ color: 'var(--text-muted)' }}
          >
            {description}
          </div>
        )}
        {disabledReason && (
          <div
            className="text-xs leading-relaxed italic"
            style={{ color: 'var(--text-faint)' }}
          >
            {disabledReason}
          </div>
        )}
      </div>

      {control && (
        <div
          className="flex items-center shrink-0"
          onClick={(e) => {
            // Prevent row onPress when clicking inner control
            if (isClickable) {
              e.stopPropagation();
            }
          }}
        >
          {control}
        </div>
      )}
    </div>
  );
}
