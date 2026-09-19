import React, { useState, useRef, useEffect } from 'react';
import { HandClose, HandSend, HandSparkle, HandCheck } from './CustomIcons';
import { Loader2, ArrowRight, Plus, Copy, Check } from 'lucide-react';
import { soundService } from '../services/sound';
import { ThemeColors, DynamicUIConfig, AISettings, AlarmItem } from '../types';
import type { DirectionDraft } from '../services/aiCompiler';

import { ChatMessage, AICompilerService } from '../services/aiCompiler';

/** Message ids and timestamps are created outside render so components stay pure. */
let messageSeq = 0;
function createMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}_${Date.now()}_${messageSeq}`;
}

function nowLabel(): string {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

interface AIChatDrawerProps {
  isOpen: boolean;
  hideHeader?: boolean;
  onClose: () => void;
  theme: ThemeColors;
  currentUi: DynamicUIConfig;
  aiSettings: AISettings;
  onApplyUI: (newUi: DynamicUIConfig) => void;
  onApplyAlarms?: (alarms: AlarmItem[]) => void;
  /** Directions the assistant created from chat. */
  onApplyDirections?: (directions: DirectionDraft[]) => void;
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
  currentUi,
  aiSettings,
  onApplyUI,
  onApplyAlarms,
  onApplyDirections,
  onSetTimerMinutes,
  onNavigateToModule,
  messages,
  onSendMessage,
  onResetChat,
}) => {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  if (!isOpen) return null;

  const handleSend = async (customPrompt?: string) => {
    const textToSend = customPrompt || input;
    if (!textToSend.trim() || loading) return;

    soundService.playCountdownTick();
    const userMsg: ChatMessage = {
      id: createMessageId('user'),
      sender: 'user',
      text: textToSend,
      timestamp: nowLabel(),
    };

    onSendMessage(userMsg);
    if (!customPrompt) setInput('');
    setLoading(true);

    try {

      const mutation = await AICompilerService.compileUserIntent(textToSend, currentUi, aiSettings);

      if (mutation.ui) {
        onApplyUI({
          ...currentUi,
          ...mutation.ui,
          colors: { ...currentUi.colors, ...mutation.ui.colors },
          dial: { ...currentUi.dial, ...mutation.ui.dial },
          typography: { ...currentUi.typography, ...mutation.ui.typography },
          layout: { ...currentUi.layout, ...mutation.ui.layout },
        });
      }

      if (mutation.alarms && onApplyAlarms) {
        onApplyAlarms(mutation.alarms);
        onNavigateToModule?.('alarms');
      }

      if (mutation.directions?.length && onApplyDirections) {
        onApplyDirections(mutation.directions);
      }

      // Check for timer intent in text
      const timerMatch = textToSend.match(/таймер.*?(\d+)\s*(мин|m)/i) || textToSend.match(/(\d+)\s*(мин|m).*?таймер/i);
      if (timerMatch && onSetTimerMinutes) {
        const mins = parseInt(timerMatch[1], 10);
        onSetTimerMinutes(mins);
        onNavigateToModule?.('timer');
      }

      soundService.speak(mutation.explanation);

      const assistantMsg: ChatMessage = {
        id: createMessageId('asst'),
        sender: 'assistant',
        text: mutation.explanation,
        timestamp: nowLabel(),
        mutation,
      };

      onSendMessage(assistantMsg);
    } catch (e: unknown) {
      const errMsg = e instanceof Error ? e.message : 'Ошибка компиляции интерфейса';
      onSendMessage({
        id: createMessageId('err'),
        sender: 'assistant',
        text: `Не удалось применить: ${errMsg}`,
        timestamp: nowLabel(),
      });
    } finally {
      setLoading(false);
    }
  };

  const quickPrompts = [
    'Сделай киберпанк тему с неоновым розовым и круглыми кнопками',
    'Ультра-минимализм: черный AMOLED, без засечек и пресетов',
    'Янтарный спортивный таймер с крупным шрифтом',
    'Поставь будильник на 07:00 и 21:30',
  ];

  return (
    <div
      className="w-full h-full flex flex-col backdrop-blur-xl transition-all duration-300 select-none z-30 flex-shrink-0"
      style={{
        backgroundColor: `${theme.cardBg}F0`,
        color: theme.text,
      }}
    >
      {/* Drawer Header */}
      {!hideHeader && (
      <div
        className="flex items-center justify-between px-4 py-3 border-b"
        style={{ borderColor: theme.border }}
      >
        <div className="flex items-center space-x-2">
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center shadow-lg"
            style={{ backgroundColor: theme.surface, color: theme.text }}
          >
            <HandSparkle size={14} color={theme.text} />
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5">
              AI Co-Pilot
            </h3>
            <span className="text-[10px] opacity-60">Ассистент таймера</span>
          </div>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => {
              soundService.playUiClick();
              onResetChat?.();
            }}
            className="flex items-center space-x-1 py-1 px-2 rounded-lg bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-white/70 hover:text-white border border-white/5 text-[10px] font-medium"
            title="Создать новый чистый чат"
          >
            <Plus size={11} />
            <span>Новый чат</span>
          </button>
          <button
            onClick={onClose}
            className="w-6 h-6 rounded-lg flex items-center justify-center bg-white/5 hover:bg-white/10 active:scale-95 transition-all text-white/70 hover:text-white"
          >
            <HandClose size={13} />
          </button>
        </div>
      </div>
      )}
      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex flex-col ${m.sender === 'user' ? 'items-end' : 'items-start'}`}
          >
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 text-xs leading-relaxed shadow-md select-text cursor-text relative group ${
                m.sender === 'user'
                  ? 'text-black font-medium'
                  : 'bg-white/5 border border-white/10 text-white/90'
              }`}
              style={{
                backgroundColor: m.sender === 'user' ? "rgba(255,255,255,0.10)" : undefined,
                color: theme.text,
              }}
            >
              <div className="select-text whitespace-pre-wrap">{m.text}</div>
              {m.sender === 'assistant' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigator.clipboard.writeText(m.text);
                    setCopiedId(m.id);
                    setTimeout(() => setCopiedId(null), 2000);
                  }}
                  className="absolute -right-2 -top-2 opacity-0 group-hover:opacity-100 p-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-white/70 hover:text-white border border-white/10 shadow transition-all select-none"
                  title="Копировать текст"
                >
                  {copiedId === m.id ? <Check size={10} color={theme.text} /> : <Copy size={10} />}
                </button>
              )}


              {m.mutation && (
                <div className="mt-2 pt-2 border-t border-white/10 flex flex-wrap gap-1">
                  {m.mutation.ui && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 flex items-center gap-1">
                      <HandCheck size={10} color={theme.subtext} /> UI трансформирован
                    </span>
                  )}
                  {m.mutation.directions?.length ? (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 flex items-center gap-1">
                      <HandCheck size={10} color={theme.subtext} /> Направления добавлены
                    </span>
                  ) : null}
                  {m.mutation.alarms && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/10 flex items-center gap-1">
                      <HandCheck size={10} color={theme.subtext} /> Будильники добавлены
                    </span>
                  )}
                </div>
              )}
            </div>
            <span className="text-[9px] opacity-40 px-1 mt-0.5">{m.timestamp}</span>
          </div>
        ))}

        {loading && (
          <div className="flex items-center space-x-2 text-xs opacity-60 p-2">
            <Loader2 size={13} className="animate-spin" style={{ color: theme.subtext }} />
            <span>AI компилирует интерфейс и сценарии...</span>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Quick Prompts */}
      <div className="px-3 py-1.5 border-t border-white/5 overflow-x-auto flex gap-1.5 no-scrollbar">
        {quickPrompts.map((q, idx) => (
          <button
            key={idx}
            onClick={() => handleSend(q)}
            className="text-[10px] whitespace-nowrap px-2 py-1 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 active:scale-95 transition-all text-left flex items-center gap-1 opacity-70 hover:opacity-100"
          >
            <span>{q}</span>
            <ArrowRight size={10} />
          </button>
        ))}
      </div>

      {/* Input bar */}
      <div className="p-2 border-t border-white/10 bg-black/20">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex items-center gap-1.5"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Например: Сделай черный AMOLED и убери засечки..."
            className="flex-1 bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs outline-none focus:border-white/30 transition-colors"
            style={{ color: theme.text }}
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="w-9 h-9 rounded-xl flex items-center justify-center shadow-lg transition-all active:scale-95 disabled:opacity-30"
            style={{
              backgroundColor: '#fafafa',
              color: '#0a0a0a',
            }}
          >
            <HandSend size={14} color="#000000" />
          </button>
        </form>
      </div>
    </div>
  );
};
