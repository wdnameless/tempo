import React, { useState, useEffect, useMemo } from 'react';
import {
  Clock,
  Flame,
  CheckCircle2,
  Calendar,
  Sparkles,
  BarChart3,
  Award,
} from 'lucide-react';
import { listSessions, type StoredSession } from '../services/sessionStore';
import {
  focusByDay,
  focusByWeek,
  heatmap,
  focusByHour,
  peakHour,
  pomodoroCount,
  currentStreak,
  longestStreak,
  completionByDay,
  taskProgress,
  formatFocus,
} from '../services/stats';
import { listTasks } from '../services/tasks';
import { I18nService } from '../services/i18n';
import type { TaskItem } from '../types';

export interface StatsViewProps {
  tasks?: TaskItem[];
}

export const StatsView: React.FC<StatsViewProps> = ({ tasks: tasksProp }) => {
  const t = I18nService.t();

  const [period, setPeriod] = useState<'day' | 'week'>('day');
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>(tasksProp ?? []);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const [loadedSessions, loadedTasks] = await Promise.all([
          listSessions(),
          tasksProp ? Promise.resolve(tasksProp) : listTasks(),
        ]);
        if (active) {
          setSessions(loadedSessions);
          if (!tasksProp) {
            setTasks(loadedTasks);
          }
        }
      } catch {
        // Safe fallback on unexpected failure
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void load();
    return () => {
      active = false;
    };
  }, [tasksProp]);

  // Derived metrics
  const now = useMemo(() => new Date(), []);

  // Focus time for selected period
  const dayBuckets = useMemo(() => focusByDay(sessions, 14, now), [sessions, now]);
  const weekBuckets = useMemo(() => focusByWeek(sessions, 12, now), [sessions, now]);

  const periodBuckets = period === 'day' ? dayBuckets : weekBuckets;
  const totalPeriodSeconds = useMemo(
    () => periodBuckets.reduce((acc, b) => acc + b.seconds, 0),
    [periodBuckets],
  );

  // Heatmap: 12 weeks of 7 days (84 cells, Monday first)
  const heatmapCells = useMemo(() => heatmap(sessions, 12, now), [sessions, now]);
  const maxHeatmapSec = useMemo(
    () => Math.max(1, ...heatmapCells.map((c) => c.seconds)),
    [heatmapCells],
  );

  // Pomodoros & streaks
  const pomodoros = useMemo(() => pomodoroCount(sessions), [sessions]);
  const streakCurrent = useMemo(() => currentStreak(sessions, 1, now), [sessions, now]);
  const streakLongest = useMemo(() => longestStreak(sessions, 1), [sessions]);

  // Task completion rate & progress
  const { completed: completedCount, total: totalCount, rate } = useMemo(
    () => taskProgress(tasks),
    [tasks],
  );
  const completionsPerDay = useMemo(() => completionByDay(tasks, 14, now), [tasks, now]);

  // Best hours of the day (24 buckets)
  const hourBuckets = useMemo(() => focusByHour(sessions), [sessions]);
  const bestHour = useMemo(() => peakHour(sessions), [sessions]);
  const maxHourSec = useMemo(
    () => Math.max(1, ...hourBuckets),
    [hourBuckets],
  );

  // Day chart max
  const maxDaySec = useMemo(
    () => Math.max(1, ...dayBuckets.map((b) => b.seconds)),
    [dayBuckets],
  );

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center p-8 text-sm text-[var(--text-muted)]">
        <Clock className="w-5 h-5 animate-spin mr-2 text-[var(--accent)]" />
        <span>Loading statistics...</span>
      </div>
    );
  }

  // Empty state: app nobody has used yet must say what will appear and why
  if (sessions.length === 0 && tasks.length === 0) {
    return (
      <div
        data-testid="stats-empty-state"
        className="flex-1 flex flex-col items-center justify-center p-8 text-center"
      >
        <div className="w-16 h-16 rounded-2xl bg-[var(--surface-panel)] border border-[var(--border-subtle)] flex items-center justify-center mb-4 text-[var(--accent)] shadow-sm">
          <BarChart3 className="w-8 h-8" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--text-main)] mb-1">
          {t.statsEmptyTitle}
        </h2>
        <p className="text-sm text-[var(--text-muted)] max-w-sm mb-6 leading-relaxed">
          {t.statsEmptyBody}
        </p>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] px-3 py-1.5 rounded-full bg-[var(--surface-panel)] border border-[var(--border-subtle)]">
          <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
          <span>{t.statsEmptyHint}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6 max-w-5xl mx-auto w-full">
      {/* Header & Period Toggle */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text-main)] tracking-tight">
            {t.statsTitle}
          </h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            {t.statsSubtitle}
          </p>
        </div>

        {/* Day / Week toggle */}
        <div className="inline-flex rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-panel)] p-0.5 self-start sm:self-auto">
          <button
            type="button"
            data-testid="toggle-period-day"
            onClick={() => setPeriod('day')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              period === 'day'
                ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {t.statsPeriodDay}
          </button>
          <button
            type="button"
            data-testid="toggle-period-week"
            onClick={() => setPeriod('week')}
            className={`px-3 py-1 text-xs font-medium rounded-md transition-colors ${
              period === 'week'
                ? 'bg-[var(--accent)] text-[var(--accent-contrast)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
            }`}
          >
            {t.statsPeriodWeek}
          </button>
        </div>
      </div>

      {/* Top 4 KPI metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Period Focus Time */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span data-testid="period-focus-label" className="text-xs font-medium">
              {period === 'day' ? t.statsFocusDays : t.statsFocusWeeks}
            </span>
            <Clock className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div data-testid="period-focus-total" className="text-2xl font-bold text-[var(--text-main)]">
            {formatFocus(totalPeriodSeconds)}
          </div>
          <span className="text-[11px] text-[var(--text-muted)] mt-1">
            {period === 'day' ? t.statsTotalDays : t.statsTotalWeeks}
          </span>
        </div>

        {/* Pomodoros */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium">{t.statsPomodoros}</span>
            <Award className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div data-testid="pomodoro-count" className="text-2xl font-bold text-[var(--text-main)]">
            {pomodoros}
          </div>
          <span className="text-[11px] text-[var(--text-muted)] mt-1">
            {t.statsCompletedSessions}
          </span>
        </div>

        {/* Day Streak */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium">{t.statsStreak}</span>
            <Flame className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div className="flex items-baseline gap-1.5">
            <span data-testid="current-streak" className="text-2xl font-bold text-[var(--text-main)]">
              {streakCurrent}
            </span>
            <span className="text-xs text-[var(--text-muted)]">
              {t.statsDaysShort}
            </span>
          </div>
          <span className="text-[11px] text-[var(--text-muted)] mt-1">
            {t.statsBestStreak.replace('{n}', String(streakLongest))}
          </span>
        </div>

        {/* Task Completion Rate */}
        <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] flex flex-col justify-between">
          <div className="flex items-center justify-between text-[var(--text-muted)] mb-2">
            <span className="text-xs font-medium">{t.statsTasksCard}</span>
            <CheckCircle2 className="w-4 h-4 text-[var(--accent)]" />
          </div>
          <div data-testid="task-completion-rate" className="text-2xl font-bold text-[var(--text-main)]">
            {Math.round(rate * 100)}%
          </div>
          <span className="text-[11px] text-[var(--text-muted)] mt-1">
            {t.statsDoneOfTotal.replace('{done}', String(completedCount)).replace('{total}', String(totalCount))}
          </span>
        </div>
      </div>

      {/* Bar Chart: Last 2 weeks by day */}
      <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-main)]">
              {t.statsFocusChart}
            </h3>
          </div>
          <span className="text-xs text-[var(--text-muted)]">
            14 {t.statsDaysShort}
          </span>
        </div>

        <div className="h-36 flex items-end gap-1.5 pt-4">
          {dayBuckets.map((bucket) => {
            const heightPercent = bucket.seconds > 0
              ? Math.max(8, Math.round((bucket.seconds / maxDaySec) * 100))
              : 3;
            const hasFocus = bucket.seconds > 0;
            const dateObj = new Date(bucket.date);
            const dayLabel = !Number.isNaN(dateObj.getTime())
              ? dateObj.toLocaleDateString(undefined, { weekday: 'narrow' })
              : bucket.date;

            return (
              <div key={bucket.date} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                <div
                  className="w-full rounded-t transition-all duration-200 relative"
                  style={{
                    height: `${heightPercent}%`,
                    backgroundColor: hasFocus
                      ? 'var(--accent)'
                      : 'var(--border-subtle)',
                    opacity: hasFocus ? 0.85 : 0.4,
                  }}
                  title={`${bucket.date}: ${formatFocus(bucket.seconds)}`}
                />
                <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-main)]">
                  {dayLabel}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Activity Heat Map (12 weeks × 7 days = 84 cells) */}
      <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-[var(--accent)]" />
            <h3 className="text-sm font-semibold text-[var(--text-main)]">
              {t.statsHeatmap}
            </h3>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
            <span>{t.statsHeatLess}</span>
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--border-subtle)] opacity-40" />
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)] opacity-30" />
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)] opacity-60" />
            <span className="w-2.5 h-2.5 rounded-sm bg-[var(--accent)] opacity-100" />
            <span>{t.statsHeatMore}</span>
          </div>
        </div>

        {/* Heatmap grid */}
        <div className="overflow-x-auto pb-2">
          <div
            data-testid="heatmap-grid"
            className="grid grid-flow-col grid-rows-7 gap-1 min-w-[320px]"
          >
            {heatmapCells.map((cell) => {
              const sec = cell.seconds;
              const ratio = sec / maxHeatmapSec;
              let opacity = 0.15;
              let bgColor = 'var(--border-subtle)';

              if (sec > 0) {
                bgColor = 'var(--accent)';
                if (ratio < 0.25) opacity = 0.35;
                else if (ratio < 0.5) opacity = 0.55;
                else if (ratio < 0.75) opacity = 0.8;
                else opacity = 1.0;
              }

              return (
                <div
                  key={cell.date}
                  data-testid="heatmap-cell"
                  data-seconds={sec}
                  title={`${cell.date}: ${formatFocus(sec)}`}
                  className="w-3.5 h-3.5 rounded-[2px] transition-transform hover:scale-125"
                  style={{
                    backgroundColor: bgColor,
                    opacity,
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      {/* Two-column section: Best Hours histogram & Task Completions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Best Hours Histogram (24 columns) */}
        <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-main)]">
                {t.statsPeakHours}
              </h3>
            </div>
            {bestHour !== null && (
              <span className="text-xs font-medium text-[var(--accent)] px-2 py-0.5 rounded-full bg-[var(--accent)]/10">
                {t.statsPeakAt.replace('{hour}', String(bestHour))}
              </span>
            )}
          </div>

          <div className="h-28 flex items-end gap-1 pt-3">
            {hourBuckets.map((sec, hour) => {
              const isPeak = bestHour === hour && sec > 0;
              const heightPercent = sec > 0
                ? Math.max(10, Math.round((sec / maxHourSec) * 100))
                : 4;

              return (
                <div key={hour} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                  <div
                    className="w-full rounded-t transition-all duration-200"
                    style={{
                      height: `${heightPercent}%`,
                      backgroundColor: isPeak
                        ? 'var(--accent)'
                        : sec > 0
                        ? 'var(--accent)'
                        : 'var(--border-subtle)',
                      opacity: isPeak ? 1.0 : sec > 0 ? 0.6 : 0.3,
                    }}
                    title={`${hour}:00 - ${formatFocus(sec)}`}
                  />
                  {hour % 6 === 0 && (
                    <span className="text-[9px] text-[var(--text-muted)]">
                      {hour}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Task completions per day */}
        <div className="p-5 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-panel)] space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-[var(--accent)]" />
              <h3 className="text-sm font-semibold text-[var(--text-main)]">
                {t.statsCompletedChart}
              </h3>
            </div>
            <span className="text-xs text-[var(--text-muted)]">
              {completedCount} {t.statsTotalWord}
            </span>
          </div>

          <div className="h-28 flex items-end gap-1.5 pt-3">
            {completionsPerDay.map((item) => {
              const maxCount = Math.max(1, ...completionsPerDay.map((d) => d.done));
              const heightPercent = item.done > 0
                ? Math.max(12, Math.round((item.done / maxCount) * 100))
                : 4;
              const dateObj = new Date(item.day);
              const dayLabel = !Number.isNaN(dateObj.getTime())
                ? dateObj.toLocaleDateString(undefined, { weekday: 'narrow' })
                : item.day;

              return (
                <div key={item.day} className="flex-1 flex flex-col items-center gap-1 h-full justify-end group">
                  <div
                    className="w-full rounded-t transition-all duration-200"
                    style={{
                      height: `${heightPercent}%`,
                      backgroundColor: item.done > 0
                        ? 'var(--accent)'
                        : 'var(--border-subtle)',
                      opacity: item.done > 0 ? 0.75 : 0.3,
                    }}
                    title={`${item.day}: ${item.done} tasks`}
                  />
                  <span className="text-[10px] text-[var(--text-muted)] group-hover:text-[var(--text-main)]">
                    {dayLabel}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
};

export default StatsView;
