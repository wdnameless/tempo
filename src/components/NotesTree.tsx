import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Folder,
  FolderOpen,
  FileText,
  Calendar,
  RefreshCw,
  FolderSync,
  FolderPlus,
  FilePlus,
  ExternalLink,
  ChevronRight,
  ChevronDown,
  Edit2,
  Trash2,
  Check,
  X,
} from 'lucide-react';
import {
  listVault,
  createNoteFile,
  renameNoteFile,
  deleteNoteFile,
  createVaultFolder,
  ensureDailyNote,
  openVaultInExplorer,
  vaultRoot,
  setVaultRoot,
  pickVaultFolder,
  type VaultEntry,
} from '../services/vault';
import { reindexVault } from '../services/notes';
import { I18nService } from '../services/i18n';
import { IconButton } from './ui';

export interface NotesTreeProps {
  currentPath?: string | null;
  onSelectNote: (path: string) => void;
  onRefresh?: () => void;
  className?: string;
}

interface InlineActionState {
  type: 'create-note' | 'create-folder' | 'rename';
  targetPath?: string;
  parentFolder?: string;
  initialValue?: string;
}
function formatRootPath(p: string, maxLength = 26): string {
  if (!p || p.length <= maxLength) return p;
  const half = Math.floor((maxLength - 3) / 2);
  return `${p.slice(0, half)}...${p.slice(-half)}`;
}


interface ActionInputRowProps {
  type: 'create-note' | 'create-folder';
  placeholder: string;
  value: string;
  onChange: (val: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  paddingLeft?: number;
}

function ActionInputRow({
  type,
  placeholder,
  value,
  onChange,
  onSubmit,
  onCancel,
  paddingLeft,
}: ActionInputRowProps): React.ReactElement {
  return (
    <div
      className="flex items-center gap-1.5 py-1.5 px-3 text-xs bg-[var(--elevated)] border-b border-[var(--border)]"
      style={paddingLeft !== undefined ? { paddingLeft: `${paddingLeft}px` } : undefined}
    >
      {type === 'create-note' ? (
        <FileText size={13} className="text-[var(--text-muted)]" />
      ) : (
        <Folder size={14} className="text-[var(--text-muted)]" />
      )}
      <input
        type="text"
        autoFocus
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onSubmit();
          if (e.key === 'Escape') onCancel();
        }}
        className="flex-1 min-w-0 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-[var(--accent)]"
      />
      <button
        type="button"
        onClick={onSubmit}
        className="p-1 hover:text-[var(--accent)] text-[var(--text-muted)] cursor-pointer"
      >
        <Check size={12} />
      </button>
      <button
        type="button"
        onClick={onCancel}
        className="p-1 hover:text-[var(--text)] text-[var(--text-muted)] cursor-pointer"
      >
        <X size={12} />
      </button>
    </div>
  );
}

