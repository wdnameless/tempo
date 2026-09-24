import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { AudioSettings } from '../speech/AudioSettings';
import { DEFAULT_SPEECH_CONFIG, type SpeechConfig } from '../../services/speechSettings';
import * as stt from '../../services/stt';

vi.mock('../../services/stt', () => ({
  inputDevices: vi.fn().mockResolvedValue([
    { name: 'Default Mic', isDefault: true, channels: 2 },
  ]),
  inputChannels: vi.fn().mockResolvedValue(2),
  micLevel: vi.fn().mockResolvedValue(0),
  listModels: vi.fn().mockResolvedValue([]),
  downloadModel: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(() => () => {}),
}));

describe('AudioSettings - Test Microphone Probe', () => {
  let mockStream: { getTracks: () => { stop: () => void }[] };
  let mockTrackStop: Mock;
  let mockAudioContextClose: Mock;
  let originalAudioContext: typeof window.AudioContext;
  let originalMediaDevices: typeof navigator.mediaDevices;

  beforeEach(() => {
    vi.clearAllMocks();
    originalAudioContext = window.AudioContext;
    originalMediaDevices = navigator.mediaDevices;

    mockTrackStop = vi.fn();
    mockStream = {
      getTracks: () => [{ stop: mockTrackStop }],
    };
    mockAudioContextClose = vi.fn().mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.AudioContext = originalAudioContext;
    Object.defineProperty(navigator, 'mediaDevices', {
      value: originalMediaDevices,
      configurable: true,
      writable: true,
    });
  });

  it('starts live probe capture on toggle on and stops on toggle off', async () => {
    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
      writable: true,
    });

    class MockAnalyser {
      fftSize = 256;
      frequencyBinCount = 128;
      getFloatTimeDomainData(arr: Float32Array) {
        // simulate speech waveform with RMS ~ 0.15
        for (let i = 0; i < arr.length; i++) {
          arr[i] = 0.15 * Math.sin(i);
        }
      }
      getByteFrequencyData(arr: Uint8Array) {
        arr.fill(100);
      }
    }

    class MockAudioContext {
      state = 'running';
      createMediaStreamSource() {
        return {
          connect: vi.fn(),
        };
      }
      createAnalyser() {
        return new MockAnalyser();
      }
      resume = vi.fn().mockResolvedValue(undefined);
      close = mockAudioContextClose;
    }

    // @ts-expect-error test mock
    window.AudioContext = MockAudioContext;

    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      device: null,
    };
    const onChange = vi.fn();

    render(<AudioSettings config={config} onChange={onChange} />);

    // Toggle on Test Microphone
    const testMicToggle = screen.getByTestId('test-mic-toggle').querySelector('button');
    expect(testMicToggle).toBeDefined();

    await act(async () => {
      fireEvent.click(testMicToggle!);
    });

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    // Level meter should have updated from speech
    await waitFor(() => {
      const meter = screen.getByTestId('mic-level-meter').firstElementChild as HTMLElement;
      expect(meter.style.width).not.toBe('0%');
    });

    // Toggle off
    await act(async () => {
      fireEvent.click(testMicToggle!);
    });

    await waitFor(() => {
      expect(mockTrackStop).toHaveBeenCalled();
      expect(mockAudioContextClose).toHaveBeenCalled();
      const meter = screen.getByTestId('mic-level-meter').firstElementChild as HTMLElement;
      expect(meter.style.width).toBe('0%');
    });
  });

  it('stops probe capture when unmounting while active', async () => {
    const getUserMediaMock = vi.fn().mockResolvedValue(mockStream);
    Object.defineProperty(navigator, 'mediaDevices', {
      value: { getUserMedia: getUserMediaMock },
      configurable: true,
      writable: true,
    });

    class MockAudioContext {
      state = 'running';
      createMediaStreamSource() {
        return { connect: vi.fn() };
      }
      createAnalyser() {
        return {
          fftSize: 256,
          frequencyBinCount: 128,
          getFloatTimeDomainData: vi.fn(),
          getByteFrequencyData: vi.fn(),
        };
      }
      resume = vi.fn().mockResolvedValue(undefined);
      close = mockAudioContextClose;
    }

    // @ts-expect-error test mock
    window.AudioContext = MockAudioContext;

    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      device: null,
    };
    const onChange = vi.fn();

    const { unmount } = render(<AudioSettings config={config} onChange={onChange} />);

    const testMicToggle = screen.getByTestId('test-mic-toggle').querySelector('button');
    await act(async () => {
      fireEvent.click(testMicToggle!);
    });

    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalled();
    });

    unmount();

    expect(mockTrackStop).toHaveBeenCalled();
    expect(mockAudioContextClose).toHaveBeenCalled();
  });

  it('falls back to micLevel and shows honest notice when probe fails', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      value: {
        getUserMedia: vi.fn().mockRejectedValue(new Error('Permission denied')),
      },
      configurable: true,
      writable: true,
    });

    vi.mocked(stt.micLevel).mockResolvedValue(0.42);

    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      device: null,
    };
    const onChange = vi.fn();

    render(<AudioSettings config={config} onChange={onChange} />);

    const testMicToggle = screen.getByTestId('test-mic-toggle').querySelector('button');
    await act(async () => {
      fireEvent.click(testMicToggle!);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mic-probe-notice')).toBeDefined();
    });

    // Fallback polling receives micLevel
    await waitFor(() => {
      expect(stt.micLevel).toHaveBeenCalled();
    });
  });
});

