import React, { useState } from 'react';
import { Sparkles, Loader2, ArrowRight } from 'lucide-react';
import type { SpeechConfig } from '../../services/speechSettings';
import { postprocessText } from '../../services/stt';
import { I18nService } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type PostProcessSettingsProps = SpeechSectionProps;

export const PostProcessSettings: React.FC<PostProcessSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [testInput, setTestInput] = useState(
    'hello um so basically i think we should meet at three oclock tomorrow',
  );
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isRunningTest, setIsRunningTest] = useState(false);
  const [testError, setTestError] = useState<string | null>(null);

  const handleRunTest = async () => {
    if (!testInput.trim() || isRunningTest) return;

    setIsRunningTest(true);
    setTestError(null);
    try {
      const result = await postprocessText(testInput);
      setTestResult(result);
    } catch (err) {
      setTestError(err instanceof Error ? err.message : 'Post-processing failed');
    } finally {
      setIsRunningTest(false);
    }
  };

  return (
    <div data-testid="postprocess-settings" className="space-y-4">
      {/* Enable Post-processing */}
      <div
        className="p-2 rounded-[10px] border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label={t.settingsSpeechPostprocessEnabled}
          description={t.settingsSpeechPostprocessDesc}
          control={
            <div data-testid="postprocess-enabled-toggle">
              <Toggle
                checked={config.postprocessEnabled}
                onChange={(val) => onChange({ postprocessEnabled: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />
      </div>

      {/* System Prompt */}
      <div
        className="p-4 rounded-[10px] border space-y-2.5"
        style={{
          backgroundColor: 'var(--surface)',
          borderColor: 'var(--border)',
          opacity: config.postprocessEnabled ? 1 : 0.6,
        }}
      >
        <div className="flex flex-col gap-0.5">
          <label
            htmlFor="postprocess-prompt"
            className="text-sm font-medium"
            style={{ color: 'var(--text)' }}
          >
            {t.settingsSpeechPostprocessPrompt}
          </label>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Customize how LLM cleans up and formats the transcribed text
          </span>
        </div>

        <textarea
          id="postprocess-prompt"
          data-testid="postprocess-prompt-textarea"
          value={config.postprocessPrompt}
          onChange={(e) => onChange({ postprocessPrompt: e.target.value })}
          disabled={disabled || !config.postprocessEnabled}
          placeholder={
            t.settingsSpeechPostprocessPromptPlaceholder ||
            'e.g. Fix grammar, remove filler words, format numbers and punctuation nicely.'
          }
          rows={3}
          className="w-full px-3 py-2 rounded-[8px] border text-xs font-mono transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] resize-y disabled:opacity-40 disabled:cursor-not-allowed"
          style={{
            backgroundColor: 'var(--elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        />
      </div>

      {/* Interactive Test Box */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-sm font-medium" style={{ color: 'var(--text)' }}>
            <Sparkles className="w-4 h-4 text-[var(--accent)]" />
            <span>{t.settingsSpeechPostprocessTest}</span>
          </div>
          <button
            type="button"
            data-testid="postprocess-test-run-btn"
            onClick={handleRunTest}
            disabled={disabled || isRunningTest || !testInput.trim()}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-[6px] text-xs font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--accent)',
              color: 'var(--bg)',
            }}
          >
            {isRunningTest ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Sparkles className="w-3.5 h-3.5" />
            )}
            <span>{t.settingsSpeechPostprocessTestRun}</span>
          </button>
        </div>

        {/* Input */}
        <div className="space-y-1">
          <label className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>
            {t.settingsSpeechPostprocessTestInput}
          </label>
          <input
            type="text"
            data-testid="postprocess-test-input"
            value={testInput}
            onChange={(e) => setTestInput(e.target.value)}
            disabled={disabled || isRunningTest}
            className="w-full px-3 py-1.5 rounded-[6px] border text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] disabled:opacity-40"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          />
        </div>

        {/* Error */}
        {testError && (
          <div className="text-xs text-red-400 p-2 rounded-[6px] bg-red-500/10 border border-red-500/20">
            {testError}
          </div>
        )}

        {/* Result comparison */}
        {testResult && (
          <div
            data-testid="postprocess-test-result"
            className="p-3 rounded-[8px] border space-y-2"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
            }}
          >
            <div className="flex items-center justify-between text-xs font-medium">
              <span style={{ color: 'var(--text-muted)' }}>
                {t.settingsSpeechPostprocessTestResult}
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-[var(--accent)]" />
            </div>
            <div
              className="text-xs font-medium leading-relaxed select-text p-2 rounded bg-[var(--surface)] border border-[var(--border)]"
              style={{ color: 'var(--text)' }}
            >
              {testResult}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default PostProcessSettings;
