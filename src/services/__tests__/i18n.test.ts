import { describe, it, expect } from 'vitest';
import { TRANSLATIONS } from '../i18n';

describe('i18n completeness and Russian locale verification', () => {
  const keys = [
    'titleBarMinimize',
    'titleBarMaximize',
    'titleBarCloseToTray',
    'titleBarPin',
    'titleBarUnpin',
    'titleBarCompact',
    'sidebarCollapse',
    'sidebarExit',
    'updateIdle',
    'updateChecking',
    'updateUpToDate',
    'updateAvailable',
    'updateDownloading',
    'updateReady',
    'updateFailed',
    'chatNeedKey',
    'chatNewChat',
    'alarmsQuickIn30',
    'alarmsQuickTomorrow8',
    'alarmsQuickDaily730',
  ] as const;

  it('all interfaces.md §2 keys exist in both locales and ru values contain Cyrillic', () => {
    for (const key of keys) {
      expect(TRANSLATIONS.en[key]).toBeDefined();
      expect(TRANSLATIONS.en[key].length).toBeGreaterThan(0);

      expect(TRANSLATIONS.ru[key]).toBeDefined();
      expect(TRANSLATIONS.ru[key].length).toBeGreaterThan(0);
      // ru value must contain Cyrillic characters
      expect(/[а-яА-ЯёЁ]/.test(TRANSLATIONS.ru[key])).toBe(true);
    }
  });

  it('previously English strings in ru locale now contain Russian text', () => {
    expect(TRANSLATIONS.ru.sidebarAlarms).toBe('Будильники');
    expect(TRANSLATIONS.ru.sidebarTasks).toBe('Задачи');
    expect(TRANSLATIONS.ru.settingsSpeechActivationHoldOrToggle).toContain('Удержание');
    expect(TRANSLATIONS.ru.settingsSpeechActivationPushToTalk).toContain('Рация');
    expect(TRANSLATIONS.ru.settingsSpeechActivationToggle).toContain('Переключение');
    expect(TRANSLATIONS.ru.settingsSpeechVadEnergy).toContain('энергии');
  });
});
