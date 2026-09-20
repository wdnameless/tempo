import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AICompilerService } from '../aiCompiler';
import * as tasksService from '../tasks';
import * as notesService from '../notes';
import { TaskItem, ListItem } from '../../types';

describe('AICompilerService (R36)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });


  it('builds a day plan from a sentence and produces expected tasks', async () => {
    const createdTasks: TaskItem[] = [];
    vi.spyOn(tasksService, 'createTask').mockImplementation(async (input) => {
      const task: TaskItem = {
        id: `t-${createdTasks.length + 1}`,
        title: input.title,
        done: false,
        priority: input.priority ?? 0,
        dueDate: input.dueDate ?? null,
        startAt: input.startAt ?? null,
        plannedMinutes: input.plannedMinutes ?? null,
        completedAt: null,
        listId: input.listId ?? null,
        parentId: input.parentId ?? null,
        position: createdTasks.length,
        createdAt: '2026-09-20T10:00:00Z',
      };
      createdTasks.push(task);
      return task;
    });

    const fixedDate = new Date('2026-09-20T08:00:00Z');
    const actionPlan = AICompilerService.compileLocalIntent('распланируй утро: зарядка, отчёт, созвон', fixedDate);

    expect(actionPlan.action).toBe('build_plan');
    expect(actionPlan.plan?.tasks).toHaveLength(3);
    expect(actionPlan.plan?.tasks.map((t) => t.title)).toEqual(['зарядка', 'отчёт', 'созвон']);

    const outcome = await AICompilerService.executeAction(actionPlan);
    expect(outcome.action).toBe('build_plan');
    expect(outcome.createdTasks).toHaveLength(3);
    expect(tasksService.createTask).toHaveBeenCalledTimes(3);
    expect(tasksService.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'зарядка', dueDate: '2026-09-20' }),
    );
  });

  it('creates task through tasksService with optional due date', async () => {
    vi.spyOn(tasksService, 'createTask').mockResolvedValueOnce({
      id: 't-123',
      title: 'Купить молоко',
      done: false,
      priority: 0,
      dueDate: '2026-09-20',
      startAt: null,
      plannedMinutes: null,
      completedAt: null,
      listId: null,
      position: 0,
      createdAt: '2026-09-20T10:00:00Z',
    });

    const fixedDate = new Date('2026-09-20T08:00:00Z');
    const plan = AICompilerService.compileLocalIntent('создай задачу Купить молоко на сегодня', fixedDate);
    expect(plan.action).toBe('create_task');
    expect(plan.task?.title).toBe('Купить молоко');

    const outcome = await AICompilerService.executeAction(plan);
    expect(outcome.createdTasks?.[0].title).toBe('Купить молоко');
    expect(tasksService.createTask).toHaveBeenCalledWith({
      title: 'Купить молоко',
      dueDate: '2026-09-20',
      listId: null,
      priority: 0,
    });
  });

  it('correctly parses and strips relative dates (завтра, на завтра, послезавтра, today, tomorrow)', () => {
    const fixedDate = new Date('2026-09-20T08:00:00Z');

    // 1. Bare "завтра"
    const p1 = AICompilerService.compileLocalIntent('создай задачу купить хлеб завтра', fixedDate);
    expect(p1.task?.dueDate).toBe('2026-09-21');
    expect(p1.task?.title).toBe('купить хлеб');

    // 2. "на завтра"
    const p2 = AICompilerService.compileLocalIntent('создай задачу купить хлеб на завтра', fixedDate);
    expect(p2.task?.dueDate).toBe('2026-09-21');
    expect(p2.task?.title).toBe('купить хлеб');

    // 3. "послезавтра" (+2 days)
    const p3 = AICompilerService.compileLocalIntent('добавь задачу подготовить презентацию послезавтра', fixedDate);
    expect(p3.task?.dueDate).toBe('2026-09-22');
    expect(p3.task?.title).toBe('подготовить презентацию');

    // 4. "на послезавтра"
    const p4 = AICompilerService.compileLocalIntent('создай задачу отчет на послезавтра', fixedDate);
    expect(p4.task?.dueDate).toBe('2026-09-22');
    expect(p4.task?.title).toBe('отчет');

    // 5. Bare "сегодня"
    const p5 = AICompilerService.compileLocalIntent('задача: позвонить врачу сегодня', fixedDate);
    expect(p5.task?.dueDate).toBe('2026-09-20');
    expect(p5.task?.title).toBe('позвонить врачу');

    // 6. English "tomorrow"
    const p6 = AICompilerService.compileLocalIntent('create task buy groceries tomorrow', fixedDate);
    expect(p6.task?.dueDate).toBe('2026-09-21');
    expect(p6.task?.title).toBe('buy groceries');

    // 7. English "today"
    const p7 = AICompilerService.compileLocalIntent('add task call mom today', fixedDate);
    expect(p7.task?.dueDate).toBe('2026-09-20');
    expect(p7.task?.title).toBe('call mom');
  });

  it('does not offer or resurrect a deleted list when naming a list', async () => {
    // listLists() returns only active non-deleted lists from repo.all()
    const activeLists: ListItem[] = [
      { id: 'list-active', name: 'Дом', color: '#ff0000', position: 0, createdAt: '2026-09-20T00:00:00Z' },
    ];
    vi.spyOn(tasksService, 'listLists').mockResolvedValue(activeLists);
    const createTaskSpy = vi.spyOn(tasksService, 'createTask').mockResolvedValue({
      id: 't-99',
      title: 'Задача',
      done: false,
      priority: 0,
      dueDate: null,
      startAt: null,
      plannedMinutes: null,
      completedAt: null,
      listId: null,
      position: 0,
      createdAt: '2026-09-20T10:00:00Z',
    });

    // Request naming a deleted list 'Архив' (which is not in activeLists)
    const plan = {
      action: 'create_task' as const,
      explanation: 'Создать задачу',
      task: {
        title: 'Старый документ',
        listName: 'Архив',
      },
    };

    await AICompilerService.executeAction(plan);
    // listId must remain null because 'Архив' does not exist among active lists
    expect(createTaskSpy).toHaveBeenCalledWith({
      title: 'Старый документ',
      dueDate: null,
      listId: null,
      priority: 0,
    });
  });

  it('handles malformed model response safely without breaking the UI', () => {
    const malformed = 'Not JSON at all, totally broken response';
    const plan = AICompilerService.parseActionJson(malformed);
    expect(plan.action).toBe('noop');
    expect(plan.explanation).toContain('ошибка формата');
  });

  it('removed abilities are gone — old commands do nothing destructive', () => {
    // A command that previously hid buttons or panels now does nothing destructive
    const plan = AICompilerService.compileLocalIntent('скрой кнопки и режим сна');
    expect(plan.action).toBe('noop');
    expect(plan).not.toHaveProperty('ui');
    expect(plan).not.toHaveProperty('directions');
  });

  it('creates list through tasksService createList', async () => {
    vi.spyOn(tasksService, 'createList').mockResolvedValueOnce({
      id: 'l-1',
      name: 'Покупки',
      color: null,
      position: 1,
      createdAt: '2026-09-20T00:00:00Z',
    });

    const plan = AICompilerService.compileLocalIntent('создай список Покупки');
    expect(plan.action).toBe('create_list');
    expect(plan.list?.name).toBe('Покупки');

    const outcome = await AICompilerService.executeAction(plan);
    expect(outcome.createdList?.name).toBe('Покупки');
    expect(tasksService.createList).toHaveBeenCalledWith('Покупки', null);
  });

  it('creates note through notesService createNote', async () => {
    vi.spyOn(notesService, 'createNote').mockResolvedValueOnce({
      id: 'n-1',
      title: 'Идея',
      body: 'Текст заметки',
      pinned: false,
      createdAt: '2026-09-20T10:00:00Z',
      updatedAt: '2026-09-20T10:00:00Z',
    });

    const plan = AICompilerService.compileLocalIntent('создай заметку Идея\nТекст заметки');
    expect(plan.action).toBe('create_note');
    expect(plan.note?.title).toBe('Идея');
    expect(plan.note?.body).toBe('Текст заметки');

    const outcome = await AICompilerService.executeAction(plan);
    expect(outcome.createdNote?.title).toBe('Идея');
    expect(notesService.createNote).toHaveBeenCalledWith({
      title: 'Идея',
      body: 'Текст заметки',
    });
  });
});
