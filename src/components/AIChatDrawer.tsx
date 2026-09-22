import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ThemeColors,
  DynamicUIConfig,
  AISettings,
  AlarmItem,
} from '../types';
import { soundService } from '../services/sound';
import { ChatMessage, AICompilerService, AlarmDraft } from '../services/aiCompiler';
import { applyAlarms, type Alarm } from '../services/alarms';
import { emitDataChanged } from '../services/appEvents';

/** Message ids and timestamps are created outside render so components stay pure. */
let messageSeq = 0;
function createMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${Date.now()}-${messageSeq}`;
}

const WEEKDAY_NAMES_RU = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function formatAlarmWhen(alarm: AlarmDraft): string {
  if (alarm.repeat === 'interval') {
    const mins = alarm.intervalMinutes || 60;
    const window =
      alarm.windowStart && alarm.windowEnd
        ? ` (${alarm.windowStart}–${alarm.windowEnd})`
        : '';
    return `Каждые ${mins} мин${window}`;
  }
  if (alarm.repeat === 'date') {
    return `${alarm.date || ''} ${alarm.time}`.trim();
  }
  if (alarm.repeat === 'days' && alarm.days && alarm.days.length > 0) {
    const daysStr = alarm.days.map((d) => WEEKDAY_NAMES_RU[d] || String(d)).join(', ');
    return `${daysStr} ${alarm.time}`;
  }
  if (alarm.repeat === 'daily') {
    return `Каждый день ${alarm.time}`;
  }
  return alarm.time;
}

function formatAlarmCountNoun(count: number): string {
  if (count === 1) return 'будильник';
  if (count >= 2 && count <= 4) return 'будильника';
  return 'будильников';
}

interface AIChatDrawerProps {
  isOpen: boolean;
  hideHeader?: boolean;
  onClose: () => void;
  theme: ThemeColors;
  currentUi: DynamicUIConfig;
  aiSettings: AISettings;
  /** Retained for App.tsx compatibility — will be no-op since UI mutations were removed. */
  onApplyUI?: (config: DynamicUIConfig) => void;
  /** Receives newly created alarms after confirmation (R02). */
  onApplyAlarms?: (alarms: AlarmItem[]) => void;
  onSetTimerMinutes?: (minutes: number) => void;
  onNavigateToModule?: (module: 'today' | 'timer' | 'alarms') => void;
  messages: ChatMessage[];
  onSendMessage: (msg: ChatMessage) => void;
  onResetChat?: () => void;
}

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({
  isOpen,
  hideHeader = false,
  onClose,
  theme,
  aiSettings,
  onApplyAlarms,
  onSetTimerMinutes,
  onNavigateToModule,
  messages,
  onSendMessage,
  onResetChat,
}) => {
  const [inputText, setInputText] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [pendingAlarms, setPendingAlarms] = useState<AlarmDraft[] | null>(null);
  const [isApplyingAlarms, setIsApplyingAlarms] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, pendingAlarms, isOpen, scrollToBottom]);

  if (!isOpen) return null;

  const handleConfirmAlarms = async () => {
    if (!pendingAlarms || pendingAlarms.length === 0 || isApplyingAlarms) return;
    setIsApplyingAlarms(true);
    try {
      const alarmsToCreate: Alarm[] = pendingAlarms.map((draft, idx) => ({
        id:
          typeof crypto !== 'undefined' && crypto.randomUUID
            ? crypto.randomUUID()
            : `alarm_${Date.now()}_${idx}`,
        label: draft.label || 'Будильник',
        time: draft.time,
        repeat: draft.repeat,
        days: draft.days || [],
        date: draft.date ?? null,
        intervalMinutes: draft.intervalMinutes ?? null,
        windowStart: draft.windowStart ?? null,
        windowEnd: draft.windowEnd ?? null,
        enabled: true,
        sound: 'gentle',
      }));

      const created = await applyAlarms(alarmsToCreate);
      emitDataChanged('alarms', created.map((a) => a.id));

      if (onApplyAlarms) {
        onApplyAlarms(created.map((a) => ({ ...a, title: a.label } as unknown as AlarmItem)));
      }

      const count = created.length;
      const confirmText = `Создано ${count} ${formatAlarmCountNoun(count)}.`;
      const assistantMsg: ChatMessage = {
        id: createMessageId('asst'),
        sender: 'assistant',
        text: confirmText,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onSendMessage(assistantMsg);
      soundService.speak(confirmText);
      setPendingAlarms(null);
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      const assistantMsg: ChatMessage = {
        id: createMessageId('err'),
        sender: 'assistant',
        text: `Ошибка при создании будильников: ${errorMsg}.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onSendMessage(assistantMsg);
    } finally {
      setIsApplyingAlarms(false);
    }
  };

  const handleCancelAlarms = () => {
    setPendingAlarms(null);
    const cancelMsg: ChatMessage = {
      id: createMessageId('asst'),
      sender: 'assistant',
      text: 'Создание будильников отменено.',
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    onSendMessage(cancelMsg);
  };

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!inputText.trim() || isCompiling) return;

    const textToSend = inputText.trim();
    setInputText('');

    soundService.playCountdownTick();
    const userMsg: ChatMessage = {
      id: createMessageId('user'),
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    };
    onSendMessage(userMsg);

    setIsCompiling(true);

    try {
      // 1. Compile user intent (either via LLM or deterministic keyword mapper)
      const actionPlan = await AICompilerService.compileIntent(textToSend, aiSettings);

      // 2. Check for timer intent if user asked (R13)
      const lower = textToSend.toLowerCase();
      const timerMatch = lower.match(/(?:таймер|помодоро)\s+(?:на\s+)?(\d+)\s*(?:мин|минут)/);
      if (timerMatch && onSetTimerMinutes) {
        const mins = parseInt(timerMatch[1], 10);
        if (mins > 0) {
          onSetTimerMinutes(mins);
          if (onNavigateToModule) onNavigateToModule('timer');
        }
      }

      // 3. Alarms intent: proposal renders as preview card, nothing written before confirm (R04)
      if (actionPlan.action === 'create_alarms' && actionPlan.alarms && actionPlan.alarms.length > 0) {
        setPendingAlarms(actionPlan.alarms);
        const explanationText =
          actionPlan.explanation || actionPlan.reply || 'Предлагаю настроить следующие будильники:';
        const assistantMsg: ChatMessage = {
          id: createMessageId('asst'),
          sender: 'assistant',
          text: explanationText,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        };
        onSendMessage(assistantMsg);
        soundService.speak(explanationText.slice(0, 100));
        return;
      }

      // 4. Execute against app services for other actions
      const outcome = await AICompilerService.executeAction(actionPlan);

      const assistantMsg: ChatMessage = {
        id: createMessageId('asst'),
        sender: 'assistant',
        text: outcome.explanation,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onSendMessage(assistantMsg);
      soundService.speak(outcome.explanation.slice(0, 100));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      const assistantMsg: ChatMessage = {
        id: createMessageId('err'),
        sender: 'assistant',
        text: `Произошла ошибка при обработке запроса: ${errorMsg}. Чат остаётся доступен.`,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      };
      onSendMessage(assistantMsg);
    } finally {
      setIsCompiling(false);
    }
  };

  return (
    <div
      className="flex flex-col h-full bg-[var(--surface)] text-[var(--foreground)] border-l border-[var(--border)] select-none shadow-2xl relative"
      data-theme={theme}
    >
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-active)]/50 backdrop-blur-md">
          <div className="flex items-center space-x-2">
            <div className="w-2.5 h-2.5 rounded-full bg-[var(--accent)] animate-pulse" />
            <h3 className="text-xs font-black tracking-wider uppercase text-[var(--accent)]">
              Tempo Assistant
            </h3>
          </div>
          <div className="flex items-center space-x-2">
            {onResetChat && (
              <button
                onClick={onResetChat}
                title="Очистить историю чата"
                className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-all text-xs"
              >
                Очистить
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1 rounded-md text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-all"
              aria-label="Закрыть ассистент"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm scrollbar-thin">
        {messages.map((msg) => {
          const isUser = msg.sender === 'user';
          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-1.5 animate-fadeIn`}
            >
              <div
                className={`max-w-[88%] px-3.5 py-2.5 rounded-2xl ${
                  isUser
                    ? 'bg-[var(--accent)] text-white font-medium rounded-tr-none shadow-sm'
                    : 'bg-[var(--surface-active)] text-[var(--foreground)] rounded-tl-none border border-[var(--border)] shadow-sm'
                }`}
              >
                <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
              </div>
              <span className="text-[10px] text-[var(--text-muted)] px-1">
                {msg.timestamp || ''}
              </span>
            </div>
          );
        })}

        {/* Preview card for pending alarm proposal (R04) */}
        {pendingAlarms && pendingAlarms.length > 0 && (
          <div
            data-testid="ai-alarm-preview-card"
            className="rounded-2xl border border-[var(--border)] bg-[var(--surface-active)] p-3.5 space-y-3 shadow-md animate-fadeIn"
          >
            <div className="flex items-center justify-between">
              <div className="text-xs font-semibold tracking-wide uppercase text-[var(--accent)]">
                Предпросмотр будильников
              </div>
              <span className="text-[11px] font-mono text-[var(--text-muted)]">
                {pendingAlarms.length}
              </span>
            </div>

            <div className="space-y-1.5 divide-y divide-[var(--border)]/40">
              {pendingAlarms.map((alarm, idx) => (
                <div
                  key={idx}
                  data-testid="ai-alarm-preview-row"
                  className="pt-1.5 first:pt-0 flex items-center justify-between text-xs"
                >
                  <span className="font-mono font-medium text-[var(--foreground)]">
                    {formatAlarmWhen(alarm)}
                  </span>
                  <span className="text-[var(--text-secondary)] truncate ml-3 max-w-[60%] text-right font-medium">
                    {alarm.label}
                  </span>
                </div>
              ))}
            </div>

            <div className="flex items-center space-x-2 pt-1">
              <button
                type="button"
                data-testid="ai-alarm-confirm-btn"
                disabled={isApplyingAlarms}
                onClick={handleConfirmAlarms}
                className="flex-1 py-1.5 px-3 rounded-xl bg-[var(--accent)] text-white text-xs font-medium hover:opacity-90 active:scale-95 transition-all disabled:opacity-50"
              >
                {isApplyingAlarms
                  ? 'Создаю...'
                  : `Создать ${pendingAlarms.length} ${formatAlarmCountNoun(pendingAlarms.length)}`}
              </button>
              <button
                type="button"
                data-testid="ai-alarm-cancel-btn"
                disabled={isApplyingAlarms}
                onClick={handleCancelAlarms}
                className="py-1.5 px-3 rounded-xl border border-[var(--border)] text-xs text-[var(--text-muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-all"
              >
                Отмена
              </button>
            </div>
          </div>
        )}

        {isCompiling && (
          <div className="flex items-center space-x-2 text-[var(--text-muted)] text-xs p-2">
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce" />
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:0.2s]" />
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-bounce [animation-delay:0.4s]" />
            <span className="ml-2">Анализирую и применяю...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input bar */}
      <form onSubmit={handleSend} className="p-3 border-t border-[var(--border)] bg-[var(--surface-active)]/30">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            placeholder="Создать задачу, список, заметку, расписание..."
            disabled={isCompiling}
            className="w-full bg-[var(--surface)] text-[var(--foreground)] placeholder-[var(--text-muted)] text-xs rounded-xl pl-3 pr-10 py-2.5 border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!inputText.trim() || isCompiling}
            className="absolute right-1.5 p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40 disabled:hover:bg-[var(--accent)] hover:opacity-90 transition-all"
            aria-label="Отправить сообщение"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
        <div className="flex justify-between items-center px-1 mt-2 text-[10px] text-[var(--text-muted)]">
          <span>Поддерживает: задачи, расписания, будильники, заметки</span>
          <span>{aiSettings.apiKey ? 'Online LLM' : 'Offline Mode'}</span>
        </div>
      </form>
    </div>
  );
};
