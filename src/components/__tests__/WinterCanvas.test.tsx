import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  WinterCanvas,
  calculateHourglassAngle,
  calculateSandLevel,
  CYCLE_DURATION_MS,
  DRAIN_DURATION_MS,
  FLIP_DURATION_MS,
} from '../WinterCanvas';
import { soundService } from '../../services/sound';
import { TimerService, IDLE } from '../../services/timer';
import type { TimerSnapshot } from '../../services/timer';


vi.mock('../../services/sound', () => ({
  soundService: {
    playHourglassFlip: vi.fn(),
    playFlip: vi.fn(),
    playUiClick: vi.fn(),
  },
}));
describe('calculateSandLevel (pure sand level math)', () => {
  it('returns 1 (full) at 0 ms', () => {
    expect(calculateSandLevel(0)).toBe(1);
  });

  it('returns 1 (full) for negative or non-finite elapsed time', () => {
    expect(calculateSandLevel(-500)).toBe(1);
    expect(calculateSandLevel(NaN)).toBe(1);
    expect(calculateSandLevel(Infinity)).toBe(1);
  });

  it('returns 0.5 (half full) exactly mid-drain', () => {
    expect(calculateSandLevel(DRAIN_DURATION_MS / 2)).toBeCloseTo(0.5, 5);
  });

  it('returns 0 (empty) at the end of drain', () => {
    expect(calculateSandLevel(DRAIN_DURATION_MS)).toBe(0);
  });

  it('remains 0 (empty) throughout the flip duration', () => {
    expect(calculateSandLevel(DRAIN_DURATION_MS + FLIP_DURATION_MS / 2)).toBe(0);
    expect(calculateSandLevel(CYCLE_DURATION_MS - 1)).toBe(0);
  });

  it('resets to 1 (full) at the start of the next cycle', () => {
    expect(calculateSandLevel(CYCLE_DURATION_MS)).toBe(1);
    expect(calculateSandLevel(CYCLE_DURATION_MS + DRAIN_DURATION_MS / 2)).toBeCloseTo(0.5, 5);
  });
});

describe('calculateHourglassAngle (pure angle math)', () => {
  it('returns 0 at 0 s when running', () => {
    expect(calculateHourglassAngle(0, true)).toBe(0);
  });

  it('returns 0 mid-drain when running', () => {
    expect(calculateHourglassAngle(DRAIN_DURATION_MS / 2, true)).toBe(0);
  });

  it('remains 0 right until the sand runs out (start of flip)', () => {
    expect(calculateHourglassAngle(DRAIN_DURATION_MS, true)).toBe(0);
  });

  it('is halfway through the flip (~pi / 2) mid-flip', () => {
    const angleMidFlip = calculateHourglassAngle(DRAIN_DURATION_MS + FLIP_DURATION_MS / 2, true);
    expect(angleMidFlip).toBeCloseTo(Math.PI / 2, 3);
  });

  it('reaches pi at the end of the flip', () => {
    const angleAtEnd = calculateHourglassAngle(DRAIN_DURATION_MS + FLIP_DURATION_MS, true);
    expect(angleAtEnd).toBeCloseTo(Math.PI, 5);
  });

  it('maintains pi during the second cycle drain until its flip', () => {
    expect(calculateHourglassAngle(CYCLE_DURATION_MS + 1000, true)).toBeCloseTo(Math.PI, 5);
    expect(calculateHourglassAngle(CYCLE_DURATION_MS + DRAIN_DURATION_MS / 2, true)).toBeCloseTo(Math.PI, 5);
    expect(calculateHourglassAngle(CYCLE_DURATION_MS + DRAIN_DURATION_MS, true)).toBeCloseTo(Math.PI, 5);
  });

  it('flips to 2*pi by the end of the second cycle', () => {
    const angleSecondFlip = calculateHourglassAngle(CYCLE_DURATION_MS + DRAIN_DURATION_MS + FLIP_DURATION_MS, true);
    expect(angleSecondFlip).toBeCloseTo(2 * Math.PI, 5);
  });

  it('returns 0 whenever running is false regardless of elapsed time', () => {
    expect(calculateHourglassAngle(0, false)).toBe(0);
    expect(calculateHourglassAngle(DRAIN_DURATION_MS / 2, false)).toBe(0);
    expect(calculateHourglassAngle(DRAIN_DURATION_MS, false)).toBe(0);
    expect(calculateHourglassAngle(DRAIN_DURATION_MS + FLIP_DURATION_MS / 2, false)).toBe(0);
    expect(calculateHourglassAngle(CYCLE_DURATION_MS, false)).toBe(0);
    expect(calculateHourglassAngle(CYCLE_DURATION_MS * 2, false)).toBe(0);
  });

  it('returns 0 for negative, non-finite, or zero elapsed time', () => {
    expect(calculateHourglassAngle(-1000, true)).toBe(0);
    expect(calculateHourglassAngle(NaN, true)).toBe(0);
    expect(calculateHourglassAngle(Infinity, true)).toBe(0);
  });
});

/**
 * jsdom hands out a 2D context only when the optional native `canvas` package
 * happens to be installed. The animation path must not depend on that, so the
 * context is stubbed for every test in this file.
 */
function createMockContext() {
  return {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    beginPath: vi.fn(),
    closePath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  };
}

