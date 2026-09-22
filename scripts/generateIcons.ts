/**
 * One-off generator for the app icons, which are committed under `src-tauri/icons`.
 *
 * Not part of the build. Its `canvas` dependency pulls a native toolchain, so it
 * is not installed by default — add it ad hoc only when regenerating:
 *
 *   bun add -d canvas && bun run scripts/generateIcons.ts
 */
import { createCanvas } from 'canvas';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

function generateIcon(size: number): Buffer {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Clear to transparent
  ctx.clearRect(0, 0, size, size);

  // Scale from 24x24 reference viewBox
  const scale = size / 24;

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = Math.max(1.2, 1.4 * scale);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Minimalist hand-drawn hourglass: thin single-line drawing, two gently curved
  // triangles meeting at the waist, slightly imperfect strokes, no fills, generous whitespace.
  ctx.beginPath();
  ctx.moveTo(7.0 * scale, 5.2 * scale);
  // 1. Top bar
  ctx.bezierCurveTo(10.4 * scale, 5.0 * scale, 13.6 * scale, 5.1 * scale, 17.0 * scale, 4.9 * scale);
  // 2. Upper-right curve down to waist
  ctx.bezierCurveTo(15.4 * scale, 7.8 * scale, 13.4 * scale, 10.3 * scale, 12.1 * scale, 11.9 * scale);
  // 3. Lower-right curve down to bottom-right
  ctx.bezierCurveTo(13.5 * scale, 14.1 * scale, 15.3 * scale, 16.9 * scale, 16.8 * scale, 19.3 * scale);
  // 4. Bottom bar
  ctx.bezierCurveTo(13.6 * scale, 19.4 * scale, 10.4 * scale, 19.5 * scale, 7.2 * scale, 19.5 * scale);
  // 5. Lower-left curve up to waist
  ctx.bezierCurveTo(8.7 * scale, 17.0 * scale, 10.6 * scale, 14.2 * scale, 11.9 * scale, 12.1 * scale);
  // 6. Upper-left curve up to top-left
  ctx.bezierCurveTo(10.6 * scale, 10.0 * scale, 8.6 * scale, 7.5 * scale, 7.0 * scale, 5.2 * scale);
  ctx.closePath();
  ctx.stroke();

  return canvas.toBuffer('image/png');
}

const iconsDir = path.resolve('src-tauri/icons');
const sizes = [32, 64, 128, 256, 512];

for (const s of sizes) {
  const buf = generateIcon(s);
  if (s === 32) {
    fs.writeFileSync(path.join(iconsDir, '32x32.png'), buf);
  } else if (s === 64) {
    fs.writeFileSync(path.join(iconsDir, '64x64.png'), buf);
  } else if (s === 128) {
    fs.writeFileSync(path.join(iconsDir, '128x128.png'), buf);
  } else if (s === 256) {
    fs.writeFileSync(path.join(iconsDir, '128x128@2x.png'), buf);
  } else if (s === 512) {
    fs.writeFileSync(path.join(iconsDir, 'icon.png'), buf);
  }
}

// Generate platform bundles (icon.ico, icon.icns, Square*Logo) via Tauri CLI
try {
  execSync('bun run tauri icon src-tauri/icons/icon.png -o src-tauri/icons', {
    stdio: 'inherit',
  });
} catch {
  console.warn('Tauri icon CLI skipped or failed; basic PNGs generated.');
}

console.log('Icons generated successfully!');
