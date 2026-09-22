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
