import React, { useState, useEffect } from 'react';
import { Bell, ListTodo, NotebookPen, Plus, ChevronRight } from 'lucide-react';
import { I18nService } from '../services/i18n';
import { soundService } from '../services/sound';
import { onDataChanged } from '../services/appEvents';
import { listAlarms } from '../services/alarms';
import { createTask, toggleTask } from '../services/tasks';
import { ThemeColors, DynamicUIConfig, AlarmItem, AISettings, TaskItem, NoteItem } from '../types';
import { WinterCanvas } from './WinterCanvas';
import { WinterBottomPlayer } from './WinterBottomPlayer';

export interface DashboardViewProps {
  theme: ThemeColors;
  /** Dial and layout config, passed through to the timer and the alarm list. */
  dynamicUi: DynamicUIConfig;
  alarms: AlarmItem[];
  aiSettings: AISettings;
  onUpdateAlarms: (alarms: AlarmItem[]) => void;
  onOpenAISettings: () => void;
  tasks: TaskItem[];
  onUpdateTasks: (tasks: TaskItem[]) => void;
  timerMinutes?: number;
  notes: NoteItem[];
}

function getNextAlarmInfo(alarms: AlarmItem[]): { label: string; time: string } | null {
  const enabledAlarms = alarms.filter((a) => a.enabled);
  if (enabledAlarms.length === 0) return null;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let bestAlarm: AlarmItem | null = null;
  let minDiff = Infinity;

  for (const alarm of enabledAlarms) {
    const [h, m] = alarm.time.split(':').map(Number);
    if (isNaN(h) || isNaN(m)) continue;
    const alarmMinutes = h * 60 + m;
    let diff = alarmMinutes - currentMinutes;
    if (diff <= 0) {
      diff += 24 * 60; // fires tomorrow
    }
    if (diff < minDiff) {
      minDiff = diff;
      bestAlarm = alarm;
    }
  }

  if (!bestAlarm) {
    bestAlarm = enabledAlarms[0];
  }

  return {
    label: bestAlarm.label || bestAlarm.title || 'Будильник',
    time: bestAlarm.time,
  };
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  alarms,
  onUpdateAlarms,
  tasks,
  onUpdateTasks,
  notes,
}) => {
  const t = I18nService.t();
  const [quickTaskTitle, setQuickTaskTitle] = useState('');

  const openTasks = tasks.filter((task) => !task.done);
  const nextAlarm = getNextAlarmInfo(alarms);

  useEffect(() => {
    const unsub = onDataChanged(async (table) => {
      if (table === 'alarms') {
        const latest = await listAlarms();
        onUpdateAlarms(
          latest.map((a) => ({
            id: a.id,
            title: a.label,
            label: a.label,
            time: a.time,
            // SAFETY: SQLite repeat string maps directly to AlarmItem repeat union values
            repeat: a.repeat as unknown as AlarmItem['repeat'],
            days: a.days,
            enabled: a.enabled,
            sound: a.sound,
            voicePrompt: a.voicePrompt || undefined,
            note: a.note || undefined,
          })),
        );
      }
    });
    return unsub;
  }, [onUpdateAlarms]);

  const handleToggleTask = async (id: string) => {
    soundService.playUiClick();
    try {
      await toggleTask(id);
    } catch {
      // In tests or headless environment without DB, proceed with local update
    }
    onUpdateTasks(
      tasks.map((task) =>
        task.id === id
          ? { ...task, done: !task.done, completedAt: !task.done ? new Date().toISOString() : null }
          : task,
      ),
    );
  };

  const handleQuickAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = quickTaskTitle.trim();
    if (!trimmed) return;
    soundService.playUiClick();

    try {
      const created = await createTask({ title: trimmed });
      onUpdateTasks([...tasks, created]);
    } catch {
      const fallbackTask: TaskItem = {
        id: `task-${Date.now()}`,
        title: trimmed,
        done: false,
        priority: 0,
        position: tasks.length,
        createdAt: new Date().toISOString(),
      };
      onUpdateTasks([...tasks, fallbackTask]);
    }
    setQuickTaskTitle('');
  };

  const handleNavigateAlarms = () => {
    soundService.playUiClick();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'alarms' }));
    }
  };

  const handleNavigateTasks = () => {
    soundService.playUiClick();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'tasks' }));
    }
  };

  const handleNavigateNotes = () => {
    soundService.playUiClick();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'notes' }));
    }
  };

  const handleOpenNote = () => {
    soundService.playUiClick();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('tempo:navigate', { detail: 'notes' }));
    }
  };

  return (
    <div className="relative w-full h-full overflow-hidden bg-black select-none text-white">
      {/* Fullscreen Ambient Canvas */}
      <WinterCanvas className="absolute inset-0" />

      {/* Next Alarm pill (top-left) */}
      <button
        type="button"
        onClick={handleNavigateAlarms}
        data-testid="ambient-next-alarm"
        aria-label={
          nextAlarm
            ? `Следующий будильник: ${nextAlarm.time} ${nextAlarm.label}`
            : 'Перейти к будильникам'
        }
        className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-1.5 rounded-xl border border-white/10 bg-black/40 backdrop-blur-xl text-xs text-white/80 hover:text-white hover:border-white/25 hover:bg-black/60 transition-all focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40"
      >
        <Bell className="w-3.5 h-3.5 text-white/70" />
        {nextAlarm ? (
          <>
            <span className="font-mono font-medium text-white">{nextAlarm.time}</span>
            <span className="opacity-60 truncate max-w-[130px]">{nextAlarm.label}</span>
            <ChevronRight className="w-3.5 h-3.5 opacity-40 ml-0.5" />
          </>
        ) : (
          <>
            <span className="opacity-60">Нет активных будильников</span>
            <ChevronRight className="w-3.5 h-3.5 opacity-40 ml-0.5" />
          </>
        )}
      </button>

      {/* Floating Unobtrusive Side Panels: Tasks & Notes (top-right) */}
      <div className="absolute top-4 right-4 z-20 flex flex-col gap-3 w-72 max-h-[calc(100vh-120px)] overflow-y-auto">
        {/* Tasks Panel */}
        <div
          data-testid="ambient-tasks-panel"
          className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-3 flex flex-col gap-2 shadow-lg transition-colors hover:border-white/20"
        >
          <div className="flex items-center justify-between text-xs font-medium text-white/70">
            <span className="flex items-center gap-1.5 font-semibold text-white/90">
              <ListTodo className="w-3.5 h-3.5" />
              <span>Задачи</span>
              {openTasks.length > 0 && (
                <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-white/10 font-mono">
                  {openTasks.length}
                </span>
              )}
            </span>
            <button
              type="button"
              data-testid="ambient-tasks-all"
              onClick={handleNavigateTasks}
              className="text-[11px] text-white/50 hover:text-white transition-colors flex items-center gap-0.5"
            >
              <span>Все</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          {/* Compact tasks list */}
          <ul className="flex flex-col gap-1.5">
            {openTasks.slice(0, 5).map((task) => (
              <li key={task.id} className="flex items-center gap-2 text-xs group">
                <button
                  type="button"
                  aria-label={`Завершить ${task.title}`}
                  data-testid={`task-toggle-${task.id}`}
                  onClick={() => handleToggleTask(task.id)}
                  className="shrink-0 w-3.5 h-3.5 rounded-full border border-white/30 hover:border-white hover:bg-white/20 transition-colors flex items-center justify-center focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white"
                />
                <span className="truncate text-white/80 group-hover:text-white transition-colors">
                  {task.title}
                </span>
                {task.dueDate && (
                  <span className="ml-auto shrink-0 text-[10px] text-white/40 font-mono">
                    {task.dueDate.slice(5)}
                  </span>
                )}
              </li>
            ))}
            {openTasks.length === 0 && (
              <li className="text-[11px] text-white/40 py-1">{t.tasksEmpty}</li>
            )}
          </ul>

          {/* Quick Add Task */}
          <form
            onSubmit={handleQuickAddTask}
            className="flex items-center gap-1.5 pt-1.5 border-t border-white/10"
          >
            <input
              type="text"
              data-testid="quick-add-task-input"
              value={quickTaskTitle}
              onChange={(e) => setQuickTaskTitle(e.target.value)}
              placeholder="Быстрая задача..."
              className="flex-1 min-w-0 bg-white/5 border border-white/10 rounded-lg px-2 py-1 text-xs text-white placeholder-white/30 focus:outline-none focus:border-white/30 focus:bg-white/10 transition-colors"
            />
            <button
              type="submit"
              data-testid="quick-add-task-submit"
              aria-label="Добавить задачу"
              disabled={!quickTaskTitle.trim()}
              className="p-1 rounded-lg bg-white/10 hover:bg-white/20 disabled:opacity-30 disabled:hover:bg-white/10 text-white transition-colors shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

        {/* Notes Panel */}
        <div
          data-testid="ambient-notes-panel"
          className="rounded-2xl border border-white/10 bg-black/40 backdrop-blur-xl p-3 flex flex-col gap-2 shadow-lg transition-colors hover:border-white/20"
        >
          <div className="flex items-center justify-between text-xs font-medium text-white/70">
            <span className="flex items-center gap-1.5 font-semibold text-white/90">
              <NotebookPen className="w-3.5 h-3.5" />
              <span>Заметки</span>
            </span>
            <button
              type="button"
              data-testid="ambient-notes-all"
              onClick={handleNavigateNotes}
              className="text-[11px] text-white/50 hover:text-white transition-colors flex items-center gap-0.5"
            >
              <span>Все</span>
              <ChevronRight className="w-3 h-3" />
            </button>
          </div>

          <ul className="flex flex-col gap-1">
            {notes.slice(0, 4).map((note) => (
              <li key={note.id}>
                <button
                  type="button"
                  data-testid={`ambient-note-${note.id}`}
                  onClick={handleOpenNote}
                  className="w-full flex items-center justify-between text-left text-xs py-1 px-1.5 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <span className="truncate">
                    {note.title || note.body.split('\n')[0] || t.notesNew}
                  </span>
                  {note.pinned && (
                    <span className="text-[10px] text-amber-400 ml-1 shrink-0">★</span>
                  )}
                </button>
              </li>
            ))}
            {notes.length === 0 && (
              <li className="text-[11px] text-white/40 py-1">{t.notesEmpty}</li>
            )}
          </ul>
        </div>
      </div>

      {/* Floating Bottom Player Dock */}
      <WinterBottomPlayer />
    </div>
  );
};
