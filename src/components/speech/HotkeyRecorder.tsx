import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Keyboard, X, AlertCircle } from 'lucide-react';
import { validateHotkey, suspendShortcuts, resumeShortcuts } from '../../services/stt';
import { Kbd } from '../ui/Kbd';
import { I18nService } from '../../services/i18n';

export interface HotkeyRecorderProps {
  value: string;
  onChange: (hotkey: string) => void;
  placeholder?: string;
  disabled?: boolean;
}

function parseAcceleratorToKeys(accel: string): string[] {
  if (!accel || !accel.trim()) return [];
  return accel
    .split('+')
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => {
      if (k.toLowerCase() === 'commandorcontrol') return 'Ctrl';
      if (k.toLowerCase() === 'control') return 'Ctrl';
      if (k.toLowerCase() === 'shift') return 'Shift';
      if (k.toLowerCase() === 'alt') return 'Alt';
      if (k.toLowerCase() === 'meta') return 'Super';
      return k;
    });
}

const MODIFIER_NAMES = ['Control', 'Shift', 'Alt', 'Meta'];

function isModifierKey(e: KeyboardEvent): boolean {
  if (MODIFIER_NAMES.includes(e.key)) return true;
  const code = e.code || '';
  return (
    code.startsWith('Control') ||
    code.startsWith('Shift') ||
    code.startsWith('Alt') ||
    code.startsWith('Meta')
  );
}

function getNormalizedKey(e: KeyboardEvent): string {
  const code = e.code || '';
  if (code.match(/^F\d+$/)) return code;
  if (code.match(/^Key[A-Z]$/)) return code.replace('Key', '');
  if (code.match(/^Digit\d$/)) return code.replace('Digit', '');
  if (code.match(/^Numpad\d$/)) return code.replace('Numpad', 'Num');
  if (code === 'Space' || e.key === ' ' || e.key === 'Space') return 'Space';
  if (code === 'Escape' || e.key === 'Escape' || e.key === 'Esc') return 'Escape';
  if (code === 'Enter' || e.key === 'Enter') return 'Enter';
  if (code === 'Tab' || e.key === 'Tab') return 'Tab';
  if (code === 'Backspace' || e.key === 'Backspace') return 'Backspace';
  if (code === 'Delete' || e.key === 'Delete' || e.key === 'Del') return 'Delete';
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  return e.key || code;
}

export const HotkeyRecorder: React.FC<HotkeyRecorderProps> = ({
  value,
  onChange,
  placeholder = 'Click to record hotkey',
  disabled = false,
}) => {
  const t = I18nService.t();
  const [isRecording, setIsRecording] = useState(false);
  const [currentKeys, setCurrentKeys] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const keysRef = useRef<string[]>([]);
  const isCommittingRef = useRef(false);
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const stopRecording = useCallback(async () => {
    setIsRecording(false);
    keysRef.current = [];
    setCurrentKeys([]);
    try {
      await resumeShortcuts();
    } catch {
      // Ignored in non-Tauri
    }
  }, []);

  const startRecording = useCallback(async () => {
    if (disabled || isRecording) return;
    setError(null);
    keysRef.current = [];
    setCurrentKeys([]);
    setIsRecording(true);
    try {
      await suspendShortcuts();
    } catch {
      // Ignored in non-Tauri
    }
  }, [disabled, isRecording]);

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
    setError(null);
  };

  useEffect(() => {
    if (!isRecording) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.repeat) return;

      const keysList: string[] = [];
      if (e.ctrlKey) keysList.push('Ctrl');
      if (e.altKey) keysList.push('Alt');
      if (e.shiftKey) keysList.push('Shift');
      if (e.metaKey) keysList.push('Super');

      const isMod = isModifierKey(e);
      const norm = getNormalizedKey(e);

      if (!isMod) {
        keysList.push(norm);
      } else {
        const existingNonMod = keysRef.current.find(
          (k) => !['Ctrl', 'Alt', 'Shift', 'Super'].includes(k)
        );
        if (existingNonMod) {
          keysList.push(existingNonMod);
        }
      }

      keysRef.current = keysList;
      setCurrentKeys(keysList);
    };

    const handleKeyUp = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const isMod = isModifierKey(e);

      if (isMod) {
        const hasNonModifier = keysRef.current.some(
          (k) => !['Ctrl', 'Alt', 'Shift', 'Super'].includes(k)
        );
        if (!hasNonModifier) {
          keysRef.current = [];
          setCurrentKeys([]);
        }
        return;
      }

      if (isCommittingRef.current) return;

      const keysToCommit = [...keysRef.current];
      const hasNonMod = keysToCommit.some(
        (k) => !['Ctrl', 'Alt', 'Shift', 'Super'].includes(k)
      );

      if (keysToCommit.length > 0 && hasNonMod) {
        const accelerator = keysToCommit.join('+');
        try {
          isCommittingRef.current = true;
          await validateHotkey(accelerator);
          onChangeRef.current(accelerator);
          setError(null);
          await stopRecording();
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Invalid or busy shortcut');
          await stopRecording();
        } finally {
          isCommittingRef.current = false;
        }
      }
    };

    const handleWindowBlur = () => {
      stopRecording();
    };

    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp, true);
    window.addEventListener('blur', handleWindowBlur);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp, true);
      window.removeEventListener('blur', handleWindowBlur);
    };
  }, [isRecording, stopRecording]);

  const displayKeys = isRecording
    ? currentKeys.length > 0
      ? currentKeys
      : []
    : parseAcceleratorToKeys(value);

  return (
    <div className="flex flex-col gap-1 w-full max-w-sm">
      <div
        ref={containerRef}
        role="button"
        tabIndex={disabled ? undefined : 0}
        onClick={startRecording}
        onKeyDown={(e) => {
          if (!isRecording && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            startRecording();
          }
        }}
        data-testid="hotkey-recorder"
        className={`flex items-center justify-between gap-3 px-3 py-2 rounded-[8px] border transition-all cursor-pointer select-none ${
          disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''
        } ${
          isRecording
            ? 'border-[var(--accent)] ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--bg)]'
            : 'hover:border-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]'
        }`}
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: isRecording ? 'var(--accent)' : 'var(--border)',
        }}
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Keyboard
            className={`w-4 h-4 shrink-0 ${
              isRecording ? 'text-[var(--accent)] animate-pulse' : 'text-[var(--text-muted)]'
            }`}
          />

          {isRecording ? (
            <span className="text-xs font-medium text-[var(--accent)] animate-pulse">
              {currentKeys.length > 0 ? (
                <Kbd keys={currentKeys} />
              ) : (
                'Press shortcut keys...'
              )}
            </span>
          ) : displayKeys.length > 0 ? (
            <Kbd keys={displayKeys} />
          ) : (
            <span className="text-xs italic" style={{ color: 'var(--text-muted)' }}>
              {placeholder}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {isRecording ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                stopRecording();
              }}
              className="p-1 rounded hover:bg-[var(--elevated)] text-xs font-medium"
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
          ) : (
            value && (
              <button
                type="button"
                onClick={handleClear}
                className="p-1 rounded hover:bg-[var(--elevated)] transition-colors"
                title={t.speechClearShortcut}
                aria-label={t.speechClearShortcut}
              >
                <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
              </button>
            )
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-red-400 mt-0.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
};
