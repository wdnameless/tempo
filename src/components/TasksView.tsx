import React, { useState } from 'react';
import { Plus, Trash2, Check, Circle, Timer, Clock, ChevronDown, ChevronUp } from 'lucide-react';
import type { TaskItem, TaskTimerConfig, ThemeColors } from '../types';
import { taskProgress } from '../services/stats';
import { soundService } from '../services/sound';

interface TasksViewProps {
  theme: ThemeColors;
  tasks: TaskItem[];
  onUpdateTasks: (tasks: TaskItem[]) => void;
}

const createTaskId = () => `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

export const TasksView: React.FC<TasksViewProps> = ({
  theme,
  tasks,
  onUpdateTasks,
}) => {
  const [draft, setDraft] = useState('');
  const [showTimerOptions, setShowTimerOptions] = useState(false);
  const [timerType, setTimerType] = useState<'interval' | 'time'>('interval');
  const [intervalMinutes, setIntervalMinutes] = useState(60);
  const [targetTime, setTargetTime] = useState('14:00');

  const { done, total } = taskProgress(tasks);


  const addTask = (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;

    soundService.playCountdownTick();

    const timerConfig: TaskTimerConfig | undefined = showTimerOptions
      ? {
          enabled: true,
          type: timerType,
          intervalMinutes: timerType === 'interval' ? Number(intervalMinutes) || 60 : undefined,
          time: timerType === 'time' ? targetTime : undefined,
        }
      : undefined;

    onUpdateTasks([
      ...tasks,
      {
        id: createTaskId(),
        title,
        done: false,
        timer: timerConfig,
        createdAt: new Date().toISOString(),
      },
    ]);
    setDraft('');
    setShowTimerOptions(false);
  };


  const toggleTask = (id: string) => {
    soundService.playCountdownTick();
    onUpdateTasks(
      tasks.map((t) =>
        t.id === id
          ? { ...t, done: !t.done, completedAt: !t.done ? new Date().toISOString() : undefined }
          : t,
      ),
    );
  };

  const toggleTaskTimer = (id: string) => {
    soundService.playCountdownTick();
    onUpdateTasks(
      tasks.map((t) => {
        if (t.id !== id || !t.timer) return t;
        return {
          ...t,
          timer: {
            ...t.timer,
            enabled: !t.timer.enabled,
          },
        };
      }),
    );
  };

  const deleteTask = (id: string) => {
    soundService.playCountdownTick();
    onUpdateTasks(tasks.filter((t) => t.id !== id));
  };

  const open = tasks.filter((t) => !t.done);
  const completed = tasks.filter((t) => t.done);

  return (
    <div className="flex flex-col w-full max-w-[340px] px-1 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-semibold tracking-wider uppercase" style={{ color: theme.text }}>
            Задачи
          </span>
          {total > 0 && (
            <span
              className="text-[10px] px-1.5 py-0.5 rounded-full font-mono"
              style={{ backgroundColor: theme.surface, color: theme.subtext }}
            >
              {done} / {total}
            </span>
          )}
        </div>
      </div>

      {total > 0 && (
        <div className="w-full h-[3px] rounded-full overflow-hidden" style={{ backgroundColor: theme.border }}>
          <div
            className="h-full transition-all duration-300"
            style={{ width: `${(done / total) * 100}%`, backgroundColor: theme.accent }}
          />
        </div>
      )}

      {/* Task Creation Form with optional Scheduled Timer */}
      <form
        onSubmit={addTask}
        className="flex flex-col p-2.5 rounded-2xl border w-full gap-2 transition-all"
        style={{ backgroundColor: theme.surface, borderColor: theme.border }}
      >
        <div className="flex items-center gap-1.5 w-full">
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Что нужно сделать?"
            className="min-w-0 flex-1 bg-black/40 text-xs px-2.5 py-1.5 rounded-lg border border-white/10 focus:outline-none"
            style={{ color: theme.text }}
            aria-label="Новая задача"
          />
          <button
            type="button"
            onClick={() => setShowTimerOptions(!showTimerOptions)}
            className={`p-1.5 rounded-lg border text-xs transition-colors shrink-0 flex items-center gap-1 ${
              showTimerOptions ? 'bg-white/10 border-white/20' : 'border-transparent hover:bg-white/5'
            }`}
            style={{ color: showTimerOptions ? theme.accent : theme.subtext }}
            title="Настроить таймер/напоминание"
          >
            <Timer size={14} />
            {showTimerOptions ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
          </button>
          <button
            type="submit"
            disabled={!draft.trim()}
            className="w-7 h-7 rounded-lg transition-transform active:scale-95 flex items-center justify-center shrink-0 disabled:opacity-30"
            style={{ backgroundColor: '#fafafa', color: '#0a0a0a' }}
            title="Добавить задачу"
          >
            <Plus size={15} />
          </button>
        </div>

        {/* Expandable Timer Configuration */}
        {showTimerOptions && (
          <div className="flex flex-col gap-2 pt-2 border-t border-white/5 text-[11px]">
            <div className="flex items-center justify-between">
              <span style={{ color: theme.subtext }}>Тип таймера:</span>
              <div className="flex gap-1 bg-black/30 p-0.5 rounded-lg border border-white/5">
                <button
                  type="button"
                  onClick={() => setTimerType('interval')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    timerType === 'interval' ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Интервал
                </button>
                <button
                  type="button"
                  onClick={() => setTimerType('time')}
                  className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${
                    timerType === 'time' ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  Точное время
                </button>
              </div>
            </div>

            {timerType === 'interval' ? (
              <div className="flex items-center justify-between">
                <span style={{ color: theme.subtext }}>Повторять каждые:</span>
                <div className="flex items-center gap-1.5">
                  <select
                    value={intervalMinutes}
                    onChange={(e) => setIntervalMinutes(Number(e.target.value))}
                    className="bg-black/40 text-xs px-2 py-1 rounded border border-white/10 focus:outline-none"
                    style={{ color: theme.text }}
                  >
                    <option value={15}>15 минут</option>
                    <option value={30}>30 минут</option>
                    <option value={45}>45 минут</option>
                    <option value={60}>1 час</option>
                    <option value={90}>1.5 часа</option>
                    <option value={120}>2 часа</option>
                  </select>
                </div>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span style={{ color: theme.subtext }}>Срабатывать в:</span>
                <input
                  type="time"
                  value={targetTime}
                  onChange={(e) => setTargetTime(e.target.value)}
                  className="bg-black/40 text-xs px-2 py-0.5 rounded border border-white/10 focus:outline-none"
                  style={{ color: theme.text }}
                />
              </div>
            )}
          </div>
        )}
      </form>

      {total === 0 && (
        <div
          className="rounded-2xl border px-4 py-6 text-center"
          style={{ backgroundColor: theme.surface, borderColor: theme.border }}
        >
          <span className="text-[11px] leading-relaxed" style={{ color: theme.subtext }}>
            Пока пусто. Добавьте задачи — расписание подскажет, когда за них взяться.
          </span>
        </div>
      )}


      {/* Task list with timers */}
      <div className="flex flex-col space-y-1.5">
        {open.map((task) => (
          <div
            key={task.id}
            className="flex items-center gap-2 p-2.5 rounded-xl border group"
            style={{ backgroundColor: theme.cardBg, borderColor: theme.border }}
          >
            <button
              onClick={() => toggleTask(task.id)}
              className="shrink-0"
              style={{ color: theme.subtext }}
              title="Отметить выполненной"
              aria-label={`Отметить «${task.title}» выполненной`}
            >
              <Circle size={16} />
            </button>
            <div className="flex-1 min-w-0 flex flex-col">
              <span className="text-xs truncate" style={{ color: theme.text }}>
                {task.title}
              </span>
              {task.timer && (
                <div className="flex items-center gap-1 mt-0.5">
                  <button
                    type="button"
                    onClick={() => toggleTaskTimer(task.id)}
                    className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border transition-colors ${
                      task.timer.enabled
                        ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/10'
                        : 'border-zinc-700 text-zinc-500 bg-zinc-800/30'
                    }`}
                    title={task.timer.enabled ? 'Таймер активен (нажмите чтобы выключить)' : 'Таймер на паузе (нажмите чтобы включить)'}
                  >
                    {task.timer.type === 'interval' ? (
                      <>
                        <Timer size={10} />
                        <span>каждые {task.timer.intervalMinutes} мин</span>
                      </>
                    ) : (
                      <>
                        <Clock size={10} />
                        <span>в {task.timer.time}</span>
                      </>
                    )}
                  </button>
                </div>
              )}
            </div>
            <button
              onClick={() => deleteTask(task.id)}
              className="p-1 rounded transition-colors hover:bg-red-500/20 text-red-400 opacity-0 group-hover:opacity-100 shrink-0 transition-opacity"
              title="Удалить"
              aria-label={`Удалить «${task.title}»`}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}

        {completed.length > 0 && (
          <>
            <span className="text-[10px] uppercase tracking-wider mt-1" style={{ color: theme.subtext }}>
              Выполнено
            </span>
            {completed.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-2 p-2.5 rounded-xl border"
                style={{ backgroundColor: theme.surface, borderColor: theme.border }}
              >
                <button
                  onClick={() => toggleTask(task.id)}
                  className="shrink-0"
                  style={{ color: theme.accent }}
                  title="Вернуть в работу"
                  aria-label={`Вернуть «${task.title}» в работу`}
                >
                  <Check size={16} />
                </button>
                <span className="flex-1 text-xs truncate line-through opacity-55" style={{ color: theme.subtext }}>
                  {task.title}
                </span>
                <button
                  onClick={() => deleteTask(task.id)}
                  className="p-1 rounded transition-colors hover:bg-red-500/20 text-red-400 opacity-40 hover:opacity-100 shrink-0"
                  title="Удалить"
                  aria-label={`Удалить «${task.title}»`}
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
};
