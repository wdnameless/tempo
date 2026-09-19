import React from 'react';

export interface IconButtonProps {
  icon: React.ReactNode;
  label: string;
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
  active?: boolean;
  disabled?: boolean;
}

export function IconButton({
  icon,
  label,
  onClick,
  active = false,
  disabled = false,
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={(e) => {
        if (!disabled) {
          onClick(e);
        }
      }}
      className={`inline-flex items-center justify-center w-8 h-8 rounded-[8px] transition-colors cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${
        disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
      } ${
        active
          ? 'hover:opacity-90'
          : 'hover:bg-[var(--elevated)] hover:text-[var(--text)]'
      }`}
      style={{
        backgroundColor: active ? 'var(--accent-soft)' : 'transparent',
        color: active ? 'var(--accent)' : 'var(--text-muted)',
        border: active ? '1px solid var(--accent)' : '1px solid transparent',
      }}
    >
      {icon}
    </button>
  );
}
