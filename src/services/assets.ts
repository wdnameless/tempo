// src/services/assets.ts
// Wave 6 - Media lifecycle (R43): typed wrapper over Rust asset storage commands.

import { invoke } from '@tauri-apps/api/core';

export type AssetKind = 'drawing' | 'audio' | 'screen' | 'preview';

export interface AssetRef {
  kind: AssetKind;
  path: string;
  bytes: number;
}

export interface AssetUsage {
  total: number;
  by_kind: Record<string, number>;
}

export interface AssetPruneResult {
  removed: number;
  freed: number;
}

/**
 * Converts a Uint8Array to a Base64 string in chunks to prevent call-stack overflow
 * on large payloads when using String.fromCharCode.
 */
export function uint8ArrayToBase64(bytes: Uint8Array): string {
  const CHUNK_SIZE = 0x8000; // 32768 bytes per slice
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    const chunk = bytes.subarray(i, i + CHUNK_SIZE);
    // Applying to small slice is safe and fast
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/**
 * Saves binary asset data under `<data>/assets/<kind>/<name>`.
 * Encodes data to base64 chunk-by-chunk before sending over Tauri IPC.
 */
export async function assetSave(
  kind: AssetKind,
  name: string,
  data: Uint8Array,
): Promise<AssetRef> {
  const data_base64 = uint8ArrayToBase64(data);
  return invoke<AssetRef>('asset_save', {
    kind,
    name,
    data_base64,
  });
}

/**
 * Deletes an asset file. Accepts either an AssetRef or the direct string path.
 * Refuses paths outside the assets directory on the Rust side; missing files are treated as success.
 */
export async function assetDelete(ref: AssetRef | string): Promise<void> {
  const path = typeof ref === 'string' ? ref : ref.path;
  await invoke<void>('asset_delete', { path });
}

/**
 * Returns disk usage across assets: total bytes and per-kind breakdown.
 */
export async function assetUsage(): Promise<AssetUsage> {
  return invoke<AssetUsage>('asset_usage');
}

/**
 * Prunes assets oldest-first until total usage fits within `limit_bytes`.
 */
export async function assetPrune(limit_bytes: number): Promise<AssetPruneResult> {
  return invoke<AssetPruneResult>('asset_prune', { limit_bytes });
}
