import { AISettings, DynamicUIConfig, AlarmItem, Schedule } from '../types';
import { asArray, asBoolean, asNumber, asString, isRecord, oneOf } from '../types/guards';
import { AIGateway } from './aiGateway';
import type { HistoryDigest } from './aiHistory';

/**
 * Commands the local keyword map handles better than a model.
 *
 * Each entry is a *pair*: an action word and a thing it acts on. Matching on the
 * bare verb ("покажи") swallowed unrelated requests, and matching on the bare
 * noun ("тему") did the same. Both halves must be present.
 */
const UI_ACTION_WORDS = [
  'убери',
  'убрать',
  'скрой',
  'спрячь',
  'верни',
  'включи',
  'выключи',
  'добавь',
  'отключи',
];
const UI_TARGET_WORDS = [
  'засечк',
  'пресет',
  'кнопк',
  'ко сну',
  'панель',
  'плашк',
  'бейдж',
  'подтаймер',
  'циферблат',
  'амолед',
  'amoled',
  'киберпанк',
  'cyberpunk',
  'минимал',
  'круглые',
  'квадратн',
  'моноширинн',
];

/**
 * True only for unambiguous local UI toggles.
 *
 * Deliberately narrow. A request that merely mentions a UI noun, or only shares
 * a verb with these, must reach the model — that was the whole defect this
 * replaces.
 */
function isLocalUiCommand(lowerPrompt: string): boolean {
  const hasAction = UI_ACTION_WORDS.some((w) => lowerPrompt.includes(w));
  const hasTarget = UI_TARGET_WORDS.some((w) => lowerPrompt.includes(w));
  return hasAction && hasTarget;
}

/** A parsed draft carries the pasted text and the assistant note for the card. */
export type ScheduleDraft = Schedule & { sourceText: string; note: string };

export interface DirectionDraft {
  name: string;
  weeklyBlockBudget: number;
  color?: string;
}

export interface AIPlatformMutation {
  type: 'ui_change' | 'alarm_schedule' | 'workout_plan' | 'hybrid' | 'answer' | 'directions';
  explanation: string;
  ui?: Partial<DynamicUIConfig>;
  alarms?: AlarmItem[];
  directions?: DirectionDraft[];
  autoApply: boolean;
}

export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  mutation?: AIPlatformMutation;
  /**
   * Present when this message carries a parsed schedule awaiting confirmation.
   * The user reviews it as a card and saves it in one action.
   */
  scheduleDraft?: ScheduleDraft;
}

/**
 * Said when the request matched no local action and no model was reachable.
 *
 * The offline compiler is a keyword map, not an assistant: admitting that is
 * better than inventing an edit, which is what it used to do.
 */
const NOTHING_TO_CHANGE =
  'Не понял запрос — я не изменил интерфейс. Опишите, что поменять (например: «сделай AMOLED и убери засечки»), либо подключите нейросеть в Настройках → Нейросеть, чтобы я отвечал на любые вопросы.';

