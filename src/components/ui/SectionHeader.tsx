import React from 'react';

export interface SectionHeaderProps {
  children: React.ReactNode;
}

export function SectionHeader({ children }: SectionHeaderProps) {
  return (
    <h3
      className="text-xs font-medium uppercase tracking-wider px-3.5 pt-4 pb-1.5 select-none"
      style={{
        color: 'var(--text-muted)',
      }}
    >
      {children}
    </h3>
  );
}
