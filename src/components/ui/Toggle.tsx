import React from 'react';

export interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}

export function Toggle({ checked, onChange, disabled = false }: ToggleProps) {
  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!disabled) {
      onChange(!checked);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      onChange(!checked);
    }
  };

  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg)] ${
        disabled ? 'cursor-not-allowed opacity-40' : ''
      }`}
      style={{
        backgroundColor: checked ? 'var(--accent)' : 'var(--elevated)',
        border: checked
          ? '1px solid var(--accent)'
          : '1px solid var(--border-strong, rgba(255, 255, 255, 0.2))',
      }}
    >
      <span
        className={`pointer-events-none inline-block h-4 w-4 transform rounded-full shadow-sm transition-transform duration-200 ${
          checked ? 'translate-x-6' : 'translate-x-1'
        }`}
        style={{
          backgroundColor: checked ? 'var(--accent-fg)' : 'var(--text-muted)',
        }}
      />
    </button>
  );
}
