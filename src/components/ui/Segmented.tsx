
export interface SegmentOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string | number> {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
}

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  disabled = false,
}: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      className={`inline-flex p-1 rounded-[10px] items-center gap-1 ${
        disabled ? 'opacity-40 pointer-events-none' : ''
      }`}
      style={{
        backgroundColor: 'var(--surface)',
        border: '1px solid var(--border)',
      }}
    >
      {options.map((option) => {
        const isSelected = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={isSelected}
            disabled={disabled}
            onClick={(e) => {
              e.stopPropagation();
              if (!disabled && option.value !== value) {
                onChange(option.value);
              }
            }}
            className={`px-3 py-1.5 text-xs font-medium rounded-[6px] transition-all duration-150 cursor-pointer select-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] ${
              isSelected ? 'shadow-sm' : 'hover:text-[var(--text)]'
            }`}
            style={{
              backgroundColor: isSelected ? 'var(--accent)' : 'transparent',
              color: isSelected ? 'var(--bg)' : 'var(--text-muted)',
              fontWeight: isSelected ? 600 : 500,
            }}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
