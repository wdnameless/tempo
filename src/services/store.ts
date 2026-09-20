/**
 * Bridge layer for StoreService.
 *
 * NOTE: This file is a temporary migration bridge that redirects legacy
 * StoreService calls to the SQLite database and settings layer.
 * This file will be deleted in the wave where its last consumer goes.
 */

import { invoke } from '@tauri-apps/api/core';
import type {
  AlarmItem,
  TaskItem,
  SessionRecord,
  AISettings,
  NoteItem,
  ChatMessage,
} from '../types';
import { asString, isRecord } from '../types/guards';
import { repo, type EntityMeta } from './db';
import { DEFAULT_DYNAMIC_UI, type DynamicUIConfig } from '../types/dynamicUi';
import { getPref, setPref, subscribePrefs, resetSettingsCacheForTesting } from './settings';

export interface TaskRow extends EntityMeta {
  title: string;
  note: string | null;
  status: string;
  list_id: string | null;
  parent_id: string | null;
  priority: number;
  due_date: string | null;
  start_at: string | null;
  planned_minutes: number | null;
  completed_at: string | null;
  position: number | null;
}

export interface AlarmRow extends EntityMeta {
  label: string;
  time: string;
  days: string;
  repeat: string;
  enabled: number;
  sound: string;
  voice_prompt: string | null;
  note: string | null;
}

export interface NoteRow extends EntityMeta {
  title: string;
  body_md: string;
  pinned: number;
}

export interface ChatMessageRow extends EntityMeta {
  role: string;
  content: string;
  created_at?: string;
}

export interface PersistedState {
  schemaVersion: number;
  alarms: AlarmItem[];
  tasks: TaskItem[];
  sessions: SessionRecord[];
  aiSettings: AISettings;
  /**
   * The dial/typography/layout config the timer and the radial dial read.
   *
   * Shell state (which screen is open, whether the sidebar is collapsed, the
   * accent) is NOT here: it lives in `preferences` under its own keys, because
   * those are read during render before this object is hydrated.
   */
  dynamicUi: DynamicUIConfig;
  chatMessages: ChatMessage[];
  preferences: Record<string, unknown>;
  notes: NoteItem[];
}

export const DEFAULT_AI_SETTINGS: AISettings = {
  apiKey: '',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o-mini',
  systemPrompt: 'You are an AI assistant helping with time management.',
  enabled: false,
  autoAdjustIntervals: false,
};

export const DEFAULT_STATE: PersistedState = {
  schemaVersion: 1,
  alarms: [],
  tasks: [],
  sessions: [],
  aiSettings: DEFAULT_AI_SETTINGS,
  dynamicUi: DEFAULT_DYNAMIC_UI,
  chatMessages: [],
  preferences: {},
  notes: [],
};

// Row ↔ Entity Pure Mappers

export function alarmFromRow(rawRow: Partial<AlarmRow> | Record<string, unknown>): AlarmItem {
  const row = rawRow as Record<string, unknown>;

  const rawDays = row.days;
  let days: number[] = [];
  if (Array.isArray(rawDays)) {
    days = rawDays.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  } else if (typeof rawDays === 'string') {
    try {
      const parsed = JSON.parse(rawDays);
      if (Array.isArray(parsed)) {
        days = parsed.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
      }
    } catch {
      days = [];
    }
  }

  const repeatRaw = asString(row.repeat, '');
  let repeat: 'once' | 'daily' | 'days' = 'once';
  if (repeatRaw === 'daily' || repeatRaw === 'days' || repeatRaw === 'once') {
    repeat = repeatRaw;
  } else if (days.length > 0) {
    repeat = 'days';
  }

  const label = asString(row.label, asString(row.title, ''));

  return {
    id: asString(row.id, ''),
    title: label,
    label,
    time: asString(row.time, '00:00'),
    days,
    repeat,
    enabled: typeof row.enabled === 'boolean' ? row.enabled : row.enabled === 1 || row.enabled === '1',
    sound: asString(row.sound, 'gentle'),
    voicePrompt:
      typeof row.voice_prompt === 'string'
        ? row.voice_prompt
        : typeof row.voicePrompt === 'string'
          ? row.voicePrompt
          : undefined,
    voiceAnnouncement:
      typeof row.voice_announcement === 'string'
        ? row.voice_announcement
        : typeof row.voiceAnnouncement === 'string'
          ? row.voiceAnnouncement
          : undefined,
    note: typeof row.note === 'string' ? row.note : undefined,
  };
}

