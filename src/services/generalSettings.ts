import { ACCENTS, DEFAULT_ACCENT, type AccentId } from '../constants/design';
import { getPref, setPref, subscribePrefs } from './settings';
import { rolloverSettings, setRolloverSettings, localTimeZone } from './rollover';
import { DEFAULT_MEDIA_LIMIT_BYTES } from './assets';
import type { SoundProfileId } from '../types';

export type TimerMode = 'pomodoro' | 'flowtime' | 'stopwatch';

export interface GeneralSettings {
  // §21 Core Fields
  timerMode: TimerMode;
  focusMinutes: number;
  shortBreakMinutes: number;
  longBreakMinutes: number;
  longBreakEvery: number;
  endSound: string;
  background: string;
  accent: AccentId;
  timezone: string;
  rolloverHour: number;
  mediaLimitBytes: number;

  // Additional settings from pre-rename / prompt mapping
  soundProfile: SoundProfileId;
  uiClicks: boolean;
  countdownTicks: boolean;
  clickVolume: number;
  dashboardWidgets: boolean;
  alarmVolume: number;
  alarmEnabled: boolean;
}

export const DEFAULT_GENERAL_SETTINGS: GeneralSettings = {
  timerMode: 'pomodoro',
  focusMinutes: 50,
  shortBreakMinutes: 10,
  longBreakMinutes: 20,
  longBreakEvery: 4,
  endSound: 'chime',
  background: 'default',
  accent: 'amber',
  timezone: localTimeZone(),
  rolloverHour: 3,
  mediaLimitBytes: DEFAULT_MEDIA_LIMIT_BYTES,

  soundProfile: 'neon',
  uiClicks: true,
  countdownTicks: true,
  clickVolume: 0.5,
  dashboardWidgets: true,
  alarmVolume: 0.8,
  alarmEnabled: true,
};

const VALID_TIMER_MODES: readonly TimerMode[] = ['pomodoro', 'flowtime', 'stopwatch'] as const;
const VALID_ACCENTS: readonly AccentId[] = Object.keys(ACCENTS) as AccentId[];
const VALID_SOUND_PROFILES: readonly SoundProfileId[] = ['mechanical', 'soft', 'neon', 'arcade'] as const;

export interface KeyMigration {
  tempoKey: string;
  legacyKey: string;
}

export const GENERAL_KEY_MIGRATIONS: readonly KeyMigration[] = [
  { tempoKey: 'tempo_accent', legacyKey: 'alarmer_theme' },
  { tempoKey: 'tempo_alarm_enabled', legacyKey: 'alarmer_alarm_enabled' },
  { tempoKey: 'tempo_alarm_volume', legacyKey: 'alarmer_alarm_volume' },
  { tempoKey: 'tempo_focus_minutes', legacyKey: 'alarmer_block_focus_min' },
  { tempoKey: 'tempo_short_break_minutes', legacyKey: 'alarmer_block_rest_min' },
  { tempoKey: 'tempo_sound_profile', legacyKey: 'alarmer_sound_profile' },
  { tempoKey: 'tempo_ui_clicks', legacyKey: 'alarmer_ui_clicks' },
  { tempoKey: 'tempo_countdown_ticks', legacyKey: 'alarmer_countdown_ticks' },
  { tempoKey: 'tempo_click_volume', legacyKey: 'alarmer_click_volume' },
  { tempoKey: 'tempo_dashboard_widgets', legacyKey: 'alarmer_dashboard_widgets' },
  { tempoKey: 'tempo_background', legacyKey: 'tempo_dynamic_ui' },
  { tempoKey: 'tempo_timer_mode', legacyKey: 'alarmer_timer_mode' },
  { tempoKey: 'tempo_long_break_minutes', legacyKey: 'alarmer_long_break_min' },
  { tempoKey: 'tempo_long_break_every', legacyKey: 'alarmer_long_break_every' },
  { tempoKey: 'tempo_end_sound', legacyKey: 'alarmer_end_sound' },
  { tempoKey: 'tempo_media_limit_bytes', legacyKey: 'alarmer_media_limit_bytes' },
] as const;

