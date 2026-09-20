import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';

/**
 * The single door to the language model.
 *
 * There were three independent pipelines (alarm generation, UI compilation and
 * schedule parsing), each with its own `fetch`, its own prompt and its own
 * hand-rolled JSON scraping — three places to fix when the model or the
 * endpoint changed. They now share one transport, one error contract and one
 * place to point at a provider.
 *
 * Requests are issued from Rust: the webview's CSP pins `connect-src` to a
 * hard-coded allow-list, so a user's own Base URL was blocked by the browser and
 * the resulting failure was reported as a successful offline edit.
 */

export interface ChatMessage {
  role: 'system' | 'user';
  content: string;
}

export interface AIRequest {
  /** System instruction establishing the output contract. */
  system: string;
  /** The user's actual input. */
  user: string;
  baseUrl: string;
  model: string;
}

export interface AIResult {
  /** Parsed JSON object the model returned. */
  value: Record<string, unknown>;
  /** Set when the request failed; `value` is then empty. */
  error: string | null;
}

/** Strips a fenced code block, which models add despite a JSON-only request. */
function unwrapJson(raw: string): unknown {
  const cleaned = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // Some providers wrap the payload in prose; take the outermost object.
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {
        return null;
      }
    }
    return null;
  }
}

export class AIGateway {
  /** True when a key is stored in the OS credential store. */
  static async hasKey(): Promise<boolean> {
    if (!isTauri()) return false;
    try {
      return await invoke<boolean>('has_api_key');
    } catch {
      return false;
    }
  }

  /** Saves the key to the OS credential store; an empty string clears it. */
  static async setKey(key: string): Promise<void> {
    if (!isTauri()) return;
    await invoke('set_api_key', { key });
  }

  /**
   * Sends one instruction and returns the parsed object.
   *
   * Failures are returned, never thrown and never silently downgraded: the
   * caller decides whether to offer a deterministic fallback, and the user is
   * told which one they got.
   */
  static async requestJson(request: AIRequest): Promise<AIResult> {
    if (!isTauri()) {
      return { value: {}, error: 'Запросы к модели доступны только в приложении.' };
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: request.system },
      { role: 'user', content: request.user },
    ];

    try {
      const outcome = await invoke<{ content: string; error: string | null }>('ai_complete', {
        baseUrl: request.baseUrl,
        model: request.model,
        messages,
      });

      if (outcome.error) {
        return { value: {}, error: outcome.error };
      }

      const parsed = unwrapJson(outcome.content);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return { value: {}, error: 'Модель вернула ответ в неожиданном формате.' };
      }

      return { value: parsed as Record<string, unknown>, error: null };
    } catch (e) {
      return { value: {}, error: e instanceof Error ? e.message : 'Неизвестная ошибка запроса' };
    }
  }

  /**
   * Sends system and user prompts and returns the raw string content completion.
   */
  static async generateCompletion(
    system: string,
    user: string,
    settings: { baseUrl?: string; model?: string },
  ): Promise<string> {
    if (!isTauri()) {
      throw new Error('Запросы к модели доступны только в приложении.');
    }

    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];

    const outcome = await invoke<{ content: string; error: string | null }>('ai_complete', {
      baseUrl: settings.baseUrl || 'https://api.openai.com/v1',
      model: settings.model || 'gpt-4o-mini',
      messages,
    });

    if (outcome.error) {
      throw new Error(outcome.error);
    }

    return outcome.content;
  }
}
