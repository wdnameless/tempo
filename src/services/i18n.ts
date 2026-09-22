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
  statsEmptyTitle: string;
  statsEmptyBody: string;
  statsEmptyHint: string;
  statsTitle: string;
  statsSubtitle: string;
  statsPeriodDay: string;
  statsPeriodWeek: string;
  statsFocusDays: string;
  statsFocusWeeks: string;
  statsTotalDays: string;
  statsTotalWeeks: string;
  statsPomodoros: string;
  statsCompletedSessions: string;
  statsStreak: string;
  statsDaysShort: string;
  statsTasksCard: string;
  statsFocusChart: string;
  statsHeatmap: string;
  statsHeatLess: string;
  statsHeatMore: string;
  statsPeakHours: string;
  statsCompletedChart: string;
  statsTotalWord: string;
  statsBestStreak: string;
  statsDoneOfTotal: string;
  statsPeakAt: string;
  syncTitle: string;
  syncDisabled: string;
  syncSavePath: string;
  syncSharedFolder: string;
  syncSharedFolderPath: string;
  syncError: string;
  syncMediaFiles: string;
  syncMethod: string;
  syncFolderPlaceholder: string;
  syncCancel: string;
  syncConfirmMedia: string;
  syncEnableMedia: string;
  syncDeviceIdFull: string;
  syncLastSync: string;
  syncNeverSynced: string;
  syncUnavailable: string;
  syncMediaWarning: string;
  syncDriveBlocked: string;
  syncDriveTitle: string;
  settingsTitle: string;
  settingsSubtitle: string;
  settingsTimerFocus: string;
  settingsDefaultMode: string;
  settingsModePomodoro: string;
  settingsModeStopwatch: string;
  settingsBlockPreset: string;
  settingsEndSound: string;
  settingsSoundChime: string;
  settingsSoundBell: string;
  settingsSoundAlarm: string;
  settingsSoundDigital: string;
  settingsFocusMinutes: string;
  settingsShortBreak: string;
  settingsLongBreak: string;
  settingsLongBreakEvery: string;
  settingsFocusDurationAria: string;
  settingsShortBreakAria: string;
  settingsLongBreakAria: string;
  settingsLongBreakEveryAria: string;
  settingsAccent: string;
  settingsDynamicBackground: string;
  settingsDynamicBackgroundHint: string;
  settingsRollover: string;
  settingsRolloverHour: string;
  settingsRolloverHint: string;
  settingsTimeZone: string;
  settingsMedia: string;
  settingsMediaHint: string;
  settingsRemove: string;
  settingsAssistant: string;
  settingsApiKey: string;
  settingsApiKeyAria: string;
  settingsSaveKey: string;
  settingsSaving: string;
  settingsSaved: string;
  settingsKeyStored: string;
  settingsKeyHidden: string;
  settingsBaseUrl: string;
  settingsBaseUrlAria: string;
  settingsModel: string;
  settingsModelAria: string;
  settingsVoiceHint: string;
  settingsTestVoice: string;
  settingsIntegrationsHint: string;
  settingsGoogleCalendar: string;
  settingsNotConnected: string;
  settingsConnected: string;
  settingsGoogleBlocked: string;
  settingsGoogleMissing: string;
  settingsGoogleAwaiting: string;
  settingsCalendarActive: string;
  settingsSpeech: string;
  settingsSpeechHint: string;
  settingsSpeechEnable: string;
  settingsSpeechEnableHint: string;
  settingsSpeechHotkey: string;
  settingsSpeechHotkeyPlaceholder: string;
  settingsSpeechCancelHotkey: string;
  settingsSpeechCancelHotkeyPlaceholder: string;
  settingsSpeechActivationMode: string;
  settingsSpeechActivationHoldOrToggle: string;
  settingsSpeechActivationHoldOrToggleDesc: string;
  settingsSpeechActivationPushToTalk: string;
  settingsSpeechActivationPushToTalkDesc: string;
  settingsSpeechActivationToggle: string;
  settingsSpeechActivationToggleDesc: string;
  settingsSpeechHoldThreshold: string;
  settingsSpeechHoldThresholdDesc: string;
  settingsSpeechTabModels: string;
  settingsSpeechTabPtt: string;
  settingsSpeechTabAudio: string;
  settingsSpeechTabDelivery: string;
  settingsSpeechTabFeedback: string;
  settingsSpeechTabLanguage: string;
  settingsSpeechTabHistory: string;
  settingsSpeechTabPostprocess: string;
  settingsSpeechTabAdvanced: string;
  settingsSpeechTabDebug: string;
  settingsSpeechModelsSearch: string;
  settingsSpeechModelsFilterAll: string;
  settingsSpeechModelsFilterInstalled: string;
  settingsSpeechModelsFilterRecommended: string;
  settingsSpeechModelsFilterLanguages: string;
  settingsSpeechModelsRescan: string;
  settingsSpeechModelsImport: string;
  settingsSpeechModelsOpenDir: string;
  settingsSpeechModelsFreeDisk: string;
  settingsSpeechModelActive: string;
  settingsSpeechModelUse: string;
  settingsSpeechModelDownload: string;
  settingsSpeechModelDownloading: string;
  settingsSpeechModelVerifying: string;
  settingsSpeechModelDelete: string;
  settingsSpeechModelDeleteConfirm: string;
  settingsSpeechModelCancelDownload: string;
  settingsSpeechModelSpeed: string;
  settingsSpeechModelAccuracy: string;
  settingsSpeechModelParameters: string;
  settingsSpeechModelQuant: string;
  settingsSpeechModelLanguages: string;
  settingsSpeechModelCustom: string;
  settingsSpeechInputDevice: string;
  settingsSpeechInputDeviceDefault: string;
  settingsSpeechInputChannel: string;
  settingsSpeechInputChannelDefault: string;
  settingsSpeechVadBackend: string;
  settingsSpeechVadEnergy: string;
  settingsSpeechVadEarshot: string;
  settingsSpeechVadThreshold: string;
  settingsSpeechTestMic: string;
  settingsSpeechTestMicStop: string;
  settingsSpeechMicLevel: string;
  settingsSpeechPasteMethod: string;
  settingsSpeechPasteMethodCtrlV: string;
  settingsSpeechPasteMethodShiftInsert: string;
  settingsSpeechPasteMethodDirect: string;
  settingsSpeechClipboardBehavior: string;
  settingsSpeechClipboardRestore: string;
  settingsSpeechClipboardKeep: string;
  settingsSpeechPasteDelayBefore: string;
  settingsSpeechPasteDelayAfter: string;
  settingsSpeechAppendSpace: string;
  settingsSpeechAutoSubmit: string;
  settingsSpeechFeedbackEnabled: string;
  settingsSpeechFeedbackEnabledDesc: string;
  settingsSpeechFeedbackVolume: string;
  settingsSpeechSoundTheme: string;
  settingsSpeechSoundThemeDefault: string;
  settingsSpeechSoundThemeSoft: string;
  settingsSpeechSoundThemeMechanical: string;
  settingsSpeechPlayTestStart: string;
  settingsSpeechPlayTestStop: string;
  settingsSpeechLanguage: string;
  settingsSpeechLanguageAuto: string;
  settingsSpeechTranslateToEnglish: string;
  settingsSpeechTranslateToEnglishDesc: string;
  settingsSpeechCustomWords: string;
  settingsSpeechCustomWordsPlaceholder: string;
  settingsSpeechCustomWordsDesc: string;
  settingsSpeechRemoveFillerWords: string;
  settingsSpeechRemoveFillerWordsDesc: string;
  settingsSpeechHistoryEnabled: string;
  settingsSpeechHistoryLimit: string;
  settingsSpeechHistoryRetention: string;
  settingsSpeechHistoryRetentionDays: string;
  settingsSpeechHistoryRetentionForever: string;
  settingsSpeechHistoryClear: string;
  settingsSpeechHistoryClearConfirm: string;
  settingsSpeechHistoryEmpty: string;
  settingsSpeechHistorySearch: string;
  settingsSpeechHistoryCopy: string;
  settingsSpeechHistoryCopied: string;
  settingsSpeechHistoryRetry: string;
  settingsSpeechHistoryDelete: string;
  settingsSpeechHistorySave: string;
  settingsSpeechHistoryUnsave: string;
  settingsSpeechHistoryPlay: string;
  settingsSpeechHistoryDuration: string;
  settingsSpeechPostprocessEnabled: string;
  settingsSpeechPostprocessDesc: string;
  settingsSpeechPostprocessPrompt: string;
  settingsSpeechPostprocessPromptPlaceholder: string;
  settingsSpeechPostprocessTest: string;
  settingsSpeechPostprocessTestInput: string;
  settingsSpeechPostprocessTestRun: string;
  settingsSpeechPostprocessTestResult: string;
  settingsSpeechOnboardingTitle: string;
  settingsSpeechOnboardingSubtitle: string;
  settingsSpeechOnboardingStep1: string;
  settingsSpeechOnboardingStep2: string;
  settingsSpeechOnboardingStep3: string;
  settingsSpeechOnboardingStep4: string;
  settingsSpeechOnboardingNext: string;
  settingsSpeechOnboardingBack: string;
  settingsSpeechOnboardingFinish: string;
  settingsSpeechOnboardingSkip: string;
  settingsSpeechOnboardingStartTest: string;
  settingsSpeechDebugTitle: string;
  settingsSpeechDebugPaths: string;
  settingsSpeechDebugModelsDir: string;
  settingsSpeechDebugState: string;
  settingsSpeechDebugLastErrors: string;
  settingsSpeechDebugNoErrors: string;
  settingsSpeechDebugRerunOnboarding: string;
  settingsSpeechAdvancedTitle: string;
  settingsSpeechAccelerator: string;
  settingsSpeechAcceleratorDesc: string;
  settingsSpeechAcceleratorAuto: string;
  settingsSpeechAcceleratorCpu: string;
  settingsSpeechAcceleratorNoGpu: string;
  settingsSpeechAcceleratorMissing: string;
  settingsSpeechModelUnload: string;
  settingsSpeechModelUnloadDesc: string;
  settingsSpeechModelUnloadNever: string;
  settingsSpeechModelUnload2Min: string;
  settingsSpeechModelUnload5Min: string;
  settingsSpeechModelUnload10Min: string;
  settingsSpeechModelUnload15Min: string;
  dictationIndicatorRecording: string;
  dictationIndicatorTranscribing: string;
  dictationIndicatorCancel: string;
  dictationIndicatorStop: string;
  settingsWhisperModel: string;
  settingsWhisperTiny: string;
  settingsWhisperBase: string;
  settingsWhisperSmall: string;
  settingsWhisperHint: string;
  sttErrorNoModel: string;
  sttErrorNoMic: string;
  sttErrorCloudRefused: string;
  sttErrorInjectionFailed: string;
  sttErrorNetwork: string;
  sttErrorDiskSpace: string;
  sttErrorModelVerifyFailed: string;
  sttErrorHotkeyInvalid: string;
  sttErrorHotkeyTaken: string;
  sttErrorNoDevice: string;
  sttErrorImportFailed: string;
  sttErrorPostprocessFailed: string;
  sttCopiedToClipboard: string;
  sttInsertedIntoWindow: string;
  recTranscribe: string;
  recTranscribeAll: string;
  recTranscript: string;
  recTranscriptPending: string;
  recTranscriptFailed: string;
  recTranscriptDone: string;
  sttEngineLocal: string;
  sttEngineCloud: string;
  sttDownloadCancel: string;
  sttDeleteModel: string;
  sttDownloadModel: string;
  sttSize: string;
  sttQuality: string;
  sttModelInstalled: string;
  settingsShortcutsHint: string;
  settingsShortcutsEmpty: string;
  settingsAboutHint: string;
  settingsVersion: string;
  settingsVersionHint: string;
  settingsEnvironment: string;
  settingsEnvironmentHint: string;
  settingsPortable: string;
  settingsInstalled: string;
  settingsUpdate: string;
  settingsUpdateHint: string;
  settingsInstallUpdate: string;
  settingsInstalling: string;
  settingsGoogleAccount: string;
  settingsActive: string;
  settingsUnlinked: string;
  settingsIntegrationsTab: string;
  settingsShortcutsTab: string;
  settingsAboutTab: string;
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

  searchPlaceholder: string;
  searchEmpty: string;
  searchNoResults: string;
  searchGroupCommands: string;
  searchGroupScreens: string;
  searchGroupAlarms: string;
  searchGroupSessions: string;
  searchHintOpen: string;
  changeAccent: string;

  navLists: string;
  commonAdd: string;
  commonLoading: string;
  titleLists: string;
  tasksNew: string;
  tasksEmpty: string;
  tasksCompleted: string;
  tasksSubtasks: string;
  tasksPriority: string;
  priorityNone: string;
  priorityLow: string;
  priorityMedium: string;
  priorityHigh: string;
  tasksDueDate: string;
  tasksStartAt: string;
  tasksPlanned: string;
  tasksMinutesShort: string;
  tasksDelete: string;
  tasksSortManual: string;
  tasksSortDue: string;
  tasksSortPriority: string;
  tasksAddSubtask: string;
  listsNew: string;
  listsEmpty: string;
  listsName: string;
  listsToTask: string;
  listsDelete: string;

  navCalendar: string;
  calendarMonth: string;
  calendarWeek: string;
  calendarDay: string;
  calendarToday: string;
  calendarNewEvent: string;
  calendarEditEvent: string;
  calendarDeleteEvent: string;
  calendarEventTitle: string;
  calendarAllDay: string;
  calendarStart: string;
  calendarEnd: string;
  calendarLocation: string;
  calendarSource: string;
  calendarSourceLocal: string;
  calendarSourceGoogle: string;
  calendarSourceTask: string;
  calendarFilterAll: string;
  calendarShowTasks: string;
  calendarEmptyMonth: string;
  calendarEmptyDay: string;
  calendarSave: string;
  calendarCancel: string;
  calendarConfirmDelete: string;
  calendarTimeSlotError: string;

  navDay: string;
  titleDay: string;
  dayStepPlan: string;
  dayStepExecute: string;
  dayStepReview: string;
  dayToday: string;
  dayTomorrow: string;
  dayYesterday: string;
  dayEmpty: string;
  dayEmptyHint: string;
  dayPickMain: string;
  dayUnplanned: string;
  dayDone: string;
  dayUnfinished: string;
  dayCarryOver: string;
  dayCarriedOver: string;
  dayAllDay: string;
  dayConflict: string;
  dayConflictHint: string;
  dayNewEvent: string;
  dayEventTitle: string;
  dayFromGoogle: string;
  rollover: string;
  rolloverAfter: string;
  rolloverHint: string;
  rolloverTimezone: string;
  rolloverDisabledHint: string;

  notesNew: string;
  notesEmpty: string;
  notesBody: string;
  notesPreview: string;
  notesBacklinks: string;
  notesNoBacklinks: string;
  notesCreateTarget: string;
  notesBrokenLink: string;
  notesDelete: string;
  notesPin: string;
  notesUnpin: string;
  notesLinkHint: string;

  navRecordings: string;
  recTabAudio: string;
  recTabScreen: string;
  recMic: string;
  recSystem: string;
  recDevice: string;
  recDefaultDevice: string;
  recSource: string;
  recMonitors: string;
  recWindows: string;
  recStart: string;
  recStop: string;
  recPause: string;
  recResume: string;
  recCancel: string;
  recRecording: string;
  recPaused: string;
  recEmpty: string;
  recDelete: string;
  recRename: string;
  recDuration: string;
  recSize: string;
  recNoDevices: string;
  recNoSources: string;
  recPermissionMic: string;
  recPermissionScreen: string;
  recPermissionHint: string;
  recDiscard: string;
  recKindAudio: string;
  recKindScreen: string;
  recPreviewHint: string;
  recConfirmScreen: string;
  recConfirmNeeded: string;
  navDrawings: string;
  drawingsNew: string;
  drawingsEmpty: string;
  drawToolPen: string;
  drawToolMarker: string;
  drawToolEraser: string;
  drawToolLine: string;
  drawToolRect: string;
  drawToolEllipse: string;
  drawToolText: string;
  drawColor: string;
  drawWidth: string;
  drawZoom: string;
  drawReset: string;
  drawExportPng: string;
  drawExportSvg: string;
  drawToolbarHint: string;
  drawingsDelete: string;
  storageUsage: string;
  storageUsageHint: string;

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
  minutesShort: string;
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
  settingsSpeechToText: string;

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
    navDashboard: 'Помодоро',
    navAlarms: 'Будильники',
    navTasks: 'Задачи',
    navNotes: 'Заметки',
    statsEmptyTitle: 'Статистика пока пуста',
    statsEmptyBody: 'Здесь появятся часы концентрации, тепловая карта активности за 12 недель, серии продуктивности и пиковые часы дня.',
    statsEmptyHint: 'Завершите сессию таймера для старта',
    statsTitle: 'Статистика',
    statsSubtitle: 'Обзор времени концентрации и выполнения задач',
    statsPeriodDay: 'По дням',
    statsPeriodWeek: 'По неделям',
    statsFocusDays: 'Фокус (14 дней)',
    statsFocusWeeks: 'Фокус (12 недель)',
    statsTotalDays: 'Итого за 14 дней',
    statsTotalWeeks: 'Итого за 12 недель',
    statsPomodoros: 'Помодоро',
    statsCompletedSessions: 'Завершённых сессий',
    statsStreak: 'Серия дней',
    statsDaysShort: 'дн.',
    statsTasksCard: 'Задачи',
    statsFocusChart: 'Время концентрации по дням (2 недели)',
    statsHeatmap: 'Тепловая карта активности (12 недель)',
    statsHeatLess: 'Меньше',
    statsHeatMore: 'Больше',
    statsPeakHours: 'Пиковые часы (24 ч)',
    statsCompletedChart: 'Выполнено задач за 14 дней',
    statsTotalWord: 'всего',
    statsBestStreak: 'Рекорд: {n} дн.',
    statsDoneOfTotal: '{done} из {total} выполнено',
    statsPeakAt: 'Пик: {hour}:00',
    syncTitle: 'Синхронизация устройств',
    syncDisabled: 'Выключена',
    syncSavePath: 'Сохранить путь',
    syncSharedFolder: 'Общая папка',
    syncSharedFolderPath: 'Путь к общей папке',
    syncError: 'Ошибка синхронизации',
    syncMediaFiles: 'Синхронизировать медиафайлы',
    syncMethod: 'Способ синхронизации',
    syncFolderPlaceholder: '/путь/к/папке',
    syncCancel: 'Отмена',
    syncConfirmMedia: 'Подтвердите передачу медиафайлов',
    syncEnableMedia: 'Включить передачу медиа',
    syncDeviceIdFull: 'Полный идентификатор устройства: {id}',
    syncLastSync: 'Последняя синхронизация: {when}',
    syncNeverSynced: 'Ещё не синхронизировалось',
    syncUnavailable: 'Недоступно',
    syncMediaWarning: 'При включении аудио и медиафайлы покинут это устройство и попадут в общую папку.',
    syncDriveBlocked: 'Синхронизация с Google Drive требует вашего Cloud-проекта и OAuth Client ID. Прямая синхронизация с Drive пока недоступна — используйте общую папку, которую синхронизирует клиент Google Drive.',
    syncDriveTitle: 'Google Drive',
    settingsTitle: 'Настройки',
    settingsSubtitle: 'Поведение, горячие клавиши и интеграции',
    settingsTimerFocus: 'Таймер и фокус',
    settingsDefaultMode: 'Режим таймера по умолчанию',
    settingsModePomodoro: 'Помодоро',
    settingsModeStopwatch: 'Секундомер',
    settingsBlockPreset: 'Пресет блоков',
    settingsEndSound: 'Звук окончания',
    settingsSoundChime: 'Перезвон',
    settingsSoundBell: 'Колокол',
    settingsSoundAlarm: 'Будильник',
    settingsSoundDigital: 'Цифровой',
    settingsFocusMinutes: 'Фокус (мин)',
    settingsShortBreak: 'Короткий перерыв (мин)',
    settingsLongBreak: 'Длинный перерыв (мин)',
    settingsLongBreakEvery: 'Длинный перерыв каждые',
    settingsFocusDurationAria: 'Длительность фокуса',
    settingsShortBreakAria: 'Длительность короткого перерыва',
    settingsLongBreakAria: 'Длительность длинного перерыва',
    settingsLongBreakEveryAria: 'Интервал длинного перерыва',
    settingsAccent: 'Акцентный цвет',
    settingsDynamicBackground: 'Динамический фон',
    settingsDynamicBackgroundHint: 'Фон следует за фазами таймера и состоянием',
    settingsRollover: 'Начало дня и часовой пояс',
    settingsRolloverHour: 'Час начала дня',
    settingsRolloverHint: 'Определяет местные даты и интервалы',
    settingsTimeZone: 'Часовой пояс',
    settingsMedia: 'Медиа и потолок хранилища',
    settingsMediaHint: 'Рисунки, записи и превью в кэше',
    settingsRemove: 'Убрать',
    settingsAssistant: 'Настройка ассистента',
    settingsApiKey: 'Ключ API',
    settingsApiKeyAria: 'Поле ключа API',
    settingsSaveKey: 'Сохранить ключ',
    settingsSaving: 'Сохранение…',
    settingsSaved: 'Сохранено',
    settingsKeyStored: 'Хранится в системном хранилище, не в открытом виде.',
    settingsKeyHidden: 'Ключ хранится в системном хранилище и не показывается.',
    settingsBaseUrl: 'Базовый URL',
    settingsBaseUrlAria: 'Базовый URL ассистента',
    settingsModel: 'Модель',
    settingsModelAria: 'Модель ассистента',
    settingsVoiceHint: 'Проверка облачного голоса Edge TTS',
    settingsTestVoice: 'Проверить голос',
    settingsIntegrationsHint: 'Прямые интеграции с внешними сервисами',
    settingsGoogleCalendar: 'Google Календарь',
    settingsNotConnected: 'Не подключён',
    settingsConnected: 'Подключён',
    settingsGoogleBlocked: 'Google OAuth не настроен: нужен Cloud-проект пользователя (нет client ID).',
    settingsGoogleMissing: 'В проекте нет настроек Google OAuth.',
    settingsGoogleAwaiting: 'Ожидаются учётные данные Cloud-проекта',
    settingsCalendarActive: 'Синхронизация календаря работает.',
    settingsSpeech: 'Распознавание речи',
    settingsSpeechHint: 'Локальная расшифровка и голосовые команды',
    settingsSpeechEnable: 'Включить распознавание речи',
    settingsSpeechEnableHint: 'Глобальная клавиша записывает и расшифровывает звук',
    settingsSpeechHotkey: 'Клавиша диктовки',
    settingsSpeechHotkeyPlaceholder: 'напр. CommandOrControl+Shift+Space',
    settingsSpeechCancelHotkey: 'Клавиша отмены',
    settingsSpeechCancelHotkeyPlaceholder: 'напр. Escape',
    settingsSpeechActivationMode: 'Режим активации',
    settingsSpeechActivationHoldOrToggle: 'Hold or Toggle',
    settingsSpeechActivationHoldOrToggleDesc: 'Короткое нажатие фиксирует запись, долгое — работает пока держите',
    settingsSpeechActivationPushToTalk: 'Push to Talk',
    settingsSpeechActivationPushToTalkDesc: 'Запись идёт только пока клавиша зажата',
    settingsSpeechActivationToggle: 'Toggle',
    settingsSpeechActivationToggleDesc: 'Нажмите один раз для старта, второй раз для завершения',
    settingsSpeechHoldThreshold: 'Порог удержания',
    settingsSpeechHoldThresholdDesc: 'Время в миллисекундах для различения тапа и зажатия',
    settingsSpeechTabModels: 'Модели',
    settingsSpeechTabPtt: 'Активация и клавиши',
    settingsSpeechTabAudio: 'Аудио и VAD',
    settingsSpeechTabDelivery: 'Вставка текста',
    settingsSpeechTabFeedback: 'Звуковой отклик',
    settingsSpeechTabLanguage: 'Язык и словарь',
    settingsSpeechTabHistory: 'История',
    settingsSpeechTabPostprocess: 'Пост-обработка',
    settingsSpeechTabAdvanced: 'Расширенные',
    settingsSpeechTabDebug: 'Диагностика',
    settingsSpeechModelsSearch: 'Поиск моделей...',
    settingsSpeechModelsFilterAll: 'Все',
    settingsSpeechModelsFilterInstalled: 'Установленные',
    settingsSpeechModelsFilterRecommended: 'Рекомендуемые',
    settingsSpeechModelsFilterLanguages: 'Все языки',
    settingsSpeechModelsRescan: 'Пересканировать папку',
    settingsSpeechModelsImport: 'Импорт .gguf',
    settingsSpeechModelsOpenDir: 'Открыть папку',
    settingsSpeechModelsFreeDisk: 'Свободно на диске',
    settingsSpeechModelActive: 'Активная',
    settingsSpeechModelUse: 'Выбрать',
    settingsSpeechModelDownload: 'Скачать',
    settingsSpeechModelDownloading: 'Скачивание...',
    settingsSpeechModelVerifying: 'Проверка целостности...',
    settingsSpeechModelDelete: 'Удалить',
    settingsSpeechModelDeleteConfirm: 'Вы уверены, что хотите удалить эту модель?',
    settingsSpeechModelCancelDownload: 'Отменить',
    settingsSpeechModelSpeed: 'Скорость',
    settingsSpeechModelAccuracy: 'Точность',
    settingsSpeechModelParameters: 'Параметры',
    settingsSpeechModelQuant: 'Квантование',
    settingsSpeechModelLanguages: 'Языки',
    settingsSpeechModelCustom: 'Своя модель',
    settingsSpeechInputDevice: 'Микрофон',
    settingsSpeechInputDeviceDefault: 'По умолчанию',
    settingsSpeechInputChannel: 'Канал аудио',
    settingsSpeechInputChannelDefault: 'Все / Моно',
    settingsSpeechVadBackend: 'Детектор активности (VAD)',
    settingsSpeechVadEnergy: 'Energy (RMS)',
    settingsSpeechVadEarshot: 'Earshot (Нейросеть)',
    settingsSpeechVadThreshold: 'Порог чувствительности VAD',
    settingsSpeechTestMic: 'Проверить микрофон',
    settingsSpeechTestMicStop: 'Остановить проверку',
    settingsSpeechMicLevel: 'Уровень входного сигнала',
    settingsSpeechPasteMethod: 'Метод вставки',
    settingsSpeechPasteMethodCtrlV: 'Ctrl+V',
    settingsSpeechPasteMethodShiftInsert: 'Shift+Insert',
    settingsSpeechPasteMethodDirect: 'Прямой ввод',
    settingsSpeechClipboardBehavior: 'Поведение буфера обмена',
    settingsSpeechClipboardRestore: 'Восстанавливать предыдущее содержимое',
    settingsSpeechClipboardKeep: 'Оставлять распознанный текст',
    settingsSpeechPasteDelayBefore: 'Задержка перед вставкой (мс)',
    settingsSpeechPasteDelayAfter: 'Задержка после вставки (мс)',
    settingsSpeechAppendSpace: 'Добавлять пробел в конце',
    settingsSpeechAutoSubmit: 'Авто-отправка (Enter после вставки)',
    settingsSpeechFeedbackEnabled: 'Звуковой отклик',
    settingsSpeechFeedbackEnabledDesc: 'Воспроизводить звуки при начале и завершении записи',
    settingsSpeechFeedbackVolume: 'Громкость звуков',
    settingsSpeechSoundTheme: 'Звуковая тема',
    settingsSpeechSoundThemeDefault: 'По умолчанию',
    settingsSpeechSoundThemeSoft: 'Мягкая (Soft)',
    settingsSpeechSoundThemeMechanical: 'Механическая (Mechanical)',
    settingsSpeechPlayTestStart: 'Звук старта',
    settingsSpeechPlayTestStop: 'Звук остановки',
    settingsSpeechLanguage: 'Язык распознавания',
    settingsSpeechLanguageAuto: 'Автоопределение',
    settingsSpeechTranslateToEnglish: 'Переводить на английский',
    settingsSpeechTranslateToEnglishDesc: 'Распознанный текст на любом языке будет переведён на английский',
    settingsSpeechCustomWords: 'Собственный словарь',
    settingsSpeechCustomWordsPlaceholder: 'Слова и термины через запятую или с новой строки',
    settingsSpeechCustomWordsDesc: 'Подсказка для модели для редких терминов, имен и акронимов',
    settingsSpeechRemoveFillerWords: 'Удалять слова-паразиты',
    settingsSpeechRemoveFillerWordsDesc: 'Автоматически вырезать "эээ", "ну", "типа", "um", "uh" из текста',
    settingsSpeechHistoryEnabled: 'Сохранять историю диктовки',
    settingsSpeechHistoryLimit: 'Лимит записей в истории',
    settingsSpeechHistoryRetention: 'Срок хранения записей',
    settingsSpeechHistoryRetentionDays: '{count} дн.',
    settingsSpeechHistoryRetentionForever: 'Бессрочно',
    settingsSpeechHistoryClear: 'Очистить историю',
    settingsSpeechHistoryClearConfirm: 'Удалить все записи из истории?',
    settingsSpeechHistoryEmpty: 'История диктовки пуста',
    settingsSpeechHistorySearch: 'Поиск по истории...',
    settingsSpeechHistoryCopy: 'Копировать текст',
    settingsSpeechHistoryCopied: 'Скопировано!',
    settingsSpeechHistoryRetry: 'Распознать заново',
    settingsSpeechHistoryDelete: 'Удалить запись',
    settingsSpeechHistorySave: 'Сохранить',
    settingsSpeechHistoryUnsave: 'Убрать из сохранённых',
    settingsSpeechHistoryPlay: 'Слушать аудио',
    settingsSpeechHistoryDuration: 'Длительность: {duration}',
    settingsSpeechPostprocessEnabled: 'Включить ИИ пост-обработку',
    settingsSpeechPostprocessDesc: 'Автоматически улучшать пунктуацию, стиль и форматирование с помощью модели',
    settingsSpeechPostprocessPrompt: 'Системный промпт',
    settingsSpeechPostprocessPromptPlaceholder: 'Инструкции для ИИ...',
    settingsSpeechPostprocessTest: 'Тестовый прогон',
    settingsSpeechPostprocessTestInput: 'Текст для теста',
    settingsSpeechPostprocessTestRun: 'Обработать',
    settingsSpeechPostprocessTestResult: 'Результат',
    settingsSpeechOnboardingTitle: 'Настройка распознавания речи',
    settingsSpeechOnboardingSubtitle: 'Настройте локальную модель и горячую клавишу за 4 простых шага',
    settingsSpeechOnboardingStep1: '1. Выбор модели',
    settingsSpeechOnboardingStep2: '2. Загрузка',
    settingsSpeechOnboardingStep3: '3. Клавиша диктовки',
    settingsSpeechOnboardingStep4: '4. Проверка работы',
    settingsSpeechOnboardingNext: 'Далее',
    settingsSpeechOnboardingBack: 'Назад',
    settingsSpeechOnboardingFinish: 'Завершить настройку',
    settingsSpeechOnboardingSkip: 'Пропустить',
    settingsSpeechOnboardingStartTest: 'Нажмите и говорите для теста',
    settingsSpeechDebugTitle: 'Диагностика речи',
    settingsSpeechDebugPaths: 'Системные пути',
    settingsSpeechDebugModelsDir: 'Папка моделей',
    settingsSpeechDebugState: 'Текущее состояние',
    settingsSpeechDebugLastErrors: 'Последние ошибки',
    settingsSpeechDebugNoErrors: 'Ошибок нет',
    settingsSpeechDebugRerunOnboarding: 'Пройти мастер настройки заново',
    settingsSpeechAdvancedTitle: 'Расширенные настройки',
    settingsSpeechAccelerator: 'Ускоритель вычислений',
    settingsSpeechAcceleratorDesc: 'Устройство для распознавания речи Whisper (автовыбор, GPU или процессор)',
    settingsSpeechAcceleratorAuto: 'Автовыбор',
    settingsSpeechAcceleratorCpu: 'Процессор (CPU)',
    settingsSpeechAcceleratorNoGpu: 'Подходящие графические ускорители (GPU) не обнаружены',
    settingsSpeechAcceleratorMissing: 'Выбранное ранее устройство недоступно, используется автовыбор',
    settingsSpeechModelUnload: 'Выгрузка модели из памяти',
    settingsSpeechModelUnloadDesc: 'Автоматически освобождать память при отсутствии активности',
    settingsSpeechModelUnloadNever: 'Не выгружать',
    settingsSpeechModelUnload2Min: '2 минуты',
    settingsSpeechModelUnload5Min: '5 минут',
    settingsSpeechModelUnload10Min: '10 минут',
    settingsSpeechModelUnload15Min: '15 минут',
    dictationIndicatorRecording: 'Запись...',
    dictationIndicatorTranscribing: 'Распознавание...',
    dictationIndicatorCancel: 'Отмена',
    dictationIndicatorStop: 'Завершить',
    settingsWhisperModel: 'Модель Whisper',
    settingsWhisperTiny: 'Whisper Tiny (~75 МБ)',
    settingsWhisperBase: 'Whisper Base (~145 МБ)',
    settingsWhisperSmall: 'Whisper Small (~480 МБ)',
    settingsWhisperHint: 'Модель загрузится автоматически при первом включении.',
    sttErrorNoModel: 'Модель распознавания не загружена',
    sttErrorNoMic: 'Микрофон недоступен',
    sttErrorCloudRefused: 'Ошибка облачного распознавания',
    sttErrorInjectionFailed: 'Не удалось вставить текст в окно (скопировано в буфер)',
    sttErrorNetwork: 'Сетевая ошибка при загрузке модели или обращении к облаку',
    sttErrorDiskSpace: 'Недостаточно места на диске для загрузки модели',
    sttErrorModelVerifyFailed: 'Не удалось проверить целостность модели (не совпала контрольная сумма)',
    sttErrorHotkeyInvalid: 'Недопустимая комбинация клавиш',
    sttErrorHotkeyTaken: 'Комбинация клавиш уже занята другим приложением',
    sttErrorNoDevice: 'Устройство аудиовхода не найдено',
    sttErrorImportFailed: 'Не удалось импортировать модель .gguf',
    sttErrorPostprocessFailed: 'Ошибка ИИ пост-обработки транскрипта',
    sttCopiedToClipboard: 'Текст скопирован в буфер обмена',
    sttInsertedIntoWindow: 'Текст вставлен в активное окно',
    settingsShortcutsHint: 'Список берётся из реестра горячих клавиш',
    settingsShortcutsEmpty: 'Горячие клавиши не зарегистрированы.',
    settingsAboutHint: 'Сборка, портативный режим и подключённые сервисы',
    settingsVersion: 'Версия Tempo',
    settingsVersionHint: 'Версия сборки приложения',
    settingsEnvironment: 'Режим окружения',
    settingsEnvironmentHint: 'Портативный каталог или установка',
    settingsPortable: 'Портативный режим',
    recTranscribe: 'Распознать речь',
    recTranscribeAll: 'Распознать все записи',
    recTranscript: 'Транскрипт',
    recTranscriptPending: 'Ожидает распознавания',
    recTranscriptFailed: 'Ошибка распознавания',
    recTranscriptDone: 'Распознано',
    sttEngineLocal: 'Локальная (Whisper)',
    sttEngineCloud: 'Облачная (BYOK)',
    sttDownloadCancel: 'Отменить',
    sttDeleteModel: 'Удалить модель',
    sttDownloadModel: 'Скачать модель',
    sttSize: 'Размер',
    sttQuality: 'Качество (WER)',
    sttModelInstalled: 'Установлена',
    settingsInstalled: 'Обычная установка',
    settingsUpdate: 'Обновление',
    settingsUpdateHint: 'Проверить доступные версии',
    settingsInstallUpdate: 'Установить обновление',
    settingsInstalling: 'Установка…',
    settingsGoogleAccount: 'Аккаунт Google',
    settingsActive: 'Активен',
    settingsUnlinked: 'Не привязан',
    settingsIntegrationsTab: 'Интеграции',
    settingsShortcutsTab: 'Горячие клавиши',
    settingsAboutTab: 'О программе и аккаунт',
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
    searchPlaceholder: 'Поиск по функциям и содержимому',
    searchEmpty: 'Начните печатать — или выберите команду',
    searchNoResults: 'Ничего не найдено',
    searchGroupCommands: 'Команды',
    searchGroupScreens: 'Экраны',
    searchGroupAlarms: 'Будильники',
    searchGroupSessions: 'Сессии',
    searchHintOpen: 'Открыть',
    changeAccent: 'Сменить акцент',
    navLists: 'Списки',
    commonAdd: 'Добавить',
    commonLoading: 'Загрузка…',
    titleLists: 'Списки',
    tasksNew: 'Новая задача',
    tasksEmpty: 'Пока пусто. Добавьте задачу — она появится здесь.',
    tasksCompleted: 'Выполненные',
    tasksSubtasks: 'Подзадачи',
    tasksPriority: 'Приоритет',
    priorityNone: 'Обычный',
    priorityLow: 'Низкий',
    priorityMedium: 'Средний',
    priorityHigh: 'Высокий',
    tasksDueDate: 'Срок',
    tasksStartAt: 'Начало',
    tasksPlanned: 'Запланировано',
    tasksMinutesShort: 'мин',
    tasksDelete: 'Удалить',
    tasksSortManual: 'Вручную',
    tasksSortDue: 'По сроку',
    tasksSortPriority: 'По приоритету',
    tasksAddSubtask: 'Добавить подзадачу',
    listsNew: 'Новый список',
    listsEmpty: 'Пустой список',
    listsName: 'Название',
    listsToTask: 'В задачу',
    listsDelete: 'Удалить список',
    navCalendar: 'Календарь',
    calendarMonth: 'Месяц',
    calendarWeek: 'Неделя',
    calendarDay: 'День',
    calendarToday: 'Сегодня',
    calendarNewEvent: 'Новое событие',
    calendarEditEvent: 'Редактировать событие',
    calendarDeleteEvent: 'Удалить событие',
    calendarEventTitle: 'Название события',
    calendarAllDay: 'Весь день',
    calendarStart: 'Начало',
    calendarEnd: 'Конец',
    calendarLocation: 'Место проведения',
    calendarSource: 'Источник',
    calendarSourceLocal: 'Локальный',
    calendarSourceGoogle: 'Google',
    calendarSourceTask: 'Задача',
    calendarFilterAll: 'Все события',
    calendarShowTasks: 'Показывать задачи',
    calendarEmptyMonth: 'В этом месяце нет событий',
    calendarEmptyDay: 'На этот день нет событий',
    calendarSave: 'Сохранить',
    calendarCancel: 'Отмена',
    calendarConfirmDelete: 'Удалить это событие?',
    calendarTimeSlotError: 'Время окончания не может быть раньше времени начала',

    navDay: 'День',
    titleDay: 'Планирование дня',
    dayStepPlan: 'План',
    dayStepExecute: 'День',
    dayStepReview: 'Обзор',
    dayToday: 'Сегодня',
    dayTomorrow: 'Завтра',
    dayYesterday: 'Вчера',
    dayEmpty: 'На этот день ничего не запланировано',
    dayEmptyHint: 'Выберите задачи на сегодня и расставьте их по слотам — или добавьте событие.',
    dayPickMain: 'Выберите главное на сегодня',
    dayUnplanned: 'Без времени',
    dayDone: 'Сделано за день',
    dayUnfinished: 'Незавершённое',
    dayCarryOver: 'Перенести на завтра',
    dayCarriedOver: 'Перенесено на завтра',
    dayAllDay: 'Весь день',
    dayConflict: 'Пересечение',
    dayConflictHint: 'Это время уже занято — выберите другое',
    dayNewEvent: 'Новое событие',
    dayEventTitle: 'Название события',
    dayFromGoogle: 'Из Google',
    rollover: 'Перенос задач',
    rolloverAfter: 'Переносить после',
    rolloverHint: 'Незавершённые задачи прошлых дней переезжают на сегодня, устаревшее время начала очищается.',
    rolloverTimezone: 'Часовой пояс',
    rolloverDisabledHint: 'Выключено: задачи остаются в своих днях.',
    notesNew: 'Новая заметка',
    notesEmpty: 'Пока пусто. Заметка может стоять сама по себе или ссылаться на другие через [[название]].',
    notesBody: 'Текст заметки',
    notesPreview: 'Просмотр',
    notesBacklinks: 'Упоминается в',
    notesNoBacklinks: 'Нигде не упоминается',
    notesCreateTarget: 'Создать заметку',
    notesBrokenLink: 'Ссылка ведёт в никуда',
    notesDelete: 'Удалить заметку',
    notesPin: 'Закрепить',
    notesUnpin: 'Открепить',
    notesLinkHint: '[[ — ссылка на другую заметку',
    navRecordings: 'Записи',
    recTabAudio: 'Звук',
    recTabScreen: 'Экран',
    recMic: 'Микрофон',
    recSystem: 'Системный звук',
    recDevice: 'Устройство',
    recDefaultDevice: 'По умолчанию',
    recSource: 'Источник',
    recMonitors: 'Мониторы',
    recWindows: 'Окна',
    recStart: 'Начать запись',
    recStop: 'Остановить',
    recPause: 'Пауза',
    recResume: 'Продолжить',
    recCancel: 'Отменить',
    recRecording: 'Идёт запись',
    recPaused: 'Пауза',
    recEmpty: 'Пока пусто. Запишите звук или экран — файлы лягут в ту же библиотеку, что и рисунки.',
    recDelete: 'Удалить запись',
    recRename: 'Переименовать',
    recDuration: 'Длительность',
    recSize: 'Размер',
    recNoDevices: 'Устройства записи не найдены.',
    recNoSources: 'Нет доступных мониторов или окон.',
    recPermissionMic: 'Микрофон недоступен',
    recPermissionScreen: 'Захват экрана недоступен',
    recPermissionHint: 'Проверьте, что приложение не выключено в разделе «Конфиденциальность → Микрофон» и что устройство не занято другой программой.',
    recDiscard: 'Отбросить запись',
    recKindAudio: 'Звук',
    recKindScreen: 'Экран',
    recPreviewHint: 'Кадр источника сохранится в медиа и появится в списке.',
    recConfirmScreen: 'Подтверждаю, что записываю этот источник',
    recConfirmNeeded: 'Отметьте подтверждение под списком источников — запись экрана начинается только после него.',
    navDrawings: 'Рисунки',
    drawingsNew: 'Новый рисунок',
    drawingsEmpty: 'Пока пусто. Создайте рисунок — холст бесконечный, рисуйте куда угодно.',
    drawToolPen: 'Перо',
    drawToolMarker: 'Маркер',
    drawToolEraser: 'Ластик',
    drawToolLine: 'Линия',
    drawToolRect: 'Прямоугольник',
    drawToolEllipse: 'Эллипс',
    drawToolText: 'Текст',
    drawColor: 'Цвет',
    drawWidth: 'Толщина',
    drawZoom: 'Масштаб',
    drawReset: 'Сбросить вид',
    drawExportPng: 'Экспорт PNG',
    drawExportSvg: 'Экспорт SVG',
    drawToolbarHint: 'Колесо — зум, средняя кнопка или пробел — панорама',
    drawingsDelete: 'Удалить рисунок',
    storageUsage: 'Занято медиа',
    storageUsageHint: 'Рисунки, записи и превью. Старое удаляется автоматически при превышении потолка.',
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
    minutesShort: 'мин',
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
    settingsAppearance: 'Внешний вид и тема',
    settingsSound: 'Звук',
    settingsVoice: 'Синтез голоса ассистента',
    settingsAI: 'ИИ ассистент',
    settingsShortcuts: 'Горячие клавиши',
    settingsIntegrations: 'Внешние календари и сервисы',
    settingsAbout: 'О Tempo',
    settingsSpeechToText: 'Речь в текст',

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
    settingsAboutHint: 'App details, portable mode status, and connected services',
    settingsAboutTab: 'About & Account',
    settingsAccent: 'Accent Color',
    settingsActive: 'Active',
    settingsApiKey: 'API Key',
    settingsApiKeyAria: 'API Key input',
    settingsAssistant: 'AI Assistant Configuration',
    settingsBaseUrl: 'Base URL',
    settingsBaseUrlAria: 'AI Base URL',
    settingsBlockPreset: 'Block Preset',
    settingsCalendarActive: 'Calendar sync is active.',
    settingsConnected: 'Connected',
    settingsDefaultMode: 'Default Timer Mode',
    settingsDynamicBackground: 'Dynamic Background',
    settingsDynamicBackgroundHint: 'Background follows timer phases and ambient state',
    settingsEndSound: 'End Sound',
    settingsEnvironment: 'Environment Mode',
    settingsEnvironmentHint: 'Portable single-directory vs installed',
    settingsFocusDurationAria: 'Focus duration',
    settingsFocusMinutes: 'Focus (min)',
    settingsGoogleAccount: 'Google Account',
    settingsGoogleAwaiting: 'Awaiting Google Cloud project credentials',
    settingsGoogleBlocked: 'Google OAuth not configured. Blocked on user Cloud project setup (OAuth client ID missing).',
    settingsGoogleCalendar: 'Google Calendar',
    settingsGoogleMissing: 'Google OAuth configuration is missing in the current project.',
    settingsInstallUpdate: 'Install Update',
    settingsInstalled: 'Standard Installation',
    settingsInstalling: 'Installing...',
    settingsIntegrationsHint: 'Direct integrations with external productivity providers',
    settingsIntegrationsTab: 'Integrations',
    settingsKeyHidden: 'API key is stored in your OS keychain and is never displayed.',
    settingsKeyStored: 'Stored in the OS keychain. Never stored in plaintext.',
    settingsLongBreak: 'Long Break (min)',
    settingsLongBreakAria: 'Long break duration',
    settingsLongBreakEvery: 'Long Break Every',
    settingsLongBreakEveryAria: 'Long break interval',
    settingsMedia: 'Media Storage & Cap (R43)',
    settingsMediaHint: 'Stored drawings, recordings, and cached previews',
    settingsModePomodoro: 'Pomodoro',
    settingsModeStopwatch: 'Stopwatch',
    settingsModel: 'Model',
    settingsModelAria: 'AI Model',
    settingsNotConnected: 'Not Connected',
    settingsPortable: 'Portable Mode',
    settingsRemove: 'Remove',
    settingsRollover: 'Day Rollover & Timezone (R40)',
    settingsRolloverHint: 'Calculates local dates and intervals',
    settingsRolloverHour: 'Day Rollover Hour',
    settingsSaveKey: 'Save Key',
    settingsSaved: 'Saved',
    settingsSaving: 'Saving...',
    settingsShortBreak: 'Short Break (min)',
    settingsShortBreakAria: 'Short break duration',
    settingsShortcutsEmpty: 'No shortcuts currently registered.',
    settingsShortcutsHint: 'Loaded dynamically from the internal shortcuts registry',
    settingsShortcutsTab: 'Shortcuts',
    settingsSoundAlarm: 'Alarm',
    settingsSoundBell: 'Bell',
    settingsSoundChime: 'Chime',
    settingsSoundDigital: 'Digital',
    settingsSpeech: 'Speech Recognition (Wave 11)',
    settingsSpeechEnable: 'Enable Speech to Text',
    settingsSpeechEnableHint: 'Allow pressing a global shortcut to record and transcribe audio',
    settingsSpeechHint: 'Local on-device transcription and voice commands',
    settingsSpeechHotkey: 'Dictation Shortcut',
    settingsSpeechHotkeyPlaceholder: 'e.g. CommandOrControl+Shift+Space',
    settingsSpeechCancelHotkey: 'Cancel Shortcut',
    settingsSpeechCancelHotkeyPlaceholder: 'e.g. Escape',
    settingsSpeechActivationMode: 'Activation Mode',
    settingsSpeechActivationHoldOrToggle: 'Hold or Toggle',
    settingsSpeechActivationHoldOrToggleDesc: 'Short tap toggles recording, long press records while held',
    settingsSpeechActivationPushToTalk: 'Push to Talk',
    settingsSpeechActivationPushToTalkDesc: 'Records only while key is pressed down',
    settingsSpeechActivationToggle: 'Toggle',
    settingsSpeechActivationToggleDesc: 'Press once to start recording, press again to stop',
    settingsSpeechHoldThreshold: 'Hold Threshold',
    settingsSpeechHoldThresholdDesc: 'Time in milliseconds to distinguish tap from hold',
    settingsSpeechTabModels: 'Models',
    settingsSpeechTabPtt: 'Activation & Hotkeys',
    settingsSpeechTabAudio: 'Audio & VAD',
    settingsSpeechTabDelivery: 'Text Delivery',
    settingsSpeechTabFeedback: 'Sound & Feedback',
    settingsSpeechTabLanguage: 'Language & Words',
    settingsSpeechTabHistory: 'History',
    settingsSpeechTabPostprocess: 'Post-processing',
    settingsSpeechTabAdvanced: 'Advanced',
    settingsSpeechTabDebug: 'Diagnostics',
    settingsSpeechModelsSearch: 'Search models...',
    settingsSpeechModelsFilterAll: 'All',
    settingsSpeechModelsFilterInstalled: 'Installed',
    settingsSpeechModelsFilterRecommended: 'Recommended',
    settingsSpeechModelsFilterLanguages: 'All languages',
    settingsSpeechModelsRescan: 'Rescan models folder',
    settingsSpeechModelsImport: 'Import .gguf',
    settingsSpeechModelsOpenDir: 'Open models folder',
    settingsSpeechModelsFreeDisk: 'Free disk space',
    settingsSpeechModelActive: 'Active',
    settingsSpeechModelUse: 'Use Model',
    settingsSpeechModelDownload: 'Download',
    settingsSpeechModelDownloading: 'Downloading...',
    settingsSpeechModelVerifying: 'Verifying checksum...',
    settingsSpeechModelDelete: 'Delete',
    settingsSpeechModelDeleteConfirm: 'Are you sure you want to delete this model?',
    settingsSpeechModelCancelDownload: 'Cancel',
    settingsSpeechModelSpeed: 'Speed',
    settingsSpeechModelAccuracy: 'Accuracy',
    settingsSpeechModelParameters: 'Parameters',
    settingsSpeechModelQuant: 'Quantization',
    settingsSpeechModelLanguages: 'Languages',
    settingsSpeechModelCustom: 'Custom Model',
    settingsSpeechInputDevice: 'Microphone',
    settingsSpeechInputDeviceDefault: 'Default Device',
    settingsSpeechInputChannel: 'Audio Channel',
    settingsSpeechInputChannelDefault: 'All / Mono',
    settingsSpeechVadBackend: 'Voice Activity Detection (VAD)',
    settingsSpeechVadEnergy: 'Energy (RMS)',
    settingsSpeechVadEarshot: 'Earshot (Neural)',
    settingsSpeechVadThreshold: 'VAD Sensitivity Threshold',
    settingsSpeechTestMic: 'Test Microphone',
    settingsSpeechTestMicStop: 'Stop Test',
    settingsSpeechMicLevel: 'Input Level',
    settingsSpeechPasteMethod: 'Paste Method',
    settingsSpeechPasteMethodCtrlV: 'Ctrl+V',
    settingsSpeechPasteMethodShiftInsert: 'Shift+Insert',
    settingsSpeechPasteMethodDirect: 'Direct Typing',
    settingsSpeechClipboardBehavior: 'Clipboard Behavior',
    settingsSpeechClipboardRestore: 'Restore previous clipboard',
    settingsSpeechClipboardKeep: 'Keep recognized text in clipboard',
    settingsSpeechPasteDelayBefore: 'Delay before paste (ms)',
    settingsSpeechPasteDelayAfter: 'Delay after paste (ms)',
    settingsSpeechAppendSpace: 'Append trailing space',
    settingsSpeechAutoSubmit: 'Auto-submit (Enter after paste)',
    settingsSpeechFeedbackEnabled: 'Sound Feedback',
    settingsSpeechFeedbackEnabledDesc: 'Play sounds when recording starts and stops',
    settingsSpeechFeedbackVolume: 'Sound Volume',
    settingsSpeechSoundTheme: 'Sound Theme',
    settingsSpeechSoundThemeDefault: 'Default',
    settingsSpeechSoundThemeSoft: 'Soft',
    settingsSpeechSoundThemeMechanical: 'Mechanical',
    settingsSpeechPlayTestStart: 'Test Start Sound',
    settingsSpeechPlayTestStop: 'Test Stop Sound',
    settingsSpeechLanguage: 'Recognition Language',
    settingsSpeechLanguageAuto: 'Auto Detect',
    settingsSpeechTranslateToEnglish: 'Translate to English',
    settingsSpeechTranslateToEnglishDesc: 'Speech in any language will be translated into English',
    settingsSpeechCustomWords: 'Custom Vocabulary',
    settingsSpeechCustomWordsPlaceholder: 'Words or phrases, separated by commas or newlines',
    settingsSpeechCustomWordsDesc: 'Prompt hints for model on rare terms, names, and acronyms',
    settingsSpeechRemoveFillerWords: 'Remove Filler Words',
    settingsSpeechRemoveFillerWordsDesc: 'Automatically filter out hesitation words (um, uh, эээ, ну)',
    settingsSpeechHistoryEnabled: 'Save Dictation History',
    settingsSpeechHistoryLimit: 'History Limit',
    settingsSpeechHistoryRetention: 'Retention Period',
    settingsSpeechHistoryRetentionDays: '{count} days',
    settingsSpeechHistoryRetentionForever: 'Keep forever',
    settingsSpeechHistoryClear: 'Clear History',
    settingsSpeechHistoryClearConfirm: 'Delete all history entries?',
    settingsSpeechHistoryEmpty: 'No dictation history yet',
    settingsSpeechHistorySearch: 'Search history...',
    settingsSpeechHistoryCopy: 'Copy text',
    settingsSpeechHistoryCopied: 'Copied!',
    settingsSpeechHistoryRetry: 'Transcribe again',
    settingsSpeechHistoryDelete: 'Delete entry',
    settingsSpeechHistorySave: 'Save',
    settingsSpeechHistoryUnsave: 'Unsave',
    settingsSpeechHistoryPlay: 'Play audio',
    settingsSpeechHistoryDuration: 'Duration: {duration}',
    settingsSpeechPostprocessEnabled: 'Enable AI Post-processing',
    settingsSpeechPostprocessDesc: 'Automatically polish punctuation, style, and formatting using AI',
    settingsSpeechPostprocessPrompt: 'System Prompt',
    settingsSpeechPostprocessPromptPlaceholder: 'Instructions for AI...',
    settingsSpeechPostprocessTest: 'Test Run',
    settingsSpeechPostprocessTestInput: 'Sample text to test',
    settingsSpeechPostprocessTestRun: 'Process',
    settingsSpeechPostprocessTestResult: 'Result',
    settingsSpeechOnboardingTitle: 'Speech to Text Setup',
    settingsSpeechOnboardingSubtitle: 'Set up local model and dictation shortcut in 4 easy steps',
    settingsSpeechOnboardingStep1: '1. Choose Model',
    settingsSpeechOnboardingStep2: '2. Download',
    settingsSpeechOnboardingStep3: '3. Dictation Shortcut',
    settingsSpeechOnboardingStep4: '4. Test',
    settingsSpeechOnboardingNext: 'Next',
    settingsSpeechOnboardingBack: 'Back',
    settingsSpeechOnboardingFinish: 'Finish Setup',
    settingsSpeechOnboardingSkip: 'Skip',
    settingsSpeechOnboardingStartTest: 'Press and speak to test',
    settingsSpeechDebugTitle: 'Speech Diagnostics',
    settingsSpeechDebugPaths: 'System Paths',
    settingsSpeechDebugModelsDir: 'Models Directory',
    settingsSpeechDebugState: 'Current State',
    settingsSpeechDebugLastErrors: 'Recent Errors',
    settingsSpeechDebugNoErrors: 'No errors recorded',
    settingsSpeechDebugRerunOnboarding: 'Rerun Setup Wizard',
    settingsSpeechAdvancedTitle: 'Advanced Settings',
    settingsSpeechAccelerator: 'Compute Device',
    settingsSpeechAcceleratorDesc: 'Device used for Whisper speech transcription (Auto, GPU, or CPU)',
    settingsSpeechAcceleratorAuto: 'Auto',
    settingsSpeechAcceleratorCpu: 'CPU',
    settingsSpeechAcceleratorNoGpu: 'No compatible GPU detected',
    settingsSpeechAcceleratorMissing: 'Previously selected device is missing, falling back to auto',
    settingsSpeechModelUnload: 'Model Unload Timeout',
    settingsSpeechModelUnloadDesc: 'Automatically free memory after a period of inactivity',
    settingsSpeechModelUnloadNever: 'Never',
    settingsSpeechModelUnload2Min: '2 minutes',
    settingsSpeechModelUnload5Min: '5 minutes',
    settingsSpeechModelUnload10Min: '10 minutes',
    settingsSpeechModelUnload15Min: '15 minutes',
    dictationIndicatorRecording: 'Recording...',
    dictationIndicatorTranscribing: 'Transcribing...',
    dictationIndicatorCancel: 'Cancel',
    dictationIndicatorStop: 'Stop',
    settingsSubtitle: 'Configure Tempo behavior, shortcuts, and integrations',
    settingsTestVoice: 'Test Voice',
    settingsTimeZone: 'Time Zone',
    settingsTimerFocus: 'Timer & Focus',
    syncTitle: 'Device Sync',
    syncDisabled: 'Disabled',
    syncSavePath: 'Save Path',
    syncSharedFolder: 'Shared Folder',
    syncSharedFolderPath: 'Shared Folder Path',
    syncError: 'Sync Error',
    syncMediaFiles: 'Sync Media Files',
    syncMethod: 'Sync Method',
    syncFolderPlaceholder: '/path/to/sync-folder',
    syncCancel: 'Cancel',
    syncConfirmMedia: 'Confirm Media File Sync',
    syncEnableMedia: 'Enable Media Sync',
    syncDeviceIdFull: 'Full device ID: {id}',
    syncLastSync: 'Last sync: {when}',
    syncNeverSynced: 'Never synced',
    syncUnavailable: 'Unavailable',
    syncMediaWarning: 'With this enabled, audio and media files leave this device to the shared folder.',
    syncDriveBlocked: 'Google Drive sync requires your own Google Cloud project and OAuth Client ID. Direct Drive sync is currently not available; use a shared folder synced by Google Drive desktop instead.',
    syncDriveTitle: 'Google Drive',
    settingsTitle: 'Settings',
    settingsUnlinked: 'Unlinked',
    settingsUpdate: 'Software Update',
    settingsUpdateHint: 'Check for available releases',
    settingsVersion: 'Tempo Version',
    settingsVersionHint: 'Application build version',
    settingsVoiceHint: 'Edge TTS cloud voice test',
    settingsWhisperBase: 'Whisper Base (~145 MB)',
    settingsWhisperHint: 'The model downloads automatically on first use.',
    settingsWhisperModel: 'Whisper Model',
    settingsWhisperSmall: 'Whisper Small (~480 MB)',
    settingsWhisperTiny: 'Whisper Tiny (~75 MB)',
    sttErrorNoModel: 'Speech recognition model not downloaded',
    sttErrorNoMic: 'Microphone unavailable',
    sttErrorCloudRefused: 'Cloud speech service refused',
    sttErrorInjectionFailed: 'Could not inject text into active window (copied to clipboard)',
    sttErrorNetwork: 'Network error downloading model or contacting cloud',
    sttErrorDiskSpace: 'Not enough disk space to download model',
    sttErrorModelVerifyFailed: 'Model verification failed (checksum mismatch)',
    sttErrorHotkeyInvalid: 'Invalid keyboard shortcut',
    sttErrorHotkeyTaken: 'Keyboard shortcut is already in use',
    sttErrorNoDevice: 'Audio input device not found',
    sttErrorImportFailed: 'Failed to import .gguf model',
    sttErrorPostprocessFailed: 'AI post-processing failed',
    sttCopiedToClipboard: 'Text copied to clipboard',
    sttInsertedIntoWindow: 'Text inserted into active window',
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
    navDashboard: 'Pomodoro',
    navAlarms: 'Alarms',
    navTasks: 'Tasks',
    navNotes: 'Notes',
    statsEmptyTitle: 'No statistics yet',
    statsEmptyBody: 'Focus hours, a 12-week activity heat map, productive streaks, and peak hours will appear here.',
    recTranscribe: 'Transcribe',
    recTranscribeAll: 'Transcribe all pending',
    recTranscript: 'Transcript',
    recTranscriptPending: 'Pending transcription',
    recTranscriptFailed: 'Transcription failed',
    recTranscriptDone: 'Transcribed',
    sttEngineLocal: 'Local (Whisper)',
    sttEngineCloud: 'Cloud (BYOK)',
    sttDownloadCancel: 'Cancel',
    sttDeleteModel: 'Delete model',
    sttDownloadModel: 'Download model',
    sttSize: 'Size',
    sttQuality: 'Quality (WER)',
    sttModelInstalled: 'Installed',
    statsEmptyHint: 'Complete a timer session to get started',
    statsTitle: 'Statistics',
    statsSubtitle: 'Overview of focus time and completed tasks',
    statsPeriodDay: 'Days',
    statsPeriodWeek: 'Weeks',
    statsFocusDays: 'Focus (14 days)',
    statsFocusWeeks: 'Focus (12 weeks)',
    statsTotalDays: 'Total for 14 days',
    statsTotalWeeks: 'Total for 12 weeks',
    statsPomodoros: 'Pomodoros',
    statsCompletedSessions: 'Completed sessions',
    statsStreak: 'Day streak',
    statsDaysShort: 'd',
    statsTasksCard: 'Tasks',
    statsFocusChart: 'Focus time by day (2 weeks)',
    statsHeatmap: 'Activity heat map (12 weeks)',
    statsHeatLess: 'Less',
    statsHeatMore: 'More',
    statsPeakHours: 'Peak hours (24h)',
    statsCompletedChart: 'Tasks completed in 14 days',
    statsTotalWord: 'total',
    statsBestStreak: 'Record: {n} d',
    statsDoneOfTotal: '{done} of {total} done',
    statsPeakAt: 'Peak: {hour}:00',
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
    searchPlaceholder: 'Search actions and content',
    searchEmpty: 'Start typing — or pick a command',
    searchNoResults: 'Nothing found',
    searchGroupCommands: 'Commands',
    searchGroupScreens: 'Screens',
    searchGroupAlarms: 'Alarms',
    searchGroupSessions: 'Sessions',
    searchHintOpen: 'Open',
    changeAccent: 'Change accent',
    navLists: 'Lists',
    commonAdd: 'Add',
    commonLoading: 'Loading…',
    titleLists: 'Lists',
    tasksNew: 'New task',
    tasksEmpty: 'Nothing yet. Add a task and it shows up here.',
    tasksCompleted: 'Completed',
    tasksSubtasks: 'Subtasks',
    tasksPriority: 'Priority',
    priorityNone: 'Normal',
    priorityLow: 'Low',
    priorityMedium: 'Medium',
    priorityHigh: 'High',
    tasksDueDate: 'Due',
    tasksStartAt: 'Start',
    tasksPlanned: 'Planned',
    tasksMinutesShort: 'min',
    tasksDelete: 'Delete',
    tasksSortManual: 'Manual',
    tasksSortDue: 'By due date',
    tasksSortPriority: 'By priority',
    tasksAddSubtask: 'Add subtask',
    listsNew: 'New list',
    listsEmpty: 'Empty list',
    listsName: 'Name',
    listsToTask: 'To task',
    listsDelete: 'Delete list',
    navCalendar: 'Calendar',
    calendarMonth: 'Month',
    calendarWeek: 'Week',
    calendarDay: 'Day',
    calendarToday: 'Today',
    calendarNewEvent: 'New Event',
    calendarEditEvent: 'Edit Event',
    calendarDeleteEvent: 'Delete Event',
    calendarEventTitle: 'Event Title',
    calendarAllDay: 'All Day',
    calendarStart: 'Start',
    calendarEnd: 'End',
    calendarLocation: 'Location',
    calendarSource: 'Source',
    calendarSourceLocal: 'Local',
    calendarSourceGoogle: 'Google',
    calendarSourceTask: 'Task',
    calendarFilterAll: 'All Events',
    calendarShowTasks: 'Show Tasks',
    calendarEmptyMonth: 'No events in this month',
    calendarEmptyDay: 'No events for this day',
    calendarSave: 'Save',
    calendarCancel: 'Cancel',
    calendarConfirmDelete: 'Delete this event?',
    calendarTimeSlotError: 'End time cannot be earlier than start time',

    navDay: 'Day',
    titleDay: 'Daily planning',
    dayStepPlan: 'Plan',
    dayStepExecute: 'Day',
    dayStepReview: 'Review',
    dayToday: 'Today',
    dayTomorrow: 'Tomorrow',
    dayYesterday: 'Yesterday',
    dayEmpty: 'Nothing planned for this day',
    dayEmptyHint: 'Pick what matters today and place it in slots — or add an event.',
    dayPickMain: 'Pick what matters most today',
    dayUnplanned: 'Without a time',
    dayDone: 'Done today',
    dayUnfinished: 'Unfinished',
    dayCarryOver: 'Move to tomorrow',
    dayCarriedOver: 'Moved to tomorrow',
    dayAllDay: 'All day',
    dayConflict: 'Overlap',
    dayConflictHint: 'That time is taken — pick another',
    dayNewEvent: 'New event',
    dayEventTitle: 'Event title',
    dayFromGoogle: 'From Google',
    rollover: 'Task rollover',
    rolloverAfter: 'Carry over after',
    rolloverHint: 'Unfinished tasks from older days move onto today and their stale start time is cleared.',
    rolloverTimezone: 'Time zone',
    rolloverDisabledHint: 'Off: tasks stay in their own days.',
    notesNew: 'New note',
    notesEmpty: 'Nothing yet. A note can stand alone or link to others with [[title]].',
    notesBody: 'Note body',
    notesPreview: 'Preview',
    notesBacklinks: 'Mentioned in',
    notesNoBacklinks: 'Not mentioned anywhere',
    notesCreateTarget: 'Create note',
    notesBrokenLink: 'This link leads nowhere',
    notesDelete: 'Delete note',
    notesPin: 'Pin',
    notesUnpin: 'Unpin',
    notesLinkHint: '[[ links to another note',
    navRecordings: 'Recordings',
    recTabAudio: 'Audio',
    recTabScreen: 'Screen',
    recMic: 'Microphone',
    recSystem: 'System sound',
    recDevice: 'Device',
    recDefaultDevice: 'Default',
    recSource: 'Source',
    recMonitors: 'Monitors',
    recWindows: 'Windows',
    recStart: 'Start recording',
    recStop: 'Stop',
    recPause: 'Pause',
    recResume: 'Resume',
    recCancel: 'Cancel',
    recRecording: 'Recording',
    recPaused: 'Paused',
    recEmpty: 'Nothing yet. Record audio or the screen — files land in the same library as drawings.',
    recDelete: 'Delete recording',
    recRename: 'Rename',
    recDuration: 'Duration',
    recSize: 'Size',
    recNoDevices: 'No recording devices found.',
    recNoSources: 'No monitors or windows available.',
    recPermissionMic: 'Microphone unavailable',
    recPermissionScreen: 'Screen capture unavailable',
    recPermissionHint: 'Check that the app is not switched off under Privacy → Microphone, and that the device is not held by another program.',
    recDiscard: 'Discard recording',
    recKindAudio: 'Audio',
    recKindScreen: 'Screen',
    recPreviewHint: 'A frame of the source is saved to media and shown in the list.',
    recConfirmScreen: 'I understand which source will be recorded',
    recConfirmNeeded: 'Tick the confirmation under the source list — screen capture starts only after it.',
    navDrawings: 'Drawings',
    drawingsNew: 'New drawing',
    drawingsEmpty: 'Nothing yet. Create a drawing — the canvas is infinite, draw anywhere.',
    drawToolPen: 'Pen',
    drawToolMarker: 'Marker',
    drawToolEraser: 'Eraser',
    drawToolLine: 'Line',
    drawToolRect: 'Rectangle',
    drawToolEllipse: 'Ellipse',
    drawToolText: 'Text',
    drawColor: 'Colour',
    drawWidth: 'Width',
    drawZoom: 'Zoom',
    drawReset: 'Reset view',
    drawExportPng: 'Export PNG',
    drawExportSvg: 'Export SVG',
    drawToolbarHint: 'Wheel zooms, middle button or space pans',
    drawingsDelete: 'Delete drawing',
    storageUsage: 'Media used',
    storageUsageHint: 'Drawings, recordings and previews. The oldest is pruned when the cap is exceeded.',
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
    minutesShort: 'min',
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
    settingsAppearance: 'Appearance & Theme',
    settingsSound: 'Sound',
    settingsVoice: 'Assistant Voice Synthesis',
    settingsAI: 'AI Assistant',
    settingsShortcuts: 'Registered Keyboard Shortcuts',
    settingsIntegrations: 'External Calendars & Services',
    settingsAbout: 'About Tempo',
    settingsSpeechToText: 'Speech to Text',

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
