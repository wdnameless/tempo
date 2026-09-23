import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { AIGateway } from '../services/aiGateway';
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
import { StoreService } from '../services/store';
import { I18nService, type Language } from '../services/i18n';

/** Message ids and timestamps are created outside render so components stay pure. */
let messageSeq = 0;
function createMessageId(prefix: string): string {
  messageSeq += 1;
  return `${prefix}-${Date.now()}-${messageSeq}`;
}

const WEEKDAY_NAMES_RU = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RU_MONTHS = ['янв', 'фев', 'мар', 'апр', 'май', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatChatTimestamp(
  raw: string,
  lang: Language = 'ru',
  now: Date = new Date(),
): string {
  if (!raw) return '';
  const d = new Date(raw);
  if (isNaN(d.getTime())) {
    return raw;
  }

  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  const timeStr = `${hours}:${minutes}`;

  const isSameDay =
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate();

  if (isSameDay) {
    return timeStr;
  }

  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const isYesterday =
    d.getFullYear() === yesterday.getFullYear() &&
    d.getMonth() === yesterday.getMonth() &&
    d.getDate() === yesterday.getDate();

  if (isYesterday) {
    const yLabel = lang === 'ru' ? 'вчера' : 'yesterday';
    return `${yLabel} ${timeStr}`;
  }

  const isSameYear = d.getFullYear() === now.getFullYear();
  if (lang === 'ru') {
    const month = RU_MONTHS[d.getMonth()] || '';
    return isSameYear
      ? `${d.getDate()} ${month}, ${timeStr}`
      : `${d.getDate()} ${month} ${d.getFullYear()}, ${timeStr}`;
  } else {
    const month = EN_MONTHS[d.getMonth()] || '';
    return isSameYear
      ? `${month} ${d.getDate()}, ${timeStr}`
      : `${month} ${d.getDate()}, ${d.getFullYear()}, ${timeStr}`;
  }
}

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

const DEFAULT_POPULAR_MODELS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o1-mini',
  'claude-3-5-sonnet',
  'deepseek-chat',
  'llama-3.1-8b',
];

export interface ChatSessionMeta {
  id: string;
  title: string;
  lastTimestamp: string;
}

export interface AIChatDrawerProps {
  isOpen: boolean;
  hideHeader?: boolean;
  onClose: () => void;
  theme: ThemeColors;
  currentUi: DynamicUIConfig;
  aiSettings: AISettings;
  onUpdateAISettings?: (settings: AISettings) => void;
  /** Retained for App.tsx compatibility — will be no-op since UI mutations were removed. */
  onApplyUI?: (config: DynamicUIConfig) => void;
  /** Receives newly created alarms after confirmation (R02). */
  onApplyAlarms?: (alarms: AlarmItem[]) => void;
  onSetTimerMinutes?: (minutes: number) => void;
  onNavigateToModule?: (module: 'today' | 'timer' | 'alarms') => void;
  messages: ChatMessage[];
  onSendMessage: (msg: ChatMessage) => void;
  onResetChat?: (sessionId?: string) => void;
  initialSessionId?: string;
  onOpenAISettings?: () => void;
}

