import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Search,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  Bookmark,
  BookmarkCheck,
  Clock,
  Mic,
  Loader2,
} from 'lucide-react';
import type { SpeechConfig } from '../../services/speechSettings';
import {
  historyList,
  historyDelete,
  historySetSaved,
  historyRetry,
  historyClear,
  type HistoryEntry,
} from '../../services/stt';
import { onSttEvent } from '../../services/sttEvents';
import { I18nService } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';
import { formatDuration } from './utils';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type HistoryPanelProps = SpeechSectionProps;

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [filterSaved, setFilterSaved] = useState(false);

  const fetchHistory = useCallback(async () => {
    try {
      setIsLoading(true);
      const limit = config.historyLimit > 0 ? config.historyLimit : 100;
      const list = await historyList(limit);
      setEntries(list || []);
    } catch {
      // Ignored outside Tauri / on error
    } finally {
      setIsLoading(false);
    }
  }, [config.historyLimit]);

  useEffect(() => {
    let active = true;
    const limit = config.historyLimit > 0 ? config.historyLimit : 100;
    void historyList(limit)
      .then((list) => {
        if (active) {
          setEntries(list || []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [config.historyLimit]);
  // Subscribe to STT events so history refreshes automatically when dictation stops
  useEffect(() => {
    const unsubscribe = onSttEvent((event) => {
      if (event.type === 'dictation-stopped') {
        void fetchHistory();
      }
    });
    return () => unsubscribe();
  }, [fetchHistory]);

  const handleCopy = async (entry: HistoryEntry) => {
    try {
      await navigator.clipboard.writeText(entry.text);
      setCopiedId(entry.id);
      window.setTimeout(() => {
        setCopiedId((curr) => (curr === entry.id ? null : curr));
      }, 1500);
    } catch {
      // clipboard fallback
    }
  };

  const handleToggleSaved = async (entry: HistoryEntry) => {
    const nextSaved = !entry.saved;
    // Optimistic UI update
    setEntries((prev) =>
      prev.map((item) => (item.id === entry.id ? { ...item, saved: nextSaved } : item)),
    );
    try {
      await historySetSaved(entry.id, nextSaved);
    } catch {
      // Revert on failure
      setEntries((prev) =>
        prev.map((item) => (item.id === entry.id ? { ...item, saved: entry.saved } : item)),
      );
    }
  };

  const handleDelete = async (id: string) => {
    setEntries((prev) => prev.filter((item) => item.id !== id));
    try {
      await historyDelete(id);
    } catch {
      void fetchHistory();
    }
  };

  const handleRetry = async (entry: HistoryEntry) => {
    try {
      setRetryingId(entry.id);
      const res = await historyRetry(entry.id);
      if (res?.text) {
        setEntries((prev) =>
          prev.map((item) => (item.id === entry.id ? { ...item, text: res.text } : item)),
        );
      }
    } catch {
      // Failed retry handled gracefully
    } finally {
      setRetryingId(null);
    }
  };

  const handleClearAll = async () => {
    const confirmed = window.confirm(t.settingsSpeechHistoryClearConfirm);
    if (!confirmed) return;

    try {
      await historyClear();
      setEntries([]);
    } catch {
      void fetchHistory();
    }
  };

  const filteredEntries = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return entries.filter((entry) => {
      if (filterSaved && !entry.saved) return false;
      if (!q) return true;
      return (
        entry.text.toLowerCase().includes(q) ||
        (entry.modelId && entry.modelId.toLowerCase().includes(q)) ||
        (entry.language && entry.language.toLowerCase().includes(q))
      );
    });
  }, [entries, searchQuery, filterSaved]);

  const retentionOptions = [
    { value: 7, label: '7 d.' },
    { value: 30, label: '30 d.' },
    { value: 90, label: '90 d.' },
    { value: 0, label: t.settingsSpeechHistoryRetentionForever || 'Forever' },
  ];

  return (
    <div data-testid="history-panel" className="space-y-4">
      {/* History Controls & Retention settings */}
      <div
        className="p-3 rounded-[10px] border divide-y divide-[var(--border)]"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label={t.settingsSpeechHistoryEnabled}
          control={
            <div data-testid="history-enabled-toggle">
              <Toggle
                checked={config.historyEnabled}
                onChange={(val) => onChange({ historyEnabled: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />

        <div className="py-2.5 px-3.5 flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechHistoryLimit}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Max entries stored in database
            </span>
          </div>
          <select
            data-testid="history-limit-select"
            value={config.historyLimit}
            onChange={(e) => onChange({ historyLimit: Number(e.target.value) })}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-[6px] border text-xs font-medium cursor-pointer"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <option value={50}>50</option>
            <option value={100}>100</option>
            <option value={250}>250</option>
            <option value={500}>500</option>
            <option value={1000}>1000</option>
          </select>
        </div>

        <div className="py-2.5 px-3.5 flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechHistoryRetention}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Auto-delete older records
            </span>
          </div>
          <select
            data-testid="history-retention-select"
            value={config.retentionDays}
            onChange={(e) => onChange({ retentionDays: Number(e.target.value) })}
            disabled={disabled}
            className="px-2.5 py-1.5 rounded-[6px] border text-xs font-medium cursor-pointer"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            {retentionOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* History Search & Actions Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search
            className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: 'var(--text-muted)' }}
          />
          <input
            type="text"
            data-testid="history-search-input"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.settingsSpeechHistorySearch}
            className="w-full pl-8 pr-3 py-1.5 rounded-[8px] border text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          />
        </div>

        <button
          type="button"
          data-testid="history-filter-saved-btn"
          onClick={() => setFilterSaved((prev) => !prev)}
          className={`px-2.5 py-1.5 rounded-[8px] border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer ${
            filterSaved ? 'border-[var(--accent)]' : ''
          }`}
          style={{
            backgroundColor: filterSaved ? 'var(--accent-soft)' : 'var(--surface)',
            color: filterSaved ? 'var(--accent)' : 'var(--text-muted)',
            borderColor: filterSaved ? 'var(--accent)' : 'var(--border)',
          }}
          title={filterSaved ? 'Showing saved only' : 'Filter saved'}
        >
          <BookmarkCheck className="w-3.5 h-3.5" />
          <span>{t.speechSaved}</span>
        </button>

        {entries.length > 0 && !disabled && (
          <button
            type="button"
            data-testid="history-clear-button"
            onClick={handleClearAll}
            className="px-2.5 py-1.5 rounded-[8px] border text-xs font-medium flex items-center gap-1.5 transition-colors cursor-pointer text-red-400 hover:text-red-300"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
            }}
            title={t.settingsSpeechHistoryClear}
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>{t.settingsSpeechHistoryClear}</span>
          </button>
        )}
      </div>

      {/* History Items List */}
      <div className="space-y-2">
        {isLoading ? (
          <div className="p-8 text-center flex flex-col items-center gap-2">
            <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Loading history...
            </span>
          </div>
        ) : filteredEntries.length === 0 ? (
          <div
            className="p-8 text-center rounded-[10px] border border-dashed flex flex-col items-center gap-2"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            <Mic className="w-6 h-6 opacity-40" />
            <div className="text-xs font-medium">
              {searchQuery || filterSaved ? 'No matching records found' : t.settingsSpeechHistoryEmpty}
            </div>
          </div>
        ) : (
          filteredEntries.map((entry) => {
            const isCopied = copiedId === entry.id;
            const isRetrying = retryingId === entry.id;
            const durationText = formatDuration(entry.durationMs ?? entry.duration_ms ?? 0);
            const createdAtDate = entry.createdAt ?? entry.created_at ?? '';

            return (
              <div
                key={entry.id}
                data-testid={`history-entry-${entry.id}`}
                className="p-3.5 rounded-[10px] border flex flex-col gap-2 transition-all hover:border-[var(--accent)]/50 group"
                style={{
                  backgroundColor: 'var(--surface)',
                  borderColor: 'var(--border)',
                }}
              >
                {/* Text body */}
                <div
                  className="text-xs leading-relaxed break-words font-medium select-text"
                  style={{ color: 'var(--text)' }}
                >
                  {entry.text}
                </div>

                {/* Metadata & Actions */}
                <div className="flex items-center justify-between gap-2 pt-1 border-t border-[var(--border)]/50 text-[11px]">
                  <div className="flex items-center gap-2.5 flex-wrap" style={{ color: 'var(--text-muted)' }}>
                    {createdAtDate && (
                      <span title={createdAtDate}>
                        {new Date(createdAtDate).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    )}
                    {durationText && (
                      <span className="flex items-center gap-1 font-mono">
                        <Clock className="w-3 h-3" />
                        {durationText}
                      </span>
                    )}
                    {(entry.modelId ?? entry.model_id) && (
                      <span
                        className="px-1.5 py-0.5 rounded-[4px] font-mono text-[10px]"
                        style={{ backgroundColor: 'var(--elevated)' }}
                      >
                        {entry.modelId ?? entry.model_id}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1">
                    {/* Copy */}
                    <button
                      type="button"
                      data-testid={`history-copy-${entry.id}`}
                      onClick={() => handleCopy(entry)}
                      className="p-1 rounded hover:bg-[var(--elevated)] transition-colors cursor-pointer"
                      title={isCopied ? t.settingsSpeechHistoryCopied : t.settingsSpeechHistoryCopy}
                    >
                      {isCopied ? (
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <Copy className="w-3.5 h-3.5 text-[var(--text-muted)] hover:text-[var(--text)]" />
                      )}
                    </button>

                    {/* Retry transcription */}
                    <button
                      type="button"
                      data-testid={`history-retry-${entry.id}`}
                      onClick={() => handleRetry(entry)}
                      disabled={isRetrying}
                      className="p-1 rounded hover:bg-[var(--elevated)] transition-colors cursor-pointer disabled:opacity-50"
                      title={t.settingsSpeechHistoryRetry}
                    >
                      {isRetrying ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />
                      ) : (
                        <RotateCcw className="w-3.5 h-3.5 text-[var(--text-muted)] hover:text-[var(--text)]" />
                      )}
                    </button>

                    {/* Bookmark / Save */}
                    <button
                      type="button"
                      data-testid={`history-save-${entry.id}`}
                      onClick={() => handleToggleSaved(entry)}
                      className="p-1 rounded hover:bg-[var(--elevated)] transition-colors cursor-pointer"
                      title={entry.saved ? t.settingsSpeechHistoryUnsave : t.settingsSpeechHistorySave}
                    >
                      {entry.saved ? (
                        <BookmarkCheck className="w-3.5 h-3.5 text-[var(--accent)]" />
                      ) : (
                        <Bookmark className="w-3.5 h-3.5 text-[var(--text-muted)] hover:text-[var(--text)]" />
                      )}
                    </button>

                    {/* Delete */}
                    <button
                      type="button"
                      data-testid={`history-delete-${entry.id}`}
                      onClick={() => handleDelete(entry.id)}
                      className="p-1 rounded hover:bg-[var(--elevated)] transition-colors cursor-pointer text-red-400 hover:text-red-300"
                      title={t.settingsSpeechHistoryDelete}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default HistoryPanel;
