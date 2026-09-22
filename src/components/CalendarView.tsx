import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  MapPin,
  Trash2,
  X,
  CheckCircle2,
  Circle,
  Calendar as CalendarIcon,
} from 'lucide-react';
import { I18nService } from '../services/i18n';
import { onDataChanged } from '../services/appEvents';
import {
  listEvents,
  createLocalEvent,
  updateLocalEvent,
  deleteEvent,
  type CalendarEvent,
} from '../services/events';
import { listTasks, updateTask } from '../services/tasks';
import type { TaskItem } from '../types';
import {
  type CalendarViewMode,
  formatDateKey,
  addDays,
  addWeeks,
  addMonths,
  getCalendarWeekDays,
  getCalendarMonthGrid,
  filterEventsForDay,
  calculateEventSlot,
  tasksToCalendarEvents,
  formatCalendarPeriod,
} from '../services/calendar';
import { Card, ScreenHeader, Segmented, type SegmentOption, Field } from './ui';

export function CalendarView() {
  const t = I18nService.t();

  // View mode: month | week | day
  const [viewMode, setViewMode] = useState<CalendarViewMode>('month');

  // Currently focused date
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date());

  // Data
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [showTasks, setShowTasks] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<'all' | 'local' | 'google'>('all');

  // Modal / Form state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingEvent, setEditingEvent] = useState<CalendarEvent | null>(null);
  const [formTitle, setFormTitle] = useState('');
  const [formDate, setFormDate] = useState('');
  const [formStartTime, setFormStartTime] = useState('09:00');
  const [formEndTime, setFormEndTime] = useState('10:00');
  const [formAllDay, setFormAllDay] = useState(false);
  const [formLocation, setFormLocation] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  // Reload data from storage
  const reloadData = useCallback((): Promise<void> => {
    const pEvents = listEvents()
      .then((res) => {
        setEvents(res ?? []);
      })
      .catch(() => {});

    const pTasks = listTasks()
      .then((res) => {
        setTasks(res ?? []);
      })
      .catch(() => {});

    return Promise.all([pEvents, pTasks]).then(() => undefined);
  }, []);

  useEffect(() => {
    void reloadData();
    const unsub = onDataChanged((table) => {
      if (table === 'events' || table === 'tasks') {
        void reloadData();
      }
    });
    return unsub;
  }, [reloadData]);
  // Combined events and task-events
  const allEvents = useMemo(() => {
    let combined: CalendarEvent[] = [...events];

    if (showTasks) {
      const taskEvents = tasksToCalendarEvents(tasks);
      combined = [...combined, ...taskEvents];
    }

    if (sourceFilter === 'local') {
      combined = combined.filter((e) => e.source === 'local' && !e.taskId);
    } else if (sourceFilter === 'google') {
      combined = combined.filter((e) => e.source === 'google');
    }

    return combined;
  }, [events, tasks, showTasks, sourceFilter]);

  // Navigation handlers
  const handlePrev = useCallback(() => {
    setCurrentDate((prev) => {
      if (viewMode === 'month') return addMonths(prev, -1);
      if (viewMode === 'week') return addWeeks(prev, -1);
      return addDays(prev, -1);
    });
  }, [viewMode]);

  const handleNext = useCallback(() => {
    setCurrentDate((prev) => {
      if (viewMode === 'month') return addMonths(prev, 1);
      if (viewMode === 'week') return addWeeks(prev, 1);
      return addDays(prev, 1);
    });
  }, [viewMode]);

  const handleToday = useCallback(() => {
    setCurrentDate(new Date());
  }, []);

  // Open modal for creating a new event at specified date/time
  const openCreateModal = useCallback((dateStr?: string, startTime?: string) => {
    const d = dateStr || formatDateKey(new Date());
    const s = startTime || '09:00';
    const [h, m] = s.split(':').map(Number);
    const endH = (h + 1) % 24;
    const e = `${String(endH).padStart(2, '0')}:${String(m).padStart(2, '0')}`;

    setEditingEvent(null);
    setFormTitle('');
    setFormDate(d);
    setFormStartTime(s);
    setFormEndTime(e);
    setFormAllDay(false);
    setFormLocation('');
    setFormError(null);
    setModalOpen(true);
  }, []);

  // Open modal for editing an existing event
  const openEditModal = useCallback((event: CalendarEvent) => {
    if (event.taskId) {
      // It's a projected task - cannot edit directly in calendar modal
      return;
    }
    setEditingEvent(event);
    setFormTitle(event.title);
    setFormDate(event.startAt.slice(0, 10));
    setFormStartTime(event.allDay ? '00:00' : event.startAt.slice(11, 16) || '09:00');
    setFormEndTime(event.allDay ? '23:59' : event.endAt.slice(11, 16) || '10:00');
    setFormAllDay(event.allDay);
    setFormLocation(event.location || '');
    setFormError(null);
    setModalOpen(true);
  }, []);

  // Save event handler
  const handleSaveEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) return;

    if (!formAllDay && formEndTime <= formStartTime) {
      setFormError(t.calendarTimeSlotError);
      return;
    }

    const startAt = formAllDay
      ? `${formDate}T00:00:00`
      : `${formDate}T${formStartTime}:00`;
    const endAt = formAllDay
      ? `${formDate}T23:59:59`
      : `${formDate}T${formEndTime}:00`;

    try {
      if (editingEvent) {
        if (editingEvent.source === 'local') {
          await updateLocalEvent(editingEvent.id, {
            title: formTitle.trim(),
            startAt,
            endAt,
            allDay: formAllDay,
            location: formLocation.trim() || null,
          });
        }
      } else {
        await createLocalEvent({
          title: formTitle.trim(),
          startAt,
          endAt,
          allDay: formAllDay,
          location: formLocation.trim() || null,
        });
      }
      setModalOpen(false);
      void reloadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Delete event handler
  const handleDeleteEvent = async () => {
    if (!editingEvent || editingEvent.source !== 'local') return;
    try {
      await deleteEvent(editingEvent.id);
      setModalOpen(false);
      void reloadData();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    }
  };

  // Toggle task completion from calendar
  const handleToggleTask = async (taskId: string, currentDone: boolean) => {
    try {
      await updateTask(taskId, { done: !currentDone });
      void reloadData();
    } catch (err) {
      console.warn('Failed to toggle task completion:', err);
    }
  };

  // View switcher options
  const viewModeOptions = useMemo<SegmentOption<CalendarViewMode>[]>(
    () => [
      { value: 'month', label: t.calendarMonth },
      { value: 'week', label: t.calendarWeek },
      { value: 'day', label: t.calendarDay },
    ],
    [t]
  );

  // Month grid calculation
  const monthGrid = useMemo(() => {
    return getCalendarMonthGrid(currentDate.getFullYear(), currentDate.getMonth());
  }, [currentDate]);

  // Week days calculation
  const weekDays = useMemo(() => {
    return getCalendarWeekDays(currentDate);
  }, [currentDate]);

  // 24 hourly time slots (00:00 .. 23:00)
  const hourSlots = useMemo(() => {
    return Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, '0')}:00`);
  }, []);

  return (
    <div
      className="flex flex-col h-full w-full select-none space-y-4"
      style={{ backgroundColor: 'var(--bg)', color: 'var(--text)' }}
    >
      {/* Header bar */}
      <ScreenHeader
        title={
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <CalendarIcon size={18} style={{ color: 'var(--accent)' }} />
              <span className="text-base font-semibold tracking-tight" style={{ color: 'var(--text)' }}>
                {formatCalendarPeriod(currentDate, viewMode, I18nService.getLang())}
              </span>
            </div>
            <div className="flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0.5">
              <button
                type="button"
                aria-label="Previous"
                onClick={handlePrev}
                className="p-1 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                aria-label="Today"
                onClick={handleToday}
                className="px-2.5 py-0.5 text-xs font-medium rounded-[6px] hover:bg-[var(--elevated)] transition-colors text-[var(--text)] cursor-pointer"
              >
                {t.calendarToday}
              </button>
              <button
                type="button"
                aria-label="Next"
                onClick={handleNext}
                className="p-1 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        }
        action={
          <div className="flex items-center gap-2.5 flex-wrap">
            {/* View mode Segmented switcher */}
            <Segmented
              value={viewMode}
              onChange={(m) => setViewMode(m)}
              options={viewModeOptions}
            />

            {/* Show tasks toggle */}
            <button
              type="button"
              onClick={() => setShowTasks(!showTasks)}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-[8px] border text-xs font-medium transition-colors cursor-pointer ${
                showTasks
                  ? 'bg-[var(--accent-soft)] text-[var(--accent)] border-[var(--accent)]'
                  : 'bg-[var(--surface)] text-[var(--text-muted)] border-[var(--border)] hover:bg-[var(--elevated)]'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{t.calendarShowTasks}</span>
            </button>

            {/* Source filter */}
            <div className="flex items-center rounded-[8px] border border-[var(--border)] bg-[var(--surface)] p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setSourceFilter('all')}
                className={`px-2 py-1 rounded-[6px] transition-colors cursor-pointer ${
                  sourceFilter === 'all'
                    ? 'bg-[var(--elevated)] text-[var(--text)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                {t.calendarFilterAll}
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('local')}
                className={`flex items-center gap-1 px-2 py-1 rounded-[6px] transition-colors cursor-pointer ${
                  sourceFilter === 'local'
                    ? 'bg-[var(--elevated)] text-[var(--accent)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: 'var(--accent)' }} />
                <span>{t.calendarSourceLocal}</span>
              </button>
              <button
                type="button"
                onClick={() => setSourceFilter('google')}
                className={`flex items-center gap-1 px-2 py-1 rounded-[6px] transition-colors cursor-pointer ${
                  sourceFilter === 'google'
                    ? 'bg-[var(--elevated)] text-[var(--accent-blue,#3B82F6)] font-semibold'
                    : 'text-[var(--text-muted)] hover:text-[var(--text)]'
                }`}
              >
                <span className="w-2 h-2 rounded-full bg-[var(--accent-blue,#3B82F6)]" />
                <span>{t.calendarSourceGoogle}</span>
              </button>
            </div>

            {/* New Event Button */}
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] font-medium text-xs shadow-xs transition-opacity hover:opacity-90 bg-[var(--accent)] text-[var(--bg)] cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>{t.calendarNewEvent}</span>
            </button>
          </div>
        }
        className="pb-0"
      />

      <Card variant="surface" padding="none" className="flex-1 overflow-hidden min-h-0 flex flex-col border border-[var(--border)]">
        <div className="flex-1 overflow-y-auto min-h-0 relative">
        {/* 1. MONTH VIEW */}
        {viewMode === 'month' && (
          <div className="flex flex-col h-full min-h-[600px] p-4">
            {/* Weekday headers: Mon..Sun */}
            <div className="grid grid-cols-7 mb-2 text-center text-xs font-medium text-[var(--text-muted)]">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Month grid days */}
            <div
              className="grid grid-cols-7 flex-1 border-t border-l rounded-[14px] overflow-hidden border-[var(--border)] bg-[var(--surface)]"
            >
              {monthGrid.map((day) => {
                const dayEvents = filterEventsForDay(allEvents, day.date);

                return (
                  <div
                    key={day.dateKey}
                    data-testid={`calendar-day-cell-${day.dateKey}`}
                    onClick={() => openCreateModal(day.dateKey)}
                    className={`min-h-[100px] p-1.5 border-r border-b border-[var(--border)] flex flex-col transition-colors cursor-pointer group hover:bg-[var(--surface-hover)] ${
                      !day.isCurrentMonth ? 'opacity-35 bg-[var(--bg)]' : ''
                    } ${day.isToday ? 'bg-[var(--elevated)] ring-1 ring-[var(--accent)] ring-inset' : ''}`}
                  >
                    {/* Day number & Quick add */}
                    <div className="flex items-center justify-between mb-1">
                      <span
                        className={`text-xs font-semibold px-1.5 py-0.5 rounded-md ${
                          day.isToday
                            ? 'bg-[var(--accent)] text-[var(--bg)] font-bold'
                            : day.isWeekend
                            ? 'text-amber-400'
                            : 'text-[var(--text)]'
                        }`}
                      >
                        {day.date.getDate()}
                      </span>
                      <button
                        type="button"
                        aria-label="Add event"
                        onClick={(e) => {
                          e.stopPropagation();
                          openCreateModal(day.dateKey);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-[var(--surface-selected)] text-[var(--text-muted)] transition-opacity"
                      >
                        <Plus className="w-3 h-3" />
                      </button>
                    </div>

                    {/* Day event chips */}
                    <div className="flex-1 flex flex-col gap-1 overflow-y-auto max-h-[85px] no-scrollbar">
                      {dayEvents.slice(0, 4).map((evt) => {
                        const isTask = Boolean(evt.taskId);
                        const isGoogle = evt.source === 'google';
                        const timeStr = evt.allDay ? '' : evt.startAt.slice(11, 16);

                        return (
                          <div
                            key={evt.id}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isTask) openEditModal(evt);
                            }}
                            className="px-1.5 py-0.5 rounded text-[11px] truncate flex items-center gap-1 border bg-[var(--elevated)] border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]"
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                                isTask ? 'bg-[var(--phase-focus,#F59E0B)]' : isGoogle ? 'bg-blue-400' : 'bg-[var(--accent)]'
                              }`}
                            />
                            {timeStr && <span className="font-mono text-[10px] opacity-75">{timeStr}</span>}
                            <span className="truncate">{evt.title}</span>
                          </div>
                        );
                      })}
                      {dayEvents.length > 4 && (
                        <div className="text-[10px] text-[var(--text-muted)] font-medium pl-1">
                          +{dayEvents.length - 4} ещё
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* 2. WEEK VIEW */}
        {viewMode === 'week' && (
          <div className="flex flex-col h-full min-w-[700px] p-4">
            {/* Week days column headers */}
            <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b pb-2 mb-2 text-center" style={{ borderColor: 'var(--border)' }}>
              <div /> {/* Top-left empty corner */}
              {weekDays.map((day) => (
                <div
                  key={day.dateKey}
                  className={`flex flex-col items-center py-1 rounded-lg ${
                    day.isToday ? 'bg-[var(--surface-elevated)]' : ''
                  }`}
                >
                  <span className="text-[11px] font-medium" style={{ color: 'var(--text-muted)' }}>
                    {day.date.toLocaleDateString(undefined, { weekday: 'short' })}
                  </span>
                  <span
                    className={`text-sm font-bold mt-0.5 px-2 py-0.5 rounded-full ${
                      day.isToday
                        ? 'bg-[var(--accent)] text-[var(--bg)]'
                        : day.isWeekend
                        ? 'text-amber-400'
                        : 'text-[var(--text)]'
                    }`}
                  >
                    {day.date.getDate()}
                  </span>
                </div>
              ))}
            </div>

            {/* All-day row if any all-day events exist */}
            {weekDays.some((d) => filterEventsForDay(allEvents, d.date).some((e) => e.allDay)) && (
              <div className="grid grid-cols-[60px_repeat(7,1fr)] border-b pb-2 mb-2" style={{ borderColor: 'var(--border)' }}>
                <div className="text-[10px] font-medium pr-2 text-right self-center" style={{ color: 'var(--text-muted)' }}>
                  {t.calendarAllDay}
                </div>
                {weekDays.map((day) => {
                  const allDayEvents = filterEventsForDay(allEvents, day.date).filter((e) => e.allDay);
                  return (
                    <div key={day.dateKey} className="px-1 flex flex-col gap-1">
                      {allDayEvents.map((evt) => (
                        <div
                          key={evt.id}
                          onClick={() => !evt.taskId && openEditModal(evt)}
                          className="px-1.5 py-0.5 rounded text-[10px] font-medium truncate bg-[var(--surface-elevated)] border border-[var(--border)] cursor-pointer hover:border-[var(--accent)]"
                        >
                          {evt.title}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            )}

            {/* 24-hour time grid */}
            <div className="flex-1 overflow-y-auto relative">
              <div className="grid grid-cols-[60px_repeat(7,1fr)] relative">
                {/* Hours column */}
                <div className="flex flex-col select-none pr-2">
                  {hourSlots.map((time) => (
                    <div
                      key={time}
                      className="h-14 text-[10px] font-mono text-right -mt-2.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {time}
                    </div>
                  ))}
                </div>

                {/* 7 Day columns */}
                {weekDays.map((day) => {
                  const dayEvents = filterEventsForDay(allEvents, day.date).filter((e) => !e.allDay);

                  return (
                    <div
                      key={day.dateKey}
                      data-testid={`calendar-week-col-${day.dateKey}`}
                      className="border-l relative flex flex-col"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {/* 24 clickable 1-hour slots */}
                      {hourSlots.map((time) => (
                        <div
                          key={time}
                          data-testid={`time-slot-${day.dateKey}-${time}`}
                          onClick={() => openCreateModal(day.dateKey, time)}
                          className="h-14 border-b border-[var(--border)]/40 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                        />
                      ))}

                      {/* Positioned event cards */}
                      {dayEvents.map((evt) => {
                        const slot = calculateEventSlot(evt, day.date);
                        const topPx = (slot.startMinutes / 60) * 56; // 56px = 14rem = h-14
                        const heightPx = Math.max(24, (slot.durationMinutes / 60) * 56);
                        const isTask = Boolean(evt.taskId);
                        const isGoogle = evt.source === 'google';

                        return (
                          <div
                            key={evt.id}
                            data-testid={`event-card-${evt.id}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isTask) openEditModal(evt);
                            }}
                            className={`absolute left-1 right-1 rounded-md p-1.5 text-xs shadow-sm border overflow-hidden cursor-pointer transition-all hover:z-20 hover:shadow-md ${
                              isTask
                                ? 'bg-amber-950/60 border-amber-700/50 text-amber-100'
                                : isGoogle
                                ? 'bg-blue-950/60 border-blue-700/50 text-blue-100'
                                : 'bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]'
                            }`}
                            style={{
                              top: `${topPx}px`,
                              height: `${heightPx}px`,
                            }}
                          >
                            <div className="flex items-center justify-between gap-1 font-semibold leading-tight">
                              <span className="truncate">{evt.title}</span>
                              {isTask && evt.taskId && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    const taskObj = tasks.find((t) => t.id === evt.taskId);
                                    if (taskObj) handleToggleTask(taskObj.id, taskObj.done);
                                  }}
                                  className="hover:text-amber-300 transition-colors"
                                >
                                  {tasks.find((t) => t.id === evt.taskId)?.done ? (
                                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                                  ) : (
                                    <Circle className="w-3.5 h-3.5" />
                                  )}
                                </button>
                              )}
                            </div>
                            <div className="text-[10px] font-mono opacity-80 mt-0.5">
                              {evt.startAt.slice(11, 16)} — {evt.endAt.slice(11, 16)}
                            </div>
                            {evt.location && (
                              <div className="flex items-center gap-1 text-[10px] opacity-70 mt-1 truncate">
                                <MapPin className="w-2.5 h-2.5 shrink-0" />
                                <span className="truncate">{evt.location}</span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* 3. DAY VIEW */}
        {viewMode === 'day' && (
          <div className="flex flex-col h-full max-w-4xl mx-auto p-4">
            {/* Header info for focused day */}
            <div className="flex items-center justify-between pb-3 border-b mb-3" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h2 className="text-base font-bold">
                  {currentDate.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </h2>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  {filterEventsForDay(allEvents, currentDate).length} событий и задач
                </div>
              </div>

              <button
                type="button"
                onClick={() => openCreateModal(formatDateKey(currentDate))}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border hover:bg-[var(--surface-hover)] transition-colors"
                style={{ borderColor: 'var(--border)' }}
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{t.calendarNewEvent}</span>
              </button>
            </div>

            {/* 24-hour day schedule timeline */}
            <div className="flex-1 overflow-y-auto relative">
              <div className="grid grid-cols-[70px_1fr] relative">
                {/* Hours column */}
                <div className="flex flex-col select-none pr-3">
                  {hourSlots.map((time) => (
                    <div
                      key={time}
                      className="h-16 text-xs font-mono text-right -mt-2.5"
                      style={{ color: 'var(--text-muted)' }}
                    >
                      {time}
                    </div>
                  ))}
                </div>

                {/* Day Slot Column */}
                <div className="border-l relative" style={{ borderColor: 'var(--border)' }}>
                  {hourSlots.map((time) => (
                    <div
                      key={time}
                      data-testid={`day-time-slot-${time}`}
                      onClick={() => openCreateModal(formatDateKey(currentDate), time)}
                      className="h-16 border-b border-[var(--border)]/40 hover:bg-[var(--surface-hover)] cursor-pointer transition-colors"
                    />
                  ))}

                  {/* Positioned event cards on day timeline */}
                  {filterEventsForDay(allEvents, currentDate)
                    .filter((e) => !e.allDay)
                    .map((evt) => {
                      const slot = calculateEventSlot(evt, currentDate);
                      const topPx = (slot.startMinutes / 60) * 64; // 64px = 16rem = h-16
                      const heightPx = Math.max(30, (slot.durationMinutes / 60) * 64);
                      const isTask = Boolean(evt.taskId);
                      const isGoogle = evt.source === 'google';

                      return (
                        <div
                          key={evt.id}
                          onClick={() => !isTask && openEditModal(evt)}
                          className={`absolute left-2 right-4 rounded-lg p-2.5 text-xs shadow-sm border overflow-hidden cursor-pointer transition-all hover:z-20 hover:shadow-md ${
                            isTask
                              ? 'bg-amber-950/60 border-amber-700/50 text-amber-100'
                              : isGoogle
                              ? 'bg-blue-950/60 border-blue-700/50 text-blue-100'
                              : 'bg-[var(--surface-elevated)] border-[var(--border)] text-[var(--text)] hover:border-[var(--accent)]'
                          }`}
                          style={{
                            top: `${topPx}px`,
                            height: `${heightPx}px`,
                          }}
                        >
                          <div className="flex items-center justify-between font-bold text-sm">
                            <span>{evt.title}</span>
                            <span className="font-mono text-xs opacity-80">
                              {evt.startAt.slice(11, 16)} — {evt.endAt.slice(11, 16)}
                            </span>
                          </div>
                          {evt.location && (
                            <div className="flex items-center gap-1.5 text-xs opacity-75 mt-1">
                              <MapPin className="w-3 h-3" />
                              <span>{evt.location}</span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
      </Card>

      {/* Modal Dialog for Event Creation and Editing */}
      {modalOpen && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs"
        >
          <Card
            variant="surface"
            padding="lg"
            className="w-full max-w-md shadow-2xl space-y-4 animate-in fade-in zoom-in-95 duration-150 text-[var(--text)]"
          >
            <div className="flex items-center justify-between border-b border-[var(--border)] pb-3">
              <h2 className="text-base font-semibold tracking-tight">
                {editingEvent ? t.calendarEditEvent : t.calendarNewEvent}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 rounded-[6px] hover:bg-[var(--elevated)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEvent} className="space-y-4">
              {formError && (
                <div className="p-2.5 rounded-[8px] bg-[var(--elevated)] border border-[var(--accent-red,#EF4444)]/40 text-[var(--accent-red,#EF4444)] text-xs">
                  {formError}
                </div>
              )}

              {/* Title */}
              <Field label={t.calendarEventTitle} required>
                <input
                  autoFocus
                  type="text"
                  required
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  placeholder="e.g. Weekly Strategy Sync"
                  className="w-full px-3 py-2 rounded-[8px] border text-sm bg-[var(--elevated)] border-[var(--border)] text-[var(--text)] focus:border-[var(--accent)] outline-none"
                />
              </Field>

              {/* All-day toggle */}
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium">
                <input
                  type="checkbox"
                  checked={formAllDay}
                  onChange={(e) => setFormAllDay(e.target.checked)}
                  className="rounded border-[var(--border)] text-[var(--accent)] w-4 h-4"
                />
                <span>{t.calendarAllDay}</span>
              </label>

              {/* Date */}
              <Field label="Дата" required>
                <input
                  type="date"
                  required
                  value={formDate}
                  onChange={(e) => setFormDate(e.target.value)}
                  className="w-full px-3 py-1.5 rounded-[8px] border text-sm bg-[var(--elevated)] border-[var(--border)] text-[var(--text)] focus:border-[var(--accent)] outline-none font-mono"
                />
              </Field>

              {/* Time inputs if not all-day */}
              {!formAllDay && (
                <div className="grid grid-cols-2 gap-3">
                  <Field label={t.calendarStart} required>
                    <input
                      type="time"
                      required
                      value={formStartTime}
                      onChange={(e) => setFormStartTime(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-[8px] border text-sm bg-[var(--elevated)] border-[var(--border)] text-[var(--text)] focus:border-[var(--accent)] outline-none font-mono"
                    />
                  </Field>
                  <Field label={t.calendarEnd} required>
                    <input
                      type="time"
                      required
                      value={formEndTime}
                      onChange={(e) => setFormEndTime(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-[8px] border text-sm bg-[var(--elevated)] border-[var(--border)] text-[var(--text)] focus:border-[var(--accent)] outline-none font-mono"
                    />
                  </Field>
                </div>
              )}

              {/* Location */}
              <Field label={t.calendarLocation}>
                <input
                  type="text"
                  value={formLocation}
                  onChange={(e) => setFormLocation(e.target.value)}
                  placeholder="Online / Office 402"
                  className="w-full px-3 py-2 rounded-[8px] border text-sm bg-[var(--elevated)] border-[var(--border)] text-[var(--text)] focus:border-[var(--accent)] outline-none"
                />
              </Field>

              {/* Buttons */}
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border)]">
                {editingEvent && editingEvent.source === 'local' ? (
                  <button
                    type="button"
                    onClick={handleDeleteEvent}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-[8px] text-xs font-medium text-[var(--accent-red,#EF4444)] hover:bg-[var(--elevated)] transition-colors cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    <span>{t.calendarDeleteEvent}</span>
                  </button>
                ) : (
                  <div />
                )}

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setModalOpen(false)}
                    className="px-3 py-1.5 rounded-[8px] text-xs font-medium border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] transition-colors cursor-pointer"
                  >
                    {t.calendarCancel}
                  </button>
                  <button
                    type="submit"
                    className="px-4 py-1.5 rounded-[8px] text-xs font-medium shadow-xs transition-opacity hover:opacity-90 bg-[var(--accent)] text-[var(--bg)] cursor-pointer"
                  >
                    {t.calendarSave}
                  </button>
                </div>
              </div>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
}
