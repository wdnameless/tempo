import { Plus, X, LayoutGrid, Timer as TimerIcon, Bell, ListTodo, NotebookPen } from "lucide-react";
import { StoreService } from "../services/store";
import { I18nService } from "../services/i18n";
import React, { useState, useEffect } from "react";
import { onDataChanged } from "../services/appEvents";
import { listAlarms } from "../services/alarms";
import { ThemeColors, DynamicUIConfig, AlarmItem, AISettings, TaskItem, NoteItem } from "../types";
import { Timer } from "./Timer";
import { Alarms } from "./Alarms";
import { WinterCanvas } from "./WinterCanvas";
import { WinterBottomPlayer } from "./WinterBottomPlayer";
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

export const DashboardView: React.FC<DashboardViewProps> = ({
  theme,
  dynamicUi,
  alarms,
  aiSettings,
  onUpdateAlarms,
  onOpenAISettings,
  tasks,
  onUpdateTasks,
  notes,
  timerMinutes,
}) => {
  const t = I18nService.t();
  const openTasks = tasks.filter((task) => !task.done);

  /** Completing from the widget goes through the same updater the screen uses. */
  const completeTask = (id: string) => {
    onUpdateTasks(
      tasks.map((task) =>
        task.id === id ? { ...task, done: true, completedAt: new Date().toISOString() } : task,
      ),
    );
  };

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
            repeat: a.repeat as unknown as AlarmItem['repeat'],
            days: a.days,
            enabled: a.enabled,
            sound: a.sound,
            voicePrompt: a.voicePrompt || undefined,
            note: a.note || undefined,
          }))
        );
      }
    });
    return unsub;
  }, [onUpdateAlarms]);

  const [activeWidgets, setActiveWidgets] = useState<string[]>(() => {
    try {
      const raw = StoreService.getPreference<string>('alarmer_dashboard_widgets', '["timer","tasks","alarms","notes"]');
      return JSON.parse(raw);
    } catch {
      return ['timer', 'tasks', 'alarms', 'notes'];
    }
  });
  const [showWidgetPicker, setShowWidgetPicker] = useState(false);
  const [ambientMode, setAmbientMode] = useState(true);
  const toggleWidget = (widgetId: string) => {
    setActiveWidgets((prev) => {
      const next = prev.includes(widgetId) ? prev.filter((id) => id !== widgetId) : [...prev, widgetId];
      StoreService.setPreference('alarmer_dashboard_widgets', JSON.stringify(next));
      return next;
    });
  };


  if (ambientMode) {
    return (
      <div className="relative w-full h-full overflow-hidden bg-black select-none">
        {/* Fullscreen Ambient Canvas matching Screenshot 1 */}
        <WinterCanvas className="absolute inset-0" />

        {/* Subtle toggle for widgets */}
        <button
          type="button"
          onClick={() => setAmbientMode(false)}
          aria-label="Виджеты"
          className="absolute top-4 right-4 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-mono text-white/30 hover:text-white/80 hover:bg-white/10 transition-colors"
        >
          <LayoutGrid className="w-3.5 h-3.5" />
          <span>Виджеты</span>
        </button>

        {/* Floating Bottom Player Dock matching Screenshot 1 [ ☰ | ⭘ 24:43 | ⏸ 🔊 ] */}
        <WinterBottomPlayer />
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center w-full h-full space-y-4 relative">
      {/* Ambient switch back button */}
      <button
        type="button"
        onClick={() => setAmbientMode(true)}
        className="absolute top-2 left-6 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs text-white/50 hover:text-white hover:bg-white/10 transition-colors"
      >
        <span>✦ Эмбиент</span>
      </button>
      {/* Main Module Content */}
      <div className="w-full flex-1 flex flex-col items-center justify-start overflow-y-auto">
        {/* Dashboard Header with Add Widget button */}
        <div className="w-full max-w-4xl flex items-center justify-between px-6 pt-4 pb-2">
          <div className="flex items-center space-x-2">
            <LayoutGrid size={18} style={{ color: theme.accent }} />
            <h2 className="text-base font-bold tracking-tight" style={{ color: theme.text }}>
              Доска виджетов
            </h2>
          </div>
          <button
            onClick={() => setShowWidgetPicker(!showWidgetPicker)}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-xl border text-xs font-semibold hover:opacity-90 active:scale-95 transition-all"
            style={{
              backgroundColor: showWidgetPicker ? theme.accent : theme.surface,
              borderColor: theme.border,
              color: showWidgetPicker ? '#0a0a0a' : theme.text,
            }}
          >
            {showWidgetPicker ? <X size={14} /> : <Plus size={14} />}
            <span>{showWidgetPicker ? 'Закрыть' : 'Настроить виджеты'}</span>
          </button>
        </div>

        {/* Widget Picker Modal / Drawer */}
        {showWidgetPicker && (
          <div
            className="w-full max-w-4xl p-4 mb-4 rounded-2xl border flex flex-wrap gap-2.5 transition-all animate-in fade-in slide-in-from-top-2 duration-200"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}
          >
            {[
              { id: 'timer', label: 'Таймер', icon: <TimerIcon size={14} /> },
              { id: 'tasks', label: 'Задачи', icon: <ListTodo size={14} /> },
              { id: 'alarms', label: 'Будильники', icon: <Bell size={14} /> },
              { id: 'notes', label: 'Заметки', icon: <NotebookPen size={14} /> },
            ].map((w) => {
              const active = activeWidgets.includes(w.id);
              return (
                <button
                  key={w.id}
                  onClick={() => toggleWidget(w.id)}
                  className="flex items-center space-x-2 px-3.5 py-2 rounded-xl border text-xs font-medium transition-all"
                  style={{
                    backgroundColor: active ? theme.surface : 'transparent',
                    borderColor: active ? theme.accent : theme.border,
                    color: active ? theme.accent : theme.subtext,
                  }}
                >
                  {w.icon}
                  <span>{w.label}</span>
                  <span className="text-[10px] ml-1 opacity-70">
                    {active ? '✓ Включен' : '+ Добавить'}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Modular Widgets Grid */}
        <div className="w-full max-w-4xl px-6 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
            {activeWidgets.includes('timer') && (
              <div
                className="rounded-3xl p-5 border flex flex-col items-center justify-center min-h-[320px] transition-all bg-[var(--elevated)] border-[var(--border)]"
              >
                <div className="w-full flex items-center justify-between pb-3 mb-2 border-b border-[var(--border)]">
                  <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[var(--accent)]">
                    <TimerIcon size={14} /> Таймер
                  </span>
                  <button
                    onClick={() => toggleWidget('timer')}
                    className="p-1 rounded-lg hover:bg-white/10 opacity-50 hover:opacity-100 transition-colors"
                    title="Скрыть виджет"
                  >
                    <X size={13} />
                  </button>
                </div>
                <Timer
                  initialMinutes={timerMinutes}
                />
              </div>
            )}

            {activeWidgets.includes('tasks') && (
              <div
                className="rounded-3xl p-5 border flex flex-col min-h-[320px] transition-all bg-[var(--elevated)] border-[var(--border)]"
              >
                <div className="w-full flex items-center justify-between pb-3 mb-2 border-b border-[var(--border)]">
                  <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[var(--accent)]">
                    <ListTodo size={14} /> Задачи
                  </span>
                  <button
                    onClick={() => toggleWidget('tasks')}
                    className="p-1 rounded-lg hover:bg-white/10 opacity-50 hover:opacity-100 transition-colors"
                    title="Скрыть виджет"
                  >
                    <X size={13} />
                  </button>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {openTasks.slice(0, 6).map((task) => (
                    <li key={task.id} className="flex items-center gap-2 text-sm">
                      <button
                        type="button"
                        aria-label={task.title}
                        onClick={() => completeTask(task.id)}
                        className="shrink-0 rounded-full border transition-colors"
                        style={{ borderColor: 'var(--border)', width: 14, height: 14 }}
                      />
                      <span className="truncate" style={{ color: 'var(--text)' }}>
                        {task.title}
                      </span>
                      {task.dueDate && (
                        <span
                          className="ml-auto shrink-0 text-xs tabular-nums"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          {task.dueDate.slice(5)}
                        </span>
                      )}
                    </li>
                  ))}
                  {openTasks.length === 0 && (
                    <li className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.tasksEmpty}
                    </li>
                  )}
                </ul>
              </div>
            )}

            {activeWidgets.includes('alarms') && (
              <div
                className="rounded-3xl p-5 border flex flex-col min-h-[320px] transition-all bg-[var(--elevated)] border-[var(--border)]"
              >
                <div className="w-full flex items-center justify-between pb-3 mb-2 border-b border-[var(--border)]">
                  <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[var(--accent)]">
                    <Bell size={14} /> {t.tabAlarms}
                  </span>
                  <button
                    onClick={() => toggleWidget('alarms')}
                    className="p-1 rounded-lg hover:bg-white/10 opacity-50 hover:opacity-100 transition-colors"
                    title="Скрыть виджет"
                  >
                    <X size={13} />
                  </button>
                </div>
                <Alarms
                  theme={theme}
                  alarms={alarms}
                  aiSettings={aiSettings}
                  onUpdateAlarms={onUpdateAlarms}
                  onOpenAISettings={onOpenAISettings}
                  dynamicUi={dynamicUi}
                />
              </div>
            )}

            {activeWidgets.includes('notes') && (
              <div
                className="rounded-3xl p-5 border flex flex-col min-h-[320px] transition-all bg-[var(--elevated)] border-[var(--border)]"
              >
                <div className="w-full flex items-center justify-between pb-3 mb-2 border-b border-[var(--border)]">
                  <span className="text-xs font-bold uppercase tracking-wider flex items-center gap-1.5 text-[var(--accent)]">
                    <NotebookPen size={14} /> Заметки
                  </span>
                  <button
                    onClick={() => toggleWidget('notes')}
                    className="p-1 rounded-lg hover:bg-white/10 opacity-50 hover:opacity-100 transition-colors"
                    title="Скрыть виджет"
                  >
                    <X size={13} />
                  </button>
                </div>
                <ul className="flex flex-col gap-1.5">
                  {notes.slice(0, 6).map((note) => (
                    <li key={note.id} className="flex items-baseline gap-2 text-sm">
                      <span className="truncate" style={{ color: 'var(--text)' }}>
                        {note.title || note.body.split('\n')[0] || t.notesNew}
                      </span>
                      {note.pinned && (
                        <span className="ml-auto shrink-0 text-xs" style={{ color: 'var(--accent)' }}>
                          ★
                        </span>
                      )}
                    </li>
                  ))}
                  {notes.length === 0 && (
                    <li className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {t.notesEmpty}
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
