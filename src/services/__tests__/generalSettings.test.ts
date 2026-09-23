import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadGeneralSettings,
  saveGeneralSettings,
  migrateLegacyPreferences,
  subscribeGeneralSettings,
  DEFAULT_GENERAL_SETTINGS,
} from '../generalSettings';
import { resetSettingsCacheForTesting, getPref, setPref } from '../settings';

describe('generalSettings', () => {
  beforeEach(() => {
    resetSettingsCacheForTesting();
  });

  it('loads default settings when store is empty', () => {
    const settings = loadGeneralSettings();
    expect(settings).toMatchObject({
      timerMode: 'pomodoro',
      focusMinutes: 50,
      shortBreakMinutes: 10,
      longBreakMinutes: 20,
      longBreakEvery: 4,
      endSound: 'chime',
      background: 'default',
      accent: 'amber',
      rolloverHour: 3,
      uiClicks: true,
      countdownTicks: true,
      clickVolume: 0.5,
      dashboardWidgets: true,
      alarmVolume: 0.8,
      alarmEnabled: true,
    });
    expect(typeof settings.timezone).toBe('string');
  });

  it('reads legacy alarmer_* keys when tempo_* keys are absent', async () => {
    await setPref('alarmer_theme', 'teal');
    await setPref('alarmer_block_focus_min', 25);
    await setPref('alarmer_block_rest_min', 5);
    await setPref('alarmer_alarm_enabled', false);
    await setPref('alarmer_alarm_volume', 0.4);

    const settings = loadGeneralSettings();
    expect(settings.accent).toBe('teal');
    expect(settings.focusMinutes).toBe(25);
    expect(settings.shortBreakMinutes).toBe(5);
    expect(settings.alarmEnabled).toBe(false);
    expect(settings.alarmVolume).toBe(0.4);
  });

  it('prefers tempo_* key over legacy alarmer_* key when both exist', async () => {
    await setPref('alarmer_theme', 'teal');
    await setPref('tempo_accent', 'pink');

    const settings = loadGeneralSettings();
    expect(settings.accent).toBe('pink');
  });

  it('saving writes to canonical tempo_* keys and persists forward', async () => {
    await setPref('alarmer_block_focus_min', 45);

    // Initial read finds legacy key
    expect(loadGeneralSettings().focusMinutes).toBe(45);
    expect(getPref('tempo_focus_minutes', undefined)).toBeUndefined();

    // Saving changes the key to a new one, saving forward to tempo_focus_minutes
    await saveGeneralSettings({ focusMinutes: 55 });

    expect(getPref('tempo_focus_minutes', undefined)).toBe(55);
    expect(loadGeneralSettings().focusMinutes).toBe(55);
  });

  it('migrateLegacyPreferences moves legacy keys and does not touch existing tempo_* keys', async () => {
    await setPref('alarmer_theme', 'violet');
    await setPref('alarmer_block_focus_min', 45);
    await setPref('alarmer_block_rest_min', 15);

    // tempo_alarm_volume already exists
    await setPref('tempo_alarm_volume', 0.9);
    await setPref('alarmer_alarm_volume', 0.2);

    const moved = await migrateLegacyPreferences();

    expect(moved).toContain('tempo_accent');
    expect(moved).toContain('tempo_focus_minutes');
    expect(moved).toContain('tempo_short_break_minutes');
    expect(moved).not.toContain('tempo_alarm_volume');

    expect(getPref('tempo_accent', undefined)).toBe('violet');
    expect(getPref('tempo_focus_minutes', undefined)).toBe(45);
    expect(getPref('tempo_short_break_minutes', undefined)).toBe(15);
    // Preserved existing tempo key
    expect(getPref('tempo_alarm_volume', undefined)).toBe(0.9);

    // Second run moves nothing
    const movedSecond = await migrateLegacyPreferences();
    expect(movedSecond).toEqual([]);
  });

  it('validates corrupted and out-of-range values falling back to defaults', async () => {
    await setPref('tempo_focus_minutes', 'abc');
    await setPref('tempo_short_break_minutes', -10);
    await setPref('tempo_rollover_hour', 48);
    await setPref('tempo_accent', 'non-existent-accent');
    await setPref('tempo_alarm_volume', 999);
    await setPref('tempo_click_volume', -5);
    await setPref('tempo_timer_mode', 'infinite');

    const settings = loadGeneralSettings();
    expect(settings.focusMinutes).toBe(DEFAULT_GENERAL_SETTINGS.focusMinutes);
    expect(settings.shortBreakMinutes).toBe(DEFAULT_GENERAL_SETTINGS.shortBreakMinutes);
    expect(settings.rolloverHour).toBe(DEFAULT_GENERAL_SETTINGS.rolloverHour);
    expect(settings.accent).toBe(DEFAULT_GENERAL_SETTINGS.accent);
    expect(settings.alarmVolume).toBe(DEFAULT_GENERAL_SETTINGS.alarmVolume);
    expect(settings.clickVolume).toBe(DEFAULT_GENERAL_SETTINGS.clickVolume);
    expect(settings.timerMode).toBe(DEFAULT_GENERAL_SETTINGS.timerMode);
  });

  it('supports rolloverHour persistence through rollover.ts and local timezone', async () => {
    await saveGeneralSettings({
      rolloverHour: 5,
    });

    const settings = loadGeneralSettings();
    expect(settings.rolloverHour).toBe(5);
    expect(typeof settings.timezone).toBe('string');
  });

  it('notifies subscribers when settings change', async () => {
    let notifiedCount = 0;
    let latestMode: string = '';

    const unsubscribe = subscribeGeneralSettings((s) => {
      notifiedCount += 1;
      latestMode = s.timerMode;
    });

    await saveGeneralSettings({ timerMode: 'flowtime' });

    expect(notifiedCount).toBe(1);
    expect(latestMode).toBe('flowtime');

    unsubscribe();
    await saveGeneralSettings({ timerMode: 'stopwatch' });
    expect(notifiedCount).toBe(1);
  });
});
