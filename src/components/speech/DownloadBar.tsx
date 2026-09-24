import React from 'react';
import { X, CheckCircle, AlertTriangle, Loader2 } from 'lucide-react';
import type { DownloadProgress } from '../../services/stt';
import { I18nService } from '../../services/i18n';
import { formatBytes, formatSpeed, formatEta } from './utils';
export interface DownloadBarProps {
  progress: DownloadProgress;
  modelName?: string;
  onCancel?: (modelId: string) => void;
}

export const DownloadBar: React.FC<DownloadBarProps> = ({
  progress,
  modelName,
  onCancel,
}) => {
  const t = I18nService.t();
  const modelId = progress.modelId || progress.model_id;
  const percentage = Math.min(100, Math.max(0, Math.round(progress.percentage ?? (progress.total > 0 ? (progress.received / progress.total) * 100 : 0))));
  const speed = formatSpeed(progress.speedBps ?? progress.speed_bps);
  const eta = formatEta(progress.etaSecs ?? progress.eta_secs);
  const phase = progress.phase || 'downloading';

  return (
    <div
      data-testid={`download-bar-${modelId}`}
      className="p-3.5 rounded-[10px] border flex flex-col gap-2 transition-all"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <div className="flex items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-2 min-w-0">
          {phase === 'verifying' || phase === 'extracting' ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)] shrink-0" />
          ) : phase === 'done' ? (
            <CheckCircle className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
          ) : phase === 'error' ? (
            <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
          ) : (
            <div className="w-2 h-2 rounded-full bg-[var(--accent)] animate-pulse shrink-0" />
          )}
          <span className="font-medium truncate" style={{ color: 'var(--text)' }}>
            {modelName || modelId}
          </span>
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {phase === 'verifying'
              ? t.settingsSpeechModelVerifying
              : phase === 'extracting'
              ? t.settingsSpeechModelExtracting
              : `${percentage}%`}
          </span>
        </div>

        <div className="flex items-center gap-3 shrink-0 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          {speed && <span>{speed}</span>}
          {eta && <span>ETA {eta}</span>}
          <span>
            {formatBytes(progress.received)} / {formatBytes(progress.total)}
          </span>

          {onCancel && phase !== 'done' && (
            <button
              type="button"
              onClick={() => onCancel(modelId)}
              className="p-1 rounded hover:bg-[var(--elevated)] transition-colors cursor-pointer"
              title={t.settingsSpeechModelCancelDownload}
              aria-label={t.settingsSpeechModelCancelDownload}
            >
              <X className="w-3.5 h-3.5" style={{ color: 'var(--text-muted)' }} />
            </button>
          )}
        </div>
      </div>

      <div
        className="w-full h-1.5 rounded-full overflow-hidden"
        style={{ backgroundColor: 'var(--elevated)' }}
      >
        <div
          className="h-full transition-all duration-200 rounded-full"
          style={{
            width: `${percentage}%`,
            backgroundColor: phase === 'error' ? '#ef4444' : 'var(--accent)',
          }}
        />
      </div>

      {progress.error && (
        <div className="text-[11px] text-red-400 mt-0.5 truncate">
          {progress.error}
        </div>
      )}
    </div>
  );
};
