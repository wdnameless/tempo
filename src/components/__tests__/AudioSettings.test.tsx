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
