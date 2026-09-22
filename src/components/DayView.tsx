import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Clock,
  Calendar,
  AlertTriangle,
  CheckCircle2,
  Circle,
  ArrowRight,
  ExternalLink,
} from 'lucide-react';
import { I18nService, type Translations } from '../services/i18n';
import { buildDay, findConflicts, dayKey, type DayItem, type ConflictPair } from '../services/day';
import { listEvents, createLocalEvent, type CalendarEvent } from '../services/events';
import { listTasks, updateTask, moveTask } from '../services/tasks';
import type { TaskItem } from '../types';
import { onDataChanged, emitDataChanged } from '../services/appEvents';
import { Segmented, type SegmentOption } from './ui';

export type DayStep = 'plan' | 'execute' | 'review';

/**
 * Format minutes from midnight to HH:MM string.
 */
function formatMinutes(minutes: number): string {
  const m = Math.max(0, Math.min(1440, minutes));
  const hrs = Math.floor(m / 60);
  const mins = m % 60;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * Calculate local relative day label for today / tomorrow / yesterday.
 */
function getRelativeDayLabel(date: Date, t: Translations): string | null {
  const today = new Date();
  const todayKey = dayKey(today);
  const targetKey = dayKey(date);

  if (targetKey === todayKey) {
    return t.dayToday;
  }

  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (targetKey === dayKey(tomorrow)) {
    return t.dayTomorrow;
  }

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  if (targetKey === dayKey(yesterday)) {
    return t.dayYesterday;
  }

  return null;
}

export function DayView() {
  const t = I18nService.t();

  // Active step of the day ritual: plan | execute | review
  const [step, setStep] = useState<DayStep>('plan');

  // Currently viewed date (defaults to today)
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  // Data
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // New local event form state
  const [showNewEventForm, setShowNewEventForm] = useState(false);
  const [eventTitle, setEventTitle] = useState('');
  const [eventStartTime, setEventStartTime] = useState('09:00');
  const [eventEndTime, setEventEndTime] = useState('10:00');
  const [eventAllDay, setEventAllDay] = useState(false);

  // Time-assignment form state for a task in Plan step
  const [schedulingTaskId, setSchedulingTaskId] = useState<string | null>(null);
  const [taskStartTime, setTaskStartTime] = useState('10:00');
  const [taskDurationMinutes, setTaskDurationMinutes] = useState(30);

  // Carried over tracking: tasks that have been carried over in this session
  const [carriedOverTaskIds, setCarriedOverTaskIds] = useState<Record<string, true>>({});

  // Current time marker for execute view
  const [nowMinutes, setNowMinutes] = useState<number>(() => {
    const d = new Date();
    return d.getHours() * 60 + d.getMinutes();
  });

  // Ticking time marker every 30 seconds
  useEffect(() => {
    const timer = window.setInterval(() => {
      const d = new Date();
      setNowMinutes(d.getHours() * 60 + d.getMinutes());
    }, 30000);
    return () => window.clearInterval(timer);
  }, []);

  // Reload data
  const reload = useCallback(async () => {
    try {
      const [fetchedTasks, fetchedEvents] = await Promise.all([
        listTasks(),
        listEvents(),
      ]);
      setTasks(fetchedTasks);
      setEvents(fetchedEvents);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Subscribe to external data changes
  useEffect(() => {
    const unsubscribe = onDataChanged((table) => {
      if (table === 'tasks' || table === 'events' || table === 'lists') {
        void reload();
      }
    });
    return unsubscribe;
  }, [reload]);

  // Listen to search reveal events
  useEffect(() => {
    const onReveal = (event: Event) => {
      const detail = (event as CustomEvent<{ kind?: string; row_id?: string; id?: string }>).detail;
      const id = detail?.row_id || detail?.id;
      if (!id) return;
      window.setTimeout(() => {
        document
          .querySelector(`[data-day-item="${id}"]`)
          ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }, 60);
    };

    window.addEventListener('tempo:reveal', onReveal);
    return () => window.removeEventListener('tempo:reveal', onReveal);
  }, []);

  // Build Day items for current date
  const targetKey = useMemo(() => dayKey(currentDate), [currentDate]);

  const dayItems = useMemo(() => {
    return buildDay({
      date: currentDate,
      tasks,
      events,
    });
  }, [currentDate, tasks, events]);

  // Find conflicts between day items
  const conflicts = useMemo<ConflictPair[]>(() => {
    return findConflicts(dayItems);
  }, [dayItems]);

  const conflictIds = useMemo(() => {
    const map: Record<string, true> = {};
    for (const pair of conflicts) {
      map[pair.a.id] = true;
      map[pair.b.id] = true;
    }
    return map;
  }, [conflicts]);

  // Split day items into categories
  const allDayItems = useMemo(() => {
    return dayItems.filter((item) => item.allDay);
  }, [dayItems]);

  const timedItems = useMemo(() => {
    return dayItems
      .filter((item) => !item.allDay && item.startMin !== null && item.endMin !== null)
      .sort((a, b) => (a.startMin ?? 0) - (b.startMin ?? 0));
  }, [dayItems]);

  const unplannedTasks = useMemo(() => {
    return dayItems.filter((item) => item.kind === 'task' && item.startMin === null);
  }, [dayItems]);

  // Undated or other tasks that could be planned for today
  const candidateTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (t.done) return false;
      const hasDue = t.dueDate !== null && t.dueDate !== undefined;
      const hasStart = t.startAt !== null && t.startAt !== undefined;
      // If task is not due today and has no start today, it is available to pick
      if (!hasDue && !hasStart) return true;
      if (t.dueDate === targetKey) return true;
      if (t.startAt && dayKey(new Date(t.startAt)) === targetKey) return true;
      return false;
    });
  }, [tasks, targetKey]);

  // Handlers
  const handleToggleTask = async (taskId: string, currentDone: boolean) => {
    await updateTask(taskId, { done: !currentDone });
    emitDataChanged('tasks', [taskId]);
    await reload();
  };

  const handleCarryOver = async (taskId: string) => {
    const tomorrow = new Date(currentDate);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowKey = dayKey(tomorrow);

    await moveTask(taskId, {
      dueDate: tomorrowKey,
      startAt: null,
    });

    setCarriedOverTaskIds((prev) => ({ ...prev, [taskId]: true }));
    emitDataChanged('tasks', [taskId]);
    await reload();
  };

  const handleMoveTaskIntoToday = async (taskId: string) => {
    await updateTask(taskId, {
      dueDate: targetKey,
    });
    emitDataChanged('tasks', [taskId]);
    await reload();
  };

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    const title = eventTitle.trim();
    if (!title) return;

    let startAt: string;
    let endAt: string;

    if (eventAllDay) {
      startAt = `${targetKey}T00:00:00`;
      endAt = `${targetKey}T23:59:59`;
    } else {
      startAt = `${targetKey}T${eventStartTime}:00`;
      endAt = `${targetKey}T${eventEndTime}:00`;
    }

    await createLocalEvent({
      title,
      startAt,
      endAt,
      allDay: eventAllDay,
    });

    emitDataChanged('events');
    setEventTitle('');
    setShowNewEventForm(false);
    await reload();
  };

  const handleScheduleTask = async (taskId: string) => {
    const startAt = `${targetKey}T${taskStartTime}:00`;
    await updateTask(taskId, {
      dueDate: targetKey,
      startAt,
      plannedMinutes: taskDurationMinutes,
    });
    setSchedulingTaskId(null);
    emitDataChanged('tasks', [taskId]);
    await reload();
  };

  // Step options for segmented control
  const stepOptions: SegmentOption<DayStep>[] = [
    { value: 'plan', label: t.dayStepPlan },
    { value: 'execute', label: t.dayStepExecute },
    { value: 'review', label: t.dayStepReview },
  ];

  // Relative day label
  const relativeLabel = getRelativeDayLabel(currentDate, t);

  // Formatted date header. The locale comes from the interface language, not from
  // the operating system: a Russian interface on an English Windows showed
  // "Sun, Sep 20", and the whole chrome is translated, so the date must match it.
  const formattedDate = useMemo(() => {
    return currentDate.toLocaleDateString(I18nService.getLang() === 'ru' ? 'ru-RU' : 'en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
  }, [currentDate]);

  const isEmpty = dayItems.length === 0;

  return (
    <div className="flex flex-col h-full overflow-hidden w-full max-w-5xl mx-auto px-4 py-4 sm:px-6 sm:py-6 gap-4">
      {/* Top Header: Navigation + Step Segmented Control */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-2 border-b border-[var(--border)]">
        {/* Date Selector & Navigation */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
            <button
              type="button"
              aria-label="Previous day"
              onClick={() => {
                const d = new Date(currentDate);
                d.setDate(d.getDate() - 1);
                setCurrentDate(d);
              }}
              className="p-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() => setCurrentDate(new Date())}
              className="px-2.5 py-1 text-xs font-medium rounded hover:bg-[var(--surface-hover)] text-[var(--text-normal)] transition-colors"
            >
              {relativeLabel ? `${relativeLabel}` : formattedDate}
            </button>
            <button
              type="button"
              aria-label="Next day"
              onClick={() => {
                const d = new Date(currentDate);
                d.setDate(d.getDate() + 1);
                setCurrentDate(d);
              }}
              className="p-1.5 rounded hover:bg-[var(--surface-hover)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <span className="text-xs font-normal text-[var(--text-muted)]">
            {formattedDate}
          </span>
        </div>

        {/* Step Segmented Control */}
        <div className="flex items-center gap-2">
          <Segmented<DayStep>
            value={step}
            options={stepOptions}
            onChange={(val) => setStep(val)}
          />
        </div>
      </div>

      {/* Main Content Area */}
      {loading ? (
        <div className="flex-1 flex items-center justify-center text-sm text-[var(--text-muted)]">
          {t.commonLoading}
        </div>
      ) : isEmpty ? (
        /* Empty Day View */
        <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{
              backgroundColor: 'var(--surface)',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            <Calendar size={28} />
          </div>
          <div className="flex flex-col gap-1 max-w-sm">
            <span className="text-base font-medium text-[var(--text-normal)]">
              {t.dayEmpty}
            </span>
            <span className="text-xs text-[var(--text-muted)] leading-relaxed">
              {t.dayEmptyHint}
            </span>
          </div>

          {/* Quick action to add event or pick tasks */}
          <div className="flex items-center gap-2 mt-2">
            <button
              type="button"
              onClick={() => {
                setShowNewEventForm(true);
                setStep('plan');
              }}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors cursor-pointer"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--bg)',
              }}
            >
              <Plus size={14} />
              {t.dayNewEvent}
            </button>
            {candidateTasks.length > 0 && (
              <button
                type="button"
                onClick={() => setStep('plan')}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--border)] bg-[var(--surface)] text-[var(--text-normal)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
              >
                {t.dayPickMain}
              </button>
            )}
          </div>
        </div>
      ) : (
        /* Step views */
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {/* Step 1: PLAN */}
          {step === 'plan' && (
            <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0 overflow-y-auto">
              {/* Left column: Tasks picker & planning */}
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-[var(--text-normal)]">
                    {t.dayPickMain}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setShowNewEventForm((prev) => !prev)}
                    className="inline-flex items-center gap-1 text-xs font-medium text-[var(--accent)] hover:opacity-80 transition-opacity cursor-pointer"
                  >
                    <Plus size={14} />
                    {t.dayNewEvent}
                  </button>
                </div>

                {/* Local Event Creation Form */}
                {showNewEventForm && (
                  <form
                    onSubmit={handleCreateEvent}
                    className="p-3.5 rounded-lg flex flex-col gap-3 border border-[var(--border)] bg-[var(--surface)]"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-[var(--text-normal)]">
                        {t.dayNewEvent}
                      </span>
                      <label className="flex items-center gap-1.5 text-xs text-[var(--text-muted)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={eventAllDay}
                          onChange={(e) => setEventAllDay(e.target.checked)}
                          className="rounded"
                        />
                        {t.dayAllDay}
                      </label>
                    </div>

                    <input
                      type="text"
                      value={eventTitle}
                      onChange={(e) => setEventTitle(e.target.value)}
                      placeholder={t.dayEventTitle}
                      className="w-full px-3 py-1.5 rounded text-xs bg-transparent border border-[var(--border)] text-[var(--text-normal)] focus:outline-none focus:border-[var(--accent)]"
                    />

                    {!eventAllDay && (
                      <div className="flex items-center gap-2">
                        <input
                          type="time"
                          value={eventStartTime}
                          onChange={(e) => setEventStartTime(e.target.value)}
                          className="px-2 py-1 rounded text-xs bg-transparent border border-[var(--border)] text-[var(--text-normal)]"
                        />
                        <span className="text-xs text-[var(--text-muted)]">→</span>
                        <input
                          type="time"
                          value={eventEndTime}
                          onChange={(e) => setEventEndTime(e.target.value)}
                          className="px-2 py-1 rounded text-xs bg-transparent border border-[var(--border)] text-[var(--text-normal)]"
                        />
                      </div>
                    )}

                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setShowNewEventForm(false)}
                        className="px-2.5 py-1 text-xs rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                      >
                        ✕
                      </button>
                      <button
                        type="submit"
                        disabled={!eventTitle.trim()}
                        className="px-3 py-1 text-xs font-medium rounded transition-opacity disabled:opacity-40 cursor-pointer"
                        style={{
                          backgroundColor: 'var(--accent)',
                          color: 'var(--bg)',
                        }}
                      >
                        {t.commonAdd}
                      </button>
                    </div>
                  </form>
                )}

                {/* Candidate Tasks list to pick for today */}
                <div className="flex flex-col rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                  <div className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] border-b border-[var(--border)] bg-[var(--surface-subtle)]">
                    {t.dayPickMain}
                  </div>
                  <div className="flex flex-col divide-y divide-[var(--border)] max-h-80 overflow-y-auto">
                    {candidateTasks.length === 0 ? (
                      <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                        {t.tasksEmpty}
                      </div>
                    ) : (
                      candidateTasks.map((task) => {
                        const isScheduled = task.startAt && dayKey(new Date(task.startAt)) === targetKey;
                        const isDueToday = task.dueDate === targetKey;
                        return (
                          <div
                            key={task.id}
                            data-day-item={task.id}
                            className="p-3 flex items-center justify-between gap-3 text-xs hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                              <span className="truncate text-[var(--text-normal)]">
                                {task.title}
                              </span>
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {!isScheduled && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSchedulingTaskId(task.id);
                                  }}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text-normal)] hover:border-[var(--text-muted)] transition-colors cursor-pointer"
                                >
                                  <Clock size={12} />
                                  <span>Time</span>
                                </button>
                              )}

                              {!isDueToday && (
                                <button
                                  type="button"
                                  onClick={() => handleMoveTaskIntoToday(task.id)}
                                  className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-[var(--surface-subtle)] hover:bg-[var(--surface-hover)] text-[var(--text-normal)] transition-colors cursor-pointer"
                                >
                                  {t.dayToday}
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Scheduling Modal / Inline Form */}
                {schedulingTaskId && (
                  <div className="p-3.5 rounded-lg border border-[var(--accent)] bg-[var(--surface)] flex flex-col gap-3">
                    <span className="text-xs font-semibold text-[var(--text-normal)]">
                      Time
                    </span>
                    <div className="flex items-center gap-2">
                      <input
                        type="time"
                        value={taskStartTime}
                        onChange={(e) => setTaskStartTime(e.target.value)}
                        className="px-2 py-1 rounded text-xs bg-transparent border border-[var(--border)] text-[var(--text-normal)]"
                      />
                      <select
                        value={taskDurationMinutes}
                        onChange={(e) => setTaskDurationMinutes(Number(e.target.value))}
                        className="px-2 py-1 rounded text-xs bg-[var(--surface)] border border-[var(--border)] text-[var(--text-normal)]"
                      >
                        <option value={15}>15 min</option>
                        <option value={30}>30 min</option>
                        <option value={45}>45 min</option>
                        <option value={60}>60 min</option>
                        <option value={90}>90 min</option>
                      </select>
                    </div>
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => setSchedulingTaskId(null)}
                        className="px-2.5 py-1 text-xs rounded text-[var(--text-muted)] hover:bg-[var(--surface-hover)] transition-colors cursor-pointer"
                      >
                        ✕
                      </button>
                      <button
                        type="button"
                        onClick={() => handleScheduleTask(schedulingTaskId)}
                        className="px-3 py-1 text-xs font-medium rounded transition-opacity cursor-pointer"
                        style={{
                          backgroundColor: 'var(--accent)',
                          color: 'var(--bg)',
                        }}
                      >
                        {t.commonAdd}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Right column: Today's Timeline preview */}
              <div className="flex-1 flex flex-col min-h-0">
                <h3 className="text-sm font-semibold text-[var(--text-normal)] mb-2">
                  {formattedDate}
                </h3>
                <DayTimeline
                  allDayItems={allDayItems}
                  timedItems={timedItems}
                  unplannedTasks={unplannedTasks}
                  conflictIds={conflictIds}
                  nowMinutes={nowMinutes}
                  onToggleTask={handleToggleTask}
                  t={t}
                />
              </div>
            </div>
          )}

          {/* Step 2: EXECUTE */}
          {step === 'execute' && (
            <div className="flex-1 flex flex-col min-h-0">
              <DayTimeline
                allDayItems={allDayItems}
                timedItems={timedItems}
                unplannedTasks={unplannedTasks}
                conflictIds={conflictIds}
                nowMinutes={nowMinutes}
                onToggleTask={handleToggleTask}
                t={t}
              />
            </div>
          )}

          {/* Step 3: REVIEW */}
          {step === 'review' && (
            <div className="flex-1 flex flex-col md:flex-row gap-6 min-h-0 overflow-y-auto">
              {/* Completed Tasks section */}
              <div className="flex-1 flex flex-col rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {t.dayDone}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {dayItems.filter((i) => i.kind === 'task' && i.done).length}
                  </span>
                </div>
                <div className="flex flex-col divide-y divide-[var(--border)] p-2">
                  {dayItems.filter((i) => i.kind === 'task' && i.done).length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                      {t.tasksEmpty}
                    </div>
                  ) : (
                    dayItems
                      .filter((i) => i.kind === 'task' && i.done)
                      .map((item) => (
                        <div
                          key={item.id}
                          data-day-item={item.id}
                          className="p-2.5 flex items-center gap-2.5 text-xs text-[var(--text-muted)] line-through"
                        >
                          <CheckCircle2 size={16} className="text-[var(--accent)] flex-shrink-0" />
                          <span className="truncate">{item.title}</span>
                        </div>
                      ))
                  )}
                </div>
              </div>

              {/* Unfinished Tasks & Rollover / Carry Over section */}
              <div className="flex-1 flex flex-col rounded-lg border border-[var(--border)] overflow-hidden bg-[var(--surface)]">
                <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                    {t.dayUnfinished}
                  </span>
                  <span className="text-xs text-[var(--text-muted)]">
                    {dayItems.filter((i) => i.kind === 'task' && !i.done).length}
                  </span>
                </div>
                <div className="flex flex-col divide-y divide-[var(--border)] p-2">
                  {dayItems.filter((i) => i.kind === 'task' && !i.done).length === 0 ? (
                    <div className="p-4 text-center text-xs text-[var(--text-muted)]">
                      {t.tasksEmpty}
                    </div>
                  ) : (
                    dayItems
                      .filter((i) => i.kind === 'task' && !i.done)
                      .map((item) => {
                        const isCarriedOver = carriedOverTaskIds[item.id] === true;
                        return (
                          <div
                            key={item.id}
                            data-day-item={item.id}
                            className="p-2.5 flex items-center justify-between gap-2.5 text-xs hover:bg-[var(--surface-hover)] transition-colors"
                          >
                            <div className="flex items-center gap-2.5 flex-1 min-w-0">
                              <button
                                type="button"
                                aria-label="Mark task done"
                                onClick={() => handleToggleTask(item.id, false)}
                                className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0"
                              >
                                <Circle size={16} />
                              </button>
                              <span className="truncate text-[var(--text-normal)]">
                                {item.title}
                              </span>
                            </div>

                            <div className="flex-shrink-0">
                              {isCarriedOver ? (
                                <span className="text-xs font-medium text-[var(--text-muted)] px-2 py-0.5 rounded bg-[var(--surface-subtle)]">
                                  {t.dayCarriedOver}
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => handleCarryOver(item.id)}
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs font-medium transition-colors cursor-pointer"
                                  style={{
                                    backgroundColor: 'var(--surface-subtle)',
                                    color: 'var(--text-normal)',
                                    border: '1px solid var(--border)',
                                  }}
                                >
                                  <span>{t.dayCarryOver}</span>
                                  <ArrowRight size={12} />
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Timeline component for day view:
 * 1. All-day items strip
 * 2. Vertical rail (0-24h) with timed items placed at their minute coordinates
 * 3. Unplanned tasks column
 */
interface DayTimelineProps {
  allDayItems: DayItem[];
  timedItems: DayItem[];
  unplannedTasks: DayItem[];
  conflictIds: Record<string, true>;
  nowMinutes: number;
  onToggleTask: (taskId: string, done: boolean) => void;
  t: Translations;
}

function DayTimeline({
  allDayItems,
  timedItems,
  unplannedTasks,
  conflictIds,
  nowMinutes,
  onToggleTask,
  t,
}: DayTimelineProps) {
  // 24 hours timeline rail
  const hours = Array.from({ length: 24 }, (_, i) => i);
  const hourHeight = 48; // 48px per hour

  return (
    <div className="flex-1 flex flex-col min-h-0 border border-[var(--border)] rounded-lg overflow-hidden bg-[var(--surface)]">
      {/* All-Day Items Strip */}
      {allDayItems.length > 0 && (
        <div
          data-testid="all-day-strip"
          className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--surface-subtle)] flex flex-col gap-1.5"
        >
          <div className="text-[10px] font-semibold tracking-wider uppercase text-[var(--text-muted)]">
            {t.dayAllDay}
          </div>
          <div className="flex flex-wrap gap-2">
            {allDayItems.map((item) => (
              <div
                key={item.id}
                data-day-item={item.id}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border border-[var(--border)] bg-[var(--surface)] text-[var(--text-normal)]"
              >
                <Calendar size={12} className="text-[var(--accent)] flex-shrink-0" />
                <span className="truncate max-w-[200px]">{item.title}</span>
                {item.source === 'google' && (
                  <span
                    className="text-[10px] px-1 py-0.2 rounded border border-[var(--border)] text-[var(--text-muted)] flex items-center gap-0.5"
                    title={t.dayFromGoogle}
                  >
                    <ExternalLink size={10} />
                    {t.dayFromGoogle}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Main split: Vertical Timeline Rail (left/center) + Unplanned Tasks (right) */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden divide-y lg:divide-y-0 lg:divide-x divide-[var(--border)]">
        {/* Scrollable Timeline Rail */}
        <div className="flex-1 overflow-y-auto relative min-h-[360px] p-2">
          <div
            className="relative w-full"
            style={{ height: `${24 * hourHeight}px` }}
          >
            {/* Hour grid lines & labels */}
            {hours.map((hour) => (
              <div
                key={hour}
                className="absolute w-full flex items-start border-t border-[var(--border)] pointer-events-none"
                style={{
                  top: `${hour * hourHeight}px`,
                  height: `${hourHeight}px`,
                  opacity: 0.7,
                }}
              >
                <span className="text-[10px] text-[var(--text-muted)] w-10 text-right pr-2 select-none -translate-y-2">
                  {`${String(hour).padStart(2, '0')}:00`}
                </span>
                <div className="flex-1 border-t border-[var(--border)] opacity-30" />
              </div>
            ))}

            {/* Current Time Ticking Marker */}
            {nowMinutes >= 0 && nowMinutes <= 1440 && (
              <div
                className="absolute left-10 right-0 z-20 flex items-center pointer-events-none"
                style={{
                  top: `${(nowMinutes / 60) * hourHeight}px`,
                }}
              >
                <div className="w-2 h-2 rounded-full bg-red-500 -ml-1" />
                <div className="flex-1 border-t-2 border-red-500 opacity-80" />
              </div>
            )}

            {/* Timed Items placed on rail */}
            <div className="absolute left-12 right-2 top-0 bottom-0">
              {timedItems.map((item) => {
                const start = item.startMin ?? 0;
                const end = item.endMin ?? start + 30;
                const duration = Math.max(15, end - start);
                const topPx = (start / 60) * hourHeight;
                const heightPx = Math.max(24, (duration / 60) * hourHeight);
                const isConflict = conflictIds[item.id] === true;
                const isTask = item.kind === 'task';
                const isGoogle = item.source === 'google';

                return (
                  <div
                    key={item.id}
                    data-day-item={item.id}
                    data-testid="timeline-item"
                    className={`absolute left-0 right-0 rounded-md p-2 flex flex-col justify-between text-xs overflow-hidden transition-all shadow-sm ${
                      isConflict
                        ? 'border-2 border-amber-500 bg-amber-500/10'
                        : isTask
                        ? 'border border-[var(--border)] bg-[var(--surface-subtle)]'
                        : 'border border-[var(--border)] bg-[var(--surface)]'
                    }`}
                    style={{
                      top: `${topPx}px`,
                      height: `${heightPx}px`,
                    }}
                  >
                    <div className="flex items-start justify-between gap-1.5 min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        {isTask ? (
                          <button
                            type="button"
                            aria-label={item.done ? 'Mark as active' : 'Mark as completed'}
                            onClick={() => onToggleTask(item.id, item.done)}
                            className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0"
                          >
                            {item.done ? (
                              <CheckCircle2 size={14} className="text-[var(--accent)]" />
                            ) : (
                              <Circle size={14} />
                            )}
                          </button>
                        ) : (
                          <Calendar size={13} className="text-[var(--accent)] flex-shrink-0" />
                        )}

                        <span
                          className={`font-medium truncate ${
                            item.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-normal)]'
                          }`}
                        >
                          {item.title}
                        </span>
                      </div>

                      <div className="flex items-center gap-1 flex-shrink-0 text-[10px] text-[var(--text-muted)]">
                        {isGoogle && (
                          <span
                            className="inline-flex items-center gap-0.5 px-1 py-0.2 rounded border border-[var(--border)] bg-[var(--surface)] text-[var(--text-muted)]"
                            title={t.dayFromGoogle}
                          >
                            <ExternalLink size={9} />
                            {t.dayFromGoogle}
                          </span>
                        )}
                        <span>
                          {formatMinutes(start)} – {formatMinutes(end)}
                        </span>
                      </div>
                    </div>

                    {/* Conflict notification inside the card */}
                    {isConflict && (
                      <div
                        data-testid="conflict-indicator"
                        className="flex items-center gap-1 text-[10px] text-amber-500 font-medium mt-1 truncate"
                        title={t.dayConflictHint}
                      >
                        <AlertTriangle size={11} className="flex-shrink-0" />
                        <span className="truncate">{t.dayConflict}</span>
                        <span className="hidden sm:inline text-[var(--text-muted)] font-normal truncate">
                          ({t.dayConflictHint})
                        </span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Unplanned Tasks Rail (tasks with startMin === null) */}
        {unplannedTasks.length > 0 && (
          <div className="w-full lg:w-72 flex flex-col bg-[var(--surface-subtle)] min-h-0">
            <div className="px-3.5 py-2.5 border-b border-[var(--border)] flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
                {t.dayUnplanned}
              </span>
              <span className="text-xs text-[var(--text-muted)]">
                {unplannedTasks.length}
              </span>
            </div>
            <div className="flex-1 overflow-y-auto p-2 flex flex-col gap-1.5">
              {unplannedTasks.map((task) => (
                <div
                  key={task.id}
                  data-day-item={task.id}
                  className="p-2 rounded border border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-2 text-xs"
                >
                  <div className="flex items-center gap-2 truncate">
                    <button
                      type="button"
                      aria-label="Toggle task"
                      onClick={() => onToggleTask(task.id, task.done)}
                      className="text-[var(--text-muted)] hover:text-[var(--accent)] transition-colors flex-shrink-0"
                    >
                      {task.done ? (
                        <CheckCircle2 size={14} className="text-[var(--accent)]" />
                      ) : (
                        <Circle size={14} />
                      )}
                    </button>
                    <span
                      className={`truncate ${
                        task.done ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text-normal)]'
                      }`}
                    >
                      {task.title}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