export const AIChatDrawer: React.FC<AIChatDrawerProps> = ({
  isOpen,
  hideHeader = false,
  onClose,
  theme,
  aiSettings,
  onUpdateAISettings,
  onApplyAlarms,
  onSetTimerMinutes,
  onNavigateToModule,
  messages,
  onSendMessage,
  onResetChat,
  initialSessionId,
  onOpenAISettings,
}) => {
  const [inputText, setInputText] = useState('');
  const [isCompiling, setIsCompiling] = useState(false);
  const [pendingAlarms, setPendingAlarms] = useState<AlarmDraft[] | null>(null);
  const [isApplyingAlarms, setIsApplyingAlarms] = useState(false);
  const [hasRemoteKey, setHasRemoteKey] = useState<boolean>(Boolean(aiSettings.apiKey));
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Resize state
  const [drawerWidth, setDrawerWidth] = useState<number>(() =>
    StoreService.getPreference<number>('tempo_chat_drawer_width', 380),
  );
  const [drawerHeight, setDrawerHeight] = useState<number | null>(() =>
    StoreService.getPreference<number | null>('tempo_chat_drawer_height', null),
  );
  const isResizingRef = useRef<'width' | 'height' | 'corner' | null>(null);

  // Sessions state
  const [currentSessionId, setCurrentSessionId] = useState<string>(() =>
    initialSessionId || StoreService.getPreference<string>('tempo_current_chat_session', 'default'),
  );
  const [showSessionsMenu, setShowSessionsMenu] = useState(false);

  // Model selection state
  const [activeModel, setActiveModel] = useState<string>(() =>
    aiSettings.model || StoreService.getPreference<string>('tempo_ai_model', 'gpt-4o-mini'),
  );
  const [availableModels, setAvailableModels] = useState<string[]>(DEFAULT_POPULAR_MODELS);
  const [showModelMenu, setShowModelMenu] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');

  const lang = I18nService.getLang();
  const t = I18nService.t();
  const handleOpenAISettings = () => {
    onOpenAISettings?.();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'settings' }));
    }
  };

  // Load available models from provider
  useEffect(() => {
    let active = true;
    void AIGateway.listModels(aiSettings.baseUrl).then((models) => {
      if (active && models && models.length > 0) {
        setAvailableModels((prev) => Array.from(new Set([...prev, ...models])));
      }
    });
    return () => {
      active = false;
    };
  }, [aiSettings.baseUrl]);

  useEffect(() => {
    let active = true;
    void AIGateway.hasKey().then((has) => {
      if (active) {
        setHasRemoteKey(Boolean(aiSettings.apiKey && aiSettings.apiKey.trim().length > 0) || has);
      }
    });
    return () => {
      active = false;
    };
  }, [aiSettings.apiKey]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (isOpen) {
      scrollToBottom();
    }
  }, [messages, pendingAlarms, isOpen, currentSessionId, scrollToBottom]);

  // Build sessions list
  const sessions = useMemo((): ChatSessionMeta[] => {
    const sessionMap = new Map<string, ChatMessage[]>();
    for (const msg of messages) {
      const sid = msg.sessionId || 'default';
      const existing = sessionMap.get(sid) || [];
      existing.push(msg);
      sessionMap.set(sid, existing);
    }

    if (!sessionMap.has(currentSessionId)) {
      sessionMap.set(currentSessionId, []);
    }

    const result: ChatSessionMeta[] = [];
    for (const [sid, msgs] of sessionMap.entries()) {
      const firstUser = msgs.find((m) => m.sender === 'user');
      let title = t.chatUntitled;
      if (firstUser && firstUser.text.trim()) {
        const text = firstUser.text.trim();
        title = text.length > 32 ? `${text.slice(0, 32)}…` : text;
      } else if (msgs.length > 0 && msgs[0]?.timestamp) {
        title = formatChatTimestamp(msgs[0].timestamp, lang);
      } else if (sid === 'default') {
        title = lang === 'ru' ? 'Основной чат' : 'Main chat';
      }

      const lastTimestamp = msgs.length > 0 ? msgs[msgs.length - 1]?.timestamp || '' : '';
      result.push({ id: sid, title, lastTimestamp });
    }

    return result;
  }, [messages, currentSessionId, lang, t.chatUntitled]);

  // Current session messages
  const currentMessages = useMemo(() => {
    return messages.filter((m) => (m.sessionId || 'default') === currentSessionId);
  }, [messages, currentSessionId]);

  const handleSelectSession = (sid: string) => {
    setCurrentSessionId(sid);
    StoreService.setPreference('tempo_current_chat_session', sid);
    setShowSessionsMenu(false);
  };

  const handleNewChat = () => {
    const nextSid = `session_${Date.now()}`;
    setCurrentSessionId(nextSid);
    StoreService.setPreference('tempo_current_chat_session', nextSid);
    setShowSessionsMenu(false);
  };

  const handleSelectModel = (model: string) => {
    if (!model.trim()) return;
    const cleanModel = model.trim();
    setActiveModel(cleanModel);
    StoreService.setPreference('tempo_ai_model', cleanModel);
    if (onUpdateAISettings) {
      onUpdateAISettings({ ...aiSettings, model: cleanModel });
    }
    setShowModelMenu(false);
    setCustomModelInput('');
  };

  // Resize drag handlers
  const handlePointerDownResize = (e: React.PointerEvent, type: 'width' | 'height' | 'corner') => {
    e.preventDefault();
    isResizingRef.current = type;
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = drawerWidth;
    const startH = drawerHeight ?? (typeof window !== 'undefined' ? window.innerHeight : 600);

    const onPointerMove = (moveEv: PointerEvent) => {
      if (!isResizingRef.current) return;
      if (isResizingRef.current === 'width' || isResizingRef.current === 'corner') {
        const deltaX = startX - moveEv.clientX;
        const maxW = Math.max(300, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 50);
        const nextW = Math.min(maxW, Math.max(280, startW + deltaX));
        setDrawerWidth(nextW);
      }
      if (isResizingRef.current === 'height' || isResizingRef.current === 'corner') {
        const deltaY = startY - moveEv.clientY;
        const maxH = typeof window !== 'undefined' ? window.innerHeight : 900;
        const nextH = Math.min(maxH, Math.max(280, startH + deltaY));
        setDrawerHeight(nextH);
      }
    };

    const onPointerUp = () => {
      isResizingRef.current = null;
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      setDrawerWidth((w) => {
        StoreService.setPreference('tempo_chat_drawer_width', w);
        return w;
      });
      setDrawerHeight((h) => {
        StoreService.setPreference('tempo_chat_drawer_height', h);
        return h;
      });
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

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
        // SAFETY: Alarm with title mapping satisfies AlarmItem interface
        onApplyAlarms(created.map((a) => ({ ...a, title: a.label } as unknown as AlarmItem)));
      }

      const count = created.length;
      const confirmText = `Создано ${count} ${formatAlarmCountNoun(count)}.`;
      const assistantMsg: ChatMessage = {
        id: createMessageId('asst'),
        sender: 'assistant',
        text: confirmText,
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
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
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
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
      timestamp: new Date().toISOString(),
      sessionId: currentSessionId,
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
      timestamp: new Date().toISOString(),
      sessionId: currentSessionId,
    };
    onSendMessage(userMsg);

    setIsCompiling(true);

    try {
      // 1. Check for timer intent if user asked
      const lower = textToSend.toLowerCase();
      const timerMatch = lower.match(/(?:таймер|помодоро)\s+(?:на\s+)?(\d+)\s*(?:мин|минут)/);
      if (timerMatch && onSetTimerMinutes) {
        const mins = parseInt(timerMatch[1], 10);
        if (mins > 0) {
          onSetTimerMinutes(mins);
          const assistantMsg: ChatMessage = {
            id: createMessageId('asst'),
            sender: 'assistant',
            text: `Установил таймер на ${mins} мин. Запустить?`,
            timestamp: new Date().toISOString(),
            sessionId: currentSessionId,
          };
          onSendMessage(assistantMsg);
          soundService.speak(`Таймер на ${mins} минут установлен`);
          return;
        }
      }
      if ((lower.includes('открой будильник') || lower.includes('покажи будильник')) && onNavigateToModule) {
        onNavigateToModule('alarms');
      }

      // 2. Query compiler with active model
      const actionPlan = await AICompilerService.compileIntent(textToSend, {
        ...aiSettings,
        model: activeModel,
      });

      // 3. Alarms intent: proposal renders as preview card, nothing written before confirm
      if (actionPlan.action === 'create_alarms' && actionPlan.alarms && actionPlan.alarms.length > 0) {
        setPendingAlarms(actionPlan.alarms);
        const explanationText =
          actionPlan.explanation || actionPlan.reply || 'Предлагаю настроить следующие будильники:';
        const assistantMsg: ChatMessage = {
          id: createMessageId('asst'),
          sender: 'assistant',
          text: explanationText,
          timestamp: new Date().toISOString(),
          sessionId: currentSessionId,
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
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
      };
      onSendMessage(assistantMsg);
      soundService.speak(outcome.explanation.slice(0, 100));
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Неизвестная ошибка';
      const assistantMsg: ChatMessage = {
        id: createMessageId('err'),
        sender: 'assistant',
        text: `Произошла ошибка при обработке запроса: ${errorMsg}. Чат остаётся доступен.`,
        timestamp: new Date().toISOString(),
        sessionId: currentSessionId,
      };
      onSendMessage(assistantMsg);
    } finally {
      setIsCompiling(false);
    }
  };

  const currentSessionMeta = sessions.find((s) => s.id === currentSessionId);
  const sessionDisplayName = currentSessionMeta ? currentSessionMeta.title : t.chatNew;

  return (
    <div
      data-testid="ai-chat-drawer"
      className="fixed right-0 bottom-0 z-40 flex flex-col bg-[var(--surface)] text-[var(--foreground)] border-l border-t border-[var(--border)] shadow-2xl select-none"
      style={{
        width: `${drawerWidth}px`,
        height: drawerHeight ? `${drawerHeight}px` : '100%',
        maxHeight: '100vh',
      }}
      data-theme={theme}
    >
      {/* Left resize handle */}
      <div
        data-testid="chat-resize-handle-left"
        onPointerDown={(e) => handlePointerDownResize(e, 'width')}
        className="absolute -left-1 top-0 bottom-0 w-2.5 cursor-ew-resize hover:bg-[var(--accent)]/40 active:bg-[var(--accent)] transition-colors z-50 select-none"
        title="Потяните для изменения ширины"
      />

      {/* Top resize handle */}
      <div
        data-testid="chat-resize-handle-top"
        onPointerDown={(e) => handlePointerDownResize(e, 'height')}
        className="absolute left-0 -top-1 right-0 h-2.5 cursor-ns-resize hover:bg-[var(--accent)]/40 active:bg-[var(--accent)] transition-colors z-50 select-none"
        title="Потяните для изменения высоты"
      />

      {/* Top-left corner resize handle */}
      <div
        data-testid="chat-resize-handle-corner"
        onPointerDown={(e) => handlePointerDownResize(e, 'corner')}
        className="absolute -left-1 -top-1 w-4 h-4 cursor-nwse-resize hover:bg-[var(--accent)] active:bg-[var(--accent)] z-50 rounded-tl"
        title="Потяните за угол"
      />

      {/* Header */}
      {!hideHeader && (
        <div className="flex flex-col border-b border-[var(--border)] bg-[var(--surface-active)]/50 backdrop-blur-md">
          <div className="flex items-center justify-between px-3 py-2.5">
            <div className="flex items-center space-x-2">
              <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse" />
              <h3 className="text-xs font-black tracking-wider uppercase text-[var(--accent)]">
                Tempo Assistant
              </h3>
            </div>

            <div className="flex items-center space-x-1">
              <button
                type="button"
                data-testid="new-chat-button"
                onClick={handleNewChat}
                className="px-2 py-1 rounded-md text-xs font-medium bg-[var(--accent)]/15 text-[var(--accent)] hover:bg-[var(--accent)]/25 transition-all flex items-center space-x-1"
                title={t.chatNew}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>{t.chatNew}</span>
              </button>

              {onResetChat && (
                <button
                  type="button"
                  data-testid="clear-chat-button"
                  onClick={() => onResetChat(currentSessionId)}
                  title={t.chatClearTitle}
                  className="p-1 px-2 rounded-md text-[var(--text-secondary)] hover:text-[var(--foreground)] hover:bg-[var(--surface)] transition-all text-xs"
                >
                  {t.chatClear}
                </button>
              )}

              <button
                type="button"
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

          {/* Subheader: Sessions Dropdown & Model Picker */}
          <div className="flex items-center justify-between px-3 py-1.5 border-t border-[var(--border)]/40 bg-[var(--surface)]/60 text-xs">
            {/* Session switcher */}
            <div className="relative">
              <button
                type="button"
                data-testid="chat-session-select"
                onClick={() => setShowSessionsMenu((v) => !v)}
                className="flex items-center space-x-1.5 max-w-[170px] truncate text-[var(--foreground)] hover:text-[var(--accent)] font-medium text-left transition-colors"
                title="Переключить разговор"
              >
                <span className="truncate">{sessionDisplayName}</span>
                <svg className="w-3 h-3 shrink-0 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showSessionsMenu && (
                <div
                  data-testid="chat-sessions-dropdown"
                  className="absolute left-0 top-full mt-1 w-64 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl py-1 z-50 text-xs max-h-60 overflow-y-auto"
                >
                  <div className="px-3 py-1 text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider">
                    {t.chatRecentSessions}
                  </div>
                  {sessions.map((s) => {
                    const isActive = s.id === currentSessionId;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        data-testid={`chat-session-item-${s.id}`}
                        onClick={() => handleSelectSession(s.id)}
                        className={`w-full text-left px-3 py-1.5 flex items-center justify-between hover:bg-[var(--surface-active)] transition-colors ${
                          isActive ? 'text-[var(--accent)] font-semibold bg-[var(--accent)]/10' : 'text-[var(--foreground)]'
                        }`}
                      >
                        <span className="truncate pr-2">{s.title}</span>
                        {isActive && <span className="text-xs">✓</span>}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Model picker */}
            <div className="relative">
              <button
                type="button"
                data-testid="chat-model-picker-button"
                onClick={() => setShowModelMenu((v) => !v)}
                className="flex items-center space-x-1 px-2 py-0.5 rounded-lg border border-[var(--border)] bg-[var(--surface-active)]/80 hover:border-[var(--accent)] transition-all font-mono text-[11px]"
                title="Выбрать модель ИИ"
              >
                <span className="text-[var(--accent)]">🤖</span>
                <span className="max-w-[110px] truncate">{activeModel}</span>
                <svg className="w-2.5 h-2.5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showModelMenu && (
                <div
                  data-testid="chat-model-dropdown"
                  className="absolute right-0 top-full mt-1 w-60 bg-[var(--surface)] border border-[var(--border)] rounded-xl shadow-2xl p-2 z-50 text-xs"
                >
                  <div className="text-[10px] uppercase font-bold text-[var(--text-muted)] tracking-wider mb-1.5 px-1">
                    {t.chatModel}
                  </div>
                  <div className="space-y-1 max-h-48 overflow-y-auto mb-2 pr-0.5">
                    {availableModels.map((m) => {
                      const isActive = m === activeModel;
                      return (
                        <button
                          key={m}
                          type="button"
                          data-testid={`model-option-${m}`}
                          onClick={() => handleSelectModel(m)}
                          className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center justify-between font-mono text-[11px] transition-colors ${
                            isActive
                              ? 'bg-[var(--accent)] text-white font-bold'
                              : 'hover:bg-[var(--surface-active)] text-[var(--foreground)]'
                          }`}
                        >
                          <span className="truncate">{m}</span>
                          {isActive && <span>✓</span>}
                        </button>
                      );
                    })}
                  </div>

                  {/* Free-text model input */}
                  <div className="pt-2 border-t border-[var(--border)] flex items-center space-x-1.5">
                    <input
                      type="text"
                      data-testid="chat-custom-model-input"
                      value={customModelInput}
                      onChange={(e) => setCustomModelInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleSelectModel(customModelInput);
                        }
                      }}
                      placeholder={t.chatCustomModel}
                      className="flex-1 bg-[var(--surface-active)] text-[var(--foreground)] placeholder-[var(--text-muted)] text-[11px] px-2 py-1 rounded-lg border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] font-mono"
                    />
                    <button
                      type="button"
                      data-testid="chat-custom-model-apply"
                      disabled={!customModelInput.trim()}
                      onClick={() => handleSelectModel(customModelInput)}
                      className="px-2 py-1 bg-[var(--accent)] text-white text-[11px] font-medium rounded-lg disabled:opacity-40 hover:opacity-90 transition-opacity"
                    >
                      OK
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 text-sm scrollbar-thin select-text">
        {currentMessages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-[var(--text-muted)] space-y-2 select-none">
            <div className="w-10 h-10 rounded-2xl bg-[var(--accent)]/15 flex items-center justify-center text-[var(--accent)] text-lg">
              💬
            </div>
            <div className="text-sm font-medium text-[var(--foreground)]">{t.chatNew}</div>
            <div className="text-xs max-w-xs leading-relaxed">
              Напишите вопрос или задачу — Tempo поможет настроить расписание, будильники или список дел.
            </div>
          </div>
        )}

        {currentMessages.map((msg) => {
          const isUser = msg.sender === 'user';
          const formattedTime = formatChatTimestamp(msg.timestamp, lang);
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
              <time
                dateTime={msg.timestamp}
                title={msg.timestamp}
                className="text-[10px] text-[var(--text-muted)] px-1"
              >
                {formattedTime}
              </time>
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
            <span className="ml-2">{t.chatCompiling}</span>
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
            placeholder={t.chatInputPlaceholder}
            disabled={isCompiling}
            className="w-full bg-[var(--surface)] text-[var(--foreground)] placeholder-[var(--text-muted)] text-xs rounded-xl pl-3 pr-10 py-2.5 border border-[var(--border)] focus:outline-none focus:border-[var(--accent)] transition-all shadow-inner"
          />
          <button
            type="submit"
            disabled={!hasRemoteKey || !inputText.trim() || isCompiling}
            className="absolute right-1.5 p-1.5 rounded-lg bg-[var(--accent)] text-white disabled:opacity-40 disabled:hover:bg-[var(--accent)] hover:opacity-90 transition-all cursor-pointer disabled:cursor-not-allowed"
            aria-label={t.chatSend}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </button>
        </div>
        {!hasRemoteKey && (
          <div className="flex items-center gap-1.5 px-1 pt-2 text-xs text-[var(--text-muted)]" data-testid="chat-need-key">
            <button
              type="button"
              onClick={handleOpenAISettings}
              className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1 text-left cursor-pointer"
              data-testid="chat-settings-link"
            >
              <span>{t.chatNeedKey}</span>
            </button>
          </div>
        )}
        <div className="flex justify-between items-center px-1 mt-2 text-[10px] text-[var(--text-muted)] font-mono">
          <span className="truncate max-w-[200px]">{activeModel}</span>
          <span>{hasRemoteKey ? t.chatOnline : t.chatOffline}</span>
        </div>
      </form>
    </div>
  );
};
