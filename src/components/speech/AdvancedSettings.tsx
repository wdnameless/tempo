import React, { useState, useEffect, useMemo } from 'react';
import { Cpu, Clock, AlertTriangle, Info } from 'lucide-react';
import type { SpeechConfig } from '../../services/speechSettings';
import { accelerators, type AcceleratorInfo } from '../../services/stt';
import { I18nService } from '../../services/i18n';
import { Segmented, type SegmentOption } from '../ui/Segmented';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type AdvancedSettingsProps = SpeechSectionProps;

function formatVram(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(1)} GB free`;
  }
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) {
    return `${Math.round(mb)} MB free`;
  }
  return `${bytes} B free`;
}

export const AdvancedSettings: React.FC<AdvancedSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [deviceList, setDeviceList] = useState<AcceleratorInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    accelerators()
      .then((accs) => {
        if (mounted) {
          setDeviceList(accs);
          setLoading(false);
        }
      })
      .catch((err) => {
        console.error('Failed to load accelerators:', err);
        if (mounted) {
          setDeviceList([]);
          setLoading(false);
        }
      });
    return () => {
      mounted = false;
    };
  }, []);

  const gpuDevices = useMemo(() => {
    return deviceList.filter((d) => !d.isCpu && !d.is_cpu);
  }, [deviceList]);

  const isSelectedGpuMissing = useMemo(() => {
    if (loading) return false;
    if (config.accelerator === 'gpu' && config.gpuDevice) {
      return !gpuDevices.some((d) => d.id === config.gpuDevice);
    }
    return false;
  }, [loading, config.accelerator, config.gpuDevice, gpuDevices]);

  const selectedDeviceValue = useMemo(() => {
    if (config.accelerator === 'cpu') {
      return 'cpu';
    }
    if (config.accelerator === 'gpu' && config.gpuDevice) {
      if (isSelectedGpuMissing) {
        return 'auto';
      }
      return `gpu:${config.gpuDevice}`;
    }
    return 'auto';
  }, [config.accelerator, config.gpuDevice, isSelectedGpuMissing]);

  const handleDeviceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    if (val === 'cpu') {
      onChange({ accelerator: 'cpu' });
    } else if (val.startsWith('gpu:')) {
      onChange({ accelerator: 'gpu', gpuDevice: val.slice(4) });
    } else {
      onChange({ accelerator: 'auto', gpuDevice: null });
    }
  };

  const unloadOptions: SegmentOption<number>[] = [
    { value: 0, label: t.settingsSpeechModelUnloadNever },
    { value: 120, label: t.settingsSpeechModelUnload2Min },
    { value: 300, label: t.settingsSpeechModelUnload5Min },
    { value: 600, label: t.settingsSpeechModelUnload10Min },
    { value: 900, label: t.settingsSpeechModelUnload15Min },
  ];

  return (
    <div data-testid="advanced-settings" className="space-y-4">
      {/* Compute Device Picker */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Cpu className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechAccelerator}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechAcceleratorDesc}
            </div>
          </div>
        </div>

        <select
          data-testid="speech-accelerator-select"
          aria-label={t.settingsSpeechAccelerator}
          value={selectedDeviceValue}
          disabled={disabled || loading}
          onChange={handleDeviceChange}
          className="w-full px-3 py-2 rounded-md border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
          style={{
            backgroundColor: 'var(--elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <option value="auto">{t.settingsSpeechAcceleratorAuto}</option>
          {gpuDevices.map((dev) => {
            const freeBytes = dev.memoryFree ?? dev.memory_free ?? 0;
            const vramStr = formatVram(freeBytes);
            const label = vramStr ? `${dev.name} (${vramStr})` : dev.name;
            return (
              <option key={dev.id} value={`gpu:${dev.id}`}>
                {label}
              </option>
            );
          })}
          <option value="cpu">{t.settingsSpeechAcceleratorCpu}</option>
        </select>

        {isSelectedGpuMissing && (
          <div
            data-testid="speech-accelerator-missing"
            className="text-xs flex items-center gap-1.5 p-2 rounded-md border"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text-muted)',
            }}
          >
            <AlertTriangle className="w-4 h-4 shrink-0 text-amber-500" />
            <span>{t.settingsSpeechAcceleratorMissing}</span>
          </div>
        )}

        {!loading && gpuDevices.length === 0 && (
          <div
            data-testid="speech-no-gpu-hint"
            className="text-xs flex items-center gap-1.5"
            style={{ color: 'var(--text-muted)' }}
          >
            <Info className="w-3.5 h-3.5 shrink-0" />
            <span>{t.settingsSpeechAcceleratorNoGpu}</span>
          </div>
        )}
      </div>

      {/* Model Unload Timeout */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Clock className="w-4 h-4 shrink-0" style={{ color: 'var(--accent)' }} />
          <div>
            <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
              {t.settingsSpeechModelUnload}
            </div>
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {t.settingsSpeechModelUnloadDesc}
            </div>
          </div>
        </div>

        <div data-testid="speech-model-unload-segmented">
          <Segmented<number>
            value={config.modelUnloadSecs}
            options={unloadOptions}
            onChange={(val) => onChange({ modelUnloadSecs: val })}
            disabled={disabled}
          />
        </div>
      </div>
    </div>
  );
};

export default AdvancedSettings;
