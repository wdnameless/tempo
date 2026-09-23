/**
 * @deprecated Legacy theme id kept for the themeFromTokens bridge (wave 12 removes it).
 */
export type ThemeId = string;
export * from './dynamicUi';
export * from './focus';

import type { DynamicUIConfig } from './dynamicUi';

/**
 * One message in the assistant conversation.
 *
 * Defined here rather than in the compiler service: `types` is the bottom of
 * the dependency graph, and a screen that only renders a message should not have
 * to pull the whole compiler — which is what made aiCompiler and aiHistory
 * import each other through this module.
 */
export interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant' | 'system';
  text: string;
  timestamp: string;
  sessionId?: string;
  /** A change the assistant proposes to apply; absent for plain answers. */
  mutation?: AIPlatformMutation;
}

/** A direction the assistant proposed creating from a chat message. */
export interface DirectionDraft {
  name: string;
  weeklyBlockBudget: number;
  color?: string;
}

/**
 * An edit the assistant proposes, with the sentence explaining it.
 *
 * Lives here for the same reason as `ChatMessage`: the drawer renders these
 * flags, and a rendering component must not have to import the compiler.
 */
export interface AIPlatformMutation {
  type: 'ui_change' | 'alarm_schedule' | 'workout_plan' | 'hybrid' | 'answer' | 'directions';
  explanation: string;
  ui?: Partial<DynamicUIConfig>;
  alarms?: AlarmItem[];
  directions?: DirectionDraft[];
  autoApply: boolean;
}

export interface ThemeColors {
  id: ThemeId;
  name: string;
  bg: string;
  surface: string;
  cardBg: string;
  border: string;
  text: string;
  subtext: string;
  accent: string;
  accentGlow: string;
  ringTrack: string;
  ringProgress: string;
  ticks: string;
}

/**
 * How often a standalone alarm rings.
 *
 * `days: []` used to mean "once" in the type, "one time" in the AI prompt and
 * "every day" in the Rust scheduler, so an alarm created as a one-off rang
 * forever. The intent is now explicit instead of inferred from an empty list.
 */
export type RepeatMode = 'once' | 'daily' | 'days' | 'date' | 'interval';

/**
 * A piece of work the user intends to do.
 *
 * A schedule answers "when", which is not the same question as "what". Without
 * a task, a 09:00 block can only say "Начать блок" — it cannot say what the
 * block is for, and nothing survives the block to be counted afterwards.
 */
export type TaskTimerType = 'interval' | 'time';

export interface TaskTimerConfig {
  enabled: boolean;
  type: TaskTimerType;
  /** Interval in minutes (e.g. 60 for every hour). Used when type is 'interval'. */
  intervalMinutes?: number;
  /** Fixed time "HH:MM" (24h). Used when type is 'time'. */
  time?: string;
  /** Sound profile to play when timer rings. Defaults to 'gentle'. */
  sound?: string;
  /** Optional voice speech reminder. */
  voicePrompt?: string;
}

export interface TaskItem {
  id: string;
  title: string;
  /** Optional longer note shown while the task is being worked on. */
  note?: string;
  done: boolean;
  /**
   * The list this task belongs to, when it is a checklist item.
   *
   * A list item is the same row as a task: the reference treats Lists as tasks
   * without dates, and a separate table would have meant a second completion
   * state, a second search kind and a copy of every mutation.
   */
  listId?: string | null;
  /** Parent task when this is a subtask. */
  parentId?: string | null;
  /** 0 none, 1 low, 2 medium, 3 high. */
  priority: number;
  /** "YYYY-MM-DD" — the day the task is planned for. */
  dueDate?: string | null;
  /** ISO local instant the task is scheduled to start. */
  startAt?: string | null;
  /** How long the user expects to spend, in minutes. */
  plannedMinutes?: number | null;
  /** Ordering inside its list or its group; fractional so inserts need no renumber. */
  position: number;
  /** ISO timestamps. */
  createdAt: string;
  completedAt?: string | null;
}

/** A simple checklist: tasks with a name and no dates. */
export interface ListItem {
  id: string;
  name: string;
  /** Hex colour used for the list marker. */
  color?: string | null;
  position: number;
  createdAt: string;
}

/**
 * One completed interval block or finished countdown.
 *
 * Recorded so the app can answer "how much did I actually do" — the question
 * that keeps a time-management tool installed past the first week.
 */
export interface SessionRecord {
  id: string;
  /** Schedule the block came from, when it came from one. */
  scheduleId?: string;
  stepId?: string;
  label: string;
  /** Focused seconds actually spent, excluding paused time. */
  focusedSec: number;
  startedAt: string;
  endedAt: string;
  /** True when the user ran it to completion rather than closing it early. */
  completed: boolean;
  /**
   * Direction this work belonged to. Absent means «Без направления»: it still
   * counts toward total focus, but toward no budget — attributing it to a
   * direction the user never chose would be inventing history.
   */
  directionId?: string;
  /**
   * Focus quality the user rated after the block, 1..10.
   *
   * Their headline signal, and the reason the block cycle asks at all: «качество
   * фокуса — это и есть твоё желание и вовлечённость». Absent when skipped, which
   * is deliberately different from a low score.
   */
  quality?: number;
  /**
   * Blocks earned, fractional (25 of 50 minutes = 0.5).
   *
   * Stored rather than always derived, so a later change to the block length
   * does not silently rewrite what past sessions were worth. Absent on records
   * written before blocks existed — derive those from `focusedSec`.
   */
  blocks?: number;
}
/**
 * A free-form note the user keeps.
 *
 * Written in a deliberately small subset of Markdown (headings, emphasis, lists,
 * code, links) so it reads well as plain text in the store and renders
 * formatted in the UI. Bodies are never injected as HTML — the renderer builds
 * them from text, so a note cannot break the app's CSP or inject a script.
 */
export interface NoteItem {
  id: string;
  /** Optional title; a note with only a body shows its first line instead. */
  title: string;
  /** Markdown body. */
  body: string;
  /** When set, the note is attached to a specific alarm or schedule step. */
  alarmId?: string;
  /** Schedule + step this note belongs to, when attached to a program. */
  scheduleId?: string;
  stepId?: string;
  /** Pinned notes sort ahead of the rest. */
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
}


export interface AlarmItem {
  id: string;
  title: string;
  label?: string;
  time: string; // "HH:MM" 24h
  /** Weekdays, 0 = Sunday. Only consulted when `repeat` is `'days'`. */
  days: number[];
  repeat: RepeatMode;
  enabled: boolean;
  sound: string;
  voicePrompt?: string;
  voiceAnnouncement?: string;
  /** A short description the user wrote, shown on the ringing takeover. */
  note?: string;
  /** Set when this alarm was expanded from a schedule step. */
  scheduleId?: string;
  /** One-off calendar date, `YYYY-MM-DD`. Only for `repeat: 'date'`. */
  date?: string | null;
  /** Step in minutes. Only for `repeat: 'interval'`. */
  intervalMinutes?: number | null;
  /** Interval window start, `HH:MM`. */
  windowStart?: string | null;
  /** Interval window end, `HH:MM`. */
  windowEnd?: string | null;
}

export interface AISettings {
  apiKey: string;
  baseUrl: string;
  model: string;
  systemPrompt?: string;
  enabled?: boolean;
  autoAdjustIntervals?: boolean;
}

export type SoundProfileId = 'mechanical' | 'soft' | 'neon' | 'arcade';

export type ClockStyle = 'digital' | 'classic' | 'sand';
