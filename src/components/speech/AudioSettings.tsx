import React, { useState, useEffect } from 'react';
import type { SpeechConfig, VadBackend } from '../../services/speechSettings';
import {
  inputDevices,
  inputChannels,
  micLevel,
  type AudioDeviceInfo,
} from '../../services/stt';
import { I18nService } from '../../services/i18n';
import { Segmented } from '../ui/Segmented';
import { Slider } from '../ui/Slider';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';
import { Mic, Activity } from 'lucide-react';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type AudioSettingsProps = SpeechSectionProps;

export const AudioSettings: React.FC<AudioSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();
  const [devices, setDevices] = useState<AudioDeviceInfo[]>([]);
  const [channelCount, setChannelCount] = useState<number>(1);
  const [isTestingMic, setIsTestingMic] = useState(false);
  const [meterLevel, setMeterLevel] = useState(0);
  const [probeNotice, setProbeNotice] = useState<string | null>(null);

  // Load input devices on mount
  useEffect(() => {
    let mounted = true;
    inputDevices()
      .then((devs) => {
        if (mounted) {
          setDevices(devs);
        }
      })
      .catch((err) => {
        console.error('Failed to query input devices:', err);
      });
    return () => {
      mounted = false;
    };
  }, []);

  // Query channels when selected device changes
  useEffect(() => {
    let mounted = true;
    if (!config.device) {
      return;
    }
    inputChannels(config.device)
      .then((count) => {
        if (mounted) {
          setChannelCount(count > 0 ? count : 1);
        }
      })
      .catch((err) => {
        console.error('Failed to query device channels:', err);
        if (mounted) {
          setChannelCount(1);
        }
      });
    return () => {
      mounted = false;
    };
  }, [config.device]);

  // Live mic probe / polling when test microphone is active
  useEffect(() => {
    if (!isTestingMic) {
      return;
    }

    let active = true;
    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let intervalId: number | null = null;

    const startProbe = async () => {
      // SAFETY: webkitAudioContext is a legacy WebKit prefix fallback on window
      const AudioCtxClass =
        typeof window !== 'undefined'
          ? window.AudioContext ||
            (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
          : undefined;

      if (
        typeof navigator !== 'undefined' &&
        navigator.mediaDevices &&
        typeof navigator.mediaDevices.getUserMedia === 'function' &&
        AudioCtxClass
      ) {
        try {
          const constraints: MediaStreamConstraints = {
            audio: config.device ? { deviceId: { ideal: config.device } } : true,
          };
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          if (!active) {
            stream.getTracks().forEach((track) => track.stop());
            return;
          }

          audioCtx = new AudioCtxClass();
          if (audioCtx.state === 'suspended') {
            await audioCtx.resume();
          }

          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 256;
          source.connect(analyser);

          const dataArray = new Float32Array(analyser.fftSize);

          intervalId = window.setInterval(() => {
            if (!active) return;
            if (typeof analyser.getFloatTimeDomainData === 'function') {
              analyser.getFloatTimeDomainData(dataArray);
              let sumSquares = 0;
              for (let i = 0; i < dataArray.length; i++) {
                const val = dataArray[i];
                sumSquares += val * val;
              }
              const rms = Math.sqrt(sumSquares / dataArray.length);
              const scaled = Math.min(1, Math.max(0, rms * 4));
              setMeterLevel(scaled);
            } else {
              const byteData = new Uint8Array(analyser.frequencyBinCount);
              analyser.getByteFrequencyData(byteData);
              let sum = 0;
              for (let i = 0; i < byteData.length; i++) {
                sum += byteData[i];
              }
              const avg = sum / byteData.length;
              setMeterLevel(Math.min(1, Math.max(0, (avg / 128) * 1.5)));
            }
          }, 50);
          return;
        } catch (err) {
          console.warn('WebAudio mic probe failed, falling back to backend micLevel():', err);
          if (active) {
            setProbeNotice(
              I18nService.getLang() === 'ru'
                ? 'Для проверки микрофона требуется доступ к аудио; уровень будет отображаться во время диктовки.'
                : 'Live microphone test requires audio permission or active dictation.'
            );
          }
        }
      } else {
        if (active) {
          setProbeNotice(
            I18nService.getLang() === 'ru'
              ? 'Для проверки микрофона требуется доступ к аудио; уровень будет отображаться во время диктовки.'
              : 'Live microphone test requires audio permission or active dictation.'
          );
        }
      }

      // Fallback: poll backend micLevel()
      intervalId = window.setInterval(async () => {
        try {
          const lvl = await micLevel();
          if (active) {
            setMeterLevel(Math.max(0, Math.min(1, lvl)));
          }
        } catch {
          // Silently ignore device/backend polling failures
        }
      }, 100);
    };

    void startProbe();

    return () => {
      active = false;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        void audioCtx.close().catch(() => {});
      }
      setMeterLevel(0);
      setProbeNotice(null);
    };
  }, [isTestingMic, config.device]);

  const vadOptions: { value: VadBackend; label: string }[] = [
    { value: 'energy', label: t.settingsSpeechVadEnergy || 'Energy (RMS)' },
    { value: 'earshot', label: t.settingsSpeechVadEarshot || 'Earshot (Neural)' },
  ];

  const currentVadBackend: VadBackend =
    config.vadBackend === 'energy' ? 'energy' : 'earshot';

  return (
    <div data-testid="audio-settings" className="space-y-4">
      {/* Microphone Device Picker */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex items-center gap-2">
          <Mic className="w-4 h-4 text-primary shrink-0" />
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {t.settingsSpeechInputDevice}
          </div>
        </div>
        <select
          data-testid="audio-device-select"
          aria-label={t.settingsSpeechInputDevice}
          value={config.device ?? ''}
          disabled={disabled}
          onChange={(e) => {
            const val = e.target.value;
            onChange({ device: val === '' ? null : val, channel: null });
          }}
          className="w-full px-3 py-2 rounded-md border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
          style={{
            backgroundColor: 'var(--elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <option value="">{t.settingsSpeechInputDeviceDefault}</option>
          {devices.map((d) => (
            <option key={d.name} value={d.name}>
              {d.name} {d.isDefault ? `(${t.settingsSpeechInputDeviceDefault})` : ''}
            </option>
          ))}
        </select>
      </div>

      {/* Audio Channel Picker */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
          {t.settingsSpeechInputChannel}
        </div>
        <select
          data-testid="audio-channel-select"
          aria-label={t.settingsSpeechInputChannel}
          value={config.channel !== null && config.channel !== undefined ? String(config.channel) : ''}
          disabled={disabled}
          onChange={(e) => {
            const val = e.target.value;
            onChange({ channel: val === '' ? null : parseInt(val, 10) });
          }}
          className="w-full px-3 py-2 rounded-md border text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)]"
          style={{
            backgroundColor: 'var(--elevated)',
            borderColor: 'var(--border)',
            color: 'var(--text)',
          }}
        >
          <option value="">{t.settingsSpeechInputChannelDefault}</option>
          {Array.from({ length: Math.max(config.device ? channelCount : 1, 1) }, (_, i) => i + 1).map((ch) => (
            <option key={ch} value={String(ch)}>
              Channel {ch}
            </option>
          ))}
        </select>
      </div>

      {/* VAD Backend & Energy Threshold */}
      <div
        className="p-4 rounded-[10px] border space-y-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {t.settingsSpeechVadBackend}
          </div>
        </div>

        <div data-testid="vad-backend-segmented">
          <Segmented<VadBackend>
            value={currentVadBackend}
            options={vadOptions}
            onChange={(val) => onChange({ vadBackend: val })}
            disabled={disabled}
          />
        </div>

        {/* Energy Threshold Slider (only shown for energy VAD) */}
        {currentVadBackend === 'energy' && (
          <div className="pt-2 border-t space-y-2" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between text-xs">
              <span className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                {t.settingsSpeechVadThreshold}
              </span>
              <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                {config.vadEnergyThreshold.toFixed(3)}
              </span>
            </div>
            <div data-testid="vad-threshold-slider">
              <Slider
                value={config.vadEnergyThreshold}
                min={0.001}
                max={0.1}
                step={0.001}
                onChange={(val) => onChange({ vadEnergyThreshold: val })}
                minLabel="0.001"
                maxLabel="0.100"
                disabled={disabled}
              />
            </div>
          </div>
        )}
      </div>

      {/* Noise Suppression & Audio Filters */}
      <div
        data-testid="audio-denoise-settings"
        className="p-4 rounded-[10px] border space-y-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-0.5">
          <div className="text-sm font-medium" style={{ color: 'var(--text)' }}>
            {t.settingsSpeechDenoiseTitle}
          </div>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {t.settingsSpeechDenoiseSubtitle}
          </p>
        </div>

        {/* RNNoise */}
        <Row
          label={t.settingsSpeechDenoiseRnnoise}
          description={t.settingsSpeechDenoiseRnnoiseDesc}
          control={
            <div data-testid="denoise-rnnoise-toggle">
              <Toggle
                checked={config.denoise_rnnoise ?? false}
                onChange={(val) => onChange({ denoise_rnnoise: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />

        {/* High-Pass Filter */}
        <div className="pt-2 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <Row
            label={t.settingsSpeechDenoiseHighpass}
            description={t.settingsSpeechDenoiseHighpassDesc}
            control={
              <div data-testid="denoise-highpass-toggle">
                <Toggle
                  checked={config.denoise_highpass ?? true}
                  onChange={(val) => onChange({ denoise_highpass: val })}
                  disabled={disabled}
                />
              </div>
            }
            disabled={disabled}
          />

          {(config.denoise_highpass ?? true) && (
            <div className="pl-3 border-l-2 space-y-2" style={{ borderColor: 'var(--accent)' }}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text)' }}>
                  {t.settingsSpeechDenoiseHighpassHz}
                </span>
                <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                  {config.denoise_highpass_hz ?? 80} Hz
                </span>
              </div>
              <div data-testid="denoise-highpass-slider">
                <Slider
                  value={config.denoise_highpass_hz ?? 80}
                  min={40}
                  max={300}
                  step={5}
                  onChange={(val) => onChange({ denoise_highpass_hz: Math.round(val) })}
                  minLabel="40 Hz"
                  maxLabel="300 Hz"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>

        {/* Noise Gate */}
        <div className="pt-2 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <Row
            label={t.settingsSpeechDenoiseGate}
            description={t.settingsSpeechDenoiseGateDesc}
            control={
              <div data-testid="denoise-gate-toggle">
                <Toggle
                  checked={config.denoise_gate ?? true}
                  onChange={(val) => onChange({ denoise_gate: val })}
                  disabled={disabled}
                />
              </div>
            }
            disabled={disabled}
          />

          {(config.denoise_gate ?? true) && (
            <div className="pl-3 border-l-2 space-y-2" style={{ borderColor: 'var(--accent)' }}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text)' }}>
                  {t.settingsSpeechDenoiseGateDb}
                </span>
                <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                  {config.denoise_gate_db ?? -45} dB
                </span>
              </div>
              <div data-testid="denoise-gate-slider">
                <Slider
                  value={config.denoise_gate_db ?? -45}
                  min={-60}
                  max={-20}
                  step={1}
                  onChange={(val) => onChange({ denoise_gate_db: Math.round(val) })}
                  minLabel="-60 dB"
                  maxLabel="-20 dB"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>

        {/* Level Normalisation (AGC) */}
        <div className="pt-2 border-t space-y-3" style={{ borderColor: 'var(--border)' }}>
          <Row
            label={t.settingsSpeechDenoiseAgc}
            description={t.settingsSpeechDenoiseAgcDesc}
            control={
              <div data-testid="denoise-agc-toggle">
                <Toggle
                  checked={config.denoise_agc ?? false}
                  onChange={(val) => onChange({ denoise_agc: val })}
                  disabled={disabled}
                />
              </div>
            }
            disabled={disabled}
          />

          {(config.denoise_agc ?? false) && (
            <div className="pl-3 border-l-2 space-y-2" style={{ borderColor: 'var(--accent)' }}>
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium" style={{ color: 'var(--text)' }}>
                  {t.settingsSpeechDenoiseAgcTargetDb}
                </span>
                <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
                  {config.denoise_agc_target_db ?? -20} dB
                </span>
              </div>
              <div data-testid="denoise-agc-slider">
                <Slider
                  value={config.denoise_agc_target_db ?? -20}
                  min={-36}
                  max={-6}
                  step={1}
                  onChange={(val) => onChange({ denoise_agc_target_db: Math.round(val) })}
                  minLabel="-36 dB"
                  maxLabel="-6 dB"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Test Microphone & Live Level Meter */}
      <div
        className="p-4 rounded-[10px] border space-y-4"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label={isTestingMic ? t.settingsSpeechTestMicStop : t.settingsSpeechTestMic}
          description={t.settingsSpeechMicLevel}
          control={
            <div data-testid="test-mic-toggle">
              <Toggle
                checked={isTestingMic}
                onChange={setIsTestingMic}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />

        {/* Live level meter */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-1.5" style={{ color: 'var(--text-muted)' }}>
              <Activity className="w-3.5 h-3.5" />
              <span>{t.settingsSpeechMicLevel}</span>
            </div>
            <span className="font-mono tabular-nums text-xs" style={{ color: 'var(--text-muted)' }}>
              {Math.round((isTestingMic ? meterLevel : 0) * 100)}%
            </span>
          </div>
          <div
            data-testid="mic-level-meter"
            className="w-full h-2.5 rounded-full overflow-hidden border"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
            }}
          >
            <div
              className="h-full rounded-full transition-all duration-75 ease-out"
              style={{
                width: `${Math.round((isTestingMic ? meterLevel : 0) * 100)}%`,
                backgroundColor:
                  (isTestingMic ? meterLevel : 0) > 0.8
                    ? 'var(--destructive, #ef4444)'
                    : (isTestingMic ? meterLevel : 0) > 0.05
                      ? 'var(--accent, #3b82f6)'
                      : 'var(--text-muted)',
              }}
            />
          </div>
          {isTestingMic && probeNotice && (
            <div
              data-testid="mic-probe-notice"
              className="text-xs pt-1"
              style={{ color: 'var(--text-muted)' }}
            >
              {probeNotice}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AudioSettings;
