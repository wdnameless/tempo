import { StoreService } from './store';

export type Language = 'ru' | 'en';

export interface Translations {
  // Existing keys
  tabAlarms: string;
  tabTasks: string;
  tabDashboard: string;
  tabSettings: string;
  assistantPrompt: string;
  quickAddAlarm: string;
  quickAddTask: string;
  voiceActionFailed: string;
  networkError: string;
  noSpeechDetected: string;
  unrecognizedCommand: string;
  soundPreviewFailed: string;

  // New shell - navigation / sidebar
  navDashboard: string;
  navAlarms: string;
  navTasks: string;
  navNotes: string;
  navStats: string;
  navSettings: string;
  navDailyPlanning: string;
  toggleSidebar: string;

  // Screen titles & headings
  titleDashboard: string;
  titleAlarms: string;
  titleTasks: string;
  titleNotes: string;
  titleStats: string;
  titleSettings: string;

  // Pomodoro (wave 1)
  pomodoroFocus: string;
  pomodoroShortRest: string;
  pomodoroLongRest: string;
  pomodoroIdle: string;
  pomodoroStopwatch: string;
  pomodoroMode: string;
  pomodoroOf: string;
  pomodoroToday: string;
  pomodoroStart: string;
  pomodoroPause: string;
  pomodoroReset: string;
  pomodoroSkip: string;
  pomodoroSettings: string;
  pomodoroFocusLength: string;
  pomodoroShortRestLength: string;
  pomodoroLongRestLength: string;
  pomodoroAutoStart: string;
  pomodoroAutoStartHint: string;
  pomodoroCycleHint: string;
  focusAudio: string;
  focusAudioHint: string;
  focusSoundNone: string;
  focusSoundBrown: string;
  focusSoundWhite: string;
  focusSoundRain: string;
  focusSoundCafe: string;
  dynamicBackground: string;
  dynamicBackgroundHint: string;

  // Settings section names
  settingsGeneral: string;
  settingsAppearance: string;
  settingsSound: string;
  settingsVoice: string;
  settingsAI: string;
  settingsShortcuts: string;
  settingsIntegrations: string;
  settingsAbout: string;

  // Shortcuts section UI
  shortcutsTitle: string;
  shortcutsDescription: string;
  shortcutGroupGeneral: string;
  shortcutGroupNavigation: string;
  shortcutGroupActions: string;

  // Shortcut action labels
  shortcutSpotlight: string;
  shortcutToggleSidebar: string;
  shortcutDailyPlanning: string;
  shortcutNavTasks: string;
  shortcutNavNotes: string;
  shortcutNavStats: string;
  shortcutNavSettings: string;
  shortcutNavLists: string;
  shortcutNavCalendar: string;
  shortcutDrawing: string;
  shortcutRecordings: string;
  shortcutChangeBackground: string;
  shortcutResetMusic: string;
}

