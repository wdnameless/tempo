import React, { useEffect, useRef } from 'react';
import { TimerService } from '../services/timer';
import { soundService } from '../services/sound';

export interface WinterCanvasProps {
  className?: string;
}

export const CYCLE_DURATION_MS = 60000;
export const FLIP_DURATION_MS = 1200;
export const DRAIN_DURATION_MS = CYCLE_DURATION_MS - FLIP_DURATION_MS; // 58800 ms

/**
 * Backward-compatible alias for existing imports / callers.
 * The flip interval is driven by the sand cycle length.
 */
export const FLIP_INTERVAL_MS = CYCLE_DURATION_MS;

/**
 * Calculates the remaining sand level in the upper chamber as a ratio [0, 1].
 * 1 = completely full (start of cycle), 0 = completely drained (end of drain).
 * While flipping (the remaining time of the cycle), sand level stays 0 (empty).
 *
 * Pure function of elapsed time.
 *
 * @param elapsedMs - Milliseconds elapsed while timer has been active.
 * @returns Ratio from 1 (full) down to 0 (empty).
 */
export function calculateSandLevel(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 1;
  }
  const timeIntoCycle = elapsedMs % CYCLE_DURATION_MS;
  if (timeIntoCycle >= DRAIN_DURATION_MS) {
    return 0;
  }
  return 1 - timeIntoCycle / DRAIN_DURATION_MS;
}

/**
 * Calculates the flip rotation angle of the hourglass in radians.
 * The flip occurs at the end of each cycle when the sand has completely drained.
 *
 * @param elapsedMs - Milliseconds elapsed while timer has been active.
 * @param running - Whether the timer is currently running.
 * @returns Hourglass rotation angle in radians around the flip axis.
 */
export function calculateHourglassAngle(elapsedMs: number, running: boolean): number {
  if (!running || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }

  const cycleIndex = Math.floor(elapsedMs / CYCLE_DURATION_MS);
  const baseAngle = cycleIndex * Math.PI;
  const timeIntoCycle = elapsedMs % CYCLE_DURATION_MS;

  if (timeIntoCycle < DRAIN_DURATION_MS) {
    return baseAngle;
  }

  const flipProgress = Math.min(1, (timeIntoCycle - DRAIN_DURATION_MS) / FLIP_DURATION_MS);
  // Smooth ease-in-out curve (cosine ease)
  const eased = 0.5 * (1 - Math.cos(flipProgress * Math.PI));
  return baseAngle + eased * Math.PI;
}

interface Star {
  xRatio: number;
  yRatio: number;
  radius: number;
  baseAlpha: number;
  phase: number;
  speed: number;
}

interface SandGrain {
  readonly uRatio: number;
  readonly xRatio: number;
  readonly zRatio: number;
  readonly phase: number;
  readonly speed: number;
}

interface StreamGrain {
  readonly xOffset: number;
  readonly phase: number;
  readonly speed: number;
}

// Fixed pre-allocated grain distributions (zero per-frame allocations)
const UPPER_GRAINS: readonly SandGrain[] = [
  { uRatio: 0.15, xRatio: -0.35, zRatio: 0.2, phase: 0.4, speed: 0.9 },
  { uRatio: 0.28, xRatio: 0.42, zRatio: -0.3, phase: 1.2, speed: 1.1 },
  { uRatio: 0.40, xRatio: -0.18, zRatio: 0.4, phase: 2.1, speed: 0.8 },
  { uRatio: 0.52, xRatio: 0.25, zRatio: 0.1, phase: 0.8, speed: 1.2 },
  { uRatio: 0.65, xRatio: -0.45, zRatio: -0.2, phase: 3.0, speed: 0.7 },
  { uRatio: 0.72, xRatio: 0.12, zRatio: 0.3, phase: 1.7, speed: 1.0 },
  { uRatio: 0.83, xRatio: -0.22, zRatio: -0.4, phase: 2.6, speed: 0.9 },
  { uRatio: 0.90, xRatio: 0.38, zRatio: 0.2, phase: 0.3, speed: 1.3 },
  { uRatio: 0.33, xRatio: 0.05, zRatio: -0.1, phase: 1.9, speed: 0.8 },
  { uRatio: 0.58, xRatio: -0.30, zRatio: 0.2, phase: 2.7, speed: 1.1 },
  { uRatio: 0.77, xRatio: 0.32, zRatio: -0.3, phase: 0.5, speed: 1.0 },
  { uRatio: 0.88, xRatio: -0.10, zRatio: 0.1, phase: 3.4, speed: 0.9 },
  { uRatio: 0.22, xRatio: -0.52, zRatio: 0.3, phase: 1.4, speed: 1.2 },
  { uRatio: 0.48, xRatio: 0.50, zRatio: -0.2, phase: 2.3, speed: 0.8 },
  { uRatio: 0.62, xRatio: -0.08, zRatio: 0.4, phase: 0.9, speed: 1.0 },
  { uRatio: 0.81, xRatio: 0.22, zRatio: -0.1, phase: 3.2, speed: 1.1 },
  { uRatio: 0.95, xRatio: -0.25, zRatio: 0.2, phase: 1.6, speed: 0.9 },
  { uRatio: 0.18, xRatio: 0.28, zRatio: -0.4, phase: 2.8, speed: 1.0 },
  { uRatio: 0.37, xRatio: -0.40, zRatio: 0.1, phase: 0.6, speed: 1.2 },
  { uRatio: 0.70, xRatio: 0.45, zRatio: 0.3, phase: 2.2, speed: 0.8 },
];

