import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from 'vitest';
import { render, act } from '@testing-library/react';
import {
  WinterCanvas,
  calculateHourglassAngle,
  FLIP_INTERVAL_MS,
  FLIP_DURATION_MS,
} from '../WinterCanvas';
import { TimerService, IDLE } from '../../services/timer';
import type { TimerSnapshot } from '../../services/timer';

describe('calculateHourglassAngle (pure angle math)', () => {
  it('returns 0 at 0 s when running', () => {
    expect(calculateHourglassAngle(0, true)).toBe(0);
  });

  it('returns 0 mid-cycle (2.5 s) when running', () => {
    expect(calculateHourglassAngle(2500, true)).toBe(0);
  });

  it('starts the flip at 5 s (angle is 0 at flip start)', () => {
    expect(calculateHourglassAngle(FLIP_INTERVAL_MS, true)).toBe(0);
  });

  it('reaches pi by ~5.7 s (5700 ms)', () => {
    const angleAtEnd = calculateHourglassAngle(FLIP_INTERVAL_MS + FLIP_DURATION_MS, true);
    expect(angleAtEnd).toBeCloseTo(Math.PI, 5);
  });

  it('is halfway through the flip at 5.35 s (~pi / 2)', () => {
    const angleMidFlip = calculateHourglassAngle(FLIP_INTERVAL_MS + FLIP_DURATION_MS / 2, true);
    expect(angleMidFlip).toBeCloseTo(Math.PI / 2, 3);
  });

  it('maintains pi until the next cycle begins', () => {
    expect(calculateHourglassAngle(6000, true)).toBeCloseTo(Math.PI, 5);
    expect(calculateHourglassAngle(8000, true)).toBeCloseTo(Math.PI, 5);
    expect(calculateHourglassAngle(10000, true)).toBeCloseTo(Math.PI, 5);
  });

  it('flips to 2*pi by ~10.7 s on the second cycle', () => {
    const angleSecondFlip = calculateHourglassAngle(2 * FLIP_INTERVAL_MS + FLIP_DURATION_MS, true);
    expect(angleSecondFlip).toBeCloseTo(2 * Math.PI, 5);
  });

  it('returns 0 whenever running is false regardless of elapsed time', () => {
    expect(calculateHourglassAngle(0, false)).toBe(0);
    expect(calculateHourglassAngle(2500, false)).toBe(0);
    expect(calculateHourglassAngle(5000, false)).toBe(0);
    expect(calculateHourglassAngle(5350, false)).toBe(0);
    expect(calculateHourglassAngle(5700, false)).toBe(0);
    expect(calculateHourglassAngle(10000, false)).toBe(0);
    expect(calculateHourglassAngle(10700, false)).toBe(0);
  });

  it('returns 0 for negative, non-finite, or zero elapsed time', () => {
    expect(calculateHourglassAngle(-1000, true)).toBe(0);
    expect(calculateHourglassAngle(NaN, true)).toBe(0);
    expect(calculateHourglassAngle(Infinity, true)).toBe(0);
  });
});

describe('WinterCanvas component', () => {
  let mockUnsubscribe: () => void;
  let subscriberCallback: ((state: TimerSnapshot) => void) | null = null;
  let rafCallback: FrameRequestCallback | null = null;
  let cancelRafSpy: MockInstance<(handle: number) => void>;

  beforeEach(() => {
    mockUnsubscribe = vi.fn();
    subscriberCallback = null;

    vi.spyOn(TimerService, 'getState').mockResolvedValue({
      ...IDLE,
      running: false,
    });

    vi.spyOn(TimerService, 'subscribe').mockImplementation((cb) => {
      subscriberCallback = cb;
      return mockUnsubscribe;
    });

    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      rafCallback = cb;
      return 123;
    });

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

  it('cancels animation frame on unmount', () => {
    const { unmount } = render(<WinterCanvas />);
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
    const mockCtx = {
      setTransform: vi.fn(),
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      createRadialGradient: vi.fn(() => ({
        addColorStop: vi.fn(),
      })),
    };

    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as never);

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
});