export class AICompilerService {
  private static buildSystemPrompt(historyDigest?: HistoryDigest): string {
    const digestSection = historyDigest
      ? `\n\nСводка журнала фокуса (агрегированные данные за прошедшее время, без названий сессий):\n${JSON.stringify(historyDigest, null, 2)}\nЕсли история пуста (0 сессий) и пользователь спрашивает о статистике/работе/итогах недели, честно ответь в explanation, что данных в журнале пока нет, и не придумывай цифры.`
      : '';

    return `Ты — AI-ассистент приложения Alarmer: таймер, будильники, программы дня, направления фокуса, задачи и оформление интерфейса.${digestSection}

Сначала реши, чего хочет пользователь:
- Если это ВОПРОС или разговор (например «покажи расписание на завтра», «сколько я работал», «куда ушла неделя», «когда я работаю лучше всего?», «что ты умеешь»), ответь текстом в поле "explanation", поставь "type": "answer" и НЕ присылай "ui", "alarms" или "directions". Отвечай строго на основе переданной сводки журнала, не выдумывай несуществующие данные. Если данных нет — честно скажи об этом.
- Если это создание или настройка НАПРАВЛЕНИЙ (например «создай направление Код с бюджетом 10 блоков»), поставь "type": "directions", заполни массив "directions" и кратко объясни в "explanation".
- Если это КОМАНДА настройки UI или будильников, выполни её и опиши в "explanation" ровно то, что изменил.

Никогда не выдумывай изменения, которых пользователь не просил, и не описывай работу, которую не сделал.

Когда пользователь просит изменить оформление — не бери фиксированные шаблоны, сгенерируй гармоничный дизайн с hex-кодами под настроение запроса. В "ui.colors" присылай ТОЛЬКО те цвета, которые меняешь: остальные берутся из выбранной пользователем темы.

Отвечай ИСКЛЮЧИТЕЛЬНО в формате JSON со следующей структурой:
{
  "type": "ui" | "alarm" | "workout" | "hybrid" | "directions" | "answer",
  "explanation": "Короткое понятное объяснение того, что изменилось или ответ на вопрос на русском языке (1-2 предложения)",
  "autoApply": true,
  "directions": [
    {
      "name": "Название направления",
      "weeklyBlockBudget": 10,
      "color": "#hex (необязательно)"
    }
  ],
  "ui": {
    "colors": {
      "bg": "#hex",
      "surface": "#hex",
      "cardBg": "#hex",
      "border": "#hex",
      "text": "#hex",
      "subtext": "#hex",
      "accent": "#hex",
      "accentGlow": "#hex",
      "ringTrack": "#hex",
      "ringProgress": "#hex",
      "ticks": "#hex"
    },
    "typography": {
      "fontFamily": "system-ui" | "mono" | "cyber" | "serif",
      "timeScale": 1.0
    },
    "dial": {
      "size": 220,
      "showTicks": true,
      "tickLength": "short" | "normal" | "long",
      "glowIntensity": "none" | "subtle" | "high"
    },
    "layout": {
      "showPresetButtons": true,
      "showSubtimer": true,
      "buttonStyle": "rounded" | "square" | "pill",
      "contentAlignment": "center" | "top" | "compact"
    }
  },
  "alarms": [
    {
      "id": "alarm_1",
      "title": "Название",
      "label": "Название",
      "time": "08:00",
      "days": [1,2,3,4,5],
      "enabled": true,
      "sound": "gentle",
      "voicePrompt": "Текст голосового напоминания"
    }
  ],
  "workout": {
    "id": "workout_1",
    "name": "Название комплекса",
    "repeatCount": 3,
    "steps": [
      { "id": "s1", "name": "Разминка", "durationSec": 60, "type": "prepare", "voicePrompt": "Начинаем разминку" },
      { "id": "s2", "name": "Упражнение", "durationSec": 45, "type": "work", "voicePrompt": "Работаем активно" },
      { "id": "s3", "name": "Отдых", "durationSec": 15, "type": "rest", "voicePrompt": "Отдых" }
    ]
  }
}`;
  }