export const TRANSLATIONS: Record<Language, Translations> = {
  ru: {
    // Existing keys
    tabAlarms: 'Будильники',
    tabTasks: 'Задачи',
    tabDashboard: 'Дашборд',
    tabSettings: 'Настройки',
    assistantPrompt: 'Чем могу помочь?',
    quickAddAlarm: 'Будильник установлен',
    quickAddTask: 'Задача добавлена',
    voiceActionFailed: 'Не удалось распознать голосовую команду',
    networkError: 'Ошибка сети при обращении к ассистенту',
    noSpeechDetected: 'Речь не обнаружена',
    unrecognizedCommand: 'Команда не распознана',
    soundPreviewFailed: 'Не удалось воспроизвести звук',

    // New shell - navigation / sidebar
    navDashboard: 'Дашборд',
    navAlarms: 'Будильники',
    navTasks: 'Задачи',
    navNotes: 'Заметки',
    navStats: 'Статистика',
    navSettings: 'Настройки',
    navDailyPlanning: 'План на день',
    toggleSidebar: 'Свернуть/развернуть боковую панель',

    // Screen titles & headings
    titleDashboard: 'Дашборд',
    titleAlarms: 'Будильники',
    titleTasks: 'Задачи',
    titleNotes: 'Заметки',
    titleStats: 'Статистика',
    titleSettings: 'Настройки',

    // Settings section names
    pomodoroFocus: 'Фокус',
    pomodoroShortRest: 'Перерыв',
    pomodoroLongRest: 'Длинный перерыв',
    pomodoroIdle: 'Готов',
    pomodoroStopwatch: 'Стоп-вотч',
    pomodoroMode: 'Режим',
    pomodoroOf: 'из',
    pomodoroToday: 'Сегодня',
    pomodoroStart: 'Старт',
    pomodoroPause: 'Пауза',
    pomodoroReset: 'Сброс',
    pomodoroSkip: 'Пропустить фазу',
    pomodoroSettings: 'Помодоро',
    pomodoroFocusLength: 'Длительность фокуса',
    pomodoroShortRestLength: 'Короткий перерыв',
    pomodoroLongRestLength: 'Длинный перерыв',
    pomodoroAutoStart: 'Автостарт фокуса',
    pomodoroAutoStartHint: 'Начинать следующий фокус самому после перерыва. Перерыв стартует сам всегда.',
    pomodoroCycleHint: 'После четвёртого помодоро идёт длинный перерыв.',
    focusAudio: 'Звук фокуса',
    focusAudioHint: 'Играет во время фокуса и замолкает на перерыве.',
    focusSoundNone: 'Без звука',
    focusSoundBrown: 'Коричневый шум',
    focusSoundWhite: 'Белый шум',
    focusSoundRain: 'Дождь',
    focusSoundCafe: 'Кофейня',
    dynamicBackground: 'Динамический фон',
    dynamicBackgroundHint: 'Оттенок фона следует за фазой таймера и временем суток.',
    settingsGeneral: 'Основные',
    settingsAppearance: 'Внешний вид',
    settingsSound: 'Звук',
    settingsVoice: 'Голос и речь',
    settingsAI: 'ИИ ассистент',
    settingsShortcuts: 'Горячие клавиши',
    settingsIntegrations: 'Интеграции',
    settingsAbout: 'О программе и аккаунт',

    // Shortcuts section UI
    shortcutsTitle: 'Горячие клавиши',
    shortcutsDescription: 'Клавиатурные комбинации для быстрой навигации и управления',
    shortcutGroupGeneral: 'Общие',
    shortcutGroupNavigation: 'Навигация',
    shortcutGroupActions: 'Действия',

    // Shortcut action labels
    shortcutSpotlight: 'Быстрый поиск (Spotlight)',
    shortcutToggleSidebar: 'Свернуть/развернуть боковую панель',
    shortcutDailyPlanning: 'План на день',
    shortcutNavTasks: 'Открыть задачи',
    shortcutNavNotes: 'Открыть заметки',
    shortcutNavStats: 'Открыть статистику',
    shortcutNavSettings: 'Открыть настройки',
    shortcutNavLists: 'Открыть списки',
    shortcutNavCalendar: 'Открыть календарь',
    shortcutDrawing: 'Холст для рисования',
    shortcutRecordings: 'Аудиозаписи',
    shortcutChangeBackground: 'Сменить фон',
    shortcutResetMusic: 'Сбросить музыку',
  },

  en: {
    // Existing keys
    tabAlarms: 'Alarms',
    tabTasks: 'Tasks',
    tabDashboard: 'Dashboard',
    tabSettings: 'Settings',
    assistantPrompt: 'How can I help?',
    quickAddAlarm: 'Alarm set',
    quickAddTask: 'Task added',
    voiceActionFailed: 'Voice command failed',
    networkError: 'Network error contacting assistant',
    noSpeechDetected: 'No speech detected',
    unrecognizedCommand: 'Unrecognized command',
    soundPreviewFailed: 'Failed to play sound preview',

    // New shell - navigation / sidebar
    navDashboard: 'Dashboard',
    navAlarms: 'Alarms',
    navTasks: 'Tasks',
    navNotes: 'Notes',
    navStats: 'Stats',
    navSettings: 'Settings',
    navDailyPlanning: 'Daily Planning',
    toggleSidebar: 'Toggle sidebar',

    // Screen titles & headings
    titleDashboard: 'Dashboard',
    titleAlarms: 'Alarms',
    titleTasks: 'Tasks',
    titleNotes: 'Notes',
    titleStats: 'Stats',
    titleSettings: 'Settings',

    // Settings section names
    pomodoroFocus: 'Focus',
    pomodoroShortRest: 'Break',
    pomodoroLongRest: 'Long break',
    pomodoroIdle: 'Ready',
    pomodoroStopwatch: 'Stopwatch',
    pomodoroMode: 'Mode',
    pomodoroOf: 'of',
    pomodoroToday: 'Today',
    pomodoroStart: 'Start',
    pomodoroPause: 'Pause',
    pomodoroReset: 'Reset',
    pomodoroSkip: 'Skip phase',
    pomodoroSettings: 'Pomodoro',
    pomodoroFocusLength: 'Focus length',
    pomodoroShortRestLength: 'Short break',
    pomodoroLongRestLength: 'Long break',
    pomodoroAutoStart: 'Auto-start focus',
    pomodoroAutoStartHint: 'Start the next focus by itself after a break. Breaks always start on their own.',
    pomodoroCycleHint: 'A long break follows every fourth pomodoro.',
    focusAudio: 'Focus audio',
    focusAudioHint: 'Plays during focus and falls silent on a break.',
    focusSoundNone: 'No sound',
    focusSoundBrown: 'Brown noise',
    focusSoundWhite: 'White noise',
    focusSoundRain: 'Rain',
    focusSoundCafe: 'Cafe',
    dynamicBackground: 'Dynamic background',
    dynamicBackgroundHint: 'The hue follows the timer phase and the time of day.',
    settingsGeneral: 'General',
    settingsAppearance: 'Appearance',
    settingsSound: 'Sound',
    settingsVoice: 'Voice & Speech',
    settingsAI: 'AI Assistant',
    settingsShortcuts: 'Shortcuts',
    settingsIntegrations: 'Integrations',
    settingsAbout: 'About & Account',

    // Shortcuts section UI
    shortcutsTitle: 'Keyboard Shortcuts',
    shortcutsDescription: 'Keyboard shortcuts for fast navigation and control',
    shortcutGroupGeneral: 'General',
    shortcutGroupNavigation: 'Navigation',
    shortcutGroupActions: 'Actions',

    // Shortcut action labels
    shortcutSpotlight: 'Spotlight Search',
    shortcutToggleSidebar: 'Toggle sidebar',
    shortcutDailyPlanning: 'Daily Planning',
    shortcutNavTasks: 'Go to Tasks',
    shortcutNavNotes: 'Go to Notes',
    shortcutNavStats: 'Go to Stats',
    shortcutNavSettings: 'Go to Settings',
    shortcutNavLists: 'Go to Lists',
    shortcutNavCalendar: 'Go to Calendar',
    shortcutDrawing: 'Drawing Board',
    shortcutRecordings: 'Recordings',
    shortcutChangeBackground: 'Change Background',
    shortcutResetMusic: 'Reset Music',
  },
};

export class I18nService {
  static getLang(): Language {
    const raw = StoreService.getPreference<string>('tempo_lang', StoreService.getPreference('alarmer_lang', 'ru'));
    return (raw === 'en' ? 'en' : 'ru') as Language;
  }

  static setLang(lang: Language) {
    StoreService.setPreference('tempo_lang', lang);
    StoreService.setPreference('alarmer_lang', lang);
    this.listeners.forEach((listener) => listener());
  }

  private static listeners = new Set<() => void>();

  /**
   * Notifies when the language changes.
   *
   * The chrome is rendered from `t()` at the top of the tree, so switching the
   * language has to re-render it — a stored preference alone leaves the tab
   * labels in the previous language until something else happens to redraw them.
   */
  static subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  static t(): Translations {
    return TRANSLATIONS[this.getLang()];
  }
}