export function alarmToRow(alarm: AlarmItem): Omit<AlarmRow, keyof EntityMeta> & { id?: string } {
  return {
    ...(alarm.id ? { id: alarm.id } : {}),
    label: alarm.title || alarm.label || '',
    time: alarm.time,
    days: JSON.stringify(alarm.days || []),
    repeat: alarm.repeat,
    enabled: alarm.enabled ? 1 : 0,
    sound: alarm.sound || 'gentle',
    voice_prompt: alarm.voicePrompt || null,
    note: alarm.note || null,
  };
}

export function taskFromRow(rawRow: Partial<TaskRow> | Record<string, unknown>): TaskItem {
  const row = rawRow as Record<string, unknown>;
  const status = asString(row.status, 'open');
  const createdAt = asString(row.created_at, asString(row.updated_at, new Date().toISOString()));

  return {
    id: asString(row.id, ''),
    title: asString(row.title, ''),
    note: row.note == null ? undefined : asString(row.note, ''),
    done: status === 'done',
    listId: row.list_id == null ? null : asString(row.list_id, ''),
    parentId: row.parent_id == null ? null : asString(row.parent_id, ''),
    priority: typeof row.priority === 'number' ? row.priority : 0,
    dueDate: row.due_date == null ? null : asString(row.due_date, ''),
    startAt: row.start_at == null ? null : asString(row.start_at, ''),
    plannedMinutes: typeof row.planned_minutes === 'number' ? row.planned_minutes : null,
    position: typeof row.position === 'number' ? row.position : 0,
    createdAt,
    completedAt: row.completed_at == null ? null : asString(row.completed_at, ''),
  };
}

export function taskToRow(task: TaskItem): Omit<TaskRow, keyof EntityMeta> & { id?: string } {
  return {
    ...(task.id ? { id: task.id } : {}),
    title: task.title,
    note: task.note || null,
    status: task.done ? 'done' : 'open',
    list_id: task.listId ?? null,
    parent_id: task.parentId ?? null,
    priority: task.priority ?? 0,
    due_date: task.dueDate ?? null,
    start_at: task.startAt ?? null,
    planned_minutes: task.plannedMinutes ?? null,
    completed_at: task.completedAt ?? null,
    position: task.position ?? 0,
  };
}

export function noteFromRow(rawRow: Partial<NoteRow> | Record<string, unknown>): NoteItem {
  const row = rawRow as Record<string, unknown>;
  const updatedAt = asString(row.updated_at, asString(row.updatedAt, new Date().toISOString()));
  const createdAt = asString(row.created_at, asString(row.createdAt, updatedAt));
  return {
    id: asString(row.id, ''),
    title: asString(row.title, ''),
    body: asString(row.body_md, asString(row.body, '')),
    pinned: typeof row.pinned === 'boolean' ? row.pinned : row.pinned === 1 || row.pinned === '1',
    createdAt,
    updatedAt,
    alarmId:
      typeof row.alarm_id === 'string'
        ? row.alarm_id
        : typeof row.alarmId === 'string'
          ? row.alarmId
          : undefined,
  };
}

export function noteToRow(note: NoteItem): Omit<NoteRow, keyof EntityMeta> & { id?: string } {
  return {
    ...(note.id ? { id: note.id } : {}),
    title: note.title,
    body_md: note.body,
    pinned: note.pinned ? 1 : 0,
  };
}

