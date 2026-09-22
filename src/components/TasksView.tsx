import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  ChevronDown,
  ChevronRight,
  Calendar,
  Clock,
  Timer,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import type { TaskItem } from '../types';
import {
  listTasks,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
  sortTasks,
  subtasksOf,
  type TaskSortMode,
} from '../services/tasks';
import { StoreService } from '../services/store';
import { I18nService } from '../services/i18n';
import { dayKey } from '../services/stats';
import { onDataChanged, emitDataChanged } from '../services/appEvents';
import { Row, Segmented, IconButton } from './ui';

/**
 * Priority marker indicator style based on phase palette intensity.
 */
function PriorityBadge({ priority }: { priority?: number }) {
  if (!priority || priority === 0) return null;
  const colors = [
    'transparent',
    'var(--phase-short-rest, #14B8A6)', // 1: low (teal)
    'var(--phase-focus, #F59E0B)',      // 2: medium (amber)
    'var(--phase-long-rest, #EF4444)',  // 3: high (intense red/purple)
  ];
  const color = colors[priority] || colors[1];
  return (
    <span
      className="inline-block w-2 h-2 rounded-full flex-shrink-0"
      style={{ backgroundColor: color }}
      title={`Priority ${priority}`}
      data-testid={`priority-dot-${priority}`}
    />
  );
}