describe('WinterCanvas component', () => {
  let mockUnsubscribe: () => void;
  let subscriberCallback: ((state: TimerSnapshot) => void) | null = null;
  let rafCallback: FrameRequestCallback | null = null;
  let cancelRafSpy: MockInstance<(handle: number) => void>;
  let rafSpy: MockInstance<(cb: FrameRequestCallback) => number>;

  beforeEach(() => {
    mockUnsubscribe = vi.fn();
    subscriberCallback = null;
    vi.mocked(soundService.playHourglassFlip).mockClear();
    vi.mocked(soundService.playFlip).mockClear();

    vi.spyOn(TimerService, 'getState').mockResolvedValue({
      ...IDLE,
      running: false,
    });

    vi.spyOn(TimerService, 'subscribe').mockImplementation((cb) => {
      subscriberCallback = cb;
      return mockUnsubscribe;
    });

    rafSpy = vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 123;
    });

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      createMockContext() as never,
    );

    cancelRafSpy = vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});

    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 800,
      height: 600,
      top: 0,
      left: 0,
      bottom: 600,
      right: 800,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('subscribes to TimerService on mount and unsubscribes on unmount', async () => {
    const { unmount } = render(<WinterCanvas />);

    expect(TimerService.getState).toHaveBeenCalledTimes(1);
    expect(TimerService.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriberCallback).toBeTypeOf('function');

    unmount();

    expect(mockUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('cancels the animation frame it scheduled on unmount', () => {
    const { unmount } = render(<WinterCanvas />);

    expect(
      rafSpy,
      'the loop must schedule a frame when the canvas has a size',
    ).toHaveBeenCalled();

    unmount();
    expect(cancelRafSpy).toHaveBeenCalledWith(123);
  });
  it('does not start animation loop when canvas has zero dimensions', () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 0,
      height: 0,
      top: 0,
      left: 0,
      bottom: 0,
      right: 0,
      x: 0,
      y: 0,
      toJSON: () => {},
    });
    const rafSpy = vi.spyOn(window, 'requestAnimationFrame');
    render(<WinterCanvas />);
    expect(rafSpy).not.toHaveBeenCalled();
  });


  it('does not call setState from the animation loop', async () => {
    let renderCount = 0;
    function Tracker() {
      renderCount++;
      return <WinterCanvas />;
    }

    render(<Tracker />);
    expect(renderCount).toBe(1);

    // Simulate timer running update via subscription
    await act(async () => {
      subscriberCallback?.({ ...IDLE, running: true });
    });
    // Component must not re-render on timer state changes (held in ref)
    expect(renderCount).toBe(1);

    // Simulate multiple animation loop frames
    await act(async () => {
      if (rafCallback) {
        rafCallback(1000);
      }
      if (rafCallback) {
        rafCallback(5350);
      }
      if (rafCallback) {
        rafCallback(5700);
      }
    });

    // Still exactly 1 render; zero setState calls during RAF
    expect(renderCount).toBe(1);
  });

  it('freezes sand level and flip angle when timer is stopped', () => {
    // When timer is not running, calculateHourglassAngle always returns 0 regardless of time
    expect(calculateHourglassAngle(15000, false)).toBe(0);
    expect(calculateHourglassAngle(60000, false)).toBe(0);

    // Sand level at frozen elapsed point remains fixed
    const frozenElapsed = 30000;
    const level1 = calculateSandLevel(frozenElapsed);
    const level2 = calculateSandLevel(frozenElapsed);
    expect(level1).toBe(level2);
    expect(level1).toBeCloseTo(1 - 30000 / DRAIN_DURATION_MS, 5);
  });

  it('fires flip sound exactly once per flip cycle while running and never when stopped', async () => {
    render(<WinterCanvas />);

    // Initially timer is stopped. Advancing frames across what would be flip boundaries produces no sound.
    await act(async () => {
      rafCallback?.(0);
      rafCallback?.(DRAIN_DURATION_MS);
      rafCallback?.(DRAIN_DURATION_MS + 500);
      rafCallback?.(CYCLE_DURATION_MS + 100);
    });

    expect(soundService.playHourglassFlip).not.toHaveBeenCalled();

    // Start timer via subscription update
    await act(async () => {
      subscriberCallback?.({ ...IDLE, running: true });
    });

    // First active frame sets baseline lastActiveTime
    await act(async () => {
      rafCallback?.(1000);
    });
    expect(soundService.playHourglassFlip).not.toHaveBeenCalled();

    // Advance mid-drain (sand pouring, not flipping yet)
    await act(async () => {
      rafCallback?.(1000 + DRAIN_DURATION_MS / 2);
    });
    expect(soundService.playHourglassFlip).not.toHaveBeenCalled();

    // Reaching flip threshold triggers the flip cue
    await act(async () => {
      rafCallback?.(1000 + DRAIN_DURATION_MS);
    });
    expect(soundService.playHourglassFlip).toHaveBeenCalledTimes(1);

    // Subsequent frames during the flip do not fire duplicate sounds
    await act(async () => {
      rafCallback?.(1000 + DRAIN_DURATION_MS + 200);
      rafCallback?.(1000 + DRAIN_DURATION_MS + 600);
      rafCallback?.(1000 + CYCLE_DURATION_MS - 10);
    });
    expect(soundService.playHourglassFlip).toHaveBeenCalledTimes(1);

    // Next cycle starts, sand drains, reaches second cycle flip threshold
    await act(async () => {
      rafCallback?.(1000 + CYCLE_DURATION_MS + DRAIN_DURATION_MS);
    });
    expect(soundService.playHourglassFlip).toHaveBeenCalledTimes(2);

    // Stop timer
    await act(async () => {
      subscriberCallback?.({ ...IDLE, running: false });
    });

    // Even if time keeps passing, stopped timer never triggers flip sound
    await act(async () => {
      rafCallback?.(1000 + 2 * CYCLE_DURATION_MS + DRAIN_DURATION_MS);
      rafCallback?.(1000 + 3 * CYCLE_DURATION_MS + DRAIN_DURATION_MS);
    });
    expect(soundService.playHourglassFlip).toHaveBeenCalledTimes(2);
  });
});
