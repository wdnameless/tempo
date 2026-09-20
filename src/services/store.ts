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

/**
 * Reads one field from a legacy record.
 *
 * The old shapes are untyped JSON, so every read goes through here rather than
 * casting: a missing or mistyped field becomes `undefined`, which the callers
 * already treat as "use the default".
 */
function row(record: Record<string, unknown>, key: string): unknown {
  return record[key];
}

/** A string field that may be absent, normalised to `undefined`. */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/** Weekdays as stored by the old build: a JSON array of 0..6. */
function asNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => Number(entry))
    .filter((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 6);
}

/** The repeat rule, inferred from the days when the old record did not say. */
function repeatOf(value: unknown, days: number[]): 'once' | 'daily' | 'days' {
  if (value === 'once' || value === 'daily' || value === 'days') return value;
  return days.length > 0 ? 'days' : 'once';
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

    // The old file was written by the store plugin under the key `state`, so the
    // payload is one level down. Reading the top level found nothing and the
    // migration reported success while moving zero rows — the user's alarms and
    // notes would look lost.
    const payload = isRecord(legacyData.state) ? legacyData.state : legacyData;

    // Entities in the old file are stored in their *canonical* shape (an AlarmItem
    // with `title` and a `days` array, a TaskItem with `done: boolean`), not in the
    // shape of the new database columns. Running them through the row readers —
    // which expect `label`, `status`, `body_md` — silently produced empty records,
    // so each is normalised here and converted once, on the way out.
    //
    // Each table is skipped when it already has rows, which makes a second run
    // harmless and keeps a partially failed migration recoverable: whatever did
    // not land is retried next launch.
    if (Array.isArray(payload.alarms) && (await alarmsRepo.all()).length === 0) {
      for (const item of payload.alarms) {
        if (!isRecord(item)) continue;
        const time = asString(row(item, 'time'), '');
        if (!time) continue;
        const label = asString(row(item, 'title'), asString(row(item, 'label'), ''));
        await alarmsRepo.insert(
          alarmToRow({
            id: asString(row(item, 'id'), ''),
            title: label,
            label,
            time,
            days: asNumberArray(row(item, 'days')),
            repeat: repeatOf(row(item, 'repeat'), asNumberArray(row(item, 'days'))),
            enabled: row(item, 'enabled') !== false,
            sound: asString(row(item, 'sound'), 'gentle'),
            voicePrompt: optionalString(row(item, 'voicePrompt')),
            note: optionalString(row(item, 'note')),
          }),
        );
      }
    }

    if (Array.isArray(payload.tasks) && (await tasksRepo.all()).length === 0) {
      for (const item of payload.tasks) {
        if (!isRecord(item)) continue;
        const title = asString(row(item, 'title'), '');
        if (!title) continue;
        await tasksRepo.insert(
          taskToRow({
            id: asString(row(item, 'id'), ''),
            title,
            note: optionalString(row(item, 'note')),
            done: row(item, 'done') === true || row(item, 'status') === 'done',
            priority: 0,
            position: 0,
            createdAt: asString(row(item, 'createdAt'), new Date().toISOString()),
            completedAt: optionalString(row(item, 'completedAt')),
          }),
        );
      }
    }

    if (Array.isArray(payload.notes) && (await notesRepo.all()).length === 0) {
      for (const item of payload.notes) {
        if (!isRecord(item)) continue;
        const id = asString(row(item, 'id'), '');
        if (!id) continue;
        const timestamp = asString(row(item, 'updatedAt'), new Date().toISOString());
        await notesRepo.insert(
          noteToRow({
            id,
            title: asString(row(item, 'title'), ''),
            body: asString(row(item, 'body'), ''),
            pinned: row(item, 'pinned') === true,
            createdAt: asString(row(item, 'createdAt'), timestamp),
            updatedAt: timestamp,
          }),
        );
      }
    }

    if (Array.isArray(payload.chatMessages) && (await chatRepo.all()).length === 0) {
      for (const item of payload.chatMessages) {
        if (!isRecord(item)) continue;
        const id = asString(row(item, 'id'), '');
        const text = asString(row(item, 'text'), '');
        if (!id || !text) continue;
        const sender = asString(row(item, 'sender'), 'user');
        await chatRepo.insert(
          chatMessageToRow({
            id,
            sender: sender === 'assistant' ? 'assistant' : sender === 'system' ? 'system' : 'user',
            text,
            timestamp: asString(row(item, 'timestamp'), new Date().toISOString()),
          }),
        );
      }
    }

    // Preferences: the old keys are renamed once, here, so nothing downstream has
    // to know that a prefix ever changed.
    if (isRecord(payload.preferences)) {
      for (const [k, v] of Object.entries(payload.preferences)) {
        await setPref(k.startsWith('alarmer_') ? k.replace(/^alarmer_/, 'tempo_') : k, v);
      }
    }

    // Settings that used to live beside the entities in the same file.
    if (isRecord(payload.dynamicUi)) {
      await setPref('tempo_dynamic_ui', payload.dynamicUi);
    }
    if (isRecord(payload.aiSettings)) {
      const ai = payload.aiSettings;
      for (const [source, target] of [
        ['baseUrl', 'tempo_ai_base_url'],
        ['model', 'tempo_ai_model'],
        ['systemPrompt', 'tempo_ai_system_prompt'],
        ['enabled', 'tempo_ai_enabled'],
        ['autoAdjustIntervals', 'tempo_ai_auto_adjust'],
      ] as const) {
        if (ai[source] !== undefined) await setPref(target, ai[source]);
      }
      // `apiKey` is deliberately not copied: the key belongs in the OS keyring,
      // never in the database, and the old build already moved it there.
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
