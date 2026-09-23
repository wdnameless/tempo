import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIChatDrawer, formatChatTimestamp } from '../AIChatDrawer';
import { StoreService } from '../../services/store';
import type { ChatMessage, DynamicUIConfig, AISettings, ThemeColors } from '../../types';
import { DEFAULT_DYNAMIC_UI } from '../../types/dynamicUi';

vi.mock('../../services/sound', () => ({
  soundService: {
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
  },
}));

vi.mock('../../services/aiGateway', () => ({
  AIGateway: {
    hasKey: vi.fn().mockResolvedValue(false),
    listModels: vi.fn().mockResolvedValue(['gpt-4o-mini', 'gpt-4o', 'claude-3-5-sonnet', 'deepseek-chat']),
  },
}));

const mockTheme: ThemeColors = {
  id: 'dark',
  name: 'Dark',
  bg: '#111',
  surface: '#222',
  cardBg: '#2a2a2a',
  border: '#333',
  text: '#fff',
  subtext: '#aaa',
  accent: '#00ffff',
  accentGlow: 'rgba(0,255,255,0.2)',
  ringTrack: '#333',
  ringProgress: '#00ffff',
  ticks: '#555',
};

const mockUi: DynamicUIConfig = DEFAULT_DYNAMIC_UI;

const mockAiSettings: AISettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  systemPrompt: 'Assistant prompt',
  enabled: true,
  autoAdjustIntervals: false,
};