export function chatMessageFromRow(rawRow: Partial<ChatMessageRow> | Record<string, unknown>): ChatMessage {
  const row = rawRow as Record<string, unknown>;
  const role = asString(row.role, 'user');
  const sender: 'user' | 'assistant' | 'system' =
    role === 'assistant' ? 'assistant' : role === 'system' ? 'system' : 'user';
  return {
    id: asString(row.id, ''),
    sender,
    text: asString(row.content, asString(row.text, '')),
    timestamp: asString(row.created_at, asString(row.timestamp, new Date().toISOString())),
  };
}

export function chatMessageToRow(msg: ChatMessage): Omit<ChatMessageRow, keyof EntityMeta> & { id?: string } {
  return {
    ...(msg.id ? { id: msg.id } : {}),
    role: msg.sender,
    content: msg.text,
  };
}

let cachedSnapshot: PersistedState = { ...DEFAULT_STATE };
let isHydratedState = false;

// Repos
const alarmsRepo = repo<AlarmRow>('alarms');
const tasksRepo = repo<TaskRow>('tasks');
const notesRepo = repo<NoteRow>('notes');
const chatRepo = repo<ChatMessageRow>('chat_messages');

/**
 * Migration 0.7: Run once at startup if the database is empty.
 * Reads legacy JSON and migrates alarms, tasks, notes, chat messages, preferences.
 * Does NOT delete the legacy file. Schedules and directions are dropped.
 */
export async function runLegacyMigration(): Promise<void> {
  try {
    const existingAlarms = await alarmsRepo.all();
    const existingTasks = await tasksRepo.all();
    if (existingAlarms.length > 0 || existingTasks.length > 0) {
      return;
    }

    let legacyJsonStr: string | null = null;
    try {
      legacyJsonStr = await invoke<string>('load_legacy_store');
    } catch {
      // No legacy store found or load command failed
      return;
    }

    if (!legacyJsonStr) return;

    let legacyData: unknown;
    try {
      legacyData = JSON.parse(legacyJsonStr);
    } catch {
      return;
    }

    if (!isRecord(legacyData)) return;

    // Migrate alarms
    if (Array.isArray(legacyData.alarms)) {
      for (const item of legacyData.alarms) {
        if (!isRecord(item)) continue;
        const alarm = alarmFromRow(item);
        if (alarm.id && alarm.time) {
          try {
            await alarmsRepo.insert(alarmToRow(alarm));
          } catch {
            // Continue on error
          }
        }
      }
    }

    // Migrate tasks
    if (Array.isArray(legacyData.tasks)) {
      for (const item of legacyData.tasks) {
        if (!isRecord(item)) continue;
        const task = taskFromRow(item);
        if (task.id && task.title) {
          try {
            await tasksRepo.insert(taskToRow(task));
          } catch {
            // Continue on error
          }
        }
      }
    }

    // Migrate notes
    if (Array.isArray(legacyData.notes)) {
      for (const item of legacyData.notes) {
        if (!isRecord(item)) continue;
        const note = noteFromRow(item);
        if (note.id) {
          try {
            await notesRepo.insert(noteToRow(note));
          } catch {
            // Continue on error
          }
        }
      }
    }

    // Migrate chat messages
    if (Array.isArray(legacyData.chatMessages)) {
      for (const item of legacyData.chatMessages) {
        if (!isRecord(item)) continue;
        const msg = chatMessageFromRow(item);
        if (msg.id && msg.text) {
          try {
            await chatRepo.insert(chatMessageToRow(msg));
          } catch {
            // Continue on error
          }
        }
      }
    }

    // Migrate preferences (convert alarmer_* to tempo_*)
    if (isRecord(legacyData.preferences)) {
      for (const [k, v] of Object.entries(legacyData.preferences)) {
        const targetKey = k.startsWith('alarmer_') ? k.replace(/^alarmer_/, 'tempo_') : k;
        await setPref(targetKey, v);
      }
    }
  } catch (err) {
    console.error('runLegacyMigration failed:', err);
  }
}

