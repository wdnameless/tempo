import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  currentFocusSound,
  startFocusAudio,
  _setAudioContextForTesting,
  _resetAudioContextForTesting,
  FOCUS_SOUNDS,
} from '../focusAudio';
import { StoreService } from '../store';

// Helper mock AudioContext
class MockAudioNode {
  connect = vi.fn().mockReturnValue(this);
  disconnect = vi.fn();
}

class MockGainNode extends MockAudioNode {
  gain = {
    value: 1,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
  };
}

class MockBiquadFilterNode extends MockAudioNode {
  type: BiquadFilterType = 'lowpass';
  frequency = {
    value: 350,
    setValueAtTime: vi.fn(),
  };
  Q = {
    value: 1,
    setValueAtTime: vi.fn(),
  };
}

class MockAudioBufferSourceNode extends MockAudioNode {
  buffer: AudioBuffer | null = null;
  loop = false;
  start = vi.fn();
  stop = vi.fn();
}

class MockOscillatorNode extends MockAudioNode {
  type: OscillatorType = 'sine';
  frequency = {
    value: 440,
    setValueAtTime: vi.fn(),
  };
  start = vi.fn();
  stop = vi.fn();
}

class MockAudioContext {
  state: AudioContextState = 'running';
  sampleRate = 44100;
  currentTime = 0;
  destination = new MockAudioNode();

  createdSources: MockAudioBufferSourceNode[] = [];
  createdOscillators: MockOscillatorNode[] = [];
  createdGains: MockGainNode[] = [];
  createdFilters: MockBiquadFilterNode[] = [];

  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);

  createBuffer(channels: number, length: number, sampleRate: number): AudioBuffer {
    const data = new Float32Array(length);
    return {
      numberOfChannels: channels,
      length,
      sampleRate,
      duration: length / sampleRate,
      getChannelData: vi.fn().mockReturnValue(data),
      copyFromChannel: vi.fn(),
      copyToChannel: vi.fn(),
    } as unknown as AudioBuffer;
  }

  createBufferSource(): MockAudioBufferSourceNode {
    const src = new MockAudioBufferSourceNode();
    this.createdSources.push(src);
    return src;
  }

  createGain(): MockGainNode {
    const gain = new MockGainNode();
    this.createdGains.push(gain);
    return gain;
  }

  createBiquadFilter(): MockBiquadFilterNode {
    const filter = new MockBiquadFilterNode();
    this.createdFilters.push(filter);
    return filter;
  }

  createOscillator(): MockOscillatorNode {
    const osc = new MockOscillatorNode();
    this.createdOscillators.push(osc);
    return osc;
  }
}

describe('focusAudio service', () => {
  let mockContext: MockAudioContext;

  beforeEach(() => {
    _resetAudioContextForTesting();
    StoreService.resetCache();
    StoreService.setPreference('tempo_focus_sound', 'none');

    mockContext = new MockAudioContext();
    _setAudioContextForTesting(mockContext as unknown as AudioContext);
  });

  afterEach(() => {
    _resetAudioContextForTesting();
    vi.restoreAllMocks();
  });

  it('exports valid FOCUS_SOUNDS presets', () => {
    const ids = FOCUS_SOUNDS.map((s) => s.id);
    expect(ids).toEqual(['none', 'brown', 'white', 'rain', 'cafe']);
  });

  it('currentFocusSound reads the stored preference and falls back to none', () => {
    expect(currentFocusSound()).toBe('none');

    StoreService.setPreference('tempo_focus_sound', 'brown');
    expect(currentFocusSound()).toBe('brown');

    StoreService.setPreference('tempo_focus_sound', 'invalid_id');
    expect(currentFocusSound()).toBe('none');
  });

  it('startFocusAudio("none") stops playback and updates preference', () => {
    startFocusAudio('white');
    expect(mockContext.createdSources.length).toBe(1);
    expect(currentFocusSound()).toBe('white');

    startFocusAudio('none');
    expect(currentFocusSound()).toBe('none');
    expect(mockContext.createdSources[0].stop).toHaveBeenCalled();
  });

  it('starting twice with the same id does not create two sources', () => {
    startFocusAudio('brown');
    expect(mockContext.createdSources.length).toBe(1);

    // Call start again with brown - should be idempotent
    startFocusAudio('brown');
    expect(mockContext.createdSources.length).toBe(1);
  });

  it('an unknown id is rejected rather than played', () => {
    // @ts-expect-error test unknown sound id
    startFocusAudio('unknown_preset');
    expect(mockContext.createdSources.length).toBe(0);
    expect(currentFocusSound()).toBe('none');
  });

  it('switching sounds stops previous sound and starts new sound', () => {
    startFocusAudio('white');
    expect(mockContext.createdSources.length).toBe(1);
    const firstSource = mockContext.createdSources[0];

    startFocusAudio('rain');
    expect(firstSource.stop).toHaveBeenCalled();
    expect(mockContext.createdSources.length).toBe(2);
    expect(mockContext.createdOscillators.length).toBe(1);
    expect(currentFocusSound()).toBe('rain');
  });

  it('plays cafe preset with lowpass filter and rumble oscillator', () => {
    startFocusAudio('cafe');
    expect(mockContext.createdSources.length).toBe(1);
    expect(mockContext.createdOscillators.length).toBe(1);
    expect(mockContext.createdFilters.length).toBe(1);
    expect(currentFocusSound()).toBe('cafe');
  });

  it('degrades gracefully when AudioContext is unavailable', () => {
    _setAudioContextForTesting(null);
    // @ts-expect-error test mock
    window.AudioContext = undefined;
    // @ts-expect-error test mock
    window.webkitAudioContext = undefined;

    expect(() => startFocusAudio('white')).not.toThrow();
    expect(currentFocusSound()).toBe('white');
  });
});
