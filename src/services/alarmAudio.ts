import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './platform';
import { StoreService } from './store';

export interface AlarmSoundProfile {
  id: string;
  label: string;
}

export interface AlarmAudioPrefs {
  enabled: boolean;
  volume: number;
  profile: string;
  customPath?: string | null;
}

export const DEFAULT_ALARM_AUDIO_PREFS: AlarmAudioPrefs = {
  enabled: true,
  volume: 0.8,
  profile: 'gentle',
  customPath: null,
};

export const BUILTIN_ALARM_PROFILES: AlarmSoundProfile[] = [
  { id: 'gentle', label: 'Gentle' },
  { id: 'chime', label: 'Chime' },
  { id: 'arpeggio', label: 'Arpeggio' },
  { id: 'bell', label: 'Bell' },
  { id: 'radar', label: 'Radar' },
  { id: 'energetic', label: 'Energetic' },
  { id: 'beep', label: 'Beep' },
];

export async function listAlarmSoundProfiles(): Promise<AlarmSoundProfile[]> {
  if (!isTauri()) {
    return BUILTIN_ALARM_PROFILES;
  }
  try {
    const list = await invoke<AlarmSoundProfile[]>('list_alarm_sound_profiles');
    if (Array.isArray(list) && list.length > 0) {
      return list;
    }
  } catch {
    // Backend fallback
  }
  return BUILTIN_ALARM_PROFILES;
}

export async function getAlarmAudioPrefs(): Promise<AlarmAudioPrefs> {
  const localEnabled = StoreService.getPreference<boolean>('tempo_alarm_enabled', true);
  const localVolume = StoreService.getPreference<number>('tempo_alarm_volume', 0.8);
  const localProfile = StoreService.getPreference<string>('tempo_alarm_sound_profile', 'gentle');
  const localCustom = StoreService.getPreference<string>('tempo_custom_alarm_sound', '');

  if (!isTauri()) {
    return {
      enabled: localEnabled,
      volume: localVolume,
      profile: localProfile,
      customPath: localCustom || null,
    };
  }

  try {
    const prefs = await invoke<AlarmAudioPrefs>('get_alarm_audio_prefs');
    return {
      enabled: prefs.enabled ?? localEnabled,
      volume: prefs.volume ?? localVolume,
      profile: prefs.profile || localProfile,
      customPath: prefs.customPath || localCustom || null,
    };
  } catch {
    return {
      enabled: localEnabled,
      volume: localVolume,
      profile: localProfile,
      customPath: localCustom || null,
    };
  }
}

export async function setAlarmAudioPrefs(prefs: Partial<AlarmAudioPrefs>): Promise<void> {
  if (prefs.enabled !== undefined) {
    StoreService.setPreference('tempo_alarm_enabled', prefs.enabled);
  }
  if (prefs.volume !== undefined) {
    StoreService.setPreference('tempo_alarm_volume', prefs.volume);
  }
  if (prefs.profile !== undefined) {
    StoreService.setPreference('tempo_alarm_sound_profile', prefs.profile);
  }
  if (prefs.customPath !== undefined) {
    StoreService.setPreference('tempo_custom_alarm_sound', prefs.customPath || '');
  }

  if (isTauri()) {
    try {
      await invoke('set_alarm_audio_prefs', {
        enabled: prefs.enabled,
        volume: prefs.volume,
        profile: prefs.profile,
        customPath: prefs.customPath !== undefined ? (prefs.customPath || null) : undefined,
        custom_path: prefs.customPath !== undefined ? (prefs.customPath || null) : undefined,
      });
    } catch {
      // Backend synchronization error handled gracefully
    }
  }
}

export async function previewAlarmSound(options?: {
  profile?: string;
  customPath?: string | null;
  volume?: number;
}): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('preview_alarm_sound', {
      profile: options?.profile,
      customPath: options?.customPath ?? null,
      custom_path: options?.customPath ?? null,
      volume: options?.volume,
    });
  } catch {
    // Ignore preview playback errors
  }
}

export async function stopAlarmSound(): Promise<void> {
  if (!isTauri()) return;
  try {
    await invoke('stop_alarm_sound');
  } catch {
    // Ignore stop errors
  }
}

export async function pickAlarmSoundFile(): Promise<string | null> {
  if (!isTauri()) return null;
  try {
    const res = await invoke<string | null>('pick_alarm_sound_file');
    return res ?? null;
  } catch {
    return null;
  }
}
