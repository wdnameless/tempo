import { AISettings, TaskItem, NoteItem, ListItem } from '../types';
import { asString, isRecord } from '../types/guards';
import { AIGateway } from './aiGateway';
import { listTasks, createTask, listLists, createList } from './tasks';
import { listNotes, createNote } from './notes';
import { buildDay, dayKey } from './day';
import { listRecordings } from './recordings';
import { emitDataChanged } from './appEvents';
import { I18nService } from './i18n';
import type { AlarmRepeat } from './alarms';
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

export interface AlarmDraft {
  label: string;
  time: string; // "HH:MM"
  repeat: AlarmRepeat;
  days?: number[];
  date?: string | null;
  intervalMinutes?: number | null;
  windowStart?: string | null;
  windowEnd?: string | null;
}

export interface AIActionPlan {
  action: 'create_task' | 'create_list' | 'create_note' | 'build_plan' | 'create_alarms' | 'answer' | 'noop';
  explanation: string;
  reply?: string;
  task?: TaskDraft;
  list?: ListDraft;
  note?: NoteDraft;
  plan?: DayPlanDraft;
  alarms?: AlarmDraft[];
  answer?: string;
}

export interface ExecutionOutcome {
  action: AIActionPlan['action'];
  explanation: string;
  createdTasks?: TaskItem[];
  createdList?: ListItem;
  createdNote?: NoteItem;
  alarms?: AlarmDraft[];
  answer?: string;
  error?: string;
}
const SYSTEM_PROMPT = `Ты — встроенный персональный ассистент приложения Tempo. Твоя задача: анализировать запрос пользователя и возвращать строго структурированное действие в формате JSON.

Ты умеешь:
1. Создавать будильники и расписания: действие "create_alarms". Используется ВСЕГДА, когда пользователь присылает расписание, тренирови, распорядок дня со временем, напоминания по времени или интервальные повторения («расписание тренировок: Пн, Ср, Пт в 07:30 зал», «каждые 2 часа пить воду с 09:00 до 21:00», «поставь будильник на 8:00»). НЕ превращай расписания и тренирови со временем в задачи!
2. Создавать задачу: действие "create_task" (только для явных одиночных задач без расписания: title, dueDate в формате YYYY-MM-DD, listName, priority: 0, 1, 2, 3).
3. Создавать список: действие "create_list" (name, color).
4. Создавать заметку: действие "create_note" (title, body).
5. Составлять план дня из задач БЕЗ времени: действие "build_plan" («план на день: сделать отчет, позвонить маме»). Расписания и тренирови с временными метками оформляются ТОЛЬКО как create_alarms!
6. Отвечать на вопросы по задачам, спискам, записям и расписанию дня на основе предоставленного контекста: действие "answer".

В контексте тебе передаются:
- tasks: активные задачи пользователя.
- lists: списки.
- notes: заметки.
- recordings: массив записей (аудио/видео) пользователя с названиями (title), транскриптами (transcript) и признаком hasTranscript. Если пользователь спрашивает, что он говорил на встрече или о чём была запись, используй поле transcript соответствующей записи. Если у записи нет транскрипта (hasTranscript = false), честно ответь, что для этой записи транскрипт пока отсутствует.
- dayScheduleItems: массив пунктов расписания на сегодня.
Никогда не предлагай удалённые сущности. Отвечай СТРОГО в формате JSON без markdown блоков (или внутри json блока):
{
  "action": "create_alarms" | "create_task" | "create_list" | "create_note" | "build_plan" | "answer" | "noop",
  "explanation": "краткое понятное описание пользователю на русском языке",
  "reply": "короткий ответ пользователю",
  "alarms": [
    {
      "label": "Тренировка",
      "time": "07:30",
      "repeat": "days" | "once" | "daily" | "date" | "interval",
      "days": [0, 2, 4],
      "date": null,
      "intervalMinutes": null,
      "windowStart": null,
      "windowEnd": null
    }
  ],
  "task": { "title": "...", "dueDate": "YYYY-MM-DD", "listName": "...", "priority": 0 },
  "list": { "name": "...", "color": "#HEX" },
  "note": { "title": "...", "body": "..." },
  "plan": { "tasks": [{ "title": "...", "dueDate": "YYYY-MM-DD", "startAt": "ISO or YYYY-MM-DDTHH:MM:SS", "plannedMinutes": 30 }] },
  "answer": "текст ответа"
}`;