export const StoreService = {
  async hydrate(): Promise<PersistedState> {
    try {
      await runLegacyMigration();

      const [alarmRows, taskRows, noteRows, chatRows] = await Promise.all([
        alarmsRepo.all(),
        tasksRepo.all(),
        notesRepo.all(),
        chatRepo.all(),
      ]);

      const alarms: AlarmItem[] = alarmRows.map(alarmFromRow);
      const tasks: TaskItem[] = taskRows.map(taskFromRow);
      const notes: NoteItem[] = noteRows.map(noteFromRow);
      const chatMessages: ChatMessage[] = chatRows.map(chatMessageFromRow);

      const aiSettings: AISettings = {
        apiKey: '',
        baseUrl: getPref<string>('tempo_ai_base_url', DEFAULT_AI_SETTINGS.baseUrl),
        model: getPref<string>('tempo_ai_model', DEFAULT_AI_SETTINGS.model),
        systemPrompt: getPref<string>('tempo_ai_system_prompt', DEFAULT_AI_SETTINGS.systemPrompt || ''),
        enabled: getPref<boolean>('tempo_ai_enabled', DEFAULT_AI_SETTINGS.enabled ?? false),
        autoAdjustIntervals: getPref<boolean>('tempo_ai_auto_adjust', DEFAULT_AI_SETTINGS.autoAdjustIntervals ?? false),
      };

      const dynamicUi = getPref<DynamicUIConfig>('tempo_dynamic_ui', DEFAULT_DYNAMIC_UI);

      cachedSnapshot = {
        schemaVersion: 1,
        alarms,
        tasks,
        sessions: [],
        aiSettings,
        dynamicUi,
        chatMessages,
        preferences: {},
        notes,
      };

      isHydratedState = true;
      return cachedSnapshot;
    } catch (err) {
      console.error('StoreService.hydrate failed:', err);
      return cachedSnapshot;
    }
  },

  getSnapshot(): PersistedState {
    return cachedSnapshot;
  },

  snapshot(): PersistedState {
    return cachedSnapshot;
  },

  isHydrated(): boolean {
    return isHydratedState;
  },

  async persist(patch: Partial<PersistedState>): Promise<void> {
    if (patch.alarms) {
      cachedSnapshot.alarms = patch.alarms;
      const existing = await alarmsRepo.all();
      const existingIds = new Set(existing.map((r) => r.id));

      for (const a of patch.alarms) {
        const row = alarmToRow(a);
        if (existingIds.has(a.id)) {
          await alarmsRepo.update(a.id, row);
          existingIds.delete(a.id);
        } else {
          await alarmsRepo.insert(row);
        }
      }
      for (const id of existingIds) {
        await alarmsRepo.remove(id);
      }
    }

    if (patch.tasks) {
      cachedSnapshot.tasks = patch.tasks;
      const existing = await tasksRepo.all();
      const existingIds = new Set(existing.map((r) => r.id));

      for (const t of patch.tasks) {
        const row = taskToRow(t);
        if (existingIds.has(t.id)) {
          await tasksRepo.update(t.id, row);
          existingIds.delete(t.id);
        } else {
          await tasksRepo.insert(row);
        }
      }
      for (const id of existingIds) {
        await tasksRepo.remove(id);
      }
    }

    if (patch.notes) {
      cachedSnapshot.notes = patch.notes;
      const existing = await notesRepo.all();
      const existingIds = new Set(existing.map((r) => r.id));

      for (const n of patch.notes) {
        const row = noteToRow(n);
        if (existingIds.has(n.id)) {
          await notesRepo.update(n.id, row);
          existingIds.delete(n.id);
        } else {
          await notesRepo.insert(row);
        }
      }
      for (const id of existingIds) {
        await notesRepo.remove(id);
      }
    }

    if (patch.chatMessages) {
      cachedSnapshot.chatMessages = patch.chatMessages;
      const existing = await chatRepo.all();
      const existingIds = new Set(existing.map((r) => r.id));

      for (const m of patch.chatMessages) {
        const row = chatMessageToRow(m);
        if (existingIds.has(m.id)) {
          await chatRepo.update(m.id, row);
          existingIds.delete(m.id);
        } else {
          await chatRepo.insert(row);
        }
      }
      for (const id of existingIds) {
        await chatRepo.remove(id);
      }
    }

    if (patch.aiSettings) {
      cachedSnapshot.aiSettings = patch.aiSettings;
      if (patch.aiSettings.baseUrl !== undefined) {
        await setPref('tempo_ai_base_url', patch.aiSettings.baseUrl);
      }
      if (patch.aiSettings.model !== undefined) {
        await setPref('tempo_ai_model', patch.aiSettings.model);
      }
      if (patch.aiSettings.systemPrompt !== undefined) {
        await setPref('tempo_ai_system_prompt', patch.aiSettings.systemPrompt);
      }
      if (patch.aiSettings.enabled !== undefined) {
        await setPref('tempo_ai_enabled', patch.aiSettings.enabled);
      }
      if (patch.aiSettings.autoAdjustIntervals !== undefined) {
        await setPref('tempo_ai_auto_adjust', patch.aiSettings.autoAdjustIntervals);
      }
    }

    if (patch.dynamicUi) {
      cachedSnapshot.dynamicUi = { ...cachedSnapshot.dynamicUi, ...patch.dynamicUi };
      await setPref('tempo_dynamic_ui', cachedSnapshot.dynamicUi);
    }
  },

  getPreference<T>(key: string, fallback: T): T {
    const canonicalKey = key.startsWith('alarmer_') ? key.replace(/^alarmer_/, 'tempo_') : key;
    return getPref<T>(canonicalKey, getPref<T>(key, fallback));
  },

  async setPreference<T>(key: string, value: T): Promise<void> {
    const canonicalKey = key.startsWith('alarmer_') ? key.replace(/^alarmer_/, 'tempo_') : key;
    await setPref(canonicalKey, value);
  },

  subscribePreference<T>(key: string, callback: (value: T) => void): () => void {
    return subscribePrefs((k, val) => {
      const canonicalKey = key.startsWith('alarmer_') ? key.replace(/^alarmer_/, 'tempo_') : key;
      if (k === key || k === canonicalKey) {
        callback(val as T);
      }
    });
  },

  async exportJson(): Promise<string> {
    const snap = this.snapshot();
    const exportData = {
      schemaVersion: 1,
      alarms: snap.alarms,
      tasks: snap.tasks,
      sessions: snap.sessions,
      aiSettings: {
        ...snap.aiSettings,
        apiKey: '',
      },
      dynamicUi: snap.dynamicUi,
      chatMessages: snap.chatMessages,
      preferences: snap.preferences,
      notes: snap.notes,
    };
    return JSON.stringify(exportData, null, 2);
  },

  async importJson(jsonString: string): Promise<PersistedState> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonString);
    } catch {
      throw new Error('Указанный файл не является корректным JSON.');
    }

    if (!isRecord(parsed)) {
      throw new Error('Файл не похож на резервную копию Alarmer.');
    }

    if (!('alarms' in parsed || 'tasks' in parsed || 'preferences' in parsed || 'notes' in parsed)) {
      throw new Error('Файл не похож на резервную копию Alarmer.');
    }

    const patch: Partial<PersistedState> = {};
    if (Array.isArray(parsed.alarms)) {
      patch.alarms = parsed.alarms.filter(isRecord).map(alarmFromRow);
    }
    if (Array.isArray(parsed.tasks)) {
      patch.tasks = parsed.tasks.filter(isRecord).map(taskFromRow);
    }
    if (Array.isArray(parsed.notes)) {
      patch.notes = parsed.notes.filter(isRecord).map(noteFromRow);
    }
    if (Array.isArray(parsed.chatMessages)) {
      patch.chatMessages = parsed.chatMessages.filter(isRecord).map(chatMessageFromRow);
    }

    await this.persist(patch);
    return this.snapshot();
  },

  resetCache(): void {
    cachedSnapshot = { ...DEFAULT_STATE };
    isHydratedState = false;
    // The preference cache lives in its own module and would otherwise outlive
    // the snapshot, so a reset would leave half the state behind — which is how
    // the sidebar collapsed flag leaked between tests.
    resetSettingsCacheForTesting();
  },
};
