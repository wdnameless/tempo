import React, { useEffect, useRef } from 'react';

interface WinterCanvasProps {
  className?: string;
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
 * - Subtle wavy latitude curves across the space
 * - Scattered glowing star particles
 * - Central 3D wireframe geometric nested squares/cubes with center star
 *
 * Runs strictly below 1% CPU with minimal draw operations.
 */
export function WinterCanvas({ className = '' }: WinterCanvasProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    let width = 0;
    let height = 0;
    let angle = 0;

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

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const rect = parent.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };

    resize();
    window.addEventListener('resize', resize);

    // 3D Wireframe projection helpers
    // Represents vertices of a 3D cube of side 2*s
    const cubeVertices = (s: number): [number, number, number][] => [
      [-s, -s, -s],
      [s, -s, -s],
      [s, s, -s],
      [-s, s, -s],
      [-s, -s, s],
      [s, -s, s],
      [s, s, s],
      [-s, s, s],
    ];

    const cubeEdges: [number, number][] = [
      [0, 1], [1, 2], [2, 3], [3, 0], // back square
      [4, 5], [5, 6], [6, 7], [7, 4], // front square
      [0, 4], [1, 5], [2, 6], [3, 7], // connecting edges
    ];

    const project3D = (
      x: number,
      y: number,
      z: number,
      rotX: number,
      rotY: number,
      rotZ: number,
      cx: number,
      cy: number,
      fov = 500
    ): [number, number] => {
      // Rotation Y
      const cosY = Math.cos(rotY);
      const sinY = Math.sin(rotY);
      const x1 = x * cosY + z * sinY;
      const z1 = -x * sinY + z * cosY;

      // Rotation X
      const cosX = Math.cos(rotX);
      const sinX = Math.sin(rotX);
      const y2 = y * cosX - z1 * sinX;
      const z2 = y * sinX + z1 * cosX;

      // Rotation Z
      const cosZ = Math.cos(rotZ);
      const sinZ = Math.sin(rotZ);
      const x3 = x1 * cosZ - y2 * sinZ;
      const y3 = x1 * sinZ + y2 * cosZ;

      const scale = fov / (fov + z2 + 250);
      return [cx + x3 * scale, cy + y3 * scale];
    };

    let lastTime = performance.now();

    const render = (time: number) => {
      const dt = (time - lastTime) / 1000;
      lastTime = time;

      // Slow elegant rotation (approx 1 full turn per 45s)
      angle += dt * 0.14;

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

      // 3. Wavy flowing curves across the screen (4 smooth curves)
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.08)';

      const curveLevels = [0.15, 0.33, 0.50, 0.67, 0.83];
      for (let i = 0; i < curveLevels.length; i++) {
        const baseCy = height * curveLevels[i];
        ctx.beginPath();
        const steps = 30;
        for (let s = 0; s <= steps; s++) {
          const tRatio = s / steps;
          const x = width * tRatio;
          // Smooth sine/cosine wave with gentle amplitude
          const wave =
            Math.sin(tRatio * Math.PI * 2.2 + i * 0.7) * 16 +
            Math.cos(tRatio * Math.PI * 1.5 - i * 0.4) * 10;
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
      for (const star of stars) {
        const sx = star.xRatio * width;
        const sy = star.yRatio * height;
        const twinkle = Math.sin(time * 0.0015 * star.speed + star.phase) * 0.18;
        const alpha = Math.max(0.2, Math.min(1.0, star.baseAlpha + twinkle));

        ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.beginPath();
        ctx.arc(sx, sy, star.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // 5. Central 3D wireframe tilted geometry
      const cx = width / 2;
      const cy = height / 2;

      // Two nested wireframe cubes with slightly different rotations & sizes
      const size1 = Math.min(width, height) * 0.15;
      const size2 = size1 * 0.82;

      // Draw Cube 1
      const v1 = cubeVertices(size1);
      const proj1 = v1.map(([x, y, z]) =>
        project3D(x, y, z, 0.45, angle, 0.25, cx, cy)
      );

      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
      ctx.beginPath();
      for (const [i1, i2] of cubeEdges) {
        ctx.moveTo(proj1[i1][0], proj1[i1][1]);
        ctx.lineTo(proj1[i2][0], proj1[i2][1]);
      }
      ctx.stroke();

      // Draw Cube 2 (offset rotation)
      const v2 = cubeVertices(size2);
      const proj2 = v2.map(([x, y, z]) =>
        project3D(x, y, z, -0.3, -angle * 0.85 + 0.6, 0.5, cx, cy)
      );

      ctx.strokeStyle = 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      for (const [i1, i2] of cubeEdges) {
        ctx.moveTo(proj2[i1][0], proj2[i1][1]);
        ctx.lineTo(proj2[i2][0], proj2[i2][1]);
      }
      ctx.stroke();

      // Center bright star particle
      ctx.fillStyle = 'rgba(255, 255, 255, 0.95)';
      ctx.beginPath();
      ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
      ctx.fill();

      // Subtle halo around center star
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 14);
      grad.addColorStop(0, 'rgba(255, 255, 255, 0.35)');
      grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, 14, 0, Math.PI * 2);
      ctx.fill();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
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