const LOWER_GRAINS: readonly SandGrain[] = [
  { uRatio: 0.12, xRatio: -0.20, zRatio: 0.2, phase: 0.6, speed: 1.0 },
  { uRatio: 0.18, xRatio: 0.18, zRatio: -0.3, phase: 1.5, speed: 0.8 },
  { uRatio: 0.25, xRatio: -0.35, zRatio: 0.1, phase: 2.4, speed: 1.2 },
  { uRatio: 0.32, xRatio: 0.30, zRatio: 0.4, phase: 0.9, speed: 0.9 },
  { uRatio: 0.38, xRatio: -0.12, zRatio: -0.2, phase: 3.1, speed: 1.1 },
  { uRatio: 0.44, xRatio: 0.42, zRatio: 0.2, phase: 1.8, speed: 0.7 },
  { uRatio: 0.50, xRatio: -0.48, zRatio: -0.4, phase: 2.5, speed: 1.0 },
  { uRatio: 0.56, xRatio: 0.10, zRatio: 0.3, phase: 0.3, speed: 1.3 },
  { uRatio: 0.62, xRatio: -0.28, zRatio: 0.1, phase: 1.7, speed: 0.8 },
  { uRatio: 0.68, xRatio: 0.36, zRatio: -0.1, phase: 3.3, speed: 1.1 },
  { uRatio: 0.74, xRatio: -0.52, zRatio: 0.3, phase: 0.7, speed: 0.9 },
  { uRatio: 0.80, xRatio: 0.22, zRatio: -0.3, phase: 2.0, speed: 1.2 },
  { uRatio: 0.85, xRatio: -0.15, zRatio: 0.2, phase: 1.1, speed: 1.0 },
  { uRatio: 0.90, xRatio: 0.48, zRatio: 0.1, phase: 2.8, speed: 0.8 },
  { uRatio: 0.94, xRatio: -0.40, zRatio: -0.2, phase: 0.5, speed: 1.1 },
  { uRatio: 0.98, xRatio: 0.05, zRatio: 0.4, phase: 1.9, speed: 0.9 },
  { uRatio: 0.22, xRatio: 0.05, zRatio: -0.1, phase: 2.9, speed: 1.2 },
  { uRatio: 0.35, xRatio: -0.25, zRatio: 0.3, phase: 1.3, speed: 0.7 },
  { uRatio: 0.48, xRatio: 0.24, zRatio: -0.2, phase: 0.2, speed: 1.0 },
  { uRatio: 0.58, xRatio: -0.05, zRatio: 0.1, phase: 2.7, speed: 1.3 },
  { uRatio: 0.72, xRatio: 0.15, zRatio: 0.4, phase: 1.4, speed: 0.8 },
  { uRatio: 0.82, xRatio: -0.32, zRatio: -0.3, phase: 3.5, speed: 1.0 },
  { uRatio: 0.88, xRatio: 0.38, zRatio: 0.2, phase: 0.8, speed: 1.1 },
  { uRatio: 0.96, xRatio: -0.18, zRatio: -0.1, phase: 2.2, speed: 0.9 },
];

