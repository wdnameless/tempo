import { describe, expect, it, beforeEach, vi } from 'vitest';
import { AICompilerService } from '../aiCompiler';
import { AIGateway } from '../aiGateway';
import type { AISettings } from '../../types';

/**
 * R36 routing tests:
 * With a key present the model is queried for intent compilation with active app context.
 * Without a key, requests fall back to deterministic local parsing.
 * Model errors return honest error messages rather than crashing.
 */

vi.mock('../aiGateway', () => ({
  AIGateway: {
    generateCompletion: vi.fn(),
  },
}));

vi.mock('../tasks', () => ({
  listTasks: vi.fn().mockResolvedValue([]),
  createTask: vi.fn().mockResolvedValue({ id: 't1', title: 'Task' }),
  listLists: vi.fn().mockResolvedValue([]),
  createList: vi.fn().mockResolvedValue({ id: 'l1', name: 'List' }),
}));

vi.mock('../notes', () => ({
  listNotes: vi.fn().mockResolvedValue([]),
  createNote: vi.fn().mockResolvedValue({ id: 'n1', title: 'Note' }),
}));

const settingsWithKey: AISettings = {
  apiKey: 'sk-test',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

const settingsWithoutKey: AISettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
};

describe('routing between the model and local parsing (R36)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('routes to the model when an API key is present', async () => {
    vi.mocked(AIGateway.generateCompletion).mockResolvedValueOnce(
      JSON.stringify({
        action: 'create_task',
        explanation: 'Создаю задачу из модели',
        task: { title: 'Позвонить врачу', dueDate: '2026-09-21' },
      }),
    );

    const plan = await AICompilerService.compileIntent('напомни позвонить врачу завтра', settingsWithKey);

    expect(AIGateway.generateCompletion).toHaveBeenCalledTimes(1);
    expect(plan.action).toBe('create_task');
    expect(plan.task?.title).toBe('Позвонить врачу');
    expect(plan.explanation).toBe('Создаю задачу из модели');
  });

  it('routes to local intent compiler when no API key is set', async () => {
    const plan = await AICompilerService.compileIntent('создай задачу Купить чай', settingsWithoutKey);

    expect(AIGateway.generateCompletion).not.toHaveBeenCalled();
    expect(plan.action).toBe('create_task');
    expect(plan.task?.title).toBe('Купить чай');
  });

  it('reports the model failure cleanly without breaking', async () => {
    vi.mocked(AIGateway.generateCompletion).mockRejectedValueOnce(
      new Error('Connection timeout to api.openai.com'),
    );

    const plan = await AICompilerService.compileIntent('распланируй день', settingsWithKey);

    expect(plan.action).toBe('noop');
    expect(plan.explanation).toContain('Ошибка обращения к ИИ');
    expect(plan.explanation).toContain('Connection timeout');
  });

  it('handles malformed JSON response from model gracefully', async () => {
    vi.mocked(AIGateway.generateCompletion).mockResolvedValueOnce(
      'Неверный JSON ответ',
    );

    const plan = await AICompilerService.compileIntent('распланируй день', settingsWithKey);

    expect(plan.action).toBe('noop');
    expect(plan.explanation).toContain('ошибка формата');
  });
});
