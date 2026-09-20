import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  ThemeColors,
  DynamicUIConfig,
  AISettings,
  AlarmItem,
} from '../types';
import { soundService } from '../services/sound';
import { ChatMessage, AICompilerService } from '../services/aiCompiler';

/** Message ids and timestamps are created outside render so components stay pure. */
let messageSeq = 0;
function createMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${Date.now()}-${messageSeq}`;
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
  /** Retained for App.tsx compatibility. */
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
  onSetTimerMinutes,
  onNavigateToModule,
  messages,
  onSendMessage,
  onResetChat,
}) => {
  const [inputText, setInputText] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, isOpen, scrollToBottom]);

  if (!isOpen) return null;

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

      // 2. Execute against app services
      const outcome = await AICompilerService.executeAction(actionPlan);

      // 3. Check for timer intent if user asked
      const lower = textToSend.toLowerCase();
      const timerMatch = lower.match(/(?:таймер|помодоро)\s+(?:на\s+)?(\d+)\s*(?:мин|минут)/);
      if (timerMatch && onSetTimerMinutes) {
        const mins = parseInt(timerMatch[1], 10);
        if (mins > 0) {
          onSetTimerMinutes(mins);
          if (onNavigateToModule) onNavigateToModule('timer');
        }
      }

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
            placeholder="Создать задачу, список, заметку, план..."
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
          <span>Поддерживает: задачи, списки, заметки, план дня</span>
          <span>{aiSettings.apiKey ? 'Online LLM' : 'Offline Mode'}</span>
        </div>
      </form>
    </div>
  );
};
