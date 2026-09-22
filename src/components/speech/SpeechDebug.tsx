import React, { useState, useEffect } from 'react';
import { FolderOpen, RotateCcw, AlertTriangle, CheckCircle, Bug, Sliders, ExternalLink } from 'lucide-react';
import type { SpeechConfig } from '../../services/speechSettings';
import { modelsDir, openModelsDir } from '../../services/stt';
import { onSttEvent, type SttEvent } from '../../services/sttEvents';
import { I18nService } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type SpeechDebugProps = SpeechSectionProps;

interface CapturedError {
  id: string;
  time: string;
  code: string;
  message: string;
}

export const SpeechDebug: React.FC<SpeechDebugProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [dirPath, setDirPath] = useState<string>('');
  const [errors, setErrors] = useState<CapturedError[]>([]);

  useEffect(() => {
    let mounted = true;
    modelsDir()
      .then((p) => {
        if (mounted) setDirPath(p);
      })
      .catch(() => {
        if (mounted) setDirPath('~/.local/share/tempo/models');
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const unsubscribe = onSttEvent((e: SttEvent) => {
      if (e.type === 'speech-error') {
        const newErr: CapturedError = {
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          time: new Date().toLocaleTimeString(),
          code: e.code,
          message: e.message,
        };
        setErrors((prev) => [newErr, ...prev.slice(0, 19)]);
      }
    });
    return () => unsubscribe();
  }, []);

  const handleOpenDir = async () => {
    try {
      await openModelsDir();
    } catch {
      // Ignored outside Tauri
    }
  };

  const handleRerunOnboarding = () => {
    onChange({ onboarded: false });
  };

  return (
    <div data-testid="speech-debug" className="space-y-4">
      {/* Onboarding & Overlay gate */}
      <div
        className="p-3 rounded-[10px] border divide-y divide-[var(--border)]"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label="Show recording overlay indicator"
          description="Display visual level meter, mode and timer while dictating (overlay and pill)"
          control={
            <div data-testid="overlay-enabled-toggle">
              <Toggle
                checked={config.overlayEnabled}
                onChange={(val) => onChange({ overlayEnabled: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />

        <div className="py-2.5 px-3.5 flex items-center justify-between gap-4">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechDebugRerunOnboarding}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              Reset onboarding state to launch the initial 4-step setup wizard
            </span>
          </div>
          <button
            type="button"
            data-testid="rerun-onboarding-button"
            onClick={handleRerunOnboarding}
            disabled={disabled}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors cursor-pointer border"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <RotateCcw className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span>Rerun Setup</span>
          </button>
        </div>
      </div>

      {/* Models Directory Path */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text)' }}>
            <FolderOpen className="w-4 h-4 text-[var(--accent)]" />
            <span>{t.settingsSpeechDebugPaths || 'System Paths'}</span>
          </div>
          <button
            type="button"
            data-testid="open-models-dir-button"
            onClick={handleOpenDir}
            disabled={disabled}
            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-[6px] transition-colors cursor-pointer border hover:bg-[var(--elevated)]"
            style={{
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <ExternalLink className="w-3.5 h-3.5" />
            <span>{t.settingsSpeechModelsOpenDir || 'Open in Explorer'}</span>
          </button>
        </div>

        <div className="space-y-1">
          <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {t.settingsSpeechDebugModelsDir || 'Models Directory'}
          </div>
          <div
            data-testid="models-dir-path"
            className="px-3 py-2 rounded-[6px] border font-mono text-xs select-all break-all"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            {dirPath || 'Detecting path...'}
          </div>
        </div>
      </div>

      {/* STT Error Log */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text)' }}>
            <Bug className="w-4 h-4 text-[var(--accent)]" />
            <span>{t.settingsSpeechDebugLastErrors || 'Recent Errors'}</span>
          </div>
          {errors.length > 0 && (
            <button
              type="button"
              onClick={() => setErrors([])}
              className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              Clear log
            </button>
          )}
        </div>

        <div data-testid="last-errors-list">
          {errors.length === 0 ? (
            <div
              className="flex items-center gap-2 text-xs py-2"
              style={{ color: 'var(--text-muted)' }}
            >
              <CheckCircle className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>{t.settingsSpeechDebugNoErrors || 'No STT errors recorded'}</span>
            </div>
          ) : (
            <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
              {errors.map((err) => (
                <div
                  key={err.id}
                  className="p-2.5 rounded-[6px] border text-xs flex items-start gap-2.5 bg-red-500/5 border-red-500/20"
                >
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 font-mono text-[10px] text-red-400">
                      <span>[{err.code}]</span>
                      <span>{err.time}</span>
                    </div>
                    <div className="text-red-200 mt-0.5 break-words">{err.message}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Active Speech Configuration Snapshot */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text)' }}>
          <Sliders className="w-4 h-4 text-[var(--accent)]" />
          <span>{t.settingsSpeechDebugState || 'Speech Config Snapshot'}</span>
        </div>

        <pre
          data-testid="config-snapshot"
          className="p-3 rounded-[8px] border font-mono text-[11px] leading-relaxed overflow-x-auto max-h-56 select-text"
          style={{
            backgroundColor: 'var(--elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          {JSON.stringify(config, null, 2)}
        </pre>
      </div>
    </div>
  );
};

export default SpeechDebug;