export function NotesTree({
  currentPath,
  onSelectNote,
  onRefresh,
  className = '',
}: NotesTreeProps): React.ReactElement {
  const t = I18nService.t();

  const [entries, setEntries] = useState<VaultEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsedFolders, setCollapsedFolders] = useState<Set<string>>(new Set());
  const [userExpandedFolders, setUserExpandedFolders] = useState<Set<string>>(new Set());
  const [actionState, setActionState] = useState<InlineActionState | null>(null);
  const [actionInputValue, setActionInputValue] = useState('');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rootPath, setRootPath] = useState<string>('');

  const expandedFolders = useMemo(() => {
    const res = new Set(userExpandedFolders);
    if (currentPath) {
      const parts = currentPath.split('/');
      let acc = '';
      for (let i = 0; i < parts.length - 1; i++) {
        acc = acc ? `${acc}/${parts[i]}` : parts[i];
        if (!collapsedFolders.has(acc)) {
          res.add(acc);
        }
      }
    }
    return res;
  }, [userExpandedFolders, collapsedFolders, currentPath]);

  const loadTree = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVault();
      setEntries(data);
    } catch (err) {
      console.error('Failed to list vault:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    void listVault().then((data) => {
      if (!cancelled) {
        setEntries(data);
        setLoading(false);
      }
    });
    void vaultRoot().then((root) => {
      if (!cancelled) {
        setRootPath(root);
      }
    }).catch(console.error);
    return () => {
      cancelled = true;
    };
  }, []);

  const toggleFolder = useCallback((folderPath: string) => {
    if (expandedFolders.has(folderPath)) {
      setCollapsedFolders((prev) => new Set(prev).add(folderPath));
      setUserExpandedFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
    } else {
      setCollapsedFolders((prev) => {
        const next = new Set(prev);
        next.delete(folderPath);
        return next;
      });
      setUserExpandedFolders((prev) => new Set(prev).add(folderPath));
    }
  }, [expandedFolders]);

  const handleToday = async () => {
    try {
      const todayIso = new Date().toISOString();
      const path = await ensureDailyNote(todayIso);
      await loadTree();
      onSelectNote(path);
      onRefresh?.();
    } catch (err) {
      console.error('Failed to open today note:', err);
    }
  };
  const handleChangeFolder = async () => {
    setErrorMessage(null);
    try {
      const picked = await pickVaultFolder();
      if (!picked) return; // User cancelled
      const normalized = await setVaultRoot(picked);
      setRootPath(normalized);
      await loadTree();
      await reindexVault();
      onRefresh?.();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };


  const handleRefresh = async () => {
    await loadTree();
    onRefresh?.();
  };

  const handleOpenExplorer = async () => {
    try {
      await openVaultInExplorer();
    } catch (err) {
      console.error('Failed to open vault in explorer:', err);
    }
  };

  const startAction = (
    type: InlineActionState['type'],
    parentFolder?: string,
    targetPath?: string,
    initialValue = ''
  ) => {
    setErrorMessage(null);
    setActionState({ type, parentFolder, targetPath, initialValue });
    setActionInputValue(initialValue);
    if (parentFolder) {
      setUserExpandedFolders((prev) => new Set(prev).add(parentFolder));
    }
  };

  const cancelAction = () => {
    setActionState(null);
    setActionInputValue('');
    setErrorMessage(null);
  };

  const submitAction = async () => {
    if (!actionState) return;
    const val = actionInputValue.trim();
    if (!val) {
      cancelAction();
      return;
    }

    setErrorMessage(null);
    try {
      if (actionState.type === 'create-note') {
        const fileName = val.toLowerCase().endsWith('.md') ? val : `${val}.md`;
        const filePath = actionState.parentFolder ? `${actionState.parentFolder}/${fileName}` : fileName;
        await createNoteFile(filePath, '');
        await loadTree();
        onSelectNote(filePath);
        onRefresh?.();
      } else if (actionState.type === 'create-folder') {
        const folderPath = actionState.parentFolder ? `${actionState.parentFolder}/${val}` : val;
        await createVaultFolder(folderPath);
        setUserExpandedFolders((prev) => new Set(prev).add(folderPath));
        await loadTree();
      } else if (actionState.type === 'rename' && actionState.targetPath) {
        const oldPath = actionState.targetPath;
        const isDir = !oldPath.toLowerCase().endsWith('.md');
        const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : '';
        let newName = val;
        if (!isDir && !newName.toLowerCase().endsWith('.md')) {
          newName = `${newName}.md`;
        }
        const newPath = parent ? `${parent}/${newName}` : newName;
        if (newPath !== oldPath) {
          await renameNoteFile(oldPath, newPath);
          await loadTree();
          if (currentPath === oldPath) {
            onSelectNote(newPath);
          }
          onRefresh?.();
        }
      }
      cancelAction();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    }
  };

  const handleDelete = async (entry: VaultEntry, e: React.MouseEvent) => {
    e.stopPropagation();
    const confirmed = window.confirm(t.vaultConfirmDelete.replace('{name}', entry.name));
    if (!confirmed) return;

    try {
      await deleteNoteFile(entry.path);
      await loadTree();
      onRefresh?.();
    } catch (err) {
      console.error('Failed to delete note file:', err);
    }
  };

  const renderEntry = (entry: VaultEntry, depth = 0) => {
    const isExpanded = expandedFolders.has(entry.path);
    const isSelected = currentPath === entry.path;
    const isRenaming = actionState?.type === 'rename' && actionState.targetPath === entry.path;

    return (
      <div key={entry.path} className="flex flex-col">
        {isRenaming ? (
          <div
            className="flex items-center gap-1.5 py-1 px-2 text-xs bg-[var(--elevated)] border-b border-[var(--border)]"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <input
              type="text"
              autoFocus
              data-testid="vault-rename-input"
              value={actionInputValue}
              onChange={(e) => setActionInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submitAction();
                if (e.key === 'Escape') cancelAction();
              }}
              className="flex-1 min-w-0 bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded px-1.5 py-0.5 text-xs focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => void submitAction()}
              className="p-1 hover:text-[var(--accent)] text-[var(--text-muted)] cursor-pointer"
            >
              <Check size={12} />
            </button>
            <button
              type="button"
              onClick={cancelAction}
              className="p-1 hover:text-[var(--text)] text-[var(--text-muted)] cursor-pointer"
            >
              <X size={12} />
            </button>
          </div>
        ) : (
          <div
            data-testid={`vault-entry-${entry.path}`}
            onClick={() => {
              if (entry.isDir) {
                toggleFolder(entry.path);
              } else {
                onSelectNote(entry.path);
              }
            }}
            className={`group flex items-center justify-between py-1.5 px-2 text-xs rounded-[6px] transition-colors cursor-pointer select-none ${
              isSelected
                ? 'bg-[var(--accent-soft)] text-[var(--accent)] font-medium'
                : 'hover:bg-[var(--elevated)] text-[var(--text)]'
            }`}
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
          >
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              {entry.isDir ? (
                <>
                  <span className="text-[var(--text-muted)] p-0.5">
                    {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </span>
                  {isExpanded ? (
                    <FolderOpen size={14} className="text-[var(--accent)] flex-shrink-0" />
                  ) : (
                    <Folder size={14} className="text-[var(--text-muted)] flex-shrink-0" />
                  )}
                  <span className="truncate">{entry.name}</span>
                </>
              ) : (
                <>
                  <FileText size={13} className="text-[var(--text-muted)] flex-shrink-0 ml-4" />
                  <span className="truncate">{entry.name.replace(/\.md$/i, '')}</span>
                </>
              )}
            </div>

            {/* Hover Actions */}
            <div className="hidden group-hover:flex items-center gap-0.5 ml-1 flex-shrink-0">
              {entry.isDir && (
                <>
                  <button
                    type="button"
                    title={t.vaultNewNote}
                    onClick={(e) => {
                      e.stopPropagation();
                      startAction('create-note', entry.path);
                    }}
                    className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    <FilePlus size={12} />
                  </button>
                  <button
                    type="button"
                    title={t.vaultNewFolder}
                    onClick={(e) => {
                      e.stopPropagation();
                      startAction('create-folder', entry.path);
                    }}
                    className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
                  >
                    <FolderPlus size={12} />
                  </button>
                </>
              )}
              <button
                type="button"
                data-testid={`vault-rename-${entry.path}`}
                title={t.vaultRename}
                onClick={(e) => {
                  e.stopPropagation();
                  startAction('rename', undefined, entry.path, entry.name.replace(/\.md$/i, ''));
                }}
                className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text)] cursor-pointer"
              >
                <Edit2 size={12} />
              </button>
              <button
                type="button"
                data-testid={`vault-delete-${entry.path}`}
                title={t.vaultDelete}
                onClick={(e) => void handleDelete(entry, e)}
                className="p-1 rounded hover:bg-[var(--surface)] text-[var(--text-muted)] hover:text-[var(--text-danger,#EF4444)] cursor-pointer"
              >
                <Trash2 size={12} />
              </button>
            </div>
          </div>
        )}

        {/* Children of Directory */}
        {entry.isDir && isExpanded && (
          <div className="flex flex-col">
            {/* Inline Action under folder */}
            {actionState && actionState.parentFolder === entry.path && (actionState.type === 'create-note' || actionState.type === 'create-folder') && (
              <ActionInputRow
                type={actionState.type}
                placeholder={actionState.type === 'create-note' ? t.vaultNewNote : t.vaultNewFolder}
                value={actionInputValue}
                onChange={setActionInputValue}
                onSubmit={() => void submitAction()}
                onCancel={cancelAction}
                paddingLeft={(depth + 1) * 14 + 8}
              />
            )}
            {entry.children.map((child) => renderEntry(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const totalFiles = useMemo(() => {
    let count = 0;
    const walk = (nodes: VaultEntry[]) => {
      for (const n of nodes) {
        if (!n.isDir) count++;
        else walk(n.children);
      }
    };
    walk(entries);
    return count;
  }, [entries]);

  return (
    <div
      data-testid="notes-tree"
      className={`flex flex-col h-full overflow-hidden bg-[var(--surface)] select-none text-[var(--text)] ${className}`}
    >
      {/* Header Toolbar */}
      <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2 bg-[var(--surface)]">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)]">
            {t.vaultTitle}
          </span>
          <span
            className="text-[10px] px-1.5 py-0.2 rounded-full font-mono font-medium"
            style={{
              backgroundColor: 'var(--elevated)',
              color: 'var(--text-muted)',
              border: '1px solid var(--border)',
            }}
          >
            {totalFiles}
          </span>
        </div>

        <div className="flex items-center gap-1">
          {/* Today Button */}
          <span data-testid="vault-today-btn">
            <IconButton
              icon={<Calendar size={14} />}
              label={t.vaultToday}
              onClick={() => void handleToday()}
            />
          </span>
          {/* New Note Button */}
          <span data-testid="vault-new-note-btn">
            <IconButton
              icon={<FilePlus size={14} />}
              label={t.vaultNewNote}
              onClick={() => startAction('create-note')}
            />
          </span>
          {/* New Folder Button */}
          <span data-testid="vault-new-folder-btn">
            <IconButton
              icon={<FolderPlus size={14} />}
              label={t.vaultNewFolder}
              onClick={() => startAction('create-folder')}
            />
          </span>
          {/* Refresh Button */}
          <span data-testid="vault-refresh-btn">
            <IconButton
              icon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
              label={t.vaultRefresh}
              onClick={() => void handleRefresh()}
            />
          </span>
        </div>
      </div>
      {/* Vault Root Path & Folder Actions Row (R03) */}
      <div
        data-testid="vault-root-bar"
        className="flex items-center justify-between border-b border-[var(--border)] px-3 py-1.5 bg-[var(--elevated)]/50 text-xs select-none"
      >
        <div
          className="flex items-center gap-1.5 min-w-0 flex-1 mr-2 text-[var(--text-muted)] hover:text-[var(--text)] transition-colors"
          title={rootPath || t.vaultFolder}
        >
          <Folder size={13} className="text-[var(--accent)] flex-shrink-0" />
          <span className="truncate font-mono text-[11px] select-all">
            {rootPath ? formatRootPath(rootPath) : '...'}
          </span>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Change Folder Button */}
          <span data-testid="vault-change-folder-btn">
            <IconButton
              icon={<FolderSync size={13} />}
              label={t.vaultChangeFolder}
              onClick={() => void handleChangeFolder()}
            />
          </span>
          {/* Open in Explorer Button */}
          <span data-testid="vault-open-folder-btn">
            <IconButton
              icon={<ExternalLink size={13} />}
              label={t.vaultOpenFolder}
              onClick={() => void handleOpenExplorer()}
            />
          </span>
        </div>
      </div>


      {/* Error Banner */}
      {errorMessage && (
        <div className="px-3 py-1.5 text-xs bg-[var(--accent-amber,#F59E0B)]/10 text-[var(--accent-amber,#F59E0B)] border-b border-[var(--border)] flex items-center justify-between">
          <span className="truncate">{errorMessage}</span>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            className="p-0.5 hover:opacity-75 cursor-pointer"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Root Inline Action */}
      {actionState && !actionState.parentFolder && !actionState.targetPath && (actionState.type === 'create-note' || actionState.type === 'create-folder') && (
        <ActionInputRow
          type={actionState.type}
          placeholder={actionState.type === 'create-note' ? t.vaultNewNote : t.vaultNewFolder}
          value={actionInputValue}
          onChange={setActionInputValue}
          onSubmit={() => void submitAction()}
          onCancel={cancelAction}
        />
      )}

      {/* Tree Content */}
      <div className="flex-1 overflow-y-auto p-1.5 space-y-0.5">
        {loading && entries.length === 0 ? (
          <div className="p-4 text-center text-xs text-[var(--text-muted)]">...</div>
        ) : entries.length === 0 ? (
          <div className="p-4 text-center text-xs text-[var(--text-muted)]">
            <p>{t.vaultEmptyTree}</p>
            <button
              type="button"
              onClick={() => startAction('create-note')}
              className="mt-2 text-xs text-[var(--accent)] hover:underline cursor-pointer"
            >
              {t.vaultNewNote}
            </button>
          </div>
        ) : (
          entries.map((entry) => renderEntry(entry, 0))
        )}
      </div>
    </div>
  );
}