function readFallbackPref(tempoKey: string, legacyKey: string): unknown {
  const tempoVal = getPref<unknown>(tempoKey, undefined);
  if (tempoVal !== undefined) {
    return tempoVal;
  }
  return getPref<unknown>(legacyKey, undefined);
}

function parsePositiveInt(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val) && val > 0) {
    return Math.round(val);
  }
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    const parsed = parseInt(val.trim(), 10);
    if (parsed > 0) return parsed;
  }
  return fallback;
}

function parseUnitInterval(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 1) {
    return val;
  }
  if (typeof val === 'string' && val.trim() !== '') {
    const parsed = parseFloat(val.trim());
    if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) {
      return parsed;
    }
  }
  return fallback;
}

function parseBoolean(val: unknown, fallback: boolean): boolean {
  if (typeof val === 'boolean') return val;
  if (val === 'true') return true;
  if (val === 'false') return false;
  return fallback;
}

function parseAccent(val: unknown, fallback: AccentId): AccentId {
  if (typeof val === 'string' && (VALID_ACCENTS as readonly string[]).includes(val)) {
    return val as AccentId;
  }
  return fallback;
}

function parseTimerMode(val: unknown, fallback: TimerMode): TimerMode {
  if (typeof val === 'string' && (VALID_TIMER_MODES as readonly string[]).includes(val)) {
    return val as TimerMode;
  }
  return fallback;
}

function parseSoundProfile(val: unknown, fallback: SoundProfileId): SoundProfileId {
  if (typeof val === 'string' && (VALID_SOUND_PROFILES as readonly string[]).includes(val)) {
    return val as SoundProfileId;
  }
  return fallback;
}

function parseBackground(val: unknown, fallback: string): string {
  if (typeof val === 'string' && val.trim() !== '') {
    return val.trim();
  }
  return fallback;
}

function parseHour(val: unknown, fallback: number): number {
  if (typeof val === 'number' && Number.isFinite(val) && val >= 0 && val <= 23) {
    return Math.round(val);
  }
  if (typeof val === 'string' && /^\d+$/.test(val.trim())) {
    const parsed = parseInt(val.trim(), 10);
    if (parsed >= 0 && parsed <= 23) return parsed;
  }
  return fallback;
}

/**
 * The accent the user has, whether it was saved by this version or the previous one.
 *
 * Every caller goes through here: `tempo_accent` alone would leave a user who
 * upgraded from 0.3 on the default colour until they happened to open settings.
 */
export function loadAccent(): AccentId {
  const raw = readFallbackPref('tempo_accent', 'alarmer_theme');
  return typeof raw === 'string' && raw in ACCENTS ? (raw as AccentId) : DEFAULT_ACCENT;
}