  static async compileUserIntent(
    prompt: string,
    currentUi: DynamicUIConfig,
    settings: AISettings,
    historyDigest?: HistoryDigest,
  ): Promise<AIPlatformMutation> {
    const lowerPrompt = prompt.toLowerCase();

    // The offline compiler is a keyword map, not a model. It used to take over
    // on any prompt containing "покажи", "верни" or "тему" — so "покажи
    // расписание на завтра" never reached the model at all. It now handles only
    // the two things it is genuinely better at: instant local UI toggles, and
    // the no-key case.
    const isDirectUiCommand = isLocalUiCommand(lowerPrompt);
    const haveKey = Boolean(settings.apiKey?.trim()) || (await AIGateway.hasKey());

    if (isDirectUiCommand || !haveKey) {
      return this.offlineFallbackCompiler(prompt, currentUi, historyDigest);
    }

    const { value, error } = await AIGateway.requestJson({
      system: this.buildSystemPrompt(historyDigest),
      user: `Текущий конфиг UI:\n${JSON.stringify(currentUi, null, 2)}\n\nЗапрос пользователя:\n"${prompt}"`,
      baseUrl: settings.baseUrl,
      model: settings.model || 'gpt-4o-mini',
    });
    if (error) {
      // Say so. Reporting a canned local edit as the model's work is how the
      // CSP-blocked endpoint went unnoticed.
      const fallback = this.offlineFallbackCompiler(prompt, currentUi, historyDigest);
      return { ...fallback, explanation: `${fallback.explanation} (модель недоступна: ${error})` };
    }

    if (value.type === 'answer') {
      // A conversational reply carries no mutation. Saying so explicitly keeps
      // the caller from applying an empty edit and reporting success.
      return {
        type: 'answer',
        explanation: asString(value.explanation, ''),
        autoApply: false,
      };
    }

    if (value.type === 'directions') {
      const directions = this.toDirections(value.directions);
      return {
        type: 'directions',
        explanation: asString(value.explanation, 'Созданы новые направления фокуса'),
        directions: directions.length > 0 ? directions : undefined,
        autoApply: directions.length > 0,
      };
    }

    return {
      type: value.type === 'hybrid' || value.type === 'alarm_schedule' ? 'hybrid' : 'ui_change',
      explanation: asString(value.explanation, 'Интерфейс обновлён'),
      ui: isRecord(value.ui) ? (value.ui as Partial<DynamicUIConfig>) : undefined,
      alarms: asArray<unknown>(value.alarms, []).length > 0
        ? this.toAlarms(value.alarms)
        : undefined,
      directions: asArray<unknown>(value.directions, []).length > 0
        ? this.toDirections(value.directions)
        : undefined,
      autoApply: asBoolean(value.autoApply, true),
    };
  }

  /** Validates alarms the model produced into real `AlarmItem`s. */
  private static toAlarms(raw: unknown): AlarmItem[] {
    return asArray<unknown>(raw, []).map((item, idx) => {
      const a = isRecord(item) ? item : {};
      const title = asString(a.title, asString(a.label, 'Будильник'));
      const days = asArray<unknown>(a.days, [1, 2, 3, 4, 5]).filter(
        (d): d is number => typeof d === 'number' && d >= 0 && d <= 6,
      );
      const voicePrompt = asString(a.voicePrompt, title);
      return {
        id: `ai_alarm_${Date.now()}_${idx}`,
        title,
        label: title,
        time: asString(a.time, '08:00'),
        days,
        repeat: oneOf(a.repeat, ['once', 'daily', 'days'] as const, 'days' as const),
        enabled: asBoolean(a.enabled, true),
        sound: asString(a.sound, 'gentle'),
        voicePrompt,
        voiceAnnouncement: voicePrompt,
      };
    });
  }
  /** Validates direction drafts produced by the model. */
  private static toDirections(raw: unknown): DirectionDraft[] {
    return asArray<unknown>(raw, []).map((item) => {
      const d = isRecord(item) ? item : {};
      const name = asString(d.name, 'Новое направление').trim();
      const weeklyBlockBudget = Math.max(0, Math.round(asNumber(d.weeklyBlockBudget, 10)));
      const color = typeof d.color === 'string' && d.color.trim().length > 0 ? d.color.trim() : undefined;
      return {
        name: name || 'Новое направление',
        weeklyBlockBudget,
        ...(color ? { color } : {}),
      };
    }).filter((d) => d.name.length > 0);
  }