describe('AIChatDrawer & formatChatTimestamp', () => {
  beforeEach(() => {
    StoreService.resetCache();
    vi.clearAllMocks();
  });

  describe('1. Timestamp formatter', () => {
    const fixedNow = new Date('2026-09-23T15:30:00Z');

    it('formats today timestamp as HH:mm in both ru and en', () => {
      const today = new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate(), 19, 20);
      const iso = today.toISOString();

      expect(formatChatTimestamp(iso, 'ru', today)).toBe('19:20');
      expect(formatChatTimestamp(iso, 'en', today)).toBe('19:20');
    });

    it('formats yesterday timestamp as "вчера 19:20" and "yesterday 19:20"', () => {
      const yesterday = new Date(fixedNow.getFullYear(), fixedNow.getMonth(), fixedNow.getDate() - 1, 19, 20);
      const iso = yesterday.toISOString();

      expect(formatChatTimestamp(iso, 'ru', fixedNow)).toBe('вчера 19:20');
      expect(formatChatTimestamp(iso, 'en', fixedNow)).toBe('yesterday 19:20');
    });

    it('formats older timestamps with short date and time', () => {
      const older = new Date(fixedNow.getFullYear(), 8, 15, 14, 5); // 15 Sep 2026
      const iso = older.toISOString();

      const ruFormatted = formatChatTimestamp(iso, 'ru', fixedNow);
      const enFormatted = formatChatTimestamp(iso, 'en', fixedNow);

      expect(ruFormatted).toContain('15 сен');
      expect(ruFormatted).toContain('14:05');

      expect(enFormatted).toContain('Sep 15');
      expect(enFormatted).toContain('14:05');
    });

    it('renders exact raw value in title and dateTime attributes in DOM', () => {
      const exactRaw = '2026-09-22T07:53:50.092992200+00:00';
      const messages: ChatMessage[] = [
        {
          id: 'm1',
          sender: 'user',
          text: 'Сообщение с детальным таймстемпом',
          timestamp: exactRaw,
          sessionId: 'default',
        },
      ];

      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={messages}
          onSendMessage={vi.fn()}
        />,
      );

      const timeEl = screen.getByTitle(exactRaw);
      expect(timeEl).toBeDefined();
      expect(timeEl.getAttribute('dateTime')).toBe(exactRaw);
      expect(timeEl.textContent).not.toBe(exactRaw); // human formatted instead of raw
    });
  });

  describe('2. Resizable drawer and size persistence', () => {
    it('resizes width when dragging left edge and persists it', async () => {
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={[]}
          onSendMessage={vi.fn()}
        />,
      );

      const leftHandle = screen.getByTestId('chat-resize-handle-left');
      expect(leftHandle).toBeDefined();

      // Drag left handle to the left by 100px (increasing width)
      fireEvent.pointerDown(leftHandle, { clientX: 500, clientY: 200 });
      fireEvent.pointerMove(window, { clientX: 400, clientY: 200 });
      fireEvent.pointerUp(window);

      await waitFor(() => {
        const persistedWidth = StoreService.getPreference<number>('tempo_chat_drawer_width', 0);
        expect(persistedWidth).toBeGreaterThanOrEqual(400);
      });
    });

    it('resizes height when dragging top edge and persists it', async () => {
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={[]}
          onSendMessage={vi.fn()}
        />,
      );

      const topHandle = screen.getByTestId('chat-resize-handle-top');
      expect(topHandle).toBeDefined();

      // Drag top handle down by 100px (decreasing height)
      fireEvent.pointerDown(topHandle, { clientX: 300, clientY: 100 });
      fireEvent.pointerMove(window, { clientX: 300, clientY: 200 });
      fireEvent.pointerUp(window);

      await waitFor(() => {
        const persistedHeight = StoreService.getPreference<number | null>('tempo_chat_drawer_height', null);
        expect(persistedHeight).not.toBeNull();
      });
    });
  });

  describe('3. «Новый чат» and conversations split by sessions', () => {
    it('«Новый чат» starts an empty conversation while previous remains reachable', async () => {
      const messages: ChatMessage[] = [
        {
          id: 'msg1',
          sender: 'user',
          text: 'Первый вопрос в основном чате',
          timestamp: '2026-09-23T10:00:00Z',
          sessionId: 'default',
        },
        {
          id: 'msg2',
          sender: 'assistant',
          text: 'Ответ на первый вопрос',
          timestamp: '2026-09-23T10:00:05Z',
          sessionId: 'default',
        },
      ];

      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={messages}
          onSendMessage={vi.fn()}
          initialSessionId="default"
        />,
      );

      // Initial conversation messages visible
      expect(screen.getByText('Ответ на первый вопрос')).toBeDefined();
      expect(screen.getAllByText('Первый вопрос в основном чате').length).toBeGreaterThanOrEqual(1);

      // Click «Новый чат»
      const newChatBtn = screen.getByTestId('new-chat-button');
      fireEvent.click(newChatBtn);

      // Message from previous chat is no longer shown in the new session
      expect(screen.queryByText('Ответ на первый вопрос')).toBeNull();
      expect(screen.queryByText('Первый вопрос в основном чате')).toBeNull();

      // Open sessions dropdown
      const sessionSelect = screen.getByTestId('chat-session-select');
      fireEvent.click(sessionSelect);

      // Previous session is listed with title derived from its first user message
      const prevSessionItem = screen.getByTestId('chat-session-item-default');
      expect(prevSessionItem).toBeDefined();
      expect(prevSessionItem.textContent).toContain('Первый вопрос в основном чате');

      // Click to switch back to the previous session
      fireEvent.click(prevSessionItem);

      // Messages from previous chat are restored and visible
      expect(screen.getByText('Ответ на первый вопрос')).toBeDefined();
      expect(screen.getAllByText('Первый вопрос в основном чате').length).toBeGreaterThanOrEqual(1);
    });

    it('«Очистить» clears only the current conversation', () => {
      const onResetChat = vi.fn();
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={[]}
          onSendMessage={vi.fn()}
          onResetChat={onResetChat}
          initialSessionId="session_test"
        />,
      );

      const clearBtn = screen.getByTestId('clear-chat-button');
      fireEvent.click(clearBtn);

      expect(onResetChat).toHaveBeenCalledWith('session_test');
    });
  });

  describe('4. Model picker in the drawer', () => {
    it('shows active model and lists provider models', async () => {
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={[]}
          onSendMessage={vi.fn()}
        />,
      );

      const pickerBtn = screen.getByTestId('chat-model-picker-button');
      expect(pickerBtn.textContent).toContain('gpt-4o-mini');

      fireEvent.click(pickerBtn);

      // Check dropdown options
      const optClaude = await screen.findByTestId('model-option-claude-3-5-sonnet');
      expect(optClaude).toBeDefined();
    });

    it('picking a model updates active model and persists to tempo_ai_model', async () => {
      const onUpdateAISettings = vi.fn();
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          onUpdateAISettings={onUpdateAISettings}
          messages={[]}
          onSendMessage={vi.fn()}
        />,
      );

      const pickerBtn = screen.getByTestId('chat-model-picker-button');
      fireEvent.click(pickerBtn);

      const optGpt4 = screen.getByTestId('model-option-gpt-4o');
      fireEvent.click(optGpt4);

      await waitFor(() => {
        expect(screen.getByTestId('chat-model-picker-button').textContent).toContain('gpt-4o');
        expect(StoreService.getPreference('tempo_ai_model', '')).toBe('gpt-4o');
        expect(onUpdateAISettings).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }));
      });
    });

    it('allows entering and persisting custom free-text model', async () => {
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={mockAiSettings}
          messages={[]}
          onSendMessage={vi.fn()}
        />,
      );

      fireEvent.click(screen.getByTestId('chat-model-picker-button'));

      const customInput = screen.getByTestId('chat-custom-model-input');
      const applyBtn = screen.getByTestId('chat-custom-model-apply');

      fireEvent.change(customInput, { target: { value: 'my-custom-ollama-model' } });
      fireEvent.click(applyBtn);

      await waitFor(() => {
        expect(screen.getByTestId('chat-model-picker-button').textContent).toContain('my-custom-ollama-model');
        expect(StoreService.getPreference('tempo_ai_model', '')).toBe('my-custom-ollama-model');
      });
    });
  });

  describe('5. Send button and chatNeedKey when no API key configured', () => {
    it('shows chatNeedKey and its link when there is no key, and send button is disabled', () => {
      const onOpenSettings = vi.fn();
      render(
        <AIChatDrawer
          isOpen={true}
          onClose={vi.fn()}
          theme={mockTheme}
          currentUi={mockUi}
          aiSettings={{ ...mockAiSettings, apiKey: '' }}
          messages={[]}
          onSendMessage={vi.fn()}
          onOpenAISettings={onOpenSettings}
        />,
      );

      const sendBtn = screen.getByRole('button', { name: /Отправить сообщение|Send message/i });
      expect(sendBtn.hasAttribute('disabled')).toBe(true);

      const needKeyElem = screen.getByTestId('chat-need-key');
      expect(needKeyElem).toBeDefined();
      expect(needKeyElem.textContent).toContain('Настройки → ИИ');

      const settingsLink = screen.getByTestId('chat-settings-link');
      fireEvent.click(settingsLink);
      expect(onOpenSettings).toHaveBeenCalledTimes(1);
    });
  });
});