describe('AudioSettings - Noise Suppression & Audio Filters', () => {
  it('reads stored denoise values from config and writes updated values on toggle', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      denoise_rnnoise: false,
      denoise_highpass: true,
      denoise_highpass_hz: 80,
      denoise_gate: true,
      denoise_gate_db: -45,
      denoise_agc: false,
      denoise_agc_target_db: -20,
    };
    const onChange = vi.fn();

    render(<AudioSettings config={config} onChange={onChange} />);

    // Check that the noise suppression section is rendered
    expect(screen.getByTestId('audio-denoise-settings')).toBeDefined();

    // 1. RNNoise toggle: initial false -> click -> true
    const rnnoiseToggle = screen.getByTestId('denoise-rnnoise-toggle').querySelector('button');
    expect(rnnoiseToggle).toBeDefined();
    fireEvent.click(rnnoiseToggle!);
    expect(onChange).toHaveBeenCalledWith({ denoise_rnnoise: true });

    // 2. High-pass toggle: initial true -> click -> false
    const highpassToggle = screen.getByTestId('denoise-highpass-toggle').querySelector('button');
    expect(highpassToggle).toBeDefined();
    fireEvent.click(highpassToggle!);
    expect(onChange).toHaveBeenCalledWith({ denoise_highpass: false });

    // 3. Noise gate toggle: initial true -> click -> false
    const gateToggle = screen.getByTestId('denoise-gate-toggle').querySelector('button');
    expect(gateToggle).toBeDefined();
    fireEvent.click(gateToggle!);
    expect(onChange).toHaveBeenCalledWith({ denoise_gate: false });

    // 4. AGC toggle: initial false -> click -> true
    const agcToggle = screen.getByTestId('denoise-agc-toggle').querySelector('button');
    expect(agcToggle).toBeDefined();
    fireEvent.click(agcToggle!);
    expect(onChange).toHaveBeenCalledWith({ denoise_agc: true });
  });

  it('reads and writes parameter sliders for high-pass hz, gate db, and agc target db', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      denoise_rnnoise: true,
      denoise_highpass: true,
      denoise_highpass_hz: 80,
      denoise_gate: true,
      denoise_gate_db: -45,
      denoise_agc: true,
      denoise_agc_target_db: -20,
    };
    const onChange = vi.fn();

    render(<AudioSettings config={config} onChange={onChange} />);

    // Highpass frequency slider
    const hpSlider = screen.getByTestId('denoise-highpass-slider').querySelector('input[type="range"]');
    expect(hpSlider).toBeDefined();
    fireEvent.change(hpSlider!, { target: { value: '120' } });
    expect(onChange).toHaveBeenCalledWith({ denoise_highpass_hz: 120 });

    // Gate threshold slider
    const gateSlider = screen.getByTestId('denoise-gate-slider').querySelector('input[type="range"]');
    expect(gateSlider).toBeDefined();
    fireEvent.change(gateSlider!, { target: { value: '-40' } });
    expect(onChange).toHaveBeenCalledWith({ denoise_gate_db: -40 });

    // AGC target db slider
    const agcSlider = screen.getByTestId('denoise-agc-slider').querySelector('input[type="range"]');
    expect(agcSlider).toBeDefined();
    fireEvent.change(agcSlider!, { target: { value: '-16' } });
    expect(onChange).toHaveBeenCalledWith({ denoise_agc_target_db: -16 });
  });

  it('renders one-line sound explanations for all denoise options in current locale', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      denoise_rnnoise: false,
      denoise_highpass: true,
      denoise_gate: true,
      denoise_agc: false,
    };
    render(<AudioSettings config={config} onChange={vi.fn()} />);

    // In default ru locale
    expect(screen.getByText(/рекуррентной нейросети|Нейросетевое подавление/i)).toBeDefined();
    expect(screen.getByText(/Срезает низкочастотный гул/i)).toBeDefined();
    expect(screen.getByText(/Глушит фоновый шум и дыхание/i)).toBeDefined();
    expect(screen.getByText(/Выравнивает уровень громкости/i)).toBeDefined();
  });
});

