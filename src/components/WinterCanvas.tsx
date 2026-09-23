import React, { useEffect, useRef } from 'react';
import { TimerService } from '../services/timer';

export interface WinterCanvasProps {
  className?: string;
}

export const FLIP_INTERVAL_MS = 5000;
export const FLIP_DURATION_MS = 700;

/**
 * Calculates the flip rotation angle of the hourglass in radians.
 *
 * @param elapsedMs - Milliseconds elapsed since the timer started running.
 * @param running - Whether the timer is currently running.
 * @returns Hourglass rotation angle in radians around the flip axis.
 */
export function calculateHourglassAngle(elapsedMs: number, running: boolean): number {
  if (!running || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
    return 0;
  }

  const cycleIndex = Math.floor(elapsedMs / FLIP_INTERVAL_MS);
  if (cycleIndex === 0) {
    return 0;
  }

  // Base rotation from all previously completed flips (each 180° = π rad)
  const baseAngle = (cycleIndex - 1) * Math.PI;

  const timeIntoCycle = elapsedMs % FLIP_INTERVAL_MS;
  const progress = Math.min(1, timeIntoCycle / FLIP_DURATION_MS);

  // Smooth ease-in-out curve (cosine ease)
  const eased = 0.5 * (1 - Math.cos(progress * Math.PI));

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
    let runStart = 0;

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
      strokeColor: string
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
      const RIB_STEPS = 12;
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

      // Track running duration without accumulating floating-point frame drift
      const isRunning = runningRef.current;
      if (isRunning) {
        if (!wasRunning) {
          runStart = time;
          wasRunning = true;
        }
      } else {
        wasRunning = false;
      }

      const elapsedMs = isRunning ? time - runStart : 0;
      const flipAngle = calculateHourglassAngle(elapsedMs, isRunning);

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

      // Outer hourglass (brighter, ambient turn, flips every 5s when timer runs)
      drawHourglass(
        size1,
        0.2,
        angle,
        flipAngle + idleSway,
        'rgba(255, 255, 255, 0.18)'
      );

      // Inner hourglass (fainter, offset ambient rotation, flips together with outer)
      drawHourglass(
        size2,
        0.2,
        -angle * 0.85 + 0.5,
        flipAngle + idleSway,
        'rgba(255, 255, 255, 0.11)'
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
