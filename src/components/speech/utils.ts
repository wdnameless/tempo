/**
 * Common formatting utilities for speech components.
 */

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function formatSpeed(bps: number | undefined): string {
  if (!bps || bps <= 0) return '';
  const mbps = bps / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
}

export function formatEta(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || secs < 0) return '';
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}
