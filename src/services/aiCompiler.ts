import { AISettings, TaskItem, NoteItem, ListItem } from '../types';
import { asString, isRecord } from '../types/guards';
import { AIGateway } from './aiGateway';
import { listTasks, createTask, listLists, createList } from './tasks';
import { listNotes, createNote } from './notes';
import { buildDay, dayKey } from './day';

export type { ChatMessage } from '../types';

export interface TaskDraft {
  title: string;
  dueDate?: string | null;
  listName?: string | null;
  priority?: number;
}

export interface ListDraft {
  name: string;
  color?: string | null;
}

export interface NoteDraft {
  title: string;
  body: string;
}

export interface DayPlanDraft {
  tasks: Array<{
    title: string;
    dueDate?: string | null;
    startAt?: string | null;
    plannedMinutes?: number | null;
  }>;
}

export interface AIActionPlan {
  action: 'create_task' | 'create_list' | 'create_note' | 'build_plan' | 'answer' | 'noop';
  explanation: string;
  task?: TaskDraft;
  list?: ListDraft;
  note?: NoteDraft;
  plan?: DayPlanDraft;
  answer?: string;
}

export interface ExecutionOutcome {
  action: AIActionPlan['action'];
  explanation: string;
  createdTasks?: TaskItem[];
  createdList?: ListItem;
  createdNote?: NoteItem;
  answer?: string;
  error?: string;
}

const SYSTEM_PROMPT = `Ты — встроенный интеллектуальный помощник приложения Tempo.
Твоя задача — помогать пользователю управлять задачами, списками, заметками и планом дня.
Ты умеешь:
1. Создавать задачу (title, dueDate в формате YYYY-MM-DD, listName, priority: 0, 1, 2, 3).
2. Создавать список (name, color).
3. Создавать заметку (title, body).
4. Составлять план дня из текста («распланируй утро: зарядка, отчёт, созвон»).
5. Отвечать на вопросы по задачам, спискам и расписанию дня на основе предоставленного контекста.

Никогда не предлагай удалённые сущности. Отвечай СТРОГО в формате JSON без markdown блоков (или внутри json блока):
{
  "action": "create_task" | "create_list" | "create_note" | "build_plan" | "answer" | "noop",
  "explanation": "краткое понятное описание пользователю на русском языке",
  "task": { "title": "...", "dueDate": "YYYY-MM-DD", "listName": "...", "priority": 0 },
  "list": { "name": "...", "color": "#HEX" },
  "note": { "title": "...", "body": "..." },
  "plan": { "tasks": [{ "title": "...", "dueDate": "YYYY-MM-DD", "startAt": "ISO or YYYY-MM-DDTHH:MM:SS", "plannedMinutes": 30 }] },
  "answer": "текст ответа"
}`;

