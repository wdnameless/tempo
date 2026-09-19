import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';
import { StoreService } from './store';

/**
 * Update checking.
 *
 * Two paths, because the app ships two ways and they cannot share one:
 *
 * - **Installed** builds use Tauri's updater, which verifies a signature against
 *   the public key in `tauri.conf.json` and hands off to the platform installer.
 * - **Portable** builds cannot: the Windows updater installs through NSIS, which
 *   would put the app in Program Files and write registry entries — exactly what
 *   a portable copy exists to avoid. Those builds fetch the new portable archive
 *   themselves and replace the binary in place.
 *
 * Both check the same source of truth: the `latest.json` attached to our own
 * GitHub release.
 */

/**
 * Where the app looks for updates. Fixed to this project's own releases.
 * The GitHub repository stays wdnameless/Alarmer while the product is renamed to Tempo.
 */
export const UPDATE_ENDPOINT =
  'https://github.com/wdnameless/Alarmer/releases/latest/download/latest.json';

/** What an update looks like to the UI. */
export interface UpdateInfo {
  version: string;
  notes: string;
  /** RFC 3339 date, when the release published one. */
  date?: string;
  /**
   * True when this build must be updated by replacing its own binary rather
   * than by running an installer.
   */
  portable: boolean;
}

export type UpdatePhase =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'available'; info: UpdateInfo }
  | { kind: 'downloading'; info: UpdateInfo; downloaded: number; total: number }
  | { kind: 'ready'; info: UpdateInfo }
  | { kind: 'error'; message: string };

/** The running app's version, as the bundle reports it. */
export async function currentVersion(): Promise<string> {
  if (!isTauri()) return 'dev';
  try {
    const { getVersion } = await import('@tauri-apps/api/app');
    return await getVersion();
  } catch {
    return 'unknown';
  }
}

/**
 * True when this build stores its data beside the executable.
 *
 * Resolved from the backend, which knows where the binary lives, and cached in
 * the store so the UI can read it synchronously.
 */
export async function detectPortable(): Promise<boolean> {
  if (!isTauri()) return false;
  try {
    const portable = await invoke<boolean>('is_portable_build');
    StoreService.setPreference('tempo_portable', portable);
    return portable;
  } catch {
    return isPortable();
  }
}

/** True when this build stores its data beside the executable. */
export function isPortable(): boolean {
  return StoreService.getPreference('tempo_portable', false);
}

/**
 * Looks for a newer release and reports what it found.
 *
 * Deliberately reports every outcome, including "up to date" and failure: a
 * silent updater is one the user cannot tell apart from a broken one.
 */
export async function checkForUpdate(): Promise<
  { status: 'update'; info: UpdateInfo } | { status: 'current' } | { status: 'error'; message: string }
> {
  if (!isTauri()) return { status: 'error', message: 'Обновления доступны только в приложении.' };

  try {
    // Check if the build is portable (synchronously from store, or probe from backend)
    let portable = isPortable();
    if (!portable && isTauri()) {
      try {
        portable = await detectPortable();
      } catch {
        portable = false;
      }
    }

    if (portable) {
      const found = await invoke<{
        version: string;
        notes: string;
        date: string | null;
      }>('portable_check_update');

      if (!found.version) return { status: 'current' };
      return {
        status: 'update',
        info: {
          version: found.version,
          notes: found.notes,
          date: found.date ?? undefined,
          portable: true,
        },
      };
    }

    const { check } = await import('@tauri-apps/plugin-updater');
    const update = await check();
    if (!update) return { status: 'current' };

    return {
      status: 'update',
      info: {
        version: update.version,
        notes: update.body ?? '',
        date: update.date ?? undefined,
        portable: false,
      },
    };
  } catch (e) {
    return {
      status: 'error',
      message: e instanceof Error ? e.message : 'Не удалось проверить обновления.',
    };
  }
}

/**
 * Downloads and installs the update, restarting when it is ready.
 *
 * `onProgress` receives bytes downloaded and the total when the server states
 * it, so the UI can show real progress rather than a spinner.
 */
export async function installUpdate(
  info: UpdateInfo,
  onProgress?: (downloaded: number, total: number) => void,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!isTauri()) return { ok: false, message: 'Обновления доступны только в приложении.' };

  try {
    if (info.portable) {
      await invoke('portable_stage_update');
      await invoke('portable_apply_update');
      // The process exits as the helper takes over; nothing after this runs.
      return { ok: true };
    }

    const { check } = await import('@tauri-apps/plugin-updater');
    const { relaunch } = await import('@tauri-apps/plugin-process');

    const update = await check();
    if (!update) return { ok: false, message: 'Обновление больше не доступно.' };

    let downloaded = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
      if (event.event === 'Started') {
        total = event.data.contentLength ?? 0;
      } else if (event.event === 'Progress') {
        downloaded += event.data.chunkLength;
      }
      onProgress?.(downloaded, total);
    });

    await relaunch();
    return { ok: true };
  } catch (e) {
    return {
      ok: false,
      message: e instanceof Error ? e.message : 'Не удалось установить обновление.',
    };
  }
}
