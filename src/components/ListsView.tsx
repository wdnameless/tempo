import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Plus,
  Trash2,
  Edit2,
  CheckCircle2,
  Circle,
  ArrowRight,
  List as ListIcon,
} from 'lucide-react';
import type { TaskItem, ListItem } from '../types';
import {
  listLists,
  createList,
  renameList,
  deleteList,
  listTasks,
  createTask,
  updateTask,
  toggleTask,
  deleteTask,
  moveListItemToTask,
} from '../services/tasks';
import { I18nService } from '../services/i18n';
import { onDataChanged, emitDataChanged } from '../services/appEvents';
import { Row, IconButton } from './ui';

export function ListsView() {
  const t = I18nService.t();
  const [lists, setLists] = useState<ListItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [selectedListId, setSelectedListId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newListDraft, setNewListDraft] = useState('');
  const [newItemDraft, setNewItemDraft] = useState('');
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editListNameDraft, setEditListNameDraft] = useState('');
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [editItemTitleDraft, setEditItemTitleDraft] = useState('');

  const reload = useCallback(async () => {
    try {
      const [fetchedLists, fetchedTasks] = await Promise.all([listLists(), listTasks()]);
      setLists(fetchedLists);
      setTasks(fetchedTasks);
      if (fetchedLists.length > 0) {
        setSelectedListId((prev) => (prev && fetchedLists.some((l) => l.id === prev) ? prev : fetchedLists[0].id));
      } else {
        setSelectedListId(null);
      }
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
      if (table === 'lists' || table === 'tasks') {
        void reload();
      }
    });
    return unsubscribe;
  }, [reload]);

  // Handle reveal event from search palette
  useEffect(() => {
    const handleReveal = (e: Event) => {
      const custom = e as CustomEvent<{ id?: string; kind?: string }>;
      if (custom.detail?.id && custom.detail?.kind === 'list') {
        setSelectedListId(custom.detail.id);
      }
    };
    window.addEventListener('tempo:reveal', handleReveal);
    return () => window.removeEventListener('tempo:reveal', handleReveal);
  }, []);

  const handleCreateList = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newListDraft.trim();
    if (!name) return;
    setNewListDraft('');
    const created = await createList(name);
    setSelectedListId(created.id);
    emitDataChanged('lists', [created.id]);
    await reload();
  };

  const handleRenameList = async (id: string) => {
    const name = editListNameDraft.trim();
    if (!name) {
      setEditingListId(null);
      return;
    }
    await renameList(id, name);
    setEditingListId(null);
    emitDataChanged('lists', [id]);
    await reload();
  };

  const handleDeleteList = async (id: string) => {
    await deleteList(id);
    emitDataChanged('lists', [id]);
    await reload();
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedListId) return;
    const title = newItemDraft.trim();
    if (!title) return;
    setNewItemDraft('');
    await createTask({ title, listId: selectedListId });
    emitDataChanged('tasks');
    await reload();
  };

  const handleToggleItem = async (id: string) => {
    await toggleTask(id);
    emitDataChanged('tasks', [id]);
    await reload();
  };

  const handleDeleteItem = async (id: string) => {
    await deleteTask(id);
    emitDataChanged('tasks', [id]);
    await reload();
  };

  const handleMoveToTask = async (id: string) => {
    await moveListItemToTask(id);
    emitDataChanged('tasks', [id]);
    emitDataChanged('lists');
    await reload();
  };

  const handleRenameItem = async (id: string) => {
    const title = editItemTitleDraft.trim();
    setEditingItemId(null);
    if (!title) return;
    const current = tasks.find((t) => t.id === id);
    if (current && current.title === title) return;
    await updateTask(id, { title });
    emitDataChanged('tasks', [id]);
    await reload();
  };

  const currentList = useMemo(
    () => lists.find((l) => l.id === selectedListId),
    [lists, selectedListId]
  );

  const currentItems = useMemo(
    () => (selectedListId ? tasks.filter((t) => t.listId === selectedListId) : []),
    [tasks, selectedListId]
  );

  return (
    <div className="flex h-full w-full overflow-hidden">
      {/* Sidebar: Lists directory */}
      <div
        className="w-64 flex-shrink-0 flex flex-col border-r overflow-y-auto"
        style={{
          borderColor: 'var(--border, rgba(255,255,255,0.08))',
          backgroundColor: 'var(--surface-subtle, rgba(0,0,0,0.02))',
        }}
      >
        <div className="p-4 border-b flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold tracking-wide uppercase" style={{ color: 'var(--text-muted)' }}>
            {t.titleLists || t.navLists}
          </h2>

          <form onSubmit={handleCreateList} className="flex gap-1.5">
            <input
              type="text"
              placeholder={t.listsNew}
              value={newListDraft}
              onChange={(e) => setNewListDraft(e.target.value)}
              className="flex-1 px-2.5 py-1.5 text-xs rounded bg-transparent focus:outline-none"
              style={{
                border: '1px solid var(--border, rgba(255,255,255,0.1))',
                color: 'var(--text-normal)',
              }}
            />
            <IconButton
              icon={<Plus size={14} />}
              label={t.listsNew}
              onClick={(e) => void handleCreateList(e)}
            />
          </form>
        </div>

        {/* List of lists */}
        <div className="flex flex-col py-2 flex-1">
          {loading ? (
            <div className="p-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.commonLoading}
            </div>
          ) : lists.length === 0 ? (
            <div className="p-4 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
              {t.listsEmpty}
            </div>
          ) : (
            lists.map((list) => {
              const isSelected = list.id === selectedListId;
              const isEditing = editingListId === list.id;
              const itemCount = tasks.filter((t) => t.listId === list.id).length;

              return (
                <div
                  key={list.id}
                  className="group flex items-center justify-between px-3 py-2 mx-1.5 rounded text-xs transition-colors cursor-pointer"
                  style={{
                    backgroundColor: isSelected
                      ? 'var(--surface-hover, rgba(255,255,255,0.08))'
                      : 'transparent',
                    color: isSelected ? 'var(--text-normal)' : 'var(--text-muted)',
                  }}
                  onClick={() => setSelectedListId(list.id)}
                >
                  <div className="flex items-center gap-2 flex-1 min-w-0 mr-2">
                    <ListIcon size={14} className="flex-shrink-0" />
                    {isEditing ? (
                      <input
                        type="text"
                        autoFocus
                        value={editListNameDraft}
                        onChange={(e) => setEditListNameDraft(e.target.value)}
                        onBlur={() => void handleRenameList(list.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void handleRenameList(list.id);
                          if (e.key === 'Escape') setEditingListId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="w-full px-1 py-0.5 rounded bg-transparent focus:outline-none"
                        style={{
                          border: '1px solid var(--border)',
                          color: 'var(--text-normal)',
                        }}
                      />
                    ) : (
                      <span className="truncate font-medium">{list.name}</span>
                    )}
                  </div>

                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isEditing && (
                      <IconButton
                        icon={<Edit2 size={12} />}
                        label="Rename list"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingListId(list.id);
                          setEditListNameDraft(list.name);
                        }}
                      />
                    )}
                    <IconButton
                      icon={<Trash2 size={12} />}
                      label={t.listsDelete}
                      onClick={(e) => {
                        e.stopPropagation();
                        void handleDeleteList(list.id);
                      }}
                    />
                  </div>

                  <span
                    className="text-xs px-1.5 py-0.5 rounded ml-1 group-hover:hidden"
                    style={{
                      backgroundColor: 'var(--surface, rgba(255,255,255,0.03))',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {itemCount}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Main panel: Selected List Checklist */}
      <div className="flex-1 flex flex-col h-full overflow-y-auto p-6 max-w-3xl mx-auto w-full">
        {currentList ? (
          <div className="flex flex-col gap-6">
            <div className="flex items-center justify-between pb-3 border-b" style={{ borderColor: 'var(--border)' }}>
              <div>
                <h1 className="text-xl font-bold tracking-tight" style={{ color: 'var(--text-normal)' }}>
                  {currentList.name}
                </h1>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
                  {currentItems.length} {t.titleLists?.toLowerCase() || 'items'}
                </p>
              </div>

              <IconButton
                icon={<Trash2 size={16} />}
                label={t.listsDelete}
                onClick={() => handleDeleteList(currentList.id)}
              />
            </div>

            {/* Add item form */}
            <form onSubmit={handleCreateItem} className="relative flex items-center">
              <input
                type="text"
                placeholder={t.tasksNew}
                value={newItemDraft}
                onChange={(e) => setNewItemDraft(e.target.value)}
                className="w-full px-4 py-2.5 rounded-lg text-sm bg-transparent focus:outline-none"
                style={{
                  backgroundColor: 'var(--surface, rgba(255,255,255,0.03))',
                  border: '1px solid var(--border, rgba(255,255,255,0.1))',
                  color: 'var(--text-normal)',
                }}
              />
              <button
                type="submit"
                disabled={!newItemDraft.trim()}
                className="absolute right-2 px-3 py-1 text-xs font-medium rounded transition-opacity disabled:opacity-30"
                style={{
                  backgroundColor: 'var(--primary, #3B82F6)',
                  color: '#FFFFFF',
                }}
              >
                {t.commonAdd}
              </button>
            </form>

            {/* Items list */}
            <div className="flex flex-col rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
              {currentItems.length === 0 ? (
                <div className="p-8 text-center text-sm" style={{ color: 'var(--text-muted)' }}>
                  {t.listsEmpty}
                </div>
              ) : (
                <div className="flex flex-col divide-y divide-[var(--border)]">
                  {currentItems.map((item) => {
                    const isEditingItem = editingItemId === item.id;
                    return (
                      <Row
                        key={item.id}
                        control={
                          <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                            <IconButton
                              icon={item.done ? <CheckCircle2 size={16} /> : <Circle size={16} />}
                              label={item.done ? t.tasksCompleted : t.tasksNew}
                              onClick={() => void handleToggleItem(item.id)}
                            />
                            {!isEditingItem && (
                              <IconButton
                                icon={<Edit2 size={12} />}
                                label="Rename item"
                                onClick={() => {
                                  setEditingItemId(item.id);
                                  setEditItemTitleDraft(item.title);
                                }}
                              />
                            )}
                            <button
                              type="button"
                              onClick={() => handleMoveToTask(item.id)}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded transition-colors"
                              style={{
                                backgroundColor: 'var(--surface-hover, rgba(255,255,255,0.05))',
                                color: 'var(--text-normal)',
                              }}
                              title={t.listsToTask}
                            >
                              <span>{t.listsToTask}</span>
                              <ArrowRight size={12} />
                            </button>
                            <IconButton
                              icon={<Trash2 size={14} />}
                              label={t.tasksDelete}
                              onClick={() => void handleDeleteItem(item.id)}
                            />
                          </div>
                        }
                        label={
                          isEditingItem ? (
                            <input
                              type="text"
                              autoFocus
                              value={editItemTitleDraft}
                              onChange={(e) => setEditItemTitleDraft(e.target.value)}
                              onBlur={() => void handleRenameItem(item.id)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') void handleRenameItem(item.id);
                                if (e.key === 'Escape') setEditingItemId(null);
                              }}
                              className="w-full px-2 py-1 text-sm font-medium rounded bg-transparent focus:outline-none"
                              style={{
                                border: '1px solid var(--border)',
                                color: 'var(--text-normal)',
                              }}
                            />
                          ) : (
                            <span
                              onDoubleClick={() => {
                                setEditingItemId(item.id);
                                setEditItemTitleDraft(item.title);
                              }}
                              className={`text-sm font-medium cursor-pointer ${
                                item.done ? 'line-through text-muted opacity-60' : ''
                              }`}
                              style={{ color: 'var(--text-normal)' }}
                            >
                              {item.title}
                            </span>
                          )
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-muted)' }}>
            {t.listsEmpty}
          </div>
        )}
      </div>
    </div>
  );
}