const WEEKDAY_MAP: Record<string, number> = {
  пн: 0,
  понедельник: 0,
  mon: 0,
  monday: 0,
  вт: 1,
  вторник: 1,
  tue: 1,
  tuesday: 1,
  ср: 2,
  среда: 2,
  среду: 2,
  wed: 2,
  wednesday: 2,
  чт: 3,
  четверг: 3,
  thu: 3,
  thursday: 3,
  пт: 4,
  пятница: 4,
  пятницу: 4,
  fri: 4,
  friday: 4,
  сб: 5,
  суббота: 5,
  субботу: 5,
  sat: 5,
  saturday: 5,
  вс: 6,
  воскресенье: 6,
  sun: 6,
  sunday: 6,
};

function extractWeekdaysFromText(text: string): number[] {
  const lower = text.toLowerCase();
  if (lower.includes('каждый день') || lower.includes('ежедневно') || lower.includes('daily')) {
    return [0, 1, 2, 3, 4, 5, 6];
  }
  if (lower.includes('по будням') || lower.includes('в будни') || lower.includes('weekdays')) {
    return [0, 1, 2, 3, 4];
  }
  if (lower.includes('по выходным') || lower.includes('в выходные') || lower.includes('weekends')) {
    return [5, 6];
  }
  const days = new Set<number>();
  for (const [name, dayNum] of Object.entries(WEEKDAY_MAP)) {
    const regex = new RegExp(`(?:^|[\\s,;:«"'(])${name}(?:$|[\\s,;:»"')])`, 'i');
    if (regex.test(lower)) {
      days.add(dayNum);
    }
  }
  return Array.from(days).sort((a, b) => a - b);
}

