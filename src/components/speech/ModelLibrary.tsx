import React, { useState, useEffect, useMemo, useCallback } from 'react';
import {
  Search,
  RefreshCw,
  FolderOpen,
  Upload,
  HardDrive,
} from 'lucide-react';
import {
  listModels,
  downloadModel,
  cancelDownload,
  downloadProgress,
  deleteModel,
  rescanModels,
  importModel,
  openModelsDir,
  freeDiskSpace,
  setEngine,
  type ModelInfo,
  type DownloadProgress,
} from '../../services/stt';
import { onSttEvent } from '../../services/sttEvents';
import { I18nService } from '../../services/i18n';
import { ModelCard } from './ModelCard';
import { DownloadBar } from './DownloadBar';
import { formatBytes, groupAndSortModels } from './utils';

export interface ModelLibraryProps {
  activeModelId: string | null;
  onSelectModel: (modelId: string) => void;
  disabled?: boolean;
}

type StatusFilter = 'all' | 'installed' | 'recommended';
type SizeFilter = 'all' | 'small' | 'medium' | 'large';

export const ModelLibrary: React.FC<ModelLibraryProps> = ({
  activeModelId,
  onSelectModel,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sizeFilter] = useState<SizeFilter>('all');
  const [languageFilter, setLanguageFilter] = useState<string>('all');
  const [freeDisk, setFreeDisk] = useState<number | null>(null);
  const [isRescanning, setIsRescanning] = useState(false);
  const [loading, setLoading] = useState(true);
  const [importPath, setImportPath] = useState<string | null>(null);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const fetchModelsAndDisk = useCallback(async () => {
    try {
      const [list, space, progressList] = await Promise.all([
        listModels(),
        freeDiskSpace(),
        downloadProgress().catch(() => [] as DownloadProgress[]),
      ]);
      setModels(list);
      setFreeDisk(space);

      const map: Record<string, DownloadProgress> = {};
      for (const p of progressList) {
        const id = p.modelId || p.model_id;
        if (id) map[id] = p;
      }
      setDownloads(map);
    } catch (err) {
      console.error('Failed to load speech models:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      listModels(),
      freeDiskSpace(),
      downloadProgress().catch(() => [] as DownloadProgress[]),
    ])
      .then(([list, space, progressList]) => {
        if (!active) return;
        setModels(list);
        setFreeDisk(space);
        const map: Record<string, DownloadProgress> = {};
        for (const p of progressList) {
          const id = p.modelId || p.model_id;
          if (id) map[id] = p;
        }
        setDownloads(map);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load speech models:', err);
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  // Subscribe to backend STT events
  useEffect(() => {
    const unsubscribe = onSttEvent((e) => {
      if (e.type === 'model-progress') {
        const id = e.progress.modelId || e.progress.model_id;
        if (id) {
          setDownloads((prev) => ({ ...prev, [id]: e.progress }));
        }
      } else if (e.type === 'model-complete') {
        setDownloads((prev) => {
          const next = { ...prev };
          delete next[e.modelId];
          return next;
        });
        fetchModelsAndDisk();
      } else if (e.type === 'model-failed') {
        setDownloads((prev) => {
          const next = { ...prev };
          delete next[e.modelId];
          return next;
        });
      } else if (e.type === 'models-updated') {
        fetchModelsAndDisk();
      }
    });

    return unsubscribe;
  }, [fetchModelsAndDisk]);

  const handleRescan = async () => {
    setIsRescanning(true);
    try {
      const updated = await rescanModels();
      setModels(updated);
      const space = await freeDiskSpace();
      setFreeDisk(space);
    } catch (err) {
      console.error('Rescan failed:', err);
    } finally {
      setIsRescanning(false);
    }
  };

  const handleDownload = async (modelId: string, quant?: string) => {
    try {
      // Optimistic download bar
      setDownloads((prev) => ({
        ...prev,
        [modelId]: {
          model_id: modelId,
          modelId,
          received: 0,
          total: 100,
          percentage: 0,
          phase: 'downloading',
        },
      }));
      await downloadModel(modelId, quant);
    } catch (err) {
      console.error('Failed to start download:', err);
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    }
  };

  const handleCancelDownload = async (modelId: string) => {
    try {
      await cancelDownload(modelId);
      setDownloads((prev) => {
        const next = { ...prev };
        delete next[modelId];
        return next;
      });
    } catch (err) {
      console.error('Failed to cancel download:', err);
    }
  };

  const handleDelete = async (modelId: string) => {
    try {
      await deleteModel(modelId);
      await fetchModelsAndDisk();
    } catch (err) {
      console.error('Failed to delete model:', err);
    }
  };

  const handleSelect = async (modelId: string) => {
    try {
      await setEngine('local', modelId);
      onSelectModel(modelId);
    } catch (err) {
      console.error('Failed to set speech model:', err);
    }
  };

  const handleImport = async () => {
    if (!importPath?.trim()) return;
    setImportError(null);
    try {
      await importModel(importPath.trim());
      setShowImportDialog(false);
      setImportPath(null);
      await fetchModelsAndDisk();
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  // Filter and search models
  const filteredModels = useMemo(() => {
    return models.filter((m) => {
      // Search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesName = m.name?.toLowerCase().includes(q);
        const matchesDesc = m.description?.toLowerCase().includes(q);
        const matchesId = m.id.toLowerCase().includes(q);
        if (!matchesName && !matchesDesc && !matchesId) return false;
      }

      // Status
      if (statusFilter === 'installed' && !m.installed) return false;
      if (statusFilter === 'recommended' && !m.recommended) return false;

      // Size
      if (sizeFilter === 'small' && m.bytes > 150 * 1024 * 1024) return false;
      if (sizeFilter === 'medium' && (m.bytes <= 150 * 1024 * 1024 || m.bytes > 600 * 1024 * 1024)) return false;
      if (sizeFilter === 'large' && m.bytes <= 600 * 1024 * 1024) return false;

      // Language
      if (languageFilter === 'en') {
        const isEnglishOnly = m.languages?.length === 1 && m.languages[0] === 'en';
        if (!isEnglishOnly) return false;
      } else if (languageFilter === 'multilingual') {
        const isMulti = (m.languages?.length ?? 0) > 1 || (m.languageCount ?? 0) > 1;
        if (!isMulti) return false;
      }

      return true;
    });
  }, [models, searchQuery, statusFilter, sizeFilter, languageFilter]);

  const groupedModels = useMemo(() => {
    return groupAndSortModels(filteredModels);
  }, [filteredModels]);

  const activeDownloadsList = useMemo(() => {
    return Object.values(downloads).filter(
      (d) => d.phase === 'downloading' || d.phase === 'verifying'
    );
  }, [downloads]);

  return (
    <div className="space-y-4">
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-[10px] border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-2">
          {freeDisk !== null && freeDisk > 0 && (
            <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
              <HardDrive className="w-3.5 h-3.5" />
              <span>
                {t.settingsSpeechModelsFreeDisk}: <strong className="font-mono text-[var(--text)]">{formatBytes(freeDisk)}</strong>
              </span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleRescan}
            disabled={isRescanning || disabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[6px] border hover:bg-[var(--elevated)] transition-colors cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title={t.settingsSpeechModelsRescan}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRescanning ? 'animate-spin' : ''}`} />
            <span>{t.settingsSpeechModelsRescan}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowImportDialog(true)}
            disabled={disabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[6px] border hover:bg-[var(--elevated)] transition-colors cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title={t.settingsSpeechModelsImport}
          >
            <Upload className="w-3.5 h-3.5" />
            <span>{t.settingsSpeechModelsImport}</span>
          </button>

          <button
            type="button"
            onClick={() => openModelsDir()}
            disabled={disabled}
            className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-[6px] border hover:bg-[var(--elevated)] transition-colors cursor-pointer"
            style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            title={t.settingsSpeechModelsOpenDir}
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>{t.settingsSpeechModelsOpenDir}</span>
          </button>
        </div>
      </div>

      {/* Active Downloads Bar */}
      {activeDownloadsList.length > 0 && (
        <div className="space-y-2">
          {activeDownloadsList.map((prog) => {
            const id = prog.modelId || prog.model_id;
            const model = models.find((m) => m.id === id);
            return (
              <DownloadBar
                key={id}
                progress={prog}
                modelName={model?.name || id}
                onCancel={handleCancelDownload}
              />
            );
          })}
        </div>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5">
        {/* Search */}
        <div className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-muted)' }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={t.settingsSpeechModelsSearch}
            className="w-full pl-9 pr-3 py-1.5 text-xs rounded-[8px] border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={{
              backgroundColor: 'var(--surface)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          />
        </div>

        {/* Status Filter */}
        <div
          className="inline-flex p-1 rounded-[8px] border gap-1 shrink-0"
          style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
        >
          {(['all', 'installed', 'recommended'] as StatusFilter[]).map((st) => (
            <button
              key={st}
              type="button"
              onClick={() => setStatusFilter(st)}
              className={`px-2.5 py-1 text-xs font-medium rounded-[6px] transition-colors cursor-pointer ${
                statusFilter === st
                  ? 'bg-[var(--accent)] text-[var(--bg)] shadow-xs'
                  : 'text-[var(--text-muted)] hover:text-[var(--text)]'
              }`}
            >
              {st === 'all'
                ? t.settingsSpeechModelsFilterAll
                : st === 'installed'
                ? t.settingsSpeechModelsFilterInstalled
                : t.settingsSpeechModelsFilterRecommended}
            </button>
          ))}
        </div>

        {/* Language Filter */}
        <select
          value={languageFilter}
          onChange={(e) => setLanguageFilter(e.target.value)}
          className="text-xs px-2.5 py-1.5 rounded-[8px] border font-medium cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
          style={{
            backgroundColor: 'var(--surface)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <option value="all">{t.settingsSpeechModelsFilterLanguages}</option>
          <option value="multilingual">{t.speechModelMultilingual}</option>
          <option value="en">{t.speechModelEnglishOnly}</option>
        </select>
      </div>

      {/* Import Modal */}
      {showImportDialog && (
        <div className="p-4 rounded-[10px] border space-y-3" style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}>
          <h4 className="text-sm font-semibold" style={{ color: 'var(--text)' }}>{t.settingsSpeechModelsImport}</h4>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Enter full file path to local .gguf model file:
          </p>
          <input
            type="text"
            value={importPath || ''}
            onChange={(e) => setImportPath(e.target.value)}
            placeholder="C:\models\whisper-small-q4.gguf"
            className="w-full px-3 py-1.5 text-xs font-mono rounded-[6px] border focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
            style={{ backgroundColor: 'var(--elevated)', borderColor: 'var(--border)', color: 'var(--text)' }}
          />
          {importError && <p className="text-xs text-red-400">{importError}</p>}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => { setShowImportDialog(false); setImportError(null); }}
              className="px-3 py-1 text-xs rounded-[6px] border hover:bg-[var(--elevated)] cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleImport}
              className="px-3 py-1 text-xs font-medium rounded-[6px] bg-[var(--accent)] text-[var(--bg)] cursor-pointer"
            >
              Import
            </button>
          </div>
        </div>
      )}

      {/* Model Cards Grid */}
      {loading ? (
        <div className="p-8 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
          Loading models...
        </div>
      ) : filteredModels.length === 0 ? (
        <div className="p-8 text-center text-xs border rounded-[10px]" style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}>
          No models match current search or filters.
        </div>
      ) : (
        <div className="space-y-5">
          {[
            { key: 'multilingual', title: t.speechModelMultilingual, testId: 'models-group-multilingual', list: groupedModels.multilingual },
            { key: 'englishOnly', title: t.speechModelEnglishOnly, testId: 'models-group-english-only', list: groupedModels.englishOnly },
          ].filter((group) => group.list.length > 0).map((group) => (
            <div key={group.key} data-testid={group.testId} className="space-y-2">
              <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                <span>{group.title}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-full bg-[var(--elevated)] border" style={{ borderColor: 'var(--border)' }}>
                  {group.list.length}
                </span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                {group.list.map((model) => (
                  <ModelCard
                    key={model.id}
                    model={model}
                    isActive={model.id === activeModelId}
                    progress={downloads[model.id]}
                    onSelect={handleSelect}
                    onDownload={handleDownload}
                    onCancelDownload={handleCancelDownload}
                    onDelete={handleDelete}
                    disabled={disabled}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