export function loadGeneralSettings(): GeneralSettings {
  const rollover = rolloverSettings();

  const accentRaw = readFallbackPref('tempo_accent', 'alarmer_theme');
  const alarmEnabledRaw = readFallbackPref('tempo_alarm_enabled', 'alarmer_alarm_enabled');
  const alarmVolumeRaw = readFallbackPref('tempo_alarm_volume', 'alarmer_alarm_volume');
  const focusMinutesRaw = readFallbackPref('tempo_focus_minutes', 'alarmer_block_focus_min');
  const shortBreakMinutesRaw = readFallbackPref('tempo_short_break_minutes', 'alarmer_block_rest_min');
  const longBreakMinutesRaw = readFallbackPref('tempo_long_break_minutes', 'alarmer_long_break_min');
  const longBreakEveryRaw = readFallbackPref('tempo_long_break_every', 'alarmer_long_break_every');
  const timerModeRaw = readFallbackPref('tempo_timer_mode', 'alarmer_timer_mode');
  const endSoundRaw = readFallbackPref('tempo_end_sound', 'alarmer_end_sound');
  const soundProfileRaw = readFallbackPref('tempo_sound_profile', 'alarmer_sound_profile');
  const uiClicksRaw = readFallbackPref('tempo_ui_clicks', 'alarmer_ui_clicks');
  const countdownTicksRaw = readFallbackPref('tempo_countdown_ticks', 'alarmer_countdown_ticks');
  const clickVolumeRaw = readFallbackPref('tempo_click_volume', 'alarmer_click_volume');
  const dashboardWidgetsRaw = readFallbackPref('tempo_dashboard_widgets', 'alarmer_dashboard_widgets');
  const backgroundRaw = readFallbackPref('tempo_background', 'tempo_dynamic_ui');
  const mediaLimitBytesRaw = readFallbackPref('tempo_media_limit_bytes', 'alarmer_media_limit_bytes');
  const timezoneRaw = readFallbackPref('tempo_timezone', 'alarmer_timezone');

  return {
    timerMode: parseTimerMode(timerModeRaw, DEFAULT_GENERAL_SETTINGS.timerMode),
    focusMinutes: parsePositiveInt(focusMinutesRaw, DEFAULT_GENERAL_SETTINGS.focusMinutes),
    shortBreakMinutes: parsePositiveInt(shortBreakMinutesRaw, DEFAULT_GENERAL_SETTINGS.shortBreakMinutes),
    longBreakMinutes: parsePositiveInt(longBreakMinutesRaw, DEFAULT_GENERAL_SETTINGS.longBreakMinutes),
    longBreakEvery: parsePositiveInt(longBreakEveryRaw, DEFAULT_GENERAL_SETTINGS.longBreakEvery),
    endSound: typeof endSoundRaw === 'string' && endSoundRaw.trim() ? endSoundRaw.trim() : DEFAULT_GENERAL_SETTINGS.endSound,
    background: parseBackground(backgroundRaw, DEFAULT_GENERAL_SETTINGS.background),
    accent: parseAccent(accentRaw, DEFAULT_GENERAL_SETTINGS.accent),
    timezone: typeof timezoneRaw === 'string' && timezoneRaw.trim() ? timezoneRaw.trim() : localTimeZone(),
    rolloverHour: parseHour(rollover.afterHour, DEFAULT_GENERAL_SETTINGS.rolloverHour),
    mediaLimitBytes: parsePositiveInt(mediaLimitBytesRaw, DEFAULT_GENERAL_SETTINGS.mediaLimitBytes),

    soundProfile: parseSoundProfile(soundProfileRaw, DEFAULT_GENERAL_SETTINGS.soundProfile),
    uiClicks: parseBoolean(uiClicksRaw, DEFAULT_GENERAL_SETTINGS.uiClicks),
    countdownTicks: parseBoolean(countdownTicksRaw, DEFAULT_GENERAL_SETTINGS.countdownTicks),
    clickVolume: parseUnitInterval(clickVolumeRaw, DEFAULT_GENERAL_SETTINGS.clickVolume),
    dashboardWidgets: parseBoolean(dashboardWidgetsRaw, DEFAULT_GENERAL_SETTINGS.dashboardWidgets),
    alarmVolume: parseUnitInterval(alarmVolumeRaw, DEFAULT_GENERAL_SETTINGS.alarmVolume),
    alarmEnabled: parseBoolean(alarmEnabledRaw, DEFAULT_GENERAL_SETTINGS.alarmEnabled),
  };
}

/** Alias matching interfaces.md §21 contract */
export const generalSettings = loadGeneralSettings;