const STREAM_GRAINS: readonly StreamGrain[] = [
  { xOffset: -0.25, phase: 0.08, speed: 1.1 },
  { xOffset: 0.20, phase: 0.22, speed: 1.3 },
  { xOffset: -0.10, phase: 0.39, speed: 0.95 },
  { xOffset: 0.15, phase: 0.53, speed: 1.2 },
  { xOffset: -0.30, phase: 0.68, speed: 1.05 },
  { xOffset: 0.28, phase: 0.81, speed: 1.25 },
  { xOffset: 0.00, phase: 0.14, speed: 1.15 },
  { xOffset: -0.18, phase: 0.45, speed: 1.0 },
  { xOffset: 0.12, phase: 0.72, speed: 1.35 },
  { xOffset: -0.05, phase: 0.91, speed: 1.1 },
  { xOffset: 0.22, phase: 0.31, speed: 0.9 },
  { xOffset: -0.22, phase: 0.60, speed: 1.2 },
];

const IMPACT_GRAINS: readonly { readonly xMult: number; readonly speed: number }[] = [
  { xMult: -0.7, speed: 1.2 },
  { xMult: 0.7, speed: 1.0 },
  { xMult: -1.3, speed: 0.8 },
  { xMult: 1.3, speed: 1.1 },
];

/**
 * WinterCanvas renders the signature trywinter.app ambient background:
 * - Subtle wavy latitude curves across space drifting and breathing over time
 * - Scattered glowing star particles with twinkling
 * - Central 3D wireframe nested hourglasses with center star
 * - Flips 180° every 5 seconds while the timer is running
 *
 * Runs strictly below 1% CPU with zero per-frame allocations.
 */
