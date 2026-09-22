import React from 'react';

interface IconProps {
  size?: number;
  className?: string;
  color?: string;
}

// Custom minimalist hand-drawn hourglass: thin single-line drawing with generous whitespace
export const HandHourglass: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M 7.0 5.2 C 10.4 5.0 13.6 5.1 17.0 4.9 C 15.4 7.8 13.4 10.3 12.1 11.9 C 13.5 14.1 15.3 16.9 16.8 19.3 C 13.6 19.4 10.4 19.5 7.2 19.5 C 8.7 17.0 10.6 14.2 11.9 12.1 C 10.6 10.0 8.6 7.5 7.0 5.2 Z" />
  </svg>
);

// Custom hand-drawn ink spark / star
export const HandSparkle: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M12 2.5c0 4.5 1.5 8 5.5 9.5-4 1.5-5.5 5-5.5 9.5 0-4.5-1.5-8-5.5-9.5 4-1.5 5.5-5 5.5-9.5z" />
    <circle cx="19" cy="5" r="1" fill={color} stroke="none" />
  </svg>
);

// Custom hand-drawn clock timer
export const HandClock: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 6.5v5.5l3.8 2.2" />
    <path d="M10.5 2h3" />
  </svg>
);

// Custom hand-drawn gear / settings
export const HandGear: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <circle cx="12" cy="12" r="3.5" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

// Custom hand-drawn arrow send
export const HandSend: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M21.5 2.5L10 14" />
    <path d="M21.5 2.5L14.5 21.5 10 14 2.5 9.5 21.5 2.5z" />
  </svg>
);

// Custom hand-drawn close cross
export const HandClose: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M18 6L6 18" />
    <path d="M6 6l12 12" />
  </svg>
);

// Custom hand-drawn checkmark
export const HandCheck: React.FC<IconProps> = ({ size = 16, className = '', color = 'currentColor' }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <polyline points="20 6 9 17 4 12" />
  </svg>
);