export async function saveGeneralSettings(patch: Partial<GeneralSettings>): Promise<void> {
  const current = loadGeneralSettings();

  if (patch.rolloverHour !== undefined) {
    const validHour = parseHour(patch.rolloverHour, current.rolloverHour);
    await setRolloverSettings({
      afterHour: validHour,
    });
  }

  const writes: Promise<void>[] = [];

  if (patch.timezone !== undefined) {
    writes.push(setPref('tempo_timezone', patch.timezone.trim() || localTimeZone()));
  }
  if (patch.accent !== undefined) {
    writes.push(setPref('tempo_accent', parseAccent(patch.accent, current.accent)));
  }
  if (patch.alarmEnabled !== undefined) {
    writes.push(setPref('tempo_alarm_enabled', parseBoolean(patch.alarmEnabled, current.alarmEnabled)));
  }
  if (patch.alarmVolume !== undefined) {
    writes.push(setPref('tempo_alarm_volume', parseUnitInterval(patch.alarmVolume, current.alarmVolume)));
  }
  if (patch.focusMinutes !== undefined) {
    writes.push(setPref('tempo_focus_minutes', parsePositiveInt(patch.focusMinutes, current.focusMinutes)));
  }
  if (patch.shortBreakMinutes !== undefined) {
    writes.push(setPref('tempo_short_break_minutes', parsePositiveInt(patch.shortBreakMinutes, current.shortBreakMinutes)));
  }
  if (patch.longBreakMinutes !== undefined) {
    writes.push(setPref('tempo_long_break_minutes', parsePositiveInt(patch.longBreakMinutes, current.longBreakMinutes)));
  }
  if (patch.longBreakEvery !== undefined) {
    writes.push(setPref('tempo_long_break_every', parsePositiveInt(patch.longBreakEvery, current.longBreakEvery)));
  }
  if (patch.timerMode !== undefined) {
    writes.push(setPref('tempo_timer_mode', parseTimerMode(patch.timerMode, current.timerMode)));
  }
  if (patch.endSound !== undefined) {
    const validSound = typeof patch.endSound === 'string' && patch.endSound.trim() ? patch.endSound.trim() : current.endSound;
    writes.push(setPref('tempo_end_sound', validSound));
  }
  if (patch.soundProfile !== undefined) {
    writes.push(setPref('tempo_sound_profile', parseSoundProfile(patch.soundProfile, current.soundProfile)));
  }
  if (patch.uiClicks !== undefined) {
    writes.push(setPref('tempo_ui_clicks', parseBoolean(patch.uiClicks, current.uiClicks)));
  }
  if (patch.countdownTicks !== undefined) {
    writes.push(setPref('tempo_countdown_ticks', parseBoolean(patch.countdownTicks, current.countdownTicks)));
  }
  if (patch.clickVolume !== undefined) {
    writes.push(setPref('tempo_click_volume', parseUnitInterval(patch.clickVolume, current.clickVolume)));
  }
  if (patch.dashboardWidgets !== undefined) {
    writes.push(setPref('tempo_dashboard_widgets', parseBoolean(patch.dashboardWidgets, current.dashboardWidgets)));
  }
  if (patch.background !== undefined) {
    writes.push(setPref('tempo_background', parseBackground(patch.background, current.background)));
  }
  if (patch.mediaLimitBytes !== undefined) {
    writes.push(setPref('tempo_media_limit_bytes', parsePositiveInt(patch.mediaLimitBytes, current.mediaLimitBytes)));
  }

  await Promise.all(writes);
}

/** Alias matching interfaces.md §21 contract */
export const setGeneralSettings = saveGeneralSettings;

/**
 * Migrates all legacy preference keys to canonical tempo_* keys in one pass.
 * Returns the list of canonical tempo_* keys that were newly populated from legacy keys.
 * If canonical tempo_* key already exists, it is untouched.
 */
export async function migrateLegacyPreferences(): Promise<string[]> {
  const movedKeys: string[] = [];

  for (const { tempoKey, legacyKey } of GENERAL_KEY_MIGRATIONS) {
    const tempoVal = getPref<unknown>(tempoKey, undefined);
    if (tempoVal !== undefined) {
      // Canonical key already set; do not overwrite
      continue;
    }
    const legacyVal = getPref<unknown>(legacyKey, undefined);
    if (legacyVal !== undefined) {
      await setPref(tempoKey, legacyVal);
      movedKeys.push(tempoKey);
    }
  }

  return movedKeys;
}

export function subscribeGeneralSettings(callback: (settings: GeneralSettings) => void): () => void {
  return subscribePrefs((key) => {
    if (key.startsWith('tempo_') || key.startsWith('alarmer_') || key === 'tempo_rollover_hour') {
      callback(loadGeneralSettings());
    }
  });
}
