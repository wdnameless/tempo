import React from 'react';

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
  minLabel?: React.ReactNode;
  maxLabel?: React.ReactNode;
  disabled?: boolean;
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  onChange,
  minLabel,
  maxLabel,
  disabled = false,
}: SliderProps) {
  const clampedValue = Math.min(Math.max(value, min), max);
  const percentage = max === min ? 0 : ((clampedValue - min) / (max - min)) * 100;

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawVal = parseFloat(e.target.value);
    const clamped = Math.min(Math.max(rawVal, min), max);
    onChange(clamped);
  };

  return (
    <div className={`flex flex-col gap-1.5 w-full select-none ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex items-center gap-3 w-full">
        {minLabel && (
          <span
            className="text-xs font-mono tabular-nums tabular shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {minLabel}
          </span>
        )}

        <div className="relative flex items-center flex-1 h-5">
          <input
            type="range"
            min={min}
            max={max}
            step={step}
            value={clampedValue}
            disabled={disabled}
            onChange={handleChange}
            className="w-full h-1.5 rounded-full appearance-none cursor-pointer focus-visible:outline-none"
            style={{
              background: `linear-gradient(to right, var(--accent) 0%, var(--accent) ${percentage}%, var(--elevated) ${percentage}%, var(--elevated) 100%)`,
              border: '1px solid var(--border)',
            }}
          />
        </div>

        {maxLabel && (
          <span
            className="text-xs font-mono tabular-nums tabular shrink-0"
            style={{ color: 'var(--text-muted)' }}
          >
            {maxLabel}
          </span>
        )}
      </div>
    </div>
  );
}
