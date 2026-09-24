import { useState, useEffect, type ReactElement } from 'react';
import { Sparkles, Loader2, Check, Trash2, AlertCircle, Info, Clock, Repeat } from 'lucide-react';
import { AICompilerService } from '../services/aiCompiler';
import { applyAlarms, type Alarm } from '../services/alarms';
import { AIGateway } from '../services/aiGateway';
import { StoreService } from '../services/store';
import { Card } from './ui/Card';
import type { AISettings } from '../types';

export interface AlarmDraft {
  label: string;
  time: string; // "HH:MM"
  repeat: 'once' | 'daily' | 'days' | 'date' | 'interval';
  days?: number[]; // 0-6
  date?: string; // YYYY-MM-DD
  intervalMinutes?: number;
  windowStart?: string; // "HH:MM"
  windowEnd?: string; // "HH:MM"
  sound?: string;
  note?: string;
}

export interface AIScheduleIntakeProps {
  onApplied?: (created: number) => void;
  onApply?: (created: number) => void;
}

export function AIScheduleIntake({ onApplied, onApply }: AIScheduleIntakeProps): ReactElement {
  const [inputText, setInputText] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [drafts, setDrafts] = useState<AlarmDraft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOfflineParser, setIsOfflineParser] = useState(false);
  const [hasRemoteKey, setHasRemoteKey] = useState(false);

  useEffect(() => {
    let active = true;
    void AIGateway.hasKey().then((has) => {
      if (active) {
        setHasRemoteKey(has);
      }
    }).catch(() => {
      if (active) {
        setHasRemoteKey(false);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  const handleParseSchedule = async () => {
    const trimmed = inputText.trim();
    if (!trimmed) {
      setError('Вставьте расписание или программу тренировок.');
      return;
    }
    setIsCompiling(true);
    setError(null);
    setDrafts(null);

    try {
      const hasStoredKey = await AIGateway.hasKey().catch(() => false);
      const snapshot = StoreService.isHydrated() ? StoreService.snapshot()?.aiSettings : null;
      const aiSettings: AISettings = snapshot || {
        apiKey: '',
        baseUrl: StoreService.getPreference<string>('tempo_ai_base_url', 'https://openrouter.ai/api/v1'),
        model: StoreService.getPreference<string>('tempo_ai_model', 'gpt-4o-mini'),
      };
      const keyAvailable = Boolean(aiSettings.apiKey && aiSettings.apiKey.trim().length > 0) || hasStoredKey;

      let plan;
      if (keyAvailable) {
        plan = await AICompilerService.compileIntent(trimmed, aiSettings);
        setIsOfflineParser(false);
      } else {
        plan = AICompilerService.compileLocalIntent(trimmed);
        setIsOfflineParser(true);
      }

      if (plan.action === 'create_alarms' && plan.alarms && plan.alarms.length > 0) {
        const mappedDrafts: AlarmDraft[] = plan.alarms.map((a) => ({
          label: a.label,
          time: a.time,
          repeat: a.repeat as AlarmDraft['repeat'],
          days: a.days,
          date: a.date ?? undefined,
          intervalMinutes: a.intervalMinutes ?? undefined,
          windowStart: a.windowStart ?? undefined,
          windowEnd: a.windowEnd ?? undefined,
          sound: a.sound,
          note: a.note,
        }));
        setDrafts(mappedDrafts);
      } else {
        setError(
          plan.explanation && plan.explanation !== 'Готово' && plan.explanation !== 'Никаких изменений не выполнено.'
            ? plan.explanation
            : 'Не удалось распознать задачи с временем. Укажите время для каждой активности (например: 09:00 зарядка).',
        );
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Ошибка анализа расписания: ${msg}`);
    } finally {
      setIsCompiling(false);
    }
  };

  const handleUpdateDraft = (index: number, patch: Partial<AlarmDraft>) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
  };

  const handleDeleteDraft = (index: number) => {
    setDrafts((prev) => {
      if (!prev) return prev;
      const next = prev.filter((_, idx) => idx !== index);
      return next.length > 0 ? next : null;
    });
  };

  const handleApply = async () => {
    if (!drafts || drafts.length === 0) return;
    setIsApplying(true);
    setError(null);

    try {
      const alarmsToCreate: Alarm[] = drafts.map((draft, idx) => ({
        id: `alarm_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        label: draft.label.trim() || 'Будильник',
        time: draft.time,
        repeat: draft.repeat,
        days: draft.days ?? (draft.repeat === 'daily' ? [0, 1, 2, 3, 4, 5, 6] : []),
        date: draft.date ?? null,
        intervalMinutes: draft.repeat === 'interval' ? (draft.intervalMinutes || 60) : null,
        windowStart: draft.windowStart ?? null,
        windowEnd: draft.windowEnd ?? null,
        enabled: true,
        sound: draft.sound || 'gentle',
        note: draft.note ?? null,
      }));

      const created = await applyAlarms(alarmsToCreate);
      const count = created && created.length > 0 ? created.length : alarmsToCreate.length;
      setDrafts(null);
      setInputText('');
      onApplied?.(count);
      onApply?.(count);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(`Ошибка создания будильников: ${msg}`);
    } finally {
      setIsApplying(false);
    }
  };

  const handleCancel = () => {
    setDrafts(null);
    setError(null);
  };

  return (
    <div data-testid="ai-schedule-intake">
      <Card
        variant="surface"
        padding="md"
        className="space-y-4"
      >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--text)]">
          <div className="w-7 h-7 rounded-lg bg-[var(--accent)]/15 flex items-center justify-center text-[var(--accent)]">
            <Sparkles className="w-4 h-4" />
          </div>
          <span>Расписание и программа дня</span>
        </div>
        {!hasRemoteKey && (
          <span
            className="text-[11px] font-mono text-[var(--text-muted)] bg-[var(--surface-active,rgba(255,255,255,0.05))] px-2 py-0.5 rounded-md border border-[var(--border)] select-none"
            title="API-ключ не настроен. Будет использован встроенный офлайн-парсер"
          >
            Офлайн-режим
          </span>
        )}
      </div>

      <p className="text-xs text-[var(--text-muted)] leading-relaxed">
        Вставьте текст программы тренировок или распорядок дня (например: «09:00 зарядка, 10:00 завтрак, пить воду каждый час с 9 до 18»). Tempo автоматически создаст будильники.
      </p>

      <div className="space-y-2">
        <textarea
          data-testid="ai-schedule-input"
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          disabled={isCompiling || isApplying}
          placeholder="09:00 зарядка, 10:00 завтрак, пить воду каждый час с 9 до 18, 18:00 тренировка..."
          rows={3}
          className="w-full text-xs font-mono rounded-xl p-3 bg-[var(--elevated)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] placeholder-[var(--text-faint)] resize-y min-h-[72px]"
        />

        <div className="flex items-center justify-between gap-2">
          <button
            type="button"
            data-testid="ai-schedule-submit-btn"
            disabled={isCompiling || isApplying || !inputText.trim()}
            onClick={handleParseSchedule}
            className="flex items-center gap-2 px-4 py-2 rounded-xl bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 disabled:pointer-events-none select-none cursor-pointer"
          >
            {isCompiling ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Расставляем будильники...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5" />
                <span>Расставить будильники</span>
              </>
            )}
          </button>
        </div>
      </div>

      {isCompiling && (
        <div
          data-testid="ai-schedule-loading"
          className="flex items-center gap-2 p-3 rounded-xl bg-[var(--elevated)] border border-[var(--border)] text-xs text-[var(--text-muted)]"
        >
          <Loader2 className="w-4 h-4 animate-spin text-[var(--accent)]" />
          <span>Анализируем текст расписания и формируем список будильников...</span>
        </div>
      )}

      {error && (
        <div
          data-testid="ai-schedule-error"
          className="flex items-start gap-2 p-3 rounded-xl bg-[var(--accent-red,#EF4444)]/10 border border-[var(--accent-red,#EF4444)]/30 text-xs text-[var(--accent-red,#EF4444)]"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="leading-relaxed">{error}</span>
        </div>
      )}

      {/* Confirmation preview card */}
      {drafts && drafts.length > 0 && (
        <div
          data-testid="ai-schedule-drafts-card"
          className="rounded-xl border border-[var(--border)] bg-[var(--elevated)] p-4 space-y-4 shadow-sm"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--accent)]">
                Предпросмотр будильников
              </span>
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-[var(--accent)]/15 text-[var(--accent)]">
                {drafts.length}
              </span>
            </div>
            <span className="text-[11px] text-[var(--text-muted)]">
              Отредактируйте перед подтверждением
            </span>
          </div>

          {isOfflineParser && (
            <div
              data-testid="ai-schedule-offline-notice"
              className="flex items-center gap-2 p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs text-[var(--text-muted)]"
            >
              <Info className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
              <span>Результаты получены с помощью локального офлайн-парсера (API-ключ не настроен).</span>
            </div>
          )}

          <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
            {drafts.map((draft, idx) => (
              <div
                key={idx}
                data-testid={`ai-schedule-draft-${idx}`}
                className="flex flex-wrap items-center gap-2 p-2.5 rounded-lg bg-[var(--surface)] border border-[var(--border)] text-xs"
              >
                <div className="flex items-center gap-1.5 shrink-0">
                  <Clock className="w-3.5 h-3.5 text-[var(--text-muted)]" />
                  <input
                    type="time"
                    data-testid={`draft-time-${idx}`}
                    value={draft.time}
                    onChange={(e) => handleUpdateDraft(idx, { time: e.target.value })}
                    className="font-mono bg-[var(--elevated)] text-[var(--text)] border border-[var(--border)] rounded px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)]"
                  />
                </div>

                <input
                  type="text"
                  data-testid={`draft-label-${idx}`}
                  value={draft.label}
                  onChange={(e) => handleUpdateDraft(idx, { label: e.target.value })}
                  placeholder="Название задачи"
                  className="flex-1 min-w-[140px] bg-[var(--elevated)] text-[var(--text)] border border-[var(--border)] rounded px-2.5 py-1 text-xs focus:outline-none focus:border-[var(--accent)]"
                />

                <div className="flex items-center gap-1.5 shrink-0">
                  <Repeat className="w-3 h-3 text-[var(--text-muted)]" />
                  <select
                    data-testid={`draft-repeat-${idx}`}
                    value={draft.repeat}
                    onChange={(e) =>
                      handleUpdateDraft(idx, {
                        repeat: e.target.value as AlarmDraft['repeat'],
                        intervalMinutes: e.target.value === 'interval' ? (draft.intervalMinutes || 60) : undefined,
                      })
                    }
                    className="bg-[var(--elevated)] text-[var(--text)] border border-[var(--border)] rounded px-2 py-1 text-xs focus:outline-none focus:border-[var(--accent)] cursor-pointer"
                  >
                    <option value="once">Однократно</option>
                    <option value="daily">Каждый день</option>
                    <option value="days">По дням недели</option>
                    <option value="interval">Интервал</option>
                    <option value="date">Дата</option>
                  </select>
                </div>

                {draft.repeat === 'interval' && (
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-[10px] text-[var(--text-muted)]">Каждые</span>
                    <input
                      type="number"
                      min={1}
                      step={5}
                      data-testid={`draft-interval-${idx}`}
                      value={draft.intervalMinutes || 60}
                      onChange={(e) =>
                        handleUpdateDraft(idx, {
                          intervalMinutes: parseInt(e.target.value, 10) || 60,
                        })
                      }
                      className="w-14 font-mono bg-[var(--elevated)] text-[var(--text)] border border-[var(--border)] rounded px-1.5 py-1 text-xs focus:outline-none focus:border-[var(--accent)]"
                    />
                    <span className="text-[10px] text-[var(--text-muted)]">мин</span>
                  </div>
                )}

                <button
                  type="button"
                  data-testid={`draft-delete-${idx}`}
                  onClick={() => handleDeleteDraft(idx)}
                  className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--accent-red,#EF4444)] hover:bg-[var(--elevated)] transition-colors cursor-pointer ml-auto"
                  title="Удалить черновик"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            ))}
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
            <button
              type="button"
              data-testid="ai-schedule-apply-btn"
              disabled={isApplying}
              onClick={handleApply}
              className="flex-1 flex items-center justify-center gap-2 py-2 px-4 rounded-xl bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 active:scale-95 transition-all disabled:opacity-50 select-none cursor-pointer"
            >
              {isApplying ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Создаём будильники...</span>
                </>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Применить ({drafts.length})</span>
                </>
              )}
            </button>
            <button
              type="button"
              data-testid="ai-schedule-cancel-btn"
              disabled={isApplying}
              onClick={handleCancel}
              className="py-2 px-4 rounded-xl border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface)] transition-all select-none cursor-pointer"
            >
              Отмена
            </button>
          </div>
        </div>
      )}
      </Card>
    </div>
  );
}
