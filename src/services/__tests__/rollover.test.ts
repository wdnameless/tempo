import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  rolloverSettings,
  setRolloverSettings,
  localTimeZone,
  runRollover,
} from '../rollover';
import * as tasks from '../tasks';
import type { TaskItem } from '../../types';

describe('rollover service', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('rolloverSettings', () => {
    it('is disabled by default with default hour 3', () => {
      const cfg = rolloverSettings();
      expect(cfg.enabled).toBe(false);
      expect(cfg.afterHour).toBe(3);
    });

    it('updates settings', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 4 });
      const cfg = rolloverSettings();
      expect(cfg.enabled).toBe(true);
      expect(cfg.afterHour).toBe(4);
    });
  });

  describe('localTimeZone', () => {
    it('returns a non-empty string containing UTC offset', () => {
      const tz = localTimeZone();
      expect(tz).toContain('UTC');
      expect(typeof tz).toBe('string');
      expect(tz.length).toBeGreaterThan(3);
    });
  });

  describe('runRollover', () => {
    it('does nothing and performs no writes when disabled', async () => {
      await setRolloverSettings({ enabled: false, afterHour: 3 });

      const updateSpy = vi.spyOn(tasks, 'updateTask');
      const listSpy = vi.spyOn(tasks, 'listTasks');

      const now = new Date(2026, 8, 20, 10, 0, 0); // 10:00 > 03:00
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 0, cleared: 0 });
      expect(listSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('does nothing when enabled but before the specified hour', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const updateSpy = vi.spyOn(tasks, 'updateTask');
      const listSpy = vi.spyOn(tasks, 'listTasks');

      const now = new Date(2026, 8, 20, 2, 30, 0); // 02:30 < 03:00
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 0, cleared: 0 });
      expect(listSpy).not.toHaveBeenCalled();
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('moves an overdue unfinished task and clears startAt', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const mockTasks: TaskItem[] = [
        {
          id: 'task-1',
          title: 'Overdue task',
          done: false,
          priority: 0,
          position: 0,
          createdAt: '2026-09-18T10:00:00.000Z',
          dueDate: '2026-09-19', // yesterday
          startAt: '2026-09-19T09:00:00.000Z',
        },
      ];

      vi.spyOn(tasks, 'listTasks').mockResolvedValue(mockTasks);
      const updateSpy = vi.spyOn(tasks, 'updateTask').mockResolvedValue(mockTasks[0]);

      const now = new Date(2026, 8, 20, 4, 0, 0); // 2026-09-20 04:00
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 1, cleared: 1 });
      expect(updateSpy).toHaveBeenCalledTimes(1);
      expect(updateSpy).toHaveBeenCalledWith('task-1', {
        dueDate: '2026-09-20',
        startAt: null,
      });
    });

    it('moves an overdue task without startAt without incrementing cleared count', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const mockTasks: TaskItem[] = [
        {
          id: 'task-no-start',
          title: 'Overdue task without time slot',
          done: false,
          priority: 0,
          position: 0,
          createdAt: '2026-09-18T10:00:00.000Z',
          dueDate: '2026-09-19',
          startAt: null,
        },
      ];

      vi.spyOn(tasks, 'listTasks').mockResolvedValue(mockTasks);
      const updateSpy = vi.spyOn(tasks, 'updateTask').mockResolvedValue(mockTasks[0]);

      const now = new Date(2026, 8, 20, 4, 0, 0);
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 1, cleared: 0 });
      expect(updateSpy).toHaveBeenCalledWith('task-no-start', {
        dueDate: '2026-09-20',
        startAt: null,
      });
    });

    it('leaves tasks dated today untouched', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const mockTasks: TaskItem[] = [
        {
          id: 'task-today',
          title: 'Today task',
          done: false,
          priority: 0,
          position: 0,
          createdAt: '2026-09-20T01:00:00.000Z',
          dueDate: '2026-09-20',
          startAt: '2026-09-20T10:00:00.000Z',
        },
      ];

      vi.spyOn(tasks, 'listTasks').mockResolvedValue(mockTasks);
      const updateSpy = vi.spyOn(tasks, 'updateTask');

      const now = new Date(2026, 8, 20, 4, 0, 0);
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 0, cleared: 0 });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('leaves completed tasks untouched even if overdue', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const mockTasks: TaskItem[] = [
        {
          id: 'task-done',
          title: 'Finished yesterday',
          done: true,
          priority: 0,
          position: 0,
          createdAt: '2026-09-19T01:00:00.000Z',
          dueDate: '2026-09-19',
          completedAt: '2026-09-19T18:00:00.000Z',
        },
      ];

      vi.spyOn(tasks, 'listTasks').mockResolvedValue(mockTasks);
      const updateSpy = vi.spyOn(tasks, 'updateTask');

      const now = new Date(2026, 8, 20, 4, 0, 0);
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 0, cleared: 0 });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('leaves tasks without a dueDate untouched', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const mockTasks: TaskItem[] = [
        {
          id: 'task-undated',
          title: 'Backlog task',
          done: false,
          priority: 0,
          position: 0,
          createdAt: '2026-09-01T01:00:00.000Z',
          dueDate: null,
        },
      ];

      vi.spyOn(tasks, 'listTasks').mockResolvedValue(mockTasks);
      const updateSpy = vi.spyOn(tasks, 'updateTask');

      const now = new Date(2026, 8, 20, 4, 0, 0);
      const res = await runRollover(now);

      expect(res).toEqual({ moved: 0, cleared: 0 });
      expect(updateSpy).not.toHaveBeenCalled();
    });

    it('is idempotent: running twice moves once', async () => {
      await setRolloverSettings({ enabled: true, afterHour: 3 });

      const item: TaskItem = {
        id: 'task-idem',
        title: 'Overdue task',
        done: false,
        priority: 0,
        position: 0,
        createdAt: '2026-09-18T10:00:00.000Z',
        dueDate: '2026-09-19',
        startAt: '2026-09-19T09:00:00.000Z',
      };

      const taskStore = [item];
      vi.spyOn(tasks, 'listTasks').mockImplementation(async () => [...taskStore]);
      vi.spyOn(tasks, 'updateTask').mockImplementation(async (id, patch) => {
        const target = taskStore.find((t) => t.id === id);
        if (target) {
          if (patch.dueDate !== undefined) target.dueDate = patch.dueDate;
          if (patch.startAt !== undefined) target.startAt = patch.startAt;
        }
        return target!;
      });

      const now = new Date(2026, 8, 20, 4, 0, 0);

      // First run: moves
      const res1 = await runRollover(now);
      expect(res1).toEqual({ moved: 1, cleared: 1 });
      expect(taskStore[0].dueDate).toBe('2026-09-20');
      expect(taskStore[0].startAt).toBeNull();

      // Second run: already dated today, untouched
      const res2 = await runRollover(now);
      expect(res2).toEqual({ moved: 0, cleared: 0 });
    });
  });
});
