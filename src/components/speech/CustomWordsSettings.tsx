import React, { useState } from 'react';
import { Plus, X, Trash2 } from 'lucide-react';
import type { SpeechConfig } from '../../services/speechSettings';
import { I18nService } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type CustomWordsSettingsProps = SpeechSectionProps;

export const CustomWordsSettings: React.FC<CustomWordsSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [inputValue, setInputValue] = useState('');

  const words = config.customWords || [];

  const handleAddWord = () => {
    const trimmed = inputValue.trim();
    if (!trimmed) return;

    // Support comma or newline separated entries if pasted
    const newEntries = trimmed
      .split(/[,\n]+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 0);

    const existingSet = new Set(words);
    const toAdd = newEntries.filter((w) => !existingSet.has(w));

    if (toAdd.length > 0) {
      onChange({ customWords: [...words, ...toAdd] });
    }
    setInputValue('');
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddWord();
    }
  };

  const handleRemoveWord = (wordToRemove: string) => {
    onChange({
      customWords: words.filter((w) => w !== wordToRemove),
    });
  };

  const handleClearAll = () => {
    onChange({ customWords: [] });
  };

  return (
    <div data-testid="custom-words-settings" className="space-y-4">
      {/* Custom Vocabulary Editor */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechCustomWords}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechCustomWordsDesc}
            </div>
          </div>
          {words.length > 0 && !disabled && (
            <button
              type="button"
              onClick={handleClearAll}
              data-testid="custom-words-clear-btn"
              className="flex items-center gap-1 text-xs px-2 py-1 rounded hover:bg-[var(--elevated)] transition-colors cursor-pointer text-red-400 hover:text-red-300"
              title="Clear all words"
            >
              <Trash2 className="w-3 h-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Input box */}
        <div className="flex gap-2">
          <input
            type="text"
            data-testid="custom-word-input"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t.settingsSpeechCustomWordsPlaceholder}
            disabled={disabled}
            className="flex-1 px-3 py-2 rounded-[8px] border text-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          />
          <button
            type="button"
            data-testid="custom-word-add-btn"
            onClick={handleAddWord}
            disabled={disabled || !inputValue.trim()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--bg)',
            }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Add</span>
          </button>
        </div>

        {/* Word chips */}
        {words.length > 0 ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {words.map((word) => (
              <span
                key={word}
                data-testid={`custom-word-chip-${word}`}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-xs font-medium border"
                style={{
                  backgroundColor: 'var(--elevated)',
                  borderColor: 'var(--border)',
                  color: 'var(--text)',
                }}
              >
                <span>{word}</span>
                {!disabled && (
                  <button
                    type="button"
                    data-testid={`custom-word-remove-${word}`}
                    onClick={() => handleRemoveWord(word)}
                    className="p-0.5 rounded hover:bg-[var(--surface)] transition-colors cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)]"
                    aria-label={`Remove ${word}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        ) : (
          <div className="text-xs italic py-1" style={{ color: 'var(--text-faint)' }}>
            No custom words added yet.
          </div>
        )}
      </div>

      {/* Filler Words Removal */}
      <div
        className="p-2 rounded-[10px] border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label={t.settingsSpeechRemoveFillerWords}
          description={t.settingsSpeechRemoveFillerWordsDesc}
          control={
            <div data-testid="remove-filler-words-toggle">
              <Toggle
                checked={config.removeFillerWords}
                onChange={(val) => onChange({ removeFillerWords: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export default CustomWordsSettings;