export function parseLocalAlarms(prompt: string, now: Date = new Date()): AlarmDraft[] {
  void now;
  const lower = prompt.toLowerCase();

  // 1. Interval format: e.g. "каждые 2 часа с 09:00 до 18:00 пить воду", "каждые 30 минут разминка"
  const intervalMatch = lower.match(
    /(?:каждые|every)\s+(\d+)\s*(часов|часа|час|минуты|минут|мин|minutes?|hours?|ч)/i,
  );
  if (intervalMatch) {
    const rawVal = parseInt(intervalMatch[1], 10);
    const isHours = /^(?:ч|час|часа|часов|hours?)$/i.test(intervalMatch[2]);
    const step = isHours ? rawVal * 60 : rawVal;

    let windowStart = '09:00';
    let windowEnd = '21:00';
    const windowMatch = prompt.match(/(?:с|from)\s*([01]?\d:[0-5]\d)\s*(?:до|to|по)\s*([01]?\d:[0-5]\d)/i);
    if (windowMatch) {
      windowStart = windowMatch[1].padStart(5, '0');
      windowEnd = windowMatch[2].padStart(5, '0');
    }

    let label = prompt
      .replace(intervalMatch[0], '')
      .replace(/(?:с|from)\s*[01]?\d:[0-5]\d\s*(?:до|to|по)\s*[01]?\d:[0-5]\d/gi, '')
      .replace(/^(?:пожалуйста,?\s*)?(?:напоминай|напоминание|будильник|поставь|создай|делать|сделай)\s*:?/i, '')
      .replace(/[,\-;:]/g, ' ')
      .trim();
    if (!label) label = 'Напоминание';
    else label = label.charAt(0).toUpperCase() + label.slice(1);

    return [
      {
        label,
        time: windowStart,
        repeat: 'interval',
        intervalMinutes: step,
        windowStart,
        windowEnd,
      },
    ];
  }

  // 2. Specific date format: e.g. "поставь будильник на 2026-09-25 09:00 экзамен"
  const dateMatch = prompt.match(/\b(\d{4}-\d{2}-\d{2})\b/);
  if (dateMatch) {
    const timeMatch = prompt.match(/\b([01]?\d:[0-5]\d)\b/);
    const time = timeMatch ? timeMatch[1].padStart(5, '0') : '09:00';
    let label = prompt
      .replace(dateMatch[0], '')
      .replace(/\b[01]?\d:[0-5]\d\b/, '')
      .replace(/^(?:пожалуйста,?\s*)?(?:поставь|создай|добавь)?\s*(?:будильник|напоминание|alarm)?\s*(?:на|в)?\s*:?/i, '')
      .replace(/[,\-;:]/g, ' ')
      .trim();
    if (!label) label = 'Будильник';
    else label = label.charAt(0).toUpperCase() + label.slice(1);

    return [
      {
        label,
        time,
        repeat: 'date',
        date: dateMatch[1],
        days: [],
      },
    ];
  }

  // 3. Multi-line or comma-separated schedule / workout
  // Split prefix header only on colon that is NOT inside a time like HH:MM
  const colonIndex = prompt.search(/:(?!\d)/);
  let prefixHeader = '';
  let contentBody = prompt;
  if (colonIndex !== -1) {
    prefixHeader = prompt.slice(0, colonIndex);
    contentBody = prompt.slice(colonIndex + 1);
  }

  let segments = contentBody.split('\n').map((s) => s.trim()).filter((s) => s.length > 0);
  if (segments.length === 1 && segments[0].includes(',')) {
    segments = segments[0].split(',').map((s) => s.trim()).filter((s) => s.length > 0);
  }

  const promptDays = extractWeekdaysFromText(prompt);
  const alarms: AlarmDraft[] = [];
  let pendingDays: number[] = extractWeekdaysFromText(prefixHeader);

  for (const seg of segments) {
    const timeMatches = seg.match(/\b([01]?\d:[0-5]\d)\b/g);
    if (!timeMatches || timeMatches.length === 0) {
      const foundDays = extractWeekdaysFromText(seg);
      if (foundDays.length > 0) {
        pendingDays = Array.from(new Set([...pendingDays, ...foundDays])).sort((a, b) => a - b);
      }
      continue;
    }

    const segDays = extractWeekdaysFromText(seg);
    let effectiveDays: number[];
    if (segDays.length > 0 && pendingDays.length > 0) {
      effectiveDays = Array.from(new Set([...pendingDays, ...segDays])).sort((a, b) => a - b);
      pendingDays = effectiveDays;
    } else if (segDays.length > 0) {
      effectiveDays = segDays;
    } else if (pendingDays.length > 0) {
      effectiveDays = pendingDays;
    } else {
      effectiveDays = promptDays;
    }

    for (const rawTime of timeMatches) {
      const time = rawTime.padStart(5, '0');
      let label = seg
        .replace(rawTime, '')
        .replace(/(?:понедельник|пн|вторник|вт|среда|среду|ср|четверг|чт|пятница|пятницу|пт|суббота|субботу|сб|воскресенье|вс)/gi, '')
        .replace(/^(?:в|на|во|at)\s+/i, '')
        .replace(
          /^(?:пожалуйста,?\s*)?(?:поставь|создай|добавь)?\s*(?:будильник|будильники|тренирова|тренирову|тренирови)?\s*:?/i,
          '',
        )
        .replace(/[,\-;:]/g, ' ')
        .trim();

      if (!label) {
        label = /трениров/i.test(prompt) ? 'Тренировка' : 'Будильник';
      }
      label = label.charAt(0).toUpperCase() + label.slice(1);

      let repeat: AlarmRepeat = 'once';
      if (effectiveDays.length === 7 || /каждый день|ежедневно/i.test(seg) || /каждый день|ежедневно/i.test(prompt)) {
        repeat = 'daily';
      } else if (effectiveDays.length > 0) {
        repeat = 'days';
      }

      alarms.push({
        label,
        time,
        repeat,
        days: effectiveDays,
      });
    }
  }

  if (alarms.length > 0) {
    return alarms;
  }

  // 4. Single alarm fallback if times are found anywhere
  const anyTimes = prompt.match(/\b([01]?\d:[0-5]\d)\b/g);
  if (anyTimes && anyTimes.length > 0) {
    const days = extractWeekdaysFromText(prompt);
    return anyTimes.map((t) => {
      const time = t.padStart(5, '0');
      let label = prompt
        .replace(/\b[01]?\d:[0-5]\d\b/g, '')
        .replace(/^(?:пожалуйста,?\s*)?(?:поставь|создай|добавь)?\s*(?:будильник|напоминание|alarm)?\s*(?:на|в)?\s*:?/i, '')
        .replace(/[,\-;:]/g, ' ')
        .trim();
      if (!label) label = /трениров/i.test(prompt) ? 'Тренировка' : 'Будильник';
      else label = label.charAt(0).toUpperCase() + label.slice(1);

      return {
        label,
        time,
        repeat: (days.length > 0 ? 'days' : 'once') as AlarmRepeat,
        days,
      };
    });
  }

  // 5. If no times at all, but explicit workout or alarm request:
  if (/трениров|будильник/i.test(lower)) {
    const days = extractWeekdaysFromText(prompt);
    return [
      {
        label: /трениров/i.test(lower) ? 'Тренировка' : 'Будильник',
        time: '08:00',
        repeat: (days.length > 0 ? 'days' : 'once') as AlarmRepeat,
        days,
      },
    ];
  }

  return [];
}
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

      const parsedAlarms = Array.isArray(parsed.alarms)
        ? (parsed.alarms as unknown[]).filter(isRecord).map((a) => {
            const timeRaw = asString(a.time, '08:00');
            const timeMatch = timeRaw.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
            const time = timeMatch ? `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}` : '08:00';
            const repeatRaw = asString(a.repeat, 'once');
            const repeat: AlarmRepeat = (['once', 'daily', 'days', 'date', 'interval'].includes(repeatRaw)
              ? repeatRaw
              : 'once') as AlarmRepeat;
            const days = Array.isArray(a.days)
              ? a.days.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)
              : [];
            return {
              label: asString(a.label, asString(a.title, 'Будильник')),
              time,
              repeat,
              days,
              date: typeof a.date === 'string' && a.date ? a.date : null,
              intervalMinutes:
                typeof a.intervalMinutes === 'number'
                  ? a.intervalMinutes
                  : typeof a.interval_minutes === 'number'
                    ? a.interval_minutes
                    : null,
              windowStart:
                typeof a.windowStart === 'string'
                  ? a.windowStart
                  : typeof a.window_start === 'string'
                    ? a.window_start
                    : null,
              windowEnd:
                typeof a.windowEnd === 'string'
                  ? a.windowEnd
                  : typeof a.window_end === 'string'
                    ? a.window_end
                    : null,
            };
          })
        : undefined;

      const hasAlarms = Boolean(parsedAlarms && parsedAlarms.length > 0);
      const rawAction = asString(parsed.action, '');
      const action = (hasAlarms || rawAction === 'create_alarms'
        ? 'create_alarms'
        : ['create_task', 'create_list', 'create_note', 'build_plan', 'answer', 'noop'].includes(rawAction)
          ? rawAction
          : 'answer') as AIActionPlan['action'];

      const explanation = asString(
        parsed.explanation,
        asString(parsed.reply, asString(parsed.answer, hasAlarms ? 'Предлагаю настроить будильники' : 'Готово')),
      );

      return {
        action,
        explanation,
        reply: typeof parsed.reply === 'string' ? parsed.reply : undefined,
        alarms: parsedAlarms,
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
        const [activeTasks, activeLists, activeNotes, activeRecordings] = await Promise.all([
          listTasks(),
          listLists(),
          listNotes(),
          listRecordings().catch(() => []),
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
          recordings: activeRecordings.map((r) => ({
            id: r.id,
            title: r.title,
            transcript: r.transcript || null,
            hasTranscript: Boolean(r.transcript && r.transcript.trim().length > 0),
          })),
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

    // 0. Alarms / schedule / workout:
    // R03: Text of schedule/workouts turns into alarms, NOT tasks.
    const isAlarmOrWorkoutIntent =
      lower.includes('будильник') ||
      lower.includes('трениров') ||
      lower.includes('расписани') ||
      lower.includes('график') ||
      lower.includes('каждые') ||
      lower.includes('every ') ||
      lower.includes('alarm') ||
      lower.includes('workout');

    if (isAlarmOrWorkoutIntent) {
      const alarms = parseLocalAlarms(prompt, now);
      if (alarms.length > 0) {
        const noun = alarms.length === 1 ? 'будильник' : alarms.length < 5 ? 'будильника' : 'будильников';
        return {
          action: 'create_alarms',
          explanation: `Найдено ${alarms.length} ${noun} для настройки.`,
          reply: `Найдено ${alarms.length} ${noun} для настройки.`,
          alarms,
        };
      }
    }

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

    // 5. Query about recordings/transcripts: "что я говорил на встрече", "какие записи", "что в записи"
    if (
      lower.includes('что я говорил') ||
      lower.includes('на встрече') ||
      lower.includes('в записи') ||
      lower.includes('мои записи') ||
      lower.includes('какие записи')
    ) {
      return {
        action: 'answer',
        explanation: 'Запрос информации по записям и транскриптам.',
      };
    }

    // 6. Query about tasks/plan
    if (lower.includes('какие задачи') || lower.includes('что на сегодня') || lower.includes('план на сегодня') || lower.includes('список задач')) {
      return {
        action: 'answer',
        explanation: 'Запрос информации по задачам.',
      };
    }
    // Default no-op: use existing unrecognizedCommand key (R12)
    const t = I18nService.t();
    return {
      action: 'noop',
      explanation: t.unrecognizedCommand || 'Команда не распознана.',
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
        emitDataChanged('tasks', [created.id]);
        return {
          action: 'create_task',
          explanation: actionPlan.explanation || `Задача «${created.title}» добавлена.`,
          createdTasks: [created],
        };
      }

      if (actionPlan.action === 'create_list' && actionPlan.list) {
        const created = await createList(actionPlan.list.name, actionPlan.list.color ?? null);
        emitDataChanged('lists', [created.id]);
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
        emitDataChanged('notes', [created.id]);
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
        emitDataChanged('tasks', createdTasks.map((t) => t.id));
        return {
          action: 'build_plan',
          explanation: actionPlan.explanation || `План дня создан (${createdTasks.length} задач).`,
          createdTasks,
        };
      }
      if (actionPlan.action === 'create_alarms') {
        // R04: Alarms are not written to DB before confirmation.
        return {
          action: 'create_alarms',
          explanation: actionPlan.explanation || actionPlan.reply || 'Предпросмотр будильников готов к подтверждению.',
          alarms: actionPlan.alarms,
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