export class AICompilerService {
  /**
   * Safe parser for LLM responses.
   * If the model times out, returns 401, or emits malformed JSON,
   * this does NOT throw — it returns an honest error action so the chat UI stays usable.
   */
  public static parseActionJson(raw: string): AIActionPlan {
    let clean = raw.trim();
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    }
    try {
      const parsed: unknown = JSON.parse(clean);
      if (!isRecord(parsed)) {
        return {
          action: 'noop',
          explanation: 'Не удалось разобрать ответ модели. Попробуйте переформулировать запрос.',
        };
      }
      return {
        action: (['create_task', 'create_list', 'create_note', 'build_plan', 'answer', 'noop'].includes(asString(parsed.action, ''))
          ? parsed.action
          : 'answer') as AIActionPlan['action'],
        explanation: asString(parsed.explanation, asString(parsed.answer, 'Готово')),
        task: isRecord(parsed.task)
          ? {
              title: asString(parsed.task.title, 'Новая задача'),
              dueDate: typeof parsed.task.dueDate === 'string' ? parsed.task.dueDate : undefined,
              listName: typeof parsed.task.listName === 'string' ? parsed.task.listName : undefined,
              priority: typeof parsed.task.priority === 'number' ? parsed.task.priority : undefined,
            }
          : undefined,
        list: isRecord(parsed.list)
          ? {
              name: asString(parsed.list.name, 'Новый список'),
              color: typeof parsed.list.color === 'string' ? parsed.list.color : undefined,
            }
          : undefined,
        note: isRecord(parsed.note)
          ? {
              title: asString(parsed.note.title, 'Заметка'),
              body: asString(parsed.note.body, ''),
            }
          : undefined,
        plan: isRecord(parsed.plan) && Array.isArray(parsed.plan.tasks)
          ? {
              tasks: (parsed.plan.tasks as unknown[]).filter(isRecord).map((t) => ({
                title: asString(t.title, 'Пункт плана'),
                dueDate: typeof t.dueDate === 'string' ? t.dueDate : undefined,
                startAt: typeof t.startAt === 'string' ? t.startAt : undefined,
                plannedMinutes: typeof t.plannedMinutes === 'number' ? t.plannedMinutes : undefined,
              })),
            }
          : undefined,
        answer: typeof parsed.answer === 'string' ? parsed.answer : undefined,
      };
    } catch {
      return {
        action: 'noop',
        explanation: 'Модель вернула некорректный ответ (ошибка формата). Чат остаётся доступен.',
      };
    }
  }

  /**
   * Compiles user intent using either the remote model or deterministic local keyword matching.
   */
  public static async compileIntent(
    prompt: string,
    settings: AISettings,
    now: Date = new Date(),
  ): Promise<AIActionPlan> {
    const trimmed = prompt.trim();
    if (!trimmed) {
      return { action: 'noop', explanation: 'Пустой запрос.' };
    }

    // If API key is present and enabled, query the model
    if (settings.apiKey && settings.apiKey.trim().length > 0) {
      try {
        // Collect active (non-deleted) context
        const [activeTasks, activeLists, activeNotes] = await Promise.all([
          listTasks(),
          listLists(),
          listNotes(),
        ]);

        const todayStr = dayKey(now);
        const daySchedule = buildDay({
          date: now,
          tasks: activeTasks,
          events: [],
        });

        const contextInfo = JSON.stringify({
          today: todayStr,
          tasks: activeTasks.map((t) => ({ id: t.id, title: t.title, dueDate: t.dueDate, done: t.done })),
          lists: activeLists.map((l) => ({ id: l.id, name: l.name })),
          notes: activeNotes.map((n) => ({ id: n.id, title: n.title })),
          dayScheduleItems: daySchedule.map((i) => ({ title: i.title, startMin: i.startMin, done: i.done })),
        });

        const system = `${SYSTEM_PROMPT}\n\nТекущие активные данные приложения:\n${contextInfo}`;
        const response = await AIGateway.generateCompletion(system, trimmed, settings);
        return this.parseActionJson(response);
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          action: 'noop',
          explanation: `Ошибка обращения к ИИ: ${msg}. Попробуйте позже или используйте локальные команды.`,
        };
      }
    }

    // Offline deterministic keyword parser
    return this.compileLocalIntent(trimmed, now);
  }

  /**
   * Deterministic local fallback for common actions without an API key.
   */
  public static compileLocalIntent(prompt: string, now: Date = new Date()): AIActionPlan {
    const lower = prompt.toLowerCase();
    const todayStr = dayKey(now);

    // 1. Day plan: "распланируй день: ...", "распланируй утро: зарядка, отчёт, созвон", "план на день: ..."
    if (lower.includes('распланируй') || lower.includes('составь план') || lower.startsWith('план:')) {
      // Extract items after colon or keywords
      const parts = prompt.split(/[:;]/);
      let itemsString = parts.length > 1 ? parts.slice(1).join(',') : prompt;
      if (parts.length === 1) {
        itemsString = prompt.replace(/^(?:распланируй\s+(?:день|утро|вечер|сегодня)?|составь\s+план(?:\s+на\s+день)?)/i, '');
      }
      const rawItems = itemsString
        .split(/,|\n/)
        .map((s) => s.trim())
        .filter((s) => s.length > 0);

      const planTasks = (rawItems.length > 0 ? rawItems : ['Дело 1', 'Дело 2']).map((title) => ({
        title,
        dueDate: todayStr,
      }));

      return {
        action: 'build_plan',
        explanation: `Составлен план дня из ${planTasks.length} задач: ${planTasks.map((t) => t.title).join(', ')}.`,
        plan: { tasks: planTasks },
      };
    }

    // 2. Create task: "создай задачу ...", "добавь задачу ...", "задача: ..."
    if (
      lower.includes('создай задачу') ||
      lower.includes('добавь задачу') ||
      lower.startsWith('задача:') ||
      lower.includes('create task') ||
      lower.includes('add task') ||
      lower.startsWith('task:')
    ) {
      let title = prompt
        .replace(/^(?:пожалуйста,?\s*)?(?:создай|добавь)\s+задачу\s*:?/i, '')
        .replace(/^(?:please,?\s*)?(?:create|add)\s+task\s*:?/i, '')
        .replace(/^(?:задача|task)\s*:\s*/i, '')
        .trim();

      // Check if list is mentioned: "в список Работа"
      let listName: string | undefined;
      const listMatch = title.match(/(?:\s+в\s+список|\s+to\s+list)\s+([^,]+)/i);
      if (listMatch) {
        listName = listMatch[1].trim();
        title = title.replace(listMatch[0], '').trim();
      }

      // Check if due date is mentioned:
      // "послезавтра" -> +2 days
      // "завтра", "на завтра", "tomorrow" -> +1 day
      // "сегодня", "на сегодня", "today" -> today
      let dueDate: string | undefined = todayStr;
      if (/(?:^|\s)(?:на\s+)?послезавтра(?:\s|$)/i.test(title)) {
        const dayAfter = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);
        dueDate = dayKey(dayAfter);
        title = title.replace(/(?:^|\s+)(?:на\s+)?послезавтра(?:\s+|$)/gi, ' ').trim();
      } else if (/(?:^|\s)(?:(?:на\s+)?завтра|tomorrow)(?:\s|$)/i.test(title)) {
        const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
        dueDate = dayKey(tomorrow);
        title = title.replace(/(?:^|\s+)(?:(?:на\s+)?завтра|tomorrow)(?:\s+|$)/gi, ' ').trim();
      } else if (/(?:^|\s)(?:(?:на\s+)?сегодня|today)(?:\s|$)/i.test(title)) {
        dueDate = todayStr;
        title = title.replace(/(?:^|\s+)(?:(?:на\s+)?сегодня|today)(?:\s+|$)/gi, ' ').trim();
      }

      return {
        action: 'create_task',
        explanation: `Создана задача «${title || 'Новая задача'}».`,
        task: {
          title: title || 'Новая задача',
          dueDate,
          listName,
          priority: 0,
        },
      };
    }

    // 3. Create list: "создай список ...", "новый список ..."
    if (lower.includes('создай список') || lower.includes('новый список') || lower.startsWith('список:')) {
      const name = prompt
        .replace(/^(?:пожалуйста,?\s*)?(?:создай|новый)\s+список\s*:?/i, '')
        .replace(/^список\s*:\s*/i, '')
        .trim();
      return {
        action: 'create_list',
        explanation: `Создан список «${name || 'Новый список'}».`,
        list: { name: name || 'Новый список' },
      };
    }

    // 4. Create note: "создай заметку ...", "заметка: ..."
    if (lower.includes('создай заметку') || lower.includes('добавь заметку') || lower.startsWith('заметка:')) {
      const content = prompt
        .replace(/^(?:пожалуйста,?\s*)?(?:создай|добавь)\s+заметку\s*:?/i, '')
        .replace(/^заметка\s*:\s*/i, '')
        .trim();
      const lines = content.split('\n');
      const title = lines[0]?.trim() || 'Новая заметка';
      const body = lines.slice(1).join('\n').trim();
      return {
        action: 'create_note',
        explanation: `Создана заметка «${title}».`,
        note: { title, body },
      };
    }

    // 5. Query about tasks/plan
    if (lower.includes('какие задачи') || lower.includes('что на сегодня') || lower.includes('план на сегодня') || lower.includes('список задач')) {
      return {
        action: 'answer',
        explanation: 'Запрос информации по задачам.',
      };
    }

    // Default no-op
    return {
      action: 'noop',
      explanation: 'Команда не распознана. Я умею создавать задачи («создай задачу ...»), списки («создай список ...»), заметки («создай заметку ...») и составлять план дня («распланируй утро: ...»).',
    };
  }

  /**
   * Executes the compiled action against application services (tasks, lists, notes).
   * Verifies that target entities are never deleted.
   */
  public static async executeAction(actionPlan: AIActionPlan): Promise<ExecutionOutcome> {
    try {
      if (actionPlan.action === 'create_task' && actionPlan.task) {
        let targetListId: string | null = null;
        if (actionPlan.task.listName) {
          const activeLists = await listLists();
          // Never offer a deleted entity: listLists() only returns non-deleted lists.
          const match = activeLists.find(
            (l) => l.name.toLowerCase() === actionPlan.task!.listName!.toLowerCase(),
          );
          if (match) {
            targetListId = match.id;
          }
        }

        const created = await createTask({
          title: actionPlan.task.title,
          dueDate: actionPlan.task.dueDate ?? null,
          listId: targetListId,
          priority: actionPlan.task.priority ?? 0,
        });

        return {
          action: 'create_task',
          explanation: actionPlan.explanation || `Задача «${created.title}» добавлена.`,
          createdTasks: [created],
        };
      }

      if (actionPlan.action === 'create_list' && actionPlan.list) {
        const created = await createList(actionPlan.list.name, actionPlan.list.color ?? null);
        return {
          action: 'create_list',
          explanation: actionPlan.explanation || `Список «${created.name}» создан.`,
          createdList: created,
        };
      }

      if (actionPlan.action === 'create_note' && actionPlan.note) {
        const created = await createNote({
          title: actionPlan.note.title,
          body: actionPlan.note.body,
        });
        return {
          action: 'create_note',
          explanation: actionPlan.explanation || `Заметка «${created.title}» сохранена.`,
          createdNote: created,
        };
      }

      if (actionPlan.action === 'build_plan' && actionPlan.plan) {
        const createdTasks: TaskItem[] = [];
        for (const item of actionPlan.plan.tasks) {
          const created = await createTask({
            title: item.title,
            dueDate: item.dueDate ?? null,
            startAt: item.startAt ?? null,
            plannedMinutes: item.plannedMinutes ?? null,
          });
          createdTasks.push(created);
        }
        return {
          action: 'build_plan',
          explanation: actionPlan.explanation || `План дня создан (${createdTasks.length} задач).`,
          createdTasks,
        };
      }

      if (actionPlan.action === 'answer') {
        if (actionPlan.answer) {
          return {
            action: 'answer',
            explanation: actionPlan.answer,
            answer: actionPlan.answer,
          };
        }
        // If local query for tasks:
        const activeTasks = await listTasks();
        const openTasks = activeTasks.filter((t) => !t.done);
        const text = openTasks.length > 0
          ? `У вас ${openTasks.length} открытых задач:\n` + openTasks.slice(0, 5).map((t) => `• ${t.title}`).join('\n')
          : 'На сегодня нет открытых задач.';
        return {
          action: 'answer',
          explanation: text,
          answer: text,
        };
      }

      return {
        action: 'noop',
        explanation: actionPlan.explanation || 'Никаких изменений не выполнено.',
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        action: actionPlan.action,
        explanation: `Ошибка выполнения действия: ${msg}`,
        error: msg,
      };
    }
  }
}
