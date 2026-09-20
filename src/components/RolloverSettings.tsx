import { useState, useCallback } from 'react';
import { Row, Toggle, Slider, SectionHeader } from './ui';
import { I18nService } from '../services/i18n';
import {
  rolloverSettings,
  setRolloverSettings,
  localTimeZone,
  runRollover,
  type RolloverSettings as RolloverSettingsType,
  type RolloverResult,
} from '../services/rollover';

export interface RolloverSettingsProps {
  className?: string;
}

export function RolloverSettings({ className }: RolloverSettingsProps): React.ReactElement {
  const t = I18nService.t();
  const [settings, setSettings] = useState<RolloverSettingsType>(() => rolloverSettings());
  // The zone never changes while the app runs, so it is computed once during the
  // first render instead of being set from an effect — which would re-render for
  // a value that was already available.
  const [timeZone] = useState<string>(() => localTimeZone());
  const [lastResult, setLastResult] = useState<RolloverResult | null>(null);
  const [isRunning, setIsRunning] = useState<boolean>(false);

  const handleToggle = useCallback(async (enabled: boolean) => {
    setSettings((prev) => ({ ...prev, enabled }));
    await setRolloverSettings({ enabled });
  }, []);

  const handleHourChange = useCallback(async (afterHour: number) => {
    setSettings((prev) => ({ ...prev, afterHour }));
    await setRolloverSettings({ afterHour });
  }, []);

  const handleRunNow = useCallback(async () => {
    setIsRunning(true);
    try {
      const result = await runRollover();
      setLastResult(result);
    } catch (err) {
      console.error('Manual rollover failed:', err);
    } finally {
      setIsRunning(false);
    }
  }, []);

  const formattedHour = `${String(settings.afterHour).padStart(2, '0')}:00`;

  return (
    <div className={className ? `flex flex-col space-y-6 ${className}` : 'flex flex-col space-y-6'}>
      <SectionHeader>{t.rollover}</SectionHeader>

      <div className="rounded-xl border border-zinc-200/80 dark:border-zinc-800/80 divide-y divide-zinc-200/60 dark:divide-zinc-800/60 overflow-hidden bg-white/50 dark:bg-zinc-900/50 backdrop-blur-sm">
        <Row
          label={t.rollover}
          description={t.rolloverHint}
          control={
            <Toggle
              checked={settings.enabled}
              onChange={handleToggle}
            />
          }
        />

        {settings.enabled ? (
          <Row
            label={t.rolloverAfter}
            description={formattedHour}
            control={
              <div className="w-48">
                <Slider
                  min={0}
                  max={12}
                  step={1}
                  value={settings.afterHour}
                  onChange={handleHourChange}
                />
              </div>
            }
          />
        ) : (
          <Row
            label={t.rolloverDisabledHint}
          />
        )}

        <Row
          label={t.rolloverTimezone}
          description={timeZone}
        />

        {settings.enabled && (
          <Row
            label={
              lastResult
                ? `Rollover: ${lastResult.moved} moved, ${lastResult.cleared} slots cleared`
                : 'Run rollover manually'
            }
            control={
              <button
                type="button"
                onClick={handleRunNow}
                disabled={isRunning}
                className="px-3 py-1.5 text-xs font-medium rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-100 hover:bg-zinc-200 dark:bg-zinc-800 dark:hover:bg-zinc-700 text-zinc-800 dark:text-zinc-200 transition-colors disabled:opacity-50"
              >
                {isRunning ? 'Running...' : 'Run now'}
              </button>
            }
          />
        )}
      </div>
    </div>
  );
}
