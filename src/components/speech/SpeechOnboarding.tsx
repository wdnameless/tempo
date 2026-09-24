import React, { useState, useEffect, useMemo } from 'react';
import {
  X,
  CheckCircle,
  Download,
  Mic,
  ArrowRight,
  ArrowLeft,
  Loader2,
  Square,
} from 'lucide-react';
import type { SpeechConfig } from '../../services/speechSettings';
import {
  listModels,
  downloadModel,
  cancelDownload,
  startDictation,
  stopDictation,
  type ModelInfo,
  type DownloadProgress,
} from '../../services/stt';
import { onSttEvent } from '../../services/sttEvents';
import { I18nService } from '../../services/i18n';
import { HotkeyRecorder } from './HotkeyRecorder';
import { DownloadBar } from './DownloadBar';
import {
  formatBytes,
  formatModelSizeMB,
  getModelQuant,
  groupAndSortModels,
  formatEngineName,
  isRussianModel,
  isModelSupported,
  getUnsupportedReason,
  formatLanguages,
} from './utils';
export interface SpeechOnboardingProps {
  open: boolean;
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  onClose: () => void;
  onComplete: () => void;
}

export const SpeechOnboarding: React.FC<SpeechOnboardingProps> = ({
  open,
  config,
  onChange,
  onClose,
  onComplete,
}) => {
  const t = I18nService.t();
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(true);
  const [downloads, setDownloads] = useState<Record<string, DownloadProgress>>({});
  const [isDictating, setIsDictating] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isStoppingDictation, setIsStoppingDictation] = useState(false);


  const groupedModels = useMemo(() => {
    return groupAndSortModels(models);
  }, [models]);
  useEffect(() => {
    if (!open) return;
    let mounted = true;
    listModels()
      .then((res) => {
        if (!mounted) return;
        setModels(res || []);
        // Auto-select recommended model if none selected
        if (!config.modelId && res && res.length > 0) {
          const rec = res.find((m) => m.recommended) || res[0];
          onChange({ modelId: rec.id });
        }
        setIsLoadingModels(false);
      })
      .catch(() => {
        if (mounted) setIsLoadingModels(false);
      });

    return () => {
      mounted = false;
    };
  }, [open, config.modelId, onChange]);

  // Subscribe to download events and STT events
  useEffect(() => {
    if (!open) return;
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
        void listModels().then(setModels);
      } else if (e.type === 'model-failed') {
        setDownloads((prev) => {
          const next = { ...prev };
          delete next[e.modelId];
          return next;
        });
      }
    });
    return () => unsubscribe();
  }, [open]);

  if (!open) return null;

  const selectedModel = models.find((m) => m.id === config.modelId);
  const activeDownload = selectedModel
    ? downloads[selectedModel.id]
    : undefined;

  const handleStartDownload = async (modelId: string) => {
    try {
      await downloadModel(modelId);
    } catch {
      // Handled via event
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
    } catch {
      // Ignored
    }
  };

  const handleToggleTestDictation = async () => {
    if (isDictating) {
      setIsStoppingDictation(true);
      try {
        const res = await stopDictation();
        setTestResult(res?.text || 'No speech detected.');
      } catch (err) {
        setTestResult(err instanceof Error ? err.message : 'Transcription failed.');
      } finally {
        setIsDictating(false);
        setIsStoppingDictation(false);
      }
    } else {
      setTestResult(null);
      try {
        await startDictation('insert');
        setIsDictating(true);
      } catch (err) {
        setTestResult(err instanceof Error ? err.message : 'Could not start dictation.');
      }
    }
  };

  const handleFinish = () => {
    onChange({ onboarded: true, enabled: true });
    onComplete();
  };

  return (
    <div
      data-testid="speech-onboarding-modal"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <div
        className="w-full max-w-lg rounded-[14px] border shadow-2xl flex flex-col overflow-hidden"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          maxHeight: '90vh',
        }}
      >
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
          <div className="flex flex-col gap-0.5">
            <h2 id="onboarding-title" className="text-base font-semibold" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechOnboardingTitle}
            </h2>
            <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechOnboardingSubtitle}
            </p>
          </div>
          <button
            type="button"
            data-testid="onboarding-skip-btn"
            onClick={onClose}
            className="p-1 rounded-full hover:bg-[var(--elevated)] transition-colors cursor-pointer text-[var(--text-muted)] hover:text-[var(--text)]"
            title={t.settingsSpeechOnboardingSkip}
            aria-label={t.settingsSpeechOnboardingSkip}
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Stepper indicators */}
        <div
          className="flex items-center justify-between px-6 py-2.5 border-b text-xs font-medium"
          style={{
            borderColor: 'var(--border)',
            backgroundColor: 'var(--elevated)',
          }}
        >
          <span className={currentStep === 1 ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}>
            {t.settingsSpeechOnboardingStep1}
          </span>
          <ArrowRight className="w-3 h-3 text-[var(--text-muted)] opacity-40" />
          <span className={currentStep === 2 ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}>
            {t.settingsSpeechOnboardingStep2}
          </span>
          <ArrowRight className="w-3 h-3 text-[var(--text-muted)] opacity-40" />
          <span className={currentStep === 3 ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}>
            {t.settingsSpeechOnboardingStep3}
          </span>
          <ArrowRight className="w-3 h-3 text-[var(--text-muted)] opacity-40" />
          <span className={currentStep === 4 ? 'text-[var(--accent)] font-semibold' : 'text-[var(--text-muted)]'}>
            {t.settingsSpeechOnboardingStep4}
          </span>
        </div>

        {/* Step Body */}
        <div className="p-5 overflow-y-auto flex-1 space-y-4">
          {/* STEP 1: Select Model */}
          {currentStep === 1 && (
            <div data-testid="onboarding-step-1" className="space-y-3">
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                {t.speechOnboardingSelectModel}
              </div>

              {isLoadingModels ? (
                <div className="p-8 text-center flex flex-col items-center gap-2">
                  <Loader2 className="w-5 h-5 animate-spin text-[var(--accent)]" />
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    Loading model catalog...
                  </span>
                </div>
              ) : (
                <div className="space-y-4 max-h-64 overflow-y-auto pr-1">
                  {[
                    { key: 'russian', title: t.speechModelRussian, testId: 'onboarding-models-group-russian', list: groupedModels.russian },
                    { key: 'multilingual', title: t.speechModelMultilingual, testId: 'onboarding-models-group-multilingual', list: groupedModels.multilingual },
                    { key: 'englishOnly', title: t.speechModelEnglishOnly, testId: 'onboarding-models-group-english-only', list: groupedModels.englishOnly },
                  ].filter((group) => group.list.length > 0).map((group) => (
                    <div key={group.key} data-testid={group.testId} className="space-y-2">
                      <div className="text-[11px] font-semibold uppercase tracking-wider px-1 text-[var(--text-muted)]">
                        {group.title}
                      </div>
                      {group.list.map((model) => {
                        const isSelected = config.modelId === model.id;
                        const isSupported = isModelSupported(model);
                        const unsupportedReason = getUnsupportedReason(model, t.settingsSpeechModelEngineUnsupported);
                        const isRussian = isRussianModel(model);
                        return (
                          <div
                            key={model.id}
                            data-testid={`onboarding-model-${model.id}`}
                            onClick={() => {
                              if (!isSupported) return;
                              onChange({ modelId: model.id });
                            }}
                            className={`p-3 rounded-[10px] border transition-all flex items-center justify-between gap-3 ${
                              !isSupported
                                ? 'opacity-50 cursor-not-allowed border-[var(--border)]'
                                : isSelected
                                ? 'border-[var(--accent)] ring-1 ring-[var(--accent)] cursor-pointer'
                                : 'hover:border-[var(--accent)]/50 cursor-pointer'
                            }`}
                            style={{
                              backgroundColor: isSelected ? 'var(--accent-soft)' : 'var(--surface)',
                              borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                            }}
                          >
                            <div className="flex flex-col gap-0.5">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs font-semibold" style={{ color: 'var(--text)' }}>
                                  {model.name}
                                </span>
                                {isRussian && (
                                  <span
                                    data-testid="model-russian-badge"
                                    className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-red-500/15 text-red-400 border border-red-500/30"
                                  >
                                    {t.settingsSpeechModelRussianBadge}
                                  </span>
                                )}
                                {model.recommended && (
                                  <span className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                    {t.settingsSpeechModelsFilterRecommended || 'Recommended'}
                                  </span>
                                )}
                                {!isSupported && (
                                  <span
                                    data-testid="model-unsupported-badge"
                                    className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-red-500/10 text-red-400 border border-red-500/20"
                                  >
                                    {t.settingsSpeechModelUnavailable}
                                  </span>
                                )}
                                {model.installed && (
                                  <span
                                    data-testid="model-installed-badge"
                                    className="px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-500/10 text-blue-400 border border-blue-500/20"
                                  >
                                    {t.sttModelInstalled || 'Installed'}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] flex-wrap" style={{ color: 'var(--text-muted)' }}>
                                <span data-testid="model-engine" className="font-mono font-medium px-1 py-0.2 rounded bg-[var(--elevated)] border" style={{ borderColor: 'var(--border)' }}>
                                  {formatEngineName(model.engine)}
                                </span>
                                <span data-testid="model-languages" className="font-medium text-[var(--text)]">
                                  {formatLanguages(model, t.settingsSpeechModelRussianBadge)}
                                </span>
                                <span className="font-mono font-medium px-1 py-0.2 rounded bg-[var(--elevated)] border" style={{ borderColor: 'var(--border)' }}>
                                  {getModelQuant(model)}
                                </span>
                                <span>{formatModelSizeMB(model.bytes)}</span>
                                {model.parameters && <span>· {model.parameters}</span>}
                              </div>
                              {!isSupported && (
                                <div data-testid="model-unsupported-reason" className="text-[10px] text-red-400 mt-0.5">
                                  {unsupportedReason}
                                </div>
                              )}
                            </div>

                            {isSelected && (
                              <CheckCircle className="w-4 h-4 text-[var(--accent)] shrink-0" />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Download Model */}
          {currentStep === 2 && (
            <div data-testid="onboarding-step-2" className="space-y-4">
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Download the selected model to enable offline push-to-talk transcription.
              </div>

              {selectedModel && (
                <div
                  className="p-4 rounded-[10px] border space-y-3"
                  style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-sm font-semibold" style={{ color: 'var(--text)' }}>
                        {selectedModel.name}
                      </div>
                      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {formatBytes(selectedModel.bytes)} · {selectedModel.description || 'Whisper GGUF'}
                      </div>
                    </div>
                    {selectedModel.installed && (
                      <span className="flex items-center gap-1 text-xs text-emerald-400 font-medium">
                        <CheckCircle className="w-4 h-4" />
                        <span>{t.speechReady}</span>
                      </span>
                    )}
                  </div>

                  {activeDownload ? (
                    <DownloadBar
                      progress={activeDownload}
                      modelName={selectedModel.name}
                      onCancel={handleCancelDownload}
                    />
                  ) : selectedModel.installed ? (
                    <div className="p-3 rounded-[8px] bg-emerald-500/10 border border-emerald-500/20 text-xs text-emerald-300">
                      Model is downloaded and verified on disk. You can proceed to the next step!
                    </div>
                  ) : (
                    <button
                      type="button"
                      data-testid="onboarding-download-model-btn"
                      onClick={() => handleStartDownload(selectedModel.id)}
                      className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-[8px] text-xs font-semibold cursor-pointer transition-colors"
                      style={{
                        backgroundColor: 'var(--accent)',
                        color: 'var(--bg)',
                      }}
                    >
                      <Download className="w-4 h-4" />
                      <span>Download Model ({formatBytes(selectedModel.bytes)})</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 3: Hotkey Setup */}
          {currentStep === 3 && (
            <div data-testid="onboarding-step-3" className="space-y-4">
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Choose the global shortcut for dictation. Hold down to talk or tap to lock recording.
              </div>

              <div
                className="p-4 rounded-[10px] border space-y-3"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {t.settingsSpeechHotkey}
                </div>
                <HotkeyRecorder
                  value={config.hotkey}
                  onChange={(hotkey) => onChange({ hotkey })}
                  placeholder={t.settingsSpeechHotkeyPlaceholder || 'e.g. Ctrl+Shift+Space'}
                />
              </div>
            </div>
          )}

          {/* STEP 4: Test Dictation */}
          {currentStep === 4 && (
            <div data-testid="onboarding-step-4" className="space-y-4">
              <div className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
                Test your microphone and model to make sure everything sounds crisp.
              </div>

              <div
                className="p-4 rounded-[10px] border flex flex-col items-center gap-3 text-center"
                style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
              >
                <button
                  type="button"
                  data-testid="onboarding-test-dictation-btn"
                  onClick={handleToggleTestDictation}
                  disabled={isStoppingDictation}
                  className={`w-14 h-14 rounded-full flex items-center justify-center transition-transform active:scale-95 cursor-pointer shadow-lg ${
                    isDictating ? 'bg-red-500 text-white animate-pulse' : 'hover:scale-105'
                  }`}
                  style={{
                    backgroundColor: isDictating ? '#ef4444' : 'var(--accent)',
                    color: 'var(--bg)',
                  }}
                  title={isDictating ? t.speechStopTestRecording : t.settingsSpeechOnboardingStartTest}
                >
                  {isStoppingDictation ? (
                    <Loader2 className="w-6 h-6 animate-spin" />
                  ) : isDictating ? (
                    <Square className="w-6 h-6 fill-current" />
                  ) : (
                    <Mic className="w-6 h-6" />
                  )}
                </button>

                <div className="text-xs font-medium" style={{ color: 'var(--text)' }}>
                  {isDictating
                    ? 'Listening... Click to stop.'
                    : t.settingsSpeechOnboardingStartTest}
                </div>

                {testResult && (
                  <div
                    className="w-full p-3 rounded-[8px] border text-xs text-left leading-relaxed select-text"
                    style={{
                      backgroundColor: 'var(--elevated)',
                      borderColor: 'var(--border)',
                      color: 'var(--text)',
                    }}
                  >
                    <span className="font-semibold block mb-1 text-[var(--accent)]">
                      Recognized Text:
                    </span>
                    {testResult}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div
          className="p-4 border-t flex items-center justify-between gap-3"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--surface)' }}
        >
          {currentStep > 1 ? (
            <button
              type="button"
              data-testid="onboarding-back-btn"
              onClick={() => setCurrentStep((s) => (s > 1 ? ((s - 1) as 1 | 2 | 3 | 4) : s))}
              className="flex items-center gap-1.5 px-3 py-2 rounded-[8px] border text-xs font-medium hover:bg-[var(--elevated)] transition-colors cursor-pointer"
              style={{ borderColor: 'var(--border)', color: 'var(--text)' }}
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>{t.settingsSpeechOnboardingBack}</span>
            </button>
          ) : (
            <button
              type="button"
              data-testid="onboarding-skip-footer-btn"
              onClick={onClose}
              className="px-3 py-2 text-xs font-medium text-[var(--text-muted)] hover:text-[var(--text)] transition-colors cursor-pointer"
            >
              {t.settingsSpeechOnboardingSkip}
            </button>
          )}

          {currentStep < 4 ? (
            <button
              type="button"
              data-testid="onboarding-next-btn"
              onClick={() => setCurrentStep((s) => (s < 4 ? ((s + 1) as 1 | 2 | 3 | 4) : s))}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--bg)',
              }}
            >
              <span>{t.settingsSpeechOnboardingNext}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          ) : (
            <button
              type="button"
              data-testid="onboarding-finish-btn"
              onClick={handleFinish}
              className="flex items-center gap-1.5 px-4 py-2 rounded-[8px] text-xs font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: 'var(--accent)',
                color: 'var(--bg)',
              }}
            >
              <CheckCircle className="w-3.5 h-3.5" />
              <span>{t.settingsSpeechOnboardingFinish}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default SpeechOnboarding;