export function TasksView() {
  const t = I18nService.t();
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState('');
  const [sortMode, setSortMode] = useState<TaskSortMode>(() =>
    StoreService.getPreference<TaskSortMode>('tempo_tasks_sort', 'manual')
  );
  const [showCompleted, setShowCompleted] = useState(false);
  const [expandedParents, setExpandedParents] = useState<Record<string, boolean>>({});
  /** Task the search palette just jumped to; highlighted briefly. */
  const [revealedId, setRevealedId] = useState<string | null>(null);

  // Answer the palette's "reveal this hit": open the completed group when the
  // task is done, scroll it into view and mark it. A screen that only opened
  // would leave the user searching again for the row they just picked.
  useEffect(() => {
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; row_id?: string }>).detail;
      if (!detail || detail.kind !== 'task' || !detail.row_id) return;
      const id = detail.row_id;

      if (tasks.some((candidate) => candidate.id === id && candidate.done)) {
        setShowCompleted(true);
      }
      setRevealedId(id);
      window.setTimeout(() => {
        document
          .querySelector(`[data-task-row="${id}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
      window.setTimeout(() => setRevealedId(null), 2400);
    };

    window.addEventListener('tempo:reveal', onReveal);
    return () => window.removeEventListener('tempo:reveal', onReveal);
  }, [tasks]);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTitleDraft, setEditingTitleDraft] = useState('');
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});

  const reload = useCallback(async () => {
    try {
      const items = await listTasks();
      setTasks(items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe to data changes
  useEffect(() => {
    const unsubscribe = onDataChanged((table) => {
      if (table === 'tasks') {
        void reload();
      }
    });
    return unsubscribe;
  }, [reload]);

  // Listen to search reveal events
  useEffect(() => {
    const handleReveal = (e: Event) => {
      const custom = e as CustomEvent<{ id?: string; kind?: string }>;
      if (custom.detail?.id) {
        setEditingTaskId(custom.detail.id);
        const target = tasks.find((t) => t.id === custom.detail.id);
        if (target) {
          setEditingTitleDraft(target.title);
        }
      }
    };
    window.addEventListener('tempo:reveal', handleReveal);
    return () => window.removeEventListener('tempo:reveal', handleReveal);
  }, [tasks]);

  const handleSortChange = async (mode: TaskSortMode) => {
    setSortMode(mode);
    await StoreService.setPreference('tempo_tasks_sort', mode);
  };

  const handleCreateTask = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = draft.trim();
    if (!title) return;
    setDraft('');
    await createTask({ title });
    emitDataChanged('tasks');
    await reload();
  };

  const handleToggle = async (id: string) => {
    await toggleTask(id);
    emitDataChanged('tasks', [id]);
    await reload();
  };

  const handleDelete = async (id: string) => {
    await deleteTask(id);
    emitDataChanged('tasks', [id]);
    await reload();
  };

  const handleUpdate = useCallback(async (id: string, patch: Partial<TaskItem>) => {
    await updateTask(id, patch);
    emitDataChanged('tasks', [id]);
    await reload();
  }, [reload]);

  const startEditing = (task: TaskItem) => {
    setEditingTaskId(task.id);
    setEditingTitleDraft(task.title);
  };

  const commitEditingTitle = async (taskId: string) => {
    const trimmed = editingTitleDraft.trim();
    if (!trimmed) {
      const original = tasks.find((t) => t.id === taskId);
      if (original) setEditingTitleDraft(original.title);
      return;
    }
    const current = tasks.find((t) => t.id === taskId);
    if (current && current.title !== trimmed) {
      await handleUpdate(taskId, { title: trimmed });
    }
  };

  const handleAddSubtask = async (parentId: string) => {
    const title = (subtaskDrafts[parentId] || '').trim();
    if (!title) return;
    setSubtaskDrafts((prev) => ({ ...prev, [parentId]: '' }));
    await createTask({ title, parentId });
    emitDataChanged('tasks');
    setExpandedParents((prev) => ({ ...prev, [parentId]: true }));
    await reload();
  };

  const toggleExpand = (id: string) => {
    setExpandedParents((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  // Filter tasks belonging strictly to normal task view (listId is null/undefined) and separate root tasks
  const rootTasks = useMemo(() => {
    return tasks.filter((t) => !t.listId && !t.parentId);
  }, [tasks]);

  const activeRoots = useMemo(() => {
    const active = rootTasks.filter((t) => !t.done);
    return sortTasks(active, sortMode);
  }, [rootTasks, sortMode]);

  const completedRoots = useMemo(() => {
    const completed = rootTasks.filter((t) => t.done);
    return sortTasks(completed, sortMode);
  }, [rootTasks, sortMode]);

  const renderTaskRow = (task: TaskItem, isSubtask = false) => {
    const subs = subtasksOf(tasks, task.id);
    const subDone = subs.filter((s) => s.done).length;
    const isExpanded = !!expandedParents[task.id];
    const isEditing = editingTaskId === task.id;

    return (
      <div
        key={task.id}
        data-task-row={task.id}
        className="group flex flex-col transition-colors rounded-[10px]"
        style={
          revealedId === task.id
            ? { backgroundColor: 'var(--accent-soft)', boxShadow: '0 0 0 1px var(--accent)' }
            : undefined
        }
      >
        <Row
          label={
            <div className="flex items-center gap-2 flex-wrap py-0.5 min-w-0">
              <PriorityBadge priority={task.priority} />
              <button
                type="button"
                onClick={() => {
                  if (isEditing) {
                    void commitEditingTitle(task.id);
                    setEditingTaskId(null);
                  } else {
                    startEditing(task);
                  }
                }}
                className={`text-left font-medium text-sm hover:underline focus:outline-none truncate max-w-full ${
                  task.done ? 'line-through text-[var(--text-muted)] opacity-60' : 'text-[var(--text)]'
                }`}
              >
                {task.title}
              </button>

              {/* Subtask count badge */}
              {subs.length > 0 && (
                <button
                  type="button"
                  onClick={() => toggleExpand(task.id)}
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md transition-colors bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)]"
                  title={t.tasksSubtasks}
                >
                  <span>
                    {subDone}/{subs.length}
                  </span>
                  {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </button>
              )}

              {/* Metadata tags */}
              {task.dueDate && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-[var(--elevated)] text-[var(--text-muted)]"
                  title={t.tasksDueDate}
                >
                  <Calendar size={11} />
                  {task.dueDate}
                </span>
              )}

              {task.startAt && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-[var(--elevated)] text-[var(--text-muted)]"
                  title={t.tasksStartAt}
                >
                  <Clock size={11} />
                  {task.startAt.slice(11, 16)}
                </span>
              )}

              {task.plannedMinutes != null && task.plannedMinutes > 0 && (
                <span
                  className="inline-flex items-center gap-1 text-xs px-1.5 py-0.5 rounded-md bg-[var(--elevated)] text-[var(--text-muted)]"
                  title={t.tasksPlanned}
                >
                  <Timer size={11} />
                  {task.plannedMinutes} {t.tasksMinutesShort}
                </span>
              )}
            </div>
          }
          control={
            <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
              <IconButton
                icon={task.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                label={task.done ? t.tasksCompleted : t.tasksNew}
                onClick={() => void handleToggle(task.id)}
              />
              {!isSubtask && (
                <IconButton
                  icon={<Plus size={14} />}
                  label={t.tasksAddSubtask}
                  onClick={() => {
                    setExpandedParents((prev) => ({ ...prev, [task.id]: true }));
                    startEditing(task);
                  }}
                />
              )}
              <IconButton
                icon={<Trash2 size={14} />}
                label={t.tasksDelete}
                onClick={() => void handleDelete(task.id)}
              />
            </div>
          }
        />

        {/* Inline editor when clicked */}
        {isEditing && (
          <div className="px-4 py-3 mx-2 my-1 rounded-[10px] flex flex-col gap-2.5 text-xs bg-[var(--elevated)] border border-[var(--border)]">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={editingTitleDraft}
                onChange={(e) => setEditingTitleDraft(e.target.value)}
                onBlur={() => void commitEditingTitle(task.id)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitEditingTitle(task.id);
                  }
                }}
                className="w-full px-2.5 py-1.5 rounded-md bg-[var(--surface)] font-medium text-sm text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              {/* Priority */}
              <div className="flex items-center gap-1.5">
                <span style={{ color: 'var(--text-muted)' }}>{t.tasksPriority}:</span>
                <Segmented
                  options={[
                    { value: 0, label: t.priorityNone },
                    { value: 1, label: t.priorityLow },
                    { value: 2, label: t.priorityMedium },
                    { value: 3, label: t.priorityHigh },
                  ]}
                  value={task.priority ?? 0}
                  onChange={(val) => handleUpdate(task.id, { priority: Number(val) })}
                />
              </div>

              {/* Due Date */}
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-muted)]">{t.tasksDueDate}:</span>
                <input
                  type="date"
                  value={task.dueDate ?? ''}
                  onChange={(e) => handleUpdate(task.id, { dueDate: e.target.value || null })}
                  className="px-2 py-1 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Start At */}
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-muted)]">{t.tasksStartAt}:</span>
                <input
                  type="time"
                  value={task.startAt ? task.startAt.slice(11, 16) : ''}
                  onChange={(e) => {
                    const val = e.target.value;
                    const datePart = task.dueDate || (task.startAt ? task.startAt.slice(0, 10) : dayKey(new Date()));
                    const iso = val ? `${datePart}T${val}:00` : null;
                    void handleUpdate(task.id, { startAt: iso });
                  }}
                  className="px-2 py-1 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>

              {/* Planned minutes */}
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--text-muted)]">{t.tasksPlanned}:</span>
                <input
                  type="number"
                  min="0"
                  step="5"
                  value={task.plannedMinutes ?? ''}
                  placeholder="min"
                  onChange={(e) =>
                    handleUpdate(task.id, {
                      plannedMinutes: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                  className="w-16 px-2 py-1 rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
                />
              </div>
            </div>
          </div>
        )}

        {/* Subtasks rendering */}
        {!isSubtask && isExpanded && (
          <div className="flex flex-col ml-6 pl-2 border-l border-[var(--border)]">
            {subs.map((sub) => renderTaskRow(sub, true))}

            {/* Add subtask input */}
            <div className="flex items-center gap-2 py-2 px-3">
              <input
                type="text"
                placeholder={t.tasksAddSubtask}
                value={subtaskDrafts[task.id] || ''}
                onChange={(e) =>
                  setSubtaskDrafts((prev) => ({ ...prev, [task.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void handleAddSubtask(task.id);
                  }
                }}
                className="flex-1 px-2.5 py-1 text-xs rounded-md bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] focus:outline-none focus:border-[var(--accent)]"
              />
              <IconButton
                icon={<Plus size={14} />}
                label={t.tasksAddSubtask}
                onClick={() => handleAddSubtask(task.id)}
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full overflow-y-auto px-6 py-6 gap-6 max-w-4xl mx-auto w-full">
      {/* Top Header & Sort Toolbar */}
      <header className="flex items-start justify-between gap-4 pb-2 select-none">
        <div className="flex flex-col gap-0.5 min-w-0">
          <h1 className="text-lg font-semibold tracking-tight truncate text-[var(--text)]">
            {t.titleTasks}
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Segmented
            options={[
              { value: 'manual', label: t.tasksSortManual },
              { value: 'due', label: t.tasksSortDue },
              { value: 'priority', label: t.tasksSortPriority },
            ]}
            value={sortMode}
            onChange={(val) => handleSortChange(val as TaskSortMode)}
          />
        </div>
      </header>

      {/* New Task Input */}
      <form onSubmit={handleCreateTask} className="relative flex items-center">
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t.tasksNew}
          className="w-full px-4 py-2.5 rounded-[14px] text-sm bg-[var(--surface)] border border-[var(--border)] text-[var(--text)] placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--border-strong)] transition-all"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="absolute right-2 px-3 py-1.5 text-xs font-medium rounded-md transition-opacity disabled:opacity-30 bg-[var(--accent)] text-[var(--bg)]"
        >
          {t.commonAdd}
        </button>
      </form>

      {/* Main Task List */}
      <div className="flex flex-col rounded-[14px] overflow-hidden bg-[var(--surface)] border border-[var(--border)]">
        {loading ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">
            {t.commonLoading}
          </div>
        ) : activeRoots.length === 0 && completedRoots.length === 0 ? (
          <div className="flex flex-col items-center justify-center text-center py-12 px-4">
            <CheckCircle2 className="w-8 h-8 mb-2 text-[var(--text-faint)]" />
            <div className="text-sm font-medium text-[var(--text)]">
              {t.tasksEmpty}
            </div>
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-[var(--border)]">
            {activeRoots.map((task) => renderTaskRow(task))}
          </div>
        )}

        {/* Completed tasks accordion group */}
        {completedRoots.length > 0 && (
          <div className="border-t border-[var(--border)]">
            <button
              type="button"
              onClick={() => setShowCompleted((prev) => !prev)}
              className="w-full flex items-center justify-between px-4 py-2.5 text-xs font-medium uppercase tracking-wider transition-colors hover:bg-[var(--surface-hover)] focus:outline-none text-[var(--text-muted)]"
            >
              <div className="flex items-center gap-2">
                {showCompleted ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span>
                  {t.tasksCompleted} ({completedRoots.length})
                </span>
              </div>
            </button>

            {showCompleted && (
              <div className="flex flex-col divide-y divide-[var(--border)] bg-[var(--surface-hover)]/30">
                {completedRoots.map((task) => renderTaskRow(task))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