export function WinterCanvas({ className = '' }: WinterCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runningRef = useRef(false);

  // Subscribe to backend timer state without triggering React re-renders
  useEffect(() => {
    let mounted = true;

    void TimerService.getState()
      .then((st) => {
        if (mounted && st) {
          runningRef.current = Boolean(st.running);
        }
      })
      .catch(() => {
        // Backend unavailable in test or non-Tauri mode
      });

    const unsubscribe = TimerService.subscribe((next) => {
      if (next) {
        runningRef.current = Boolean(next.running);
      }
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId = 0;
    let width = 0;
    let height = 0;
    let cx = 0;
    let cy = 0;
    let angle = 0;
    let haloGrad: CanvasGradient | null = null;
    let lastTime = performance.now();
    let wasRunning = false;
    let accumulatedElapsed = 0;
    let lastActiveTime = 0;
    let lastFlippedCycle = -1;
    let lastAccumulatedElapsed = 0;
    // Fixed seeded star distribution across the canvas (matches reference)
    const stars: Star[] = [
      { xRatio: 0.11, yRatio: 0.33, radius: 2.0, baseAlpha: 0.9, phase: 0.2, speed: 0.8 },
      { xRatio: 0.23, yRatio: 0.61, radius: 1.8, baseAlpha: 0.8, phase: 1.5, speed: 0.9 },
      { xRatio: 0.04, yRatio: 0.77, radius: 1.6, baseAlpha: 0.7, phase: 2.7, speed: 0.7 },
      { xRatio: 0.33, yRatio: 0.32, radius: 1.5, baseAlpha: 0.85, phase: 0.9, speed: 1.1 },
      { xRatio: 0.38, yRatio: 0.32, radius: 1.7, baseAlpha: 0.95, phase: 1.8, speed: 0.8 },
      { xRatio: 0.45, yRatio: 0.13, radius: 2.2, baseAlpha: 0.95, phase: 3.1, speed: 0.6 },
      { xRatio: 0.48, yRatio: 0.24, radius: 1.8, baseAlpha: 0.8, phase: 4.2, speed: 1.0 },
      { xRatio: 0.51, yRatio: 0.42, radius: 2.0, baseAlpha: 0.95, phase: 0.5, speed: 0.7 },
      { xRatio: 0.44, yRatio: 0.82, radius: 1.9, baseAlpha: 0.85, phase: 2.1, speed: 0.9 },
      { xRatio: 0.61, yRatio: 0.49, radius: 2.2, baseAlpha: 0.95, phase: 1.1, speed: 0.8 },
      { xRatio: 0.66, yRatio: 0.17, radius: 1.6, baseAlpha: 0.75, phase: 3.8, speed: 1.2 },
      { xRatio: 0.81, yRatio: 0.36, radius: 1.7, baseAlpha: 0.8, phase: 2.9, speed: 0.7 },
      { xRatio: 0.79, yRatio: 0.66, radius: 1.7, baseAlpha: 0.75, phase: 0.4, speed: 0.8 },
      { xRatio: 0.90, yRatio: 0.14, radius: 1.8, baseAlpha: 0.85, phase: 1.9, speed: 1.0 },
      { xRatio: 0.92, yRatio: 0.69, radius: 2.0, baseAlpha: 0.9, phase: 4.7, speed: 0.9 },
    ];


    // Scratch projection outputs (avoids any [x, y] tuple allocations per frame)
    let pX = 0;
    let pY = 0;

    /**
     * Renders a 3D wireframe hourglass.
     * Proportions match HandHourglass (src/components/CustomIcons.tsx):
     * top plate, bottom plate, waist ring, and 4 side curves meeting at the waist.
     */
    const drawHourglass = (
      scale: number,
      rotX: number,
      rotY: number,
      rotZ: number,
      strokeColor: string,
      sandRatio: number,
      isPrimary = true,
      animTime = 0
    ) => {
      const h = scale * 1.2;
      const w = h * 0.694;
      const rw = w * 0.1;

      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const cosZ = Math.cos(rotZ);
      const sinZ = Math.sin(rotZ);

      const project = (x: number, y: number, z: number) => {
        const x1 = x * cosY + z * sinY;
        const z1 = -x * sinY + z * cosY;

        const y2 = y * cosX - z1 * sinX;
        const z2 = y * sinX + z1 * cosX;

        const x3 = x1 * cosZ - y2 * sinZ;
        const y3 = x1 * sinZ + y2 * cosZ;

        const fov = 500;
        const scaleP = fov / (fov + z2 + 250);
        pX = cx + x3 * scaleP;
        pY = cy + y3 * scaleP;
      };

      const RIB_STEPS = 12;

      const traceProfile = (startU: number, endU: number, sign: number) => {
        for (let s = 0; s <= RIB_STEPS; s++) {
          const u = startU + (endU - startU) * (s / RIB_STEPS);
          const rad = rw + (w - rw) * (0.3 * Math.abs(u) + 0.7 * u * u);
          project(sign * rad, u * h, 0);
          if (s === 0 && sign > 0) ctx.moveTo(pX, pY);
          else ctx.lineTo(pX, pY);
        }
      };

      // Render sand inside the glass chambers
      if (sandRatio > 0.001 || sandRatio < 0.999) {
        const lowerRatio = 1 - sandRatio;
        const moundPeak = 0.055 * Math.sin(Math.min(Math.PI, lowerRatio * Math.PI * 0.95));
        const fillU = 1 - lowerRatio;
        const moundTopU = lowerRatio > 0.01 ? fillU - moundPeak : 1;

        const drawGrainField = (grains: readonly SandGrain[], startU: number, spanU: number) => {
          ctx.fillStyle = '#ffffff';
          for (let i = 0; i < grains.length; i++) {
            const g = grains[i];
            const gu = startU + g.uRatio * spanU;
            const grad = rw + (w - rw) * (0.3 * Math.abs(gu) + 0.7 * gu * gu);
            project(g.xRatio * grad * 0.85, gu * h, g.zRatio * grad * 0.5);
            const flicker = Math.sin(animTime * 0.004 * g.speed + g.phase) * 0.08;
            ctx.globalAlpha = Math.max(0.06, Math.min(0.28, 0.14 + flicker));
            ctx.fillRect(pX - 0.5, pY - 0.5, 1.1, 1.1);
          }
          ctx.globalAlpha = 1.0;
        };
        const traceTransverseSurface = (isTop: boolean, rad: number, baseU: number) => {
          project(-rad, baseU * h, 0);
          ctx.moveTo(pX, pY);
          for (let s = 1; s <= 8; s++) {
            const t = -1 + s * 0.25;
            const u = isTop
              ? baseU + 0.04 * (1 - t * t) * Math.min(1, sandRatio * 2) + Math.sin(t * 6.0 + animTime * 0.003) * 0.004 * (1 - t * t)
              : baseU - moundPeak * Math.cos(t * Math.PI * 0.5) * Math.cos(t * Math.PI * 0.5);
            project(t * rad, u * h, 0);
            ctx.lineTo(pX, pY);
          }
        };

        // Upper chamber sand: level drops as sandRatio decreases from 1 to 0
        if (sandRatio > 0.01) {
          const topU = -sandRatio; // -1 (full) to ~0 (empty)
          const radTop = rw + (w - rw) * (0.3 * Math.abs(topU) + 0.7 * topU * topU);

          ctx.beginPath();
          traceTransverseSurface(true, radTop, topU);
          traceProfile(topU, 0, 1);
          traceProfile(0, topU, -1);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
          ctx.fill();

          ctx.beginPath();
          traceTransverseSurface(true, radTop, topU);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.lineWidth = 1;
          ctx.stroke();

          if (isPrimary) {
            drawGrainField(UPPER_GRAINS, topU, -topU);
          }
        }

        // Lower chamber sand: level rises as lowerRatio increases from 0 to 1
        if (lowerRatio > 0.01) {
          const radFill = rw + (w - rw) * (0.3 * fillU + 0.7 * fillU * fillU);

          ctx.beginPath();
          traceTransverseSurface(false, radFill, fillU);
          traceProfile(fillU, 1, 1);
          project(w, h, 0);
          ctx.lineTo(pX, pY);
          project(-w, h, 0);
          ctx.lineTo(pX, pY);
          traceProfile(1, fillU, -1);
          ctx.closePath();
          ctx.fillStyle = 'rgba(255, 255, 255, 0.055)';
          ctx.fill();

          ctx.beginPath();
          traceTransverseSurface(false, radFill, fillU);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.16)';
          ctx.lineWidth = 1;
          ctx.stroke();

          if (isPrimary) {
            drawGrainField(LOWER_GRAINS, fillU, 1 - fillU);
          }
        }

        // Visible stream pouring through the neck while draining
        if (sandRatio > 0.01 && sandRatio < 0.99) {
          // Central stream line
          ctx.beginPath();
          project(0, -0.06 * h, 0);
          ctx.moveTo(pX, pY);
          project(0, moundTopU * h, 0);
          ctx.lineTo(pX, pY);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
          ctx.lineWidth = 1.2;
          ctx.stroke();

          // Subtle neck stream borders
          ctx.beginPath();
          project(-0.25 * rw, -0.04 * h, 0);
          ctx.moveTo(pX, pY);
          project(-0.35 * rw, moundTopU * 0.6 * h, 0);
          ctx.lineTo(pX, pY);
          project(0.25 * rw, -0.04 * h, 0);
          ctx.moveTo(pX, pY);
          project(0.35 * rw, moundTopU * 0.6 * h, 0);
          ctx.lineTo(pX, pY);
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
          ctx.lineWidth = 0.8;
          ctx.stroke();

          if (isPrimary) {
            // Fast falling grains along the stream with faint motion flicker
            ctx.fillStyle = '#ffffff';
            for (let i = 0; i < STREAM_GRAINS.length; i++) {
              const sg = STREAM_GRAINS[i];
              const prog = (sg.phase + animTime * 0.0016 * sg.speed) % 1;
              const su = -0.05 + prog * (moundTopU - (-0.05));
              const spread = (prog < 0.15 ? prog / 0.15 : 1) * (0.8 + 0.4 * prog);
              const sx = sg.xOffset * rw * spread;
              project(sx, su * h, 0);
              const alpha = 0.22 + 0.16 * Math.sin(animTime * 0.03 + i * 2.1);
              ctx.globalAlpha = Math.max(0.08, Math.min(0.45, alpha));
              ctx.fillRect(pX - 0.6, pY - 0.6, 1.2, 1.2);
            }

            // Mound landing impact / settling grains
            for (let i = 0; i < IMPACT_GRAINS.length; i++) {
              const ig = IMPACT_GRAINS[i];
              const impactX = ig.xMult * rw;
              project(impactX, (moundTopU + 0.008) * h, 0);
              const alpha = 0.16 + 0.12 * Math.sin(animTime * 0.02 * ig.speed + i * 1.5);
              ctx.globalAlpha = Math.max(0.06, Math.min(0.35, alpha));
              ctx.fillRect(pX - 0.5, pY - 0.5, 1.0, 1.0);
            }
            ctx.globalAlpha = 1.0;
          }
        }
      }

      ctx.lineWidth = 1;
      ctx.strokeStyle = strokeColor;
      ctx.beginPath();

      // 1. Top rim
      const RIM_SEGS = 16;
      for (let j = 0; j <= RIM_SEGS; j++) {
        const a = (j % RIM_SEGS) * ((Math.PI * 2) / RIM_SEGS);
        project(w * Math.cos(a), -h, w * Math.sin(a));
        if (j === 0) ctx.moveTo(pX, pY);
        else ctx.lineTo(pX, pY);
      }

      // 2. Top plate cross / bar
      project(-w, -h, 0);
      ctx.moveTo(pX, pY);
      project(w, -h, 0);
      ctx.lineTo(pX, pY);

      project(0, -h, -w);
      ctx.moveTo(pX, pY);
      project(0, -h, w);
      ctx.lineTo(pX, pY);

      // 3. Bottom rim
      for (let j = 0; j <= RIM_SEGS; j++) {
        const a = (j % RIM_SEGS) * ((Math.PI * 2) / RIM_SEGS);
        project(w * Math.cos(a), h, w * Math.sin(a));
        if (j === 0) ctx.moveTo(pX, pY);
        else ctx.lineTo(pX, pY);
      }

      // 4. Bottom plate cross / bar
      project(-w, h, 0);
      ctx.moveTo(pX, pY);
      project(w, h, 0);
      ctx.lineTo(pX, pY);

      project(0, h, -w);
      ctx.moveTo(pX, pY);
      project(0, h, w);
      ctx.lineTo(pX, pY);

      // 5. Waist ring
      const WAIST_SEGS = 12;
      for (let j = 0; j <= WAIST_SEGS; j++) {
        const a = (j % WAIST_SEGS) * ((Math.PI * 2) / WAIST_SEGS);
        project(rw * Math.cos(a), 0, rw * Math.sin(a));
        if (j === 0) ctx.moveTo(pX, pY);
        else ctx.lineTo(pX, pY);
      }

      // 6. Ribs (4 ribs at 0, 90, 180, 270 deg)
      for (let r = 0; r < 4; r++) {
        const theta = r * (Math.PI / 2);
        const cosT = Math.cos(theta);
        const sinT = Math.sin(theta);
        for (let s = 0; s <= RIB_STEPS; s++) {
          const u = -1 + (2 * s) / RIB_STEPS;
          const rad = rw + (w - rw) * (0.3 * Math.abs(u) + 0.7 * u * u);
          project(rad * cosT, u * h, rad * sinT);
          if (s === 0) ctx.moveTo(pX, pY);
          else ctx.lineTo(pX, pY);
        }
      }

      ctx.stroke();
    };


    const render = (time: number) => {
      if (width <= 0 || height <= 0) {
        animId = 0;
        return;
      }

      const dt = (time - lastTime) / 1000;
      lastTime = time;

      // Slow ambient spin around vertical axis (~1 turn per 45s)
      angle += dt * 0.14;

      // Track active running elapsed time so stopping freezes sand & angle,
      // and starting continues smoothly from current progress.
      const isRunning = runningRef.current;
      if (isRunning) {
        if (!wasRunning) {
          lastActiveTime = time;
          wasRunning = true;
        } else {
          const activeDelta = time - lastActiveTime;
          if (activeDelta > 0) {
            accumulatedElapsed += activeDelta;
            lastActiveTime = time;
          }
        }
      } else {
        wasRunning = false;
      }

      const sandRatio = calculateSandLevel(accumulatedElapsed);
      const flipAngle = calculateHourglassAngle(accumulatedElapsed, isRunning);

      // Track flip cycle and trigger flip sound exactly once per cycle at flip start
      const cycleIndex = Math.floor(accumulatedElapsed / CYCLE_DURATION_MS);
      const timeIntoCycle = accumulatedElapsed % CYCLE_DURATION_MS;

      if (accumulatedElapsed < lastAccumulatedElapsed) {
        lastFlippedCycle = -1;
      }
      lastAccumulatedElapsed = accumulatedElapsed;

      if (isRunning && timeIntoCycle >= DRAIN_DURATION_MS && lastFlippedCycle !== cycleIndex) {
        lastFlippedCycle = cycleIndex;
        if (typeof soundService.playHourglassFlip === 'function') {
          soundService.playHourglassFlip();
        } else if (typeof soundService.playFlip === 'function') {
          soundService.playFlip();
        }
      }

      // Subtle slow idle sway so the glass never feels frozen while stopped
      const idleSway = Math.sin(time * 0.0008) * 0.04;

      ctx.clearRect(0, 0, width, height);

      // 1. Deep space background fill
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);

      // 2. Faint vertical latitude / grid lines
      const vCols = 16;
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
      for (let c = 1; c < vCols; c++) {
        const vx = (width / vCols) * c;
        ctx.beginPath();
        ctx.moveTo(vx, 0);
        ctx.lineTo(vx, height);
        ctx.stroke();
      }

      // 3. Dynamic flowing wavy curves across the screen (5 smooth curves)
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';

      const curveLevels = [0.15, 0.33, 0.5, 0.67, 0.83];
      for (let i = 0; i < curveLevels.length; i++) {
        const baseCy = height * curveLevels[i];
        ctx.beginPath();
        const steps = 30;
        const speed = 0.00025 * (i % 2 === 0 ? 1 : -0.8);
        const breathe = Math.sin(time * 0.0005 + i * 1.3) * 4;
        for (let s = 0; s <= steps; s++) {
          const tRatio = s / steps;
          const x = width * tRatio;
          // Smooth sine/cosine wave with gentle drift and breathing amplitude
          const wave =
            Math.sin(tRatio * Math.PI * 2.2 + i * 0.7 + time * speed) * (16 + breathe) +
            Math.cos(tRatio * Math.PI * 1.5 - i * 0.4 + time * (speed * 0.6)) * 10;
          const y = baseCy + wave;
          if (s === 0) {
            ctx.moveTo(x, y);
          } else {
            ctx.lineTo(x, y);
          }
        }
        ctx.stroke();
      }

      // 4. Floating star particles with subtle breathing glow
      ctx.fillStyle = '#ffffff';
      for (let i = 0; i < stars.length; i++) {
        const star = stars[i];
        const sx = star.xRatio * width;
        const sy = star.yRatio * height;
        const twinkle = Math.sin(time * 0.0015 * star.speed + star.phase) * 0.18;
        ctx.globalAlpha = Math.max(0.2, Math.min(1.0, star.baseAlpha + twinkle));
        ctx.beginPath();
        ctx.arc(sx, sy, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1.0;

      // 5. Central 3D wireframe nested hourglasses
      const size1 = Math.min(width, height) * 0.16;
      const size2 = size1 * 0.78;

      // Outer hourglass (brighter, ambient turn, flips with cycle)
      drawHourglass(
        size1,
        0.2,
        angle,
        flipAngle + idleSway,
        'rgba(255, 255, 255, 0.18)',
        sandRatio,
        true,
        time
      );

      // Inner hourglass (fainter, offset ambient rotation, flips together with outer)
      drawHourglass(
        size2,
        0.2,
        -angle * 0.85 + 0.5,
        flipAngle + idleSway,
        'rgba(255, 255, 255, 0.11)',
        sandRatio,
        false,
        time
      );
      // 6. Center bright star particle & halo
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      if (haloGrad) {
        ctx.fillStyle = haloGrad;
        ctx.beginPath();
        ctx.arc(cx, cy, 14, 0, Math.PI * 2);
        ctx.fill();
      }

      animId = requestAnimationFrame(render);
    };
    const resize = () => {
      const parent = canvas.parentElement;
      const rect = parent ? parent.getBoundingClientRect() : canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const newWidth = rect.width;
      const newHeight = rect.height;

      const wasZeroSize = width <= 0 || height <= 0;
      width = newWidth;
      height = newHeight;

      if (width <= 0 || height <= 0) {
        if (animId) {
          cancelAnimationFrame(animId);
          animId = 0;
        }
        return;
      }

      cx = width / 2;
      cy = height / 2;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Pre-create center star halo gradient once per resize to avoid per-frame allocation
      haloGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
      haloGrad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
      haloGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');

      if (wasZeroSize && !animId) {
        lastTime = performance.now();
        animId = requestAnimationFrame(render);
      }
    };

    resize();
    window.addEventListener('resize', resize);

    if (width > 0 && height > 0 && !animId) {
      animId = requestAnimationFrame(render);
    }

    return () => {
      if (animId) {
        cancelAnimationFrame(animId);
      }
      window.removeEventListener('resize', resize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`absolute inset-0 pointer-events-none select-none ${className}`}
      style={{ zIndex: 0 }}
    />
  );
}
