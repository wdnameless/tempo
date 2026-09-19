
export interface KbdProps {
  keys: string[];
}

export function Kbd({ keys }: KbdProps) {
  return (
    <div className="inline-flex items-center gap-1 select-none">
      {keys.map((keyStr, index) => (
        <kbd
          key={`${keyStr}-${index}`}
          className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[11px] font-mono font-medium rounded-[4px] shadow-xs"
          style={{
            backgroundColor: 'var(--surface)',
            color: 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
        >
          {keyStr}
        </kbd>
      ))}
    </div>
  );
}