describe('AudioSettings - VAD Backend & Silero Neural Detector', () => {
  it('offers three VAD backends in the selector with one-line explanation of neural detector', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      vadBackend: 'energy',
    };
    render(<AudioSettings config={config} onChange={vi.fn()} />);

    // Segmented should have Energy, Earshot, and Silero options
    const segmented = screen.getByTestId('vad-backend-segmented');
    expect(segmented).toBeDefined();

    const radios = screen.getAllByRole('radio');
    const radioLabels = radios.map((r) => r.textContent);
    expect(radioLabels.some((l) => /энергии|energy/i.test(l || ''))).toBe(true);
    expect(radioLabels.some((l) => /earshot/i.test(l || ''))).toBe(true);
    expect(radioLabels.some((l) => /silero/i.test(l || ''))).toBe(true);

    // One-line explanation of neural detector advantage
    expect(screen.getByText(/сигнал\/шум|signal-to-noise/i)).toBeDefined();
  });

  it('choosing Silero writes "silero" to config and preserves the selected state without folding into another backend', () => {
    const onChange = vi.fn();
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      vadBackend: 'energy',
    };
    const { rerender } = render(<AudioSettings config={config} onChange={onChange} />);

    // Click Silero option
    const sileroRadio = screen.getByRole('radio', { name: /silero/i });
    fireEvent.click(sileroRadio);
    expect(onChange).toHaveBeenCalledWith({ vadBackend: 'silero' });

    // When config has vadBackend: 'silero', it should stay 'silero' (not become earshot or energy)
    rerender(<AudioSettings config={{ ...config, vadBackend: 'silero' }} onChange={onChange} />);
    const activeRadio = screen.getByRole('radio', { name: /silero/i });
    expect(activeRadio.getAttribute('aria-checked')).toBe('true');
  });

  it('shows download hint with catalog entry name and download button when model is not installed', async () => {
    vi.mocked(stt.listModels).mockResolvedValue([
      {
        id: 'silero-vad',
        name: 'Silero VAD',
        bytes: 1807522,
        languages: [],
        installed: false,
      },
    ]);

    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      vadBackend: 'silero',
    };
    render(<AudioSettings config={config} onChange={vi.fn()} />);

    // Wait for model query to resolve
    await waitFor(() => {
      expect(screen.getByTestId('silero-download-card')).toBeDefined();
    });

    // Mentions silero-vad catalog entry
    expect(screen.getAllByText(/silero-vad/i).length).toBeGreaterThan(0);
    // Click download button
    const downloadBtn = screen.getByTestId('silero-download-btn');
    expect(downloadBtn).toBeDefined();
    fireEvent.click(downloadBtn);
    expect(stt.downloadModel).toHaveBeenCalledWith('silero-vad');
  });

  it('says Silero is ready when the model is installed', async () => {
    vi.mocked(stt.listModels).mockResolvedValue([
      {
        id: 'silero-vad',
        name: 'Silero VAD',
        bytes: 1807522,
        languages: [],
        installed: true,
      },
    ]);

    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      vadBackend: 'silero',
    };
    render(<AudioSettings config={config} onChange={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('silero-ready-badge')).toBeDefined();
    });

    expect(screen.getByText(/готова к работе|is ready/i)).toBeDefined();
    expect(screen.queryByTestId('silero-download-btn')).toBeNull();
  });

  it('shows reported fallback reason instead of pretending neural detector is running', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      vadBackend: 'silero',
      vadFallbackReason: 'Silero ONNX session creation failed: file missing or corrupt',
    };
    render(<AudioSettings config={config} onChange={vi.fn()} />);

    expect(screen.getByTestId('silero-fallback-notice')).toBeDefined();
    expect(
      screen.getByText(/Silero ONNX session creation failed: file missing or corrupt/),
    ).toBeDefined();

    // Selected value is still silero, not silently downgraded
    const sileroRadio = screen.getByRole('radio', { name: /silero/i });
    expect(sileroRadio.getAttribute('aria-checked')).toBe('true');
  });
});
