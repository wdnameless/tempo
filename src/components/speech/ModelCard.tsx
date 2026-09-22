import React, { useState } from 'react';
import {
  Download,
  Trash2,
  Check,
  Zap,
  Target,
  Globe,
  Loader2,
  HardDrive,
  Sparkles,
} from 'lucide-react';
import type { ModelInfo, DownloadProgress } from '../../services/stt';
import { I18nService } from '../../services/i18n';
import { formatBytes } from './utils';
export interface ModelCardProps {
  model: ModelInfo;
  isActive: boolean;
  progress?: DownloadProgress;
  onSelect: (modelId: string) => void;
  onDownload: (modelId: string, quant?: string) => void;
  onCancelDownload: (modelId: string) => void;
  onDelete: (modelId: string) => void;
  disabled?: boolean;
}

export const ModelCard: React.FC<ModelCardProps> = ({
  model,
  isActive,
  progress,
  onSelect,
  onDownload,
  onCancelDownload,
  onDelete,
  disabled = false,
}) => {
  const t = I18nService.t();
  const quants = model.quants && model.quants.length > 0 ? model.quants : model.quant ? [model.quant] : [];
  const [selectedQuant, setSelectedQuant] = useState<string>(model.quant || quants[0] || '');
  const [confirmDelete, setConfirmDelete] = useState(false);

  const isDownloading = Boolean(
    model.isDownloading ||
    model.is_downloading ||
    (progress && progress.phase === 'downloading')
  );
  const isVerifying = Boolean(progress && progress.phase === 'verifying');
  const isInstalled = Boolean(model.installed);

  const speedScore = model.speedScore ?? model.speed_score ?? 0.5;
  const accuracyScore = model.accuracyScore ?? model.accuracy_score ?? 0.5;
  const languagesCount = model.languageCount ?? model.language_count ?? model.languages?.length ?? 1;

  const handleDownloadClick = () => {
    onDownload(model.id, selectedQuant || undefined);
  };

  const handleDeleteClick = () => {
    if (confirmDelete) {
      onDelete(model.id);
      setConfirmDelete(false);
    } else {
      setConfirmDelete(true);
      setTimeout(() => setConfirmDelete(false), 3000);
    }
  };

  return (
    <div
      data-testid={`model-card-${model.id}`}
      className={`relative p-4 rounded-[12px] border transition-all flex flex-col justify-between gap-3.5 ${
        isActive
          ? 'ring-2 ring-[var(--accent)] border-[var(--accent)]'
          : 'hover:border-[var(--text-muted)]'
      }`}
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: isActive ? 'var(--accent)' : 'var(--border)',
      }}
    >
      {/* Top Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h4
              className="text-sm font-semibold truncate"
              style={{ color: 'var(--text)' }}
            >
              {model.name}
            </h4>

            {isActive && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--bg)',
                }}
              >
                <Check className="w-3 h-3" />
                {t.settingsSpeechModelActive}
              </span>
            )}

            {model.recommended && !isActive && (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'rgba(234, 179, 8, 0.15)',
                  color: '#eab308',
                }}
              >
                <Sparkles className="w-3 h-3" />
                {t.settingsSpeechModelsFilterRecommended}
              </span>
            )}

            {(model.isCustom || model.is_custom) && (
              <span
                className="text-[11px] font-medium px-2 py-0.5 rounded-full"
                style={{
                  backgroundColor: 'var(--elevated)',
                  color: 'var(--text-muted)',
                }}
              >
                {t.settingsSpeechModelCustom}
              </span>
            )}
          </div>

          {model.description && (
            <p
              className="text-xs mt-1 line-clamp-2"
              style={{ color: 'var(--text-muted)' }}
            >
              {model.description}
            </p>
          )}
        </div>

        {/* File Size */}
        <div
          className="flex items-center gap-1 text-xs font-mono shrink-0 font-medium"
          style={{ color: 'var(--text-muted)' }}
        >
          <HardDrive className="w-3.5 h-3.5" />
          {formatBytes(model.bytes)}
        </div>
      </div>

      {/* Meta specifications: Parameters, Quantization, Languages */}
      <div className="flex flex-wrap items-center gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
        {model.parameters && (
          <div className="flex items-center gap-1">
            <span className="text-[11px] uppercase tracking-wider">{t.settingsSpeechModelParameters}:</span>
            <span className="font-mono font-medium text-[var(--text)]">{model.parameters}</span>
          </div>
        )}

        {/* Quantization picker */}
        {quants.length > 1 && !isInstalled ? (
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] uppercase tracking-wider">{t.settingsSpeechModelQuant}:</span>
            <select
              value={selectedQuant}
              onChange={(e) => setSelectedQuant(e.target.value)}
              disabled={isDownloading || disabled}
              className="text-xs px-2 py-0.5 rounded border font-mono cursor-pointer focus:outline-none focus:ring-1 focus:ring-[var(--accent)]"
              style={{
                backgroundColor: 'var(--elevated)',
                borderColor: 'var(--border)',
                color: 'var(--text)',
              }}
            >
              {quants.map((q) => (
                <option key={q} value={q}>
                  {q}
                </option>
              ))}
            </select>
          </div>
        ) : (
          (model.quant || quants[0]) && (
            <div className="flex items-center gap-1">
              <span className="text-[11px] uppercase tracking-wider">{t.settingsSpeechModelQuant}:</span>
              <span className="font-mono text-[var(--text)]">{model.quant || quants[0]}</span>
            </div>
          )
        )}

        {/* Supported Languages */}
        <div className="flex items-center gap-1">
          <Globe className="w-3.5 h-3.5" />
          <span>
            {languagesCount > 1
              ? `${languagesCount} langs`
              : model.languages?.[0]?.toUpperCase() || 'EN'}
          </span>
        </div>
      </div>

      {/* Speed & Accuracy metrics */}
      <div className="grid grid-cols-2 gap-3 pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1">
              <Zap className="w-3 h-3 text-amber-500" />
              {t.settingsSpeechModelSpeed}
            </span>
            <span className="font-mono">{Math.round(speedScore * 100)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--elevated)' }}>
            <div
              className="h-full rounded-full bg-amber-500"
              style={{ width: `${Math.round(speedScore * 100)}%` }}
            />
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--text-muted)' }}>
            <span className="flex items-center gap-1">
              <Target className="w-3 h-3 text-emerald-500" />
              {t.settingsSpeechModelAccuracy}
            </span>
            <span className="font-mono">{Math.round(accuracyScore * 100)}%</span>
          </div>
          <div className="h-1 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--elevated)' }}>
            <div
              className="h-full rounded-full bg-emerald-500"
              style={{ width: `${Math.round(accuracyScore * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Actions footer */}
      <div className="flex items-center justify-between gap-2 pt-2">
        {isDownloading || isVerifying ? (
          <div className="flex items-center justify-between w-full gap-2">
            <span className="text-xs flex items-center gap-1.5" style={{ color: 'var(--accent)' }}>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {isVerifying ? t.settingsSpeechModelVerifying : t.settingsSpeechModelDownloading}
            </span>
            <button
              type="button"
              onClick={() => onCancelDownload(model.id)}
              className="px-2.5 py-1 text-xs rounded-[6px] border hover:bg-[var(--elevated)] transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text-muted)' }}
            >
              {t.settingsSpeechModelCancelDownload}
            </button>
          </div>
        ) : isInstalled ? (
          <div className="flex items-center justify-between w-full gap-2">
            {isActive ? (
              <div
                className="text-xs font-medium flex items-center gap-1.5"
                style={{ color: 'var(--accent)' }}
              >
                <Check className="w-4 h-4" />
                {t.settingsSpeechModelActive}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => onSelect(model.id)}
                disabled={disabled}
                className="px-3 py-1.5 text-xs font-medium rounded-[8px] transition-colors cursor-pointer shadow-sm hover:opacity-90"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: 'var(--bg)',
                }}
              >
                {t.settingsSpeechModelUse}
              </button>
            )}

            {!isActive && (
              <button
                type="button"
                onClick={handleDeleteClick}
                disabled={disabled}
                className={`p-1.5 rounded-[6px] transition-colors cursor-pointer ${
                  confirmDelete
                    ? 'bg-red-500/20 text-red-400 border border-red-500/40'
                    : 'text-[var(--text-muted)] hover:text-red-400 hover:bg-[var(--elevated)]'
                }`}
                title={confirmDelete ? t.settingsSpeechModelDeleteConfirm : t.settingsSpeechModelDelete}
                aria-label={t.settingsSpeechModelDelete}
              >
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={handleDownloadClick}
            disabled={disabled}
            className="w-full flex items-center justify-center gap-1.5 py-1.5 px-3 text-xs font-medium rounded-[8px] border transition-colors cursor-pointer hover:bg-[var(--elevated)]"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <Download className="w-3.5 h-3.5 text-[var(--accent)]" />
            {t.settingsSpeechModelDownload}
          </button>
        )}
      </div>
    </div>
  );
};
