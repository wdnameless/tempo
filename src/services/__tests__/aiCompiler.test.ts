import { describe, it, expect } from 'vitest';
import { AICompilerService } from '../aiCompiler';
import { DEFAULT_DYNAMIC_UI } from '../../types/dynamicUi';
import type { AISettings } from '../../types';

/**
 * All cases run on the offline compiler path (no API key), which is the
 * deterministic path the app uses when the user has not configured BYOK.
 * The compiled mutation carries the full next DynamicUIConfig in `ui`.
 */
const offlineSettings: AISettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

const compile = (prompt: string, ui = DEFAULT_DYNAMIC_UI) =>
  AICompilerService.compileUserIntent(prompt, ui, offlineSettings);

describe('AICompilerService offline intent compilation', () => {
  it('hides both sleep and AI buttons on request', async () => {
    const result = await compile('убери кнопки ко сну и ИИ');

    expect(result.ui?.layout?.showSleepButton).toBe(false);
    expect(result.ui?.layout?.showAiScheduleButton).toBe(false);
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('restores the sleep button when asked to bring it back', async () => {
    const hidden = {
      ...DEFAULT_DYNAMIC_UI,
      layout: { ...DEFAULT_DYNAMIC_UI.layout, showSleepButton: false },
    };

    const result = await compile('верни кнопки ко сну', hidden);

    expect(result.ui?.layout?.showSleepButton).toBe(true);
  });

  it('hides the current time badge on request', async () => {
    const result = await compile('убери текущее время');

    expect(result.ui?.layout?.showCurrentTimeBadge).toBe(false);
  });

  it('hides dial ticks on request', async () => {
    const result = await compile('убери засечки');

    expect(result.ui?.dial?.showTicks).toBe(false);
  });

  it('changes the accent colour for a cyberpunk request', async () => {
    const result = await compile('сделай киберпанк стиль');

    expect(result.ui?.colors?.accent).toBeDefined();
    expect(result.ui?.colors?.accent).not.toBe(DEFAULT_DYNAMIC_UI.colors.accent);
  });

  it('admits it changed nothing when no command matches', async () => {
    const result = await compile('просто произвольный текст без совпадений шаблонов');

    // The honest outcome: no edit to apply, and a message that says so.
    // Returning a `ui` here made the caller apply nothing and still report
    // "UI трансформирован".
    expect(result.ui).toBeUndefined();
    expect(result.autoApply).toBe(false);
    expect(result.explanation.length).toBeGreaterThan(0);
  });

  it('does not claim an edit when asked a question it cannot act on', async () => {
    const result = await compile('покажи расписание на завтра');

    // A question is not a UI command. Saying "changes applied" here is how the
    // user asked a question and was told the interface had been redesigned.
    expect(result.ui).toBeUndefined();
    expect(result.explanation).not.toMatch(/ИИ применил изменения/);
  });

  it('parses directions mutation in offline mode when creating directions', async () => {
    const result = await compile('создай направление Кодинг с бюджетом 12 блоков');

    expect(result.type).toBe('directions');
    expect(result.directions).toBeDefined();
    expect(result.directions?.length).toBe(1);
    expect(result.directions?.[0].name).toBe('Кодинг');
    expect(result.directions?.[0].weeklyBlockBudget).toBe(12);
    expect(result.ui).toBeUndefined();
  });

  it('honestly reports empty journal when asked history question with empty history', async () => {
    const emptyHistory = {
      days: [],
      hourHistogram: new Array(24).fill(0),
      totals: { focusedSec: 0, sessions: 0, daysActive: 0 },
    };

    const result = await AICompilerService.compileUserIntent(
      'когда я работаю лучше всего?',
      DEFAULT_DYNAMIC_UI,
      offlineSettings,
      emptyHistory
    );

    expect(result.type).toBe('answer');
    expect(result.ui).toBeUndefined();
    expect(result.explanation).toMatch(/нет данных|нет записей|журнал пуст/i);
  });
});