  private static offlineFallbackCompiler(
    prompt: string,
    currentUi: DynamicUIConfig,
    historyDigest?: HistoryDigest,
  ): AIPlatformMutation {
    const lower = prompt.toLowerCase();

    // History-related questions in offline mode or empty history
    const isHistoryQuestion =
      lower.includes('лучше всего') ||
      lower.includes('куда ушла неделя') ||
      lower.includes('сколько я работал') ||
      lower.includes('когда я работаю') ||
      lower.includes('статистик') ||
      lower.includes('итог');

    if (isHistoryQuestion) {
      if (!historyDigest || historyDigest.totals.sessions === 0) {
        return {
          type: 'answer',
          explanation: 'В журнале пока нет данных о сессиях фокуса. Проведите несколько фокус-сессий, чтобы я мог рассказать о вашей продуктивности.',
          autoApply: false,
        };
      }
      const minutes = Math.round(historyDigest.totals.focusedSec / 60);
      return {
        type: 'answer',
        explanation: `Всего зафиксировано ${historyDigest.totals.sessions} сессий (${minutes} мин фокуса).`,
        autoApply: false,
      };
    }

    // Direction creation intent via keyword/offline: "создай направление X с бюджетом Y"
    if (lower.includes('направлени') && (lower.includes('создай') || lower.includes('добавь'))) {
      const budgetMatch = prompt.match(/(\d+)\s*(блок|ч|h)/i);
      const budget = budgetMatch ? parseInt(budgetMatch[1], 10) : 10;
      const nameMatch = prompt.match(/(?:направление|направлением)\s+([«"][^»"]+[»"]|\S+)/i);
      const rawName = nameMatch ? nameMatch[1].replace(/[«»"]/g, '') : 'Новое направление';
      return {
        type: 'directions',
        explanation: `Создано направление «${rawName}» с бюджетом ${budget} блоков в неделю.`,
        directions: [{ name: rawName, weeklyBlockBudget: budget }],
        autoApply: true,
      };
    }


    // If asking for capabilities
    if (lower.includes('что ты умеешь') || lower.includes('что умеешь') || lower.includes('помощь') || lower.includes('help')) {
      return {
        type: 'hybrid',
        explanation: `Я — твой персональный AI Co-Pilot для Alarmer. Вот весь мой арсенал:\n\n✨ 1. Генеративный UI: напиши мне любой стиль (например: «Сделай фиолетовый киберпанк с круглыми кнопками», «Убери засечки и пресеты, сделай AMOLED»).\n⏰ 2. Умные будильники: напиши расписание (например: «Будильник на 07:00 и 21:30 по будням с напоминанием о беге»).\n🏋️‍♂️ 3. Фитнес-сценарии: составлю Табату, HIIT или разминку со звуковым сопровождением и голосовыми инструкциями.\n🗣 4. Озвучка: могу говорить через нейронные голоса Microsoft Edge Neural TTS или работать без звука.\n⚙️ 5. Управление: полное управление окном, таймером и режимами.`,
        autoApply: false,
      };
    }

    const cloned = JSON.parse(JSON.stringify(currentUi)) as DynamicUIConfig;

    let explanation = 'ИИ применил изменения по вашему описанию: ';
    const changes: string[] = [];
    // Colors & Palettes
    if (lower.includes('киберпанк') || lower.includes('cyberpunk') || lower.includes('розов')) {
      cloned.colors.bg = '#0d0d17';
      cloned.colors.surface = '#181a27';
      cloned.colors.accent = '#ff007f';
      cloned.colors.accentGlow = '#ff007f80';
      cloned.colors.ringProgress = '#ff007f';
      cloned.colors.text = '#fef08a';
      cloned.dial.glowIntensity = 'high';
      changes.push('тема Cyberpunk (неоновый розовый/желтый)');
    } else if (lower.includes('амолед') || lower.includes('amoled') || lower.includes('черн')) {
      cloned.colors.bg = '#000000';
      cloned.colors.surface = '#0a0a0a';
      cloned.colors.cardBg = '#0a0a0a';
      cloned.colors.border = '#222222';
      cloned.colors.accent = '#00f0ff';
      cloned.colors.ringProgress = '#00f0ff';
      cloned.dial.glowIntensity = 'subtle';
      changes.push('глубокий AMOLED черный');
    } else if (lower.includes('золот') || lower.includes('amber') || lower.includes('янтарь') || lower.includes('оранж')) {
      cloned.colors.bg = '#140f07';
      cloned.colors.surface = '#22190c';
      cloned.colors.accent = '#ffb300';
      cloned.colors.ringProgress = '#ffb300';
      cloned.dial.glowIntensity = 'high';
      changes.push('янтарная палитра');
    }

    // Geometry & Layout
    if (lower.includes('убери засечки') || lower.includes('без засечек') || lower.includes('скрой деления')) {
      cloned.dial.showTicks = false;
      changes.push('скрыты засечки циферблата');
    } else if (lower.includes('верни засечки') || lower.includes('покажи засечки')) {
      cloned.dial.showTicks = true;
      changes.push('включены засечки циферблата');
    }
    if (lower.includes('ко сну') || lower.includes('сна')) {
      if (lower.includes('убери') || lower.includes('скрой') || lower.includes('отключи') || lower.includes('удалить') || lower.includes('выключи')) {
        cloned.layout.showSleepButton = false;
        changes.push('скрыта кнопка «Ко сну»');
      } else if (lower.includes('верни') || lower.includes('покажи') || lower.includes('включи') || lower.includes('добавь')) {
        cloned.layout.showSleepButton = true;
        changes.push('возвращена кнопка «Ко сну»');
      }
    }

    if (lower.includes('ии') || lower.includes('ai') || lower.includes('ассистент')) {
      if (lower.includes('убери') || lower.includes('скрой') || lower.includes('отключи') || lower.includes('удалить') || lower.includes('выключи')) {
        cloned.layout.showAiScheduleButton = false;
        changes.push('скрыта кнопка «ИИ» в будильниках');
      } else if (lower.includes('верни') || lower.includes('покажи') || lower.includes('включи') || lower.includes('добавь')) {
        cloned.layout.showAiScheduleButton = true;
        changes.push('возвращена кнопка «ИИ» в будильниках');
      }
    }

    if (lower.includes('время') || lower.includes('часы') || lower.includes('плашку времени')) {
      if (lower.includes('убери') || lower.includes('скрой') || lower.includes('отключи') || lower.includes('выключи')) {
        cloned.layout.showCurrentTimeBadge = false;
        changes.push('скрыта плашка текущего времени');
      } else if (lower.includes('верни') || lower.includes('покажи') || lower.includes('включи')) {
        cloned.layout.showCurrentTimeBadge = true;
        changes.push('возвращена плашка текущего времени');
      }
    }

    if (lower.includes('убери пресет') || lower.includes('без нижних кнопок') || lower.includes('минимал')) {
      cloned.layout.showPresetButtons = false;
      changes.push('скрыты кнопки быстрых пресетов');
    } else if (lower.includes('покажи пресет') || lower.includes('верни кнопки')) {
      cloned.layout.showPresetButtons = true;
    }

    if (lower.includes('круглые кнопки') || lower.includes('таблетки') || lower.includes('pill')) {
      cloned.layout.buttonStyle = 'pill';
      changes.push('форма кнопок: pill (скругленные)');
    } else if (lower.includes('квадрат') || lower.includes('square')) {
      cloned.layout.buttonStyle = 'square';
      changes.push('форма кнопок: строгие квадраты');
    }

    if (lower.includes('моно') || lower.includes('код') || lower.includes('mono')) {
      cloned.typography.fontFamily = 'mono';
      changes.push('шрифт: моноширинный');
    }

    // Say what actually happened. Claiming "UI трансформирован" while changing
    // nothing is how a user asks a question and is told their interface was
    // redesigned — the message and the effect have to agree.
    const didChangeUi = changes.length > 0;
    if (didChangeUi) explanation += changes.join(', ');

    // Alarms generation if asked
    let alarms: AlarmItem[] | undefined;
    const timeMatches = prompt.match(/\b([0-2]?[0-9]):([0-5][0-9])\b/g);
    if (timeMatches && (lower.includes('будильник') || lower.includes('напомин') || lower.includes('поставь'))) {
      alarms = timeMatches.map((t, i) => ({
        id: `ai_alarm_${Date.now()}_${i}`,
        title: `Напоминание ${t}`,
        label: `Напоминание ${t}`,
        time: t.padStart(5, '0'),
        repeat: 'days' as const,
        days: [1, 2, 3, 4, 5],
        enabled: true,
        sound: 'gentle',
        voicePrompt: `Время активности: ${t}. Выполните запланированное действие!`,
      }));
    }

    if (!didChangeUi) {
      return {
        type: alarms ? 'alarm_schedule' : 'ui_change',
        explanation: alarms
          ? 'Готово: будильники ниже.'
          : NOTHING_TO_CHANGE,
        // No `ui` at all: there is no edit to apply, and sending the unchanged
        // config would let the caller report a successful mutation.
        alarms,
        autoApply: Boolean(alarms),
      };
    }

    return {
      type: alarms ? 'hybrid' : 'ui_change',
      explanation,
      ui: cloned,
      alarms,
      autoApply: true,
    };
  }
}
