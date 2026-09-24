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
  // Alarms MVP
  alarmsTitle: string;
  alarmsNew: string;
  alarmsEmpty: string;
  alarmsNext: string;
  alarmsRepeatOnce: string;
  alarmsRepeatDaily: string;
  alarmsRepeatDays: string;
  alarmsRepeatDate: string;
  alarmsRepeatInterval: string;
  alarmsDate: string;
  alarmsTime: string;
  alarmsLabel: string;
  alarmsLabelPlaceholder: string;
  alarmsIntervalEvery: string;
  alarmsIntervalMinutes: string;
  alarmsIntervalHours: string;
  alarmsWindowFrom: string;
  alarmsWindowTo: string;
  alarmsEnabled: string;
  alarmsDisabled: string;
  alarmsDelete: string;
  alarmsSave: string;
  alarmsCancel: string;
  alarmsToday: string;
  alarmsTomorrow: string;
  alarmsNever: string;
  aiAlarmsPreviewTitle: string;
  aiAlarmsConfirm: string;
  aiAlarmsCancel: string;
  aiAlarmsCreated: string;
  aiAlarmsNone: string;
  alarmsNote: string;
  alarmsNotePlaceholder: string;
  alarmsSnooze: string;
  alarmsSound: string;
  alarmsSectionUpcoming: string;
  alarmsSectionAll: string;
  alarmsSkipped: string;
  alarmsNextAt: string;

  // New shell - navigation / sidebar
  navDashboard: string;
  navAlarms: string;
  navTasks: string;
  navNotes: string;
  sidebarAlarms: string;
  sidebarTasks: string;
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
  syncNow: string;
  syncChangesPending: string;
  syncOutcomeSent: string;
  syncOutcomeReceived: string;
  syncOutcomeApplied: string;
  syncOutcomeMediaCopied: string;
  syncOutcomeConflictSingle: string;
  syncOutcomeConflictPlural: string;
  syncConfirmMediaDescription: string;
  syncSelectAiModel: string;
  syncAiModelPlaceholder: string;
  syncApiKeyPlaceholderStored: string;
  syncApiKeyPlaceholderEmpty: string;
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
  settingsPruneMedia: string;
  settingsMediaUsed: string;
  settingsMediaLimit: string;
  settingsCategoriesTracked: string;
  settingsEnabled: string;
  settingsDisabled: string;
  settingsAutostart: string;
  settingsAutostartHint: string;
  settingsRecognitionStatus: string;
  settingsWhisperInstalled: string;
  settingsWhisperNotFound: string;
  settingsWhisperNotFoundHint: string;
  settingsStorageAndSystem: string;
  settingsStorageAndSystemHint: string;
  settingsDirectories: string;
  settingsDirModels: string;
  settingsDirEngine: string;
  settingsDirLogs: string;
  settingsOpenFolder: string;
  settingsPortableDesc: string;
  settingsCheckingUpdates: string;
  settingsLatestVersionInstalled: string;
  settingsCheckUpdateFailed: string;
  settingsCheckUpdateHint: string;
  settingsCheckUpdate: string;
  settingsCheckAgain: string;
  settingsChecking: string;
  settingsUpdatesTitle: string;
  settingsUpdatesSubtitle: string;
  settingsExternalAccountsUnlinked: string;
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
  settingsAiTab: string;
  settingsFetchModels: string;
  settingsFetchingModels: string;
  settingsModelsFetched: string;
  settingsCustomModelHint: string;
  settingsModelsFailed: string;
  settingsAlarmAudio: string;
  settingsAlarmSoundEnabled: string;
  settingsAlarmSoundDisabled: string;
  settingsAlarmVolume: string;
  settingsAlarmSoundProfile: string;
  settingsAlarmCustomFile: string;
  settingsAlarmCustomFileHint: string;
  settingsAlarmChooseFile: string;
  settingsAlarmResetToBuiltin: string;
  settingsAlarmCustomActiveHint: string;
  settingsAlarmPreview: string;
  settingsAlarmPreviewCustom: string;
  settingsAlarmClearCustom: string;
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
  settingsSpeechModelEngine: string;
  settingsSpeechModelExtracting: string;
  settingsSpeechModelArchive: string;
  settingsSpeechModelUnavailable: string;
  settingsSpeechModelEngineUnsupported: string;
  settingsSpeechModelRussianBadge: string;
  settingsSpeechInputDevice: string;
  settingsSpeechInputDeviceDefault: string;
  settingsSpeechInputChannel: string;
  settingsSpeechInputChannelDefault: string;
  settingsSpeechVadBackend: string;
  settingsSpeechVadEnergy: string;
  settingsSpeechVadEarshot: string;
  settingsSpeechVadSilero: string;
  settingsSpeechVadSileroDesc: string;
  settingsSpeechVadSileroReady: string;
  settingsSpeechVadSileroNeedsDownload: string;
  settingsSpeechVadSileroDownloadBtn: string;
  settingsSpeechVadSileroDownloading: string;
  settingsSpeechVadSileroCatalogHint: string;
  settingsSpeechVadFallbackNotice: string;
  settingsSpeechVadThreshold: string;
  settingsSpeechTestMic: string;
  settingsSpeechTestMicStop: string;
  settingsSpeechMicLevel: string;
  settingsSpeechDenoiseTitle: string;
  settingsSpeechDenoiseSubtitle: string;
  settingsSpeechDenoiseRnnoise: string;
  settingsSpeechDenoiseRnnoiseDesc: string;
  settingsSpeechDenoiseHighpass: string;
  settingsSpeechDenoiseHighpassDesc: string;
  settingsSpeechDenoiseHighpassHz: string;
  settingsSpeechDenoiseGate: string;
  settingsSpeechDenoiseGateDesc: string;
  settingsSpeechDenoiseGateDb: string;
  settingsSpeechDenoiseAgc: string;
  settingsSpeechDenoiseAgcDesc: string;
  settingsSpeechDenoiseAgcTargetDb: string;
  settingsSpeechModelsGroupRussian: string;
  settingsSpeechModelsGroupMultilingual: string;
  settingsSpeechModelsGroupEnglishOnly: string;
  settingsSpeechModelsGroupDownloaded: string;
  settingsSpeechModelsGroupAvailable: string;
  settingsSpeechModelsDetectedFrom: string;
  settingsSpeechModelsStreamingBadge: string;
  settingsSpeechModelsNoMatches: string;
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
  navStt: string;
  navSettings: string;
  navDailyPlanning: string;
  toggleSidebar: string;
  sttScreenTitle: string;
  sttScreenSubtitle: string;
  sttTabModels: string;
  sttTabKeys: string;
  sttTabAnimation: string;
  sttTabSound: string;
  sttTabText: string;
  sttTabHistory: string;
  sttTabAdvanced: string;
  sttAnimationTitle: string;
  sttAnimationWave: string;
  sttAnimationWaveDesc: string;
  sttAnimationWaveBars: string;
  sttAnimationWaveBarsDesc: string;
  sttAnimationOverlay: string;
  sttAnimationOverlayDesc: string;
  settingsSpeechMovedTitle: string;
  settingsSpeechMovedHint: string;
  settingsSpeechMovedAction: string;
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
  vaultTitle: string;
  vaultFolder: string;
  vaultChangeFolder: string;
  vaultOpenFolder: string;
  vaultRefresh: string;
  vaultToday: string;
  vaultNewNote: string;
  vaultNewFolder: string;
  vaultRename: string;
  vaultDelete: string;
  vaultConfirmDelete: string;
  vaultExternalChanged: string;
  vaultReload: string;
  vaultKeepMine: string;
  vaultEmptyTree: string;
  vaultMigrationDone: string;
  notesUnsaved: string;
  editorPlaceholder: string;
  notesFilesHint: string;

  navRecordings: string;
  recLibrary: string;
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
  recChannels: string;
  recChannelsMono: string;
  recChannelsStereo: string;
  playerPlay: string;
  playerPause: string;
  playerSeek: string;
  playerVolume: string;
  playerMute: string;
  playerUnmute: string;
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
  chatYesterday: string;
  chatNew: string;
  chatClear: string;
  chatClearTitle: string;
  chatModel: string;
  chatCustomModel: string;
  chatRecentSessions: string;
  chatUntitled: string;

  // Window controls & sidebar (interfaces.md §2)
  titleBarMinimize: string;
  titleBarMaximize: string;
  titleBarCloseToTray: string;
  titleBarPin: string;
  titleBarUnpin: string;
  titleBarCompact: string;
  sidebarCollapse: string;
  sidebarExit: string;

  // Update (interfaces.md §2)
  updateIdle: string;
  updateChecking: string;
  updateUpToDate: string;
  updateAvailable: string;
  updateDownloading: string;
  updateReady: string;
  updateFailed: string;

  // Chat and alarms (interfaces.md §2)
  chatNeedKey: string;
  chatNewChat: string;
  alarmsQuickIn30: string;
  alarmsQuickTomorrow8: string;
  alarmsQuickDaily730: string;

  // Swept component keys
  chatInputPlaceholder: string;
  chatCompiling: string;
  chatSend: string;
  chatOnline: string;
  chatOffline: string;

  // Stats (StatsView.tsx)
  statsLoading: string;
  statsFocusActivity: string;
  statsCurrentStreak: string;
  statsLongest: string;
  statsDays: string;
  statsFocusedTime: string;
  statsLast14Days: string;
  statsLast12Weeks: string;

  // Speech (src/components/speech/)
  speechOverlayIndicator: string;
  speechOverlayIndicatorHint: string;
  speechRerunSetupHint: string;
  speechRerunSetup: string;
  speechClearLog: string;
  speechClearAllWords: string;
  speechClear: string;
  speechAdd: string;
  speechModelRussian: string;
  speechModelMultilingual: string;
  speechModelEnglishOnly: string;
  speechSaved: string;
  speechReady: string;
  speechStopTestRecording: string;
  speechClearShortcut: string;
  speechOnboardingSelectModel: string;

  // Bottom player (WinterBottomPlayer.tsx)
  playerToggleMenu: string;
  playerPhaseSelector: string;
  playerTimerPresets: string;
  playerStartTimer: string;
  playerPauseTimer: string;
  playerResetTimer: string;
  playerSkipPhase: string;
  playerFocusAudio: string;
  playerFocusAudioActive: string;

  // Views & tools (Day, Calendar, Lists, Tasks, Notes, Recordings, Overlay, Timer, Palette)
  dayPreviousDay: string;
  dayNextDay: string;
  dayMarkTaskDone: string;
  dayMarkAsActive: string;
  dayMarkAsCompleted: string;
  dayToggleTask: string;
  calendarPrevious: string;
  calendarNext: string;
  calendarAddEvent: string;
  listsRenameList: string;
  listsRenameItem: string;
  tasksMinutesPlaceholder: string;
  notesTaskCompleted: string;
  notesTaskIncomplete: string;
  recordingsPreviewAlt: string;
  overlayClose: string;
  timerPomodoroMode: string;
  timerStopwatchMode: string;
  paletteDialogLabel: string;
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
    // Alarms MVP
    alarmsTitle: 'Будильники',
    alarmsNew: 'Новый будильник',
    alarmsEmpty: 'Нет будильников',
    alarmsNext: 'Следующий',
    alarmsRepeatOnce: 'Один раз',
    alarmsRepeatDaily: 'Каждый день',
    alarmsRepeatDays: 'По дням',
    alarmsRepeatDate: 'На дату',
    alarmsRepeatInterval: 'Интервал',
    alarmsDate: 'Дата',
    alarmsTime: 'Время',
    alarmsLabel: 'Название',
    alarmsLabelPlaceholder: 'Например: Тренировка',
    alarmsIntervalEvery: 'Каждые',
    alarmsIntervalMinutes: 'мин',
    alarmsIntervalHours: 'ч',
    alarmsWindowFrom: 'С',
    alarmsWindowTo: 'До',
    alarmsEnabled: 'Включен',
    alarmsDisabled: 'Выключен',
    alarmsDelete: 'Удалить',
    alarmsSave: 'Сохранить',
    alarmsCancel: 'Отмена',
    alarmsToday: 'Сегодня',
    alarmsTomorrow: 'Завтра',
    alarmsNever: 'Никогда',
    aiAlarmsPreviewTitle: 'Предпросмотр будильников',
    aiAlarmsConfirm: 'Создать',
    aiAlarmsCancel: 'Отмена',
    aiAlarmsCreated: 'Будильники созданы',
    aiAlarmsNone: 'Будильников не найдено',
    alarmsNote: 'Заметка',
    alarmsNotePlaceholder: 'Что нужно сделать при срабатывании',
    alarmsSnooze: 'Отложить',
    alarmsSound: 'Звук',
    alarmsSectionUpcoming: 'Ближайшие',
    alarmsSectionAll: 'Все будильники',
    alarmsSkipped: 'Пропущен',
    alarmsNextAt: 'Сработает в',

    // New shell - navigation / sidebar
    navDashboard: 'Помодоро',
    navAlarms: 'Будильники',
    navTasks: 'Задачи',
    navNotes: 'Заметки',
    sidebarAlarms: 'Будильники',
    sidebarTasks: 'Задачи',
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
    syncNow: 'Синхронизировать сейчас',
    syncChangesPending: 'Ожидает изменений: {count}',
    syncOutcomeSent: 'Отправлено: {count}',
    syncOutcomeReceived: 'Получено: {count}',
    syncOutcomeApplied: 'Применено: {count}',
    syncOutcomeMediaCopied: 'Медиа скопировано: {count}',
    syncOutcomeConflictSingle: '1 изменение разрешено в пользу более поздней правки',
    syncOutcomeConflictPlural: '{count} изменений разрешено в пользу более поздней правки',
    syncConfirmMediaDescription: 'Включение синхронизации медиа копирует аудиозаписи и прикреплённые медиафайлы в общую папку для доступа с других устройств. Файлы покинут это устройство.',
    syncSelectAiModel: 'Выберите модель ИИ',
    syncAiModelPlaceholder: 'например, gpt-4o, claude-3-5-sonnet...',
    syncApiKeyPlaceholderStored: '•••••••••••••••• (Сохранён безопасно)',
    syncApiKeyPlaceholderEmpty: 'Введите ключ API...',
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
    settingsRollover: 'Начало дня',
    settingsRolloverHour: 'Час начала дня',
    settingsRolloverHint: 'Определяет местные даты и интервалы',
    settingsTimeZone: 'Часовой пояс',
    settingsMedia: 'Медиа хранилище',
    settingsMediaHint: 'Рисунки, записи и превью в кэше',
    settingsAssistant: 'Ассистент',
    settingsPruneMedia: 'Очистить медиа',
    settingsMediaUsed: 'Занято медиа: {used}',
    settingsMediaLimit: 'Лимит: {limit}',
    settingsCategoriesTracked: 'Категорий отслеживается: {count}',
    settingsRemove: 'Убрать',
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
    settingsAiTab: 'ИИ',
    settingsFetchModels: 'Загрузить список моделей',
    settingsEnabled: 'Включено',
    settingsDisabled: 'Выключено',
    settingsAutostart: 'Запускать свёрнутым в трей',
    settingsAutostartHint: 'Окно не появляется при старте — приложение ждёт в трее.',
    settingsRecognitionStatus: 'Состояние распознавания',
    settingsWhisperInstalled: 'Модель Whisper установлена: {model} ({size} MB)',
    settingsWhisperNotFound: 'Модель распознавания не найдена. Откройте «Настройки → Speech to Text» и скачайте подходящую.',
    settingsWhisperNotFoundHint: 'Моделей пока нет — скачайте на странице «Speech to Text».',
    settingsStorageAndSystem: 'Хранилище и система',
    settingsStorageAndSystemHint: 'Расположение моделей, кэша и режим работы приложения',
    settingsDirectories: 'Каталоги',
    settingsDirModels: 'Модели',
    settingsDirEngine: 'Движок',
    settingsDirLogs: 'Логи',
    settingsOpenFolder: 'Открыть папку',
    settingsPortableDesc: 'Все файлы хранятся в одной папке рядом с приложением. Можно распаковать на флешку и переносить вместе с моделями.',
    settingsCheckingUpdates: 'Проверка наличия обновлений...',
    settingsLatestVersionInstalled: 'У вас установлена последняя версия ({version})',
    settingsCheckUpdateFailed: 'Не удалось проверить обновления',
    settingsCheckUpdateHint: 'Нажмите кнопку для проверки новых релизов',
    settingsCheckAgain: 'Проверить снова',
    settingsCheckUpdate: 'Проверить обновления',
    settingsChecking: 'Проверка...',
    settingsUpdatesTitle: 'Обновления',
    settingsUpdatesSubtitle: 'Проверка наличия новых версий приложения Tempo',
    settingsExternalAccountsUnlinked: 'Внешние облачные аккаунты не привязаны. Ожидается OAuth в Wave 8.',
    settingsFetchingModels: 'Загрузка моделей…',
    settingsModelsFetched: 'Модели загружены',
    settingsCustomModelHint: 'Или введите название модели вручную',
    settingsModelsFailed: 'Не удалось получить список моделей',
    settingsAlarmAudio: 'Звук будильника',
    settingsAlarmSoundEnabled: 'Включён',
    settingsAlarmSoundDisabled: 'Выключен',
    settingsAlarmVolume: 'Громкость будильника',
    settingsAlarmSoundProfile: 'Встроенные звуки',
    settingsAlarmCustomFile: 'Свой звук',
    settingsAlarmCustomFileHint: 'Поддерживаются аудиофайлы (MP3, WAV, FLAC и др.)',
    settingsAlarmChooseFile: 'Выбрать файл…',
    settingsAlarmResetToBuiltin: 'Вернуть встроенный',
    settingsAlarmCustomActiveHint: 'Используется свой аудиофайл',
    settingsAlarmPreview: 'Прослушать',
    settingsAlarmPreviewCustom: 'Прослушать свой звук',
    settingsAlarmClearCustom: 'Очистить свой звук',
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
    settingsSpeechActivationHoldOrToggle: 'Удержание или переключение',
    settingsSpeechActivationHoldOrToggleDesc: 'Короткое нажатие фиксирует запись, долгое — работает пока держите',
    settingsSpeechActivationPushToTalk: 'Рация (PTT)',
    settingsSpeechActivationPushToTalkDesc: 'Запись идёт только пока клавиша зажата',
    settingsSpeechActivationToggle: 'Переключение',
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
    settingsSpeechModelEngine: 'Движок',
    settingsSpeechModelExtracting: 'Распаковка архива...',
    settingsSpeechModelArchive: 'Архив',
    settingsSpeechModelUnavailable: 'Недоступно',
    settingsSpeechModelEngineUnsupported: 'Движок не поддерживается в этой системе',
    settingsSpeechModelRussianBadge: 'Русский',
    settingsSpeechInputDevice: 'Микрофон',
    settingsSpeechInputDeviceDefault: 'По умолчанию',
    settingsSpeechInputChannel: 'Канал аудио',
    settingsSpeechInputChannelDefault: 'Все / Моно',
    settingsSpeechVadBackend: 'Детектор активности (VAD)',
    settingsSpeechVadEnergy: 'По энергии (RMS)',
    settingsSpeechVadEarshot: 'Earshot (Нейросеть)',
    settingsSpeechVadSilero: 'Silero (Нейросеть)',
    settingsSpeechVadSileroDesc: 'Нейросетевой детектор находит речь при низком отношении сигнал/шум, где пороги по энергии бессильны.',
    settingsSpeechVadSileroReady: 'Модель Silero VAD установлена и готова к работе.',
    settingsSpeechVadSileroNeedsDownload: 'Требуется загрузка модели Silero VAD (каталог: silero-vad, ~1.8 МБ).',
    settingsSpeechVadSileroDownloadBtn: 'Скачать silero-vad',
    settingsSpeechVadSileroDownloading: 'Загрузка silero-vad...',
    settingsSpeechVadSileroCatalogHint: 'Модель доступна в каталоге под именем «silero-vad».',
    settingsSpeechVadFallbackNotice: 'Внимание: используется резервный детектор по энергии. Причина:',
    settingsSpeechVadThreshold: 'Порог чувствительности VAD',
    settingsSpeechTestMic: 'Проверить микрофон',
    settingsSpeechTestMicStop: 'Остановить проверку',
    settingsSpeechMicLevel: 'Уровень входного сигнала',
    settingsSpeechDenoiseTitle: 'Шумоподавление и фильтры',
    settingsSpeechDenoiseSubtitle: 'Обработка микрофона перед распознаванием речи',
    settingsSpeechDenoiseRnnoise: 'Нейросетевой шумодав (RNNoise)',
    settingsSpeechDenoiseRnnoiseDesc: 'Устраняет фоновый шум и гул окружения с помощью рекуррентной нейросети.',
    settingsSpeechDenoiseHighpass: 'Фильтр высоких частот (High-pass)',
    settingsSpeechDenoiseHighpassDesc: 'Срезает низкочастотный гул стола, микрофонные задувания и вибрации.',
    settingsSpeechDenoiseHighpassHz: 'Частота среза',
    settingsSpeechDenoiseGate: 'Шумовой гейт (Noise gate)',
    settingsSpeechDenoiseGateDesc: 'Глушит фоновый шум и дыхание в паузах между словами.',
    settingsSpeechDenoiseGateDb: 'Порог срабатывания гейта',
    settingsSpeechDenoiseAgc: 'Нормализация громкости (AGC)',
    settingsSpeechDenoiseAgcDesc: 'Выравнивает уровень громкости между тихими и громкими фразами.',
    settingsSpeechDenoiseAgcTargetDb: 'Целевой уровень громкости',
    settingsSpeechModelsGroupRussian: 'Русские модели (GigaAM)',
    settingsSpeechModelsGroupMultilingual: 'Многоязычные модели',
    settingsSpeechModelsGroupEnglishOnly: 'Только английский',
    settingsSpeechModelsGroupDownloaded: 'Загруженные',
    settingsSpeechModelsGroupAvailable: 'Доступные для скачивания',
    settingsSpeechModelsDetectedFrom: 'Обнаружена: {origin}',
    settingsSpeechModelsStreamingBadge: 'Streaming',
    settingsSpeechModelsNoMatches: 'Нет моделей, соответствующих поиску или фильтрам.',
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
    navStt: 'STT',
    navSettings: 'Настройки',
    navDailyPlanning: 'План на день',
    toggleSidebar: 'Свернуть/развернуть боковую панель',
    sttScreenTitle: 'Распознавание речи (STT)',
    sttScreenSubtitle: 'Настройки моделей, клавиш, индикации и звука',
    sttTabModels: 'Модели',
    sttTabKeys: 'Клавиши',
    sttTabAnimation: 'Анимация',
    sttTabSound: 'Звук',
    sttTabText: 'Текст',
    sttTabHistory: 'История',
    sttTabAdvanced: 'Расширенные',
    sttAnimationTitle: 'Внешний вид индикатора',
    sttAnimationWave: 'Волна вместо полоски',
    sttAnimationWaveDesc: 'Отображает живую ленту волн Handy с подсветкой при диктовке',
    sttAnimationWaveBars: 'Количество столбиков волны',
    sttAnimationWaveBarsDesc: 'Ширина и детализация ленты волны (от 12 до 48)',
    sttAnimationOverlay: 'Отображать плавающий индикатор',
    sttAnimationOverlayDesc: 'Показывать индикатор диктовки поверх всех окон',
    settingsSpeechMovedTitle: 'Настройки речи перенесены в раздел STT',
    settingsSpeechMovedHint: 'Управление моделями, горячими клавишами, волной и звуком теперь находится в отдельной вкладке бокового меню',
    settingsSpeechMovedAction: 'Перейти в раздел STT',
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
    vaultTitle: 'Хранилище',
    vaultFolder: 'Папка',
    vaultChangeFolder: 'Сменить папку',
    vaultOpenFolder: 'Открыть в проводнике',
    vaultRefresh: 'Обновить',
    vaultToday: 'Сегодня',
    vaultNewNote: 'Новая заметка',
    vaultNewFolder: 'Новая папка',
    vaultRename: 'Переименовать',
    vaultDelete: 'Удалить',
    vaultConfirmDelete: 'Удалить {name}?',
    vaultExternalChanged: 'Файл был изменён снаружи',
    vaultReload: 'Перезагрузить с диска',
    vaultKeepMine: 'Оставить мою версию',
    vaultEmptyTree: 'В хранилище пока нет файлов',
    vaultMigrationDone: 'Заметки экспортированы в файлы',
    notesUnsaved: 'Есть несохранённые изменения',
    editorPlaceholder: 'Начните писать или введите [[ для ссылки...',
    notesFilesHint: 'Заметки хранятся как .md файлы',
    navRecordings: 'Записи',
    recLibrary: 'Библиотека записей',
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
    recChannels: 'Каналы',
    recChannelsMono: 'Моно',
    recChannelsStereo: 'Стерео',
    playerPlay: 'Воспроизвести',
    playerPause: 'Пауза',
    playerSeek: 'Перемотка',
    playerVolume: 'Громкость',
    playerMute: 'Выключить звук',
    playerUnmute: 'Включить звук',
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
    chatYesterday: 'вчера',
    chatNew: 'Новый чат',
    chatClear: 'Очистить',
    chatClearTitle: 'Очистить текущий чат',
    chatModel: 'Модель',
    chatCustomModel: 'Своя модель...',
    chatRecentSessions: 'Недавние чаты',
    chatUntitled: 'Новый чат',

    // Window controls & sidebar (interfaces.md §2)
    titleBarMinimize: 'Свернуть',
    titleBarMaximize: 'Развернуть на весь экран',
    titleBarCloseToTray: 'Скрыть в трей (фоновая работа)',
    titleBarPin: 'Закрепить поверх всех окон',
    titleBarUnpin: 'Открепить',
    titleBarCompact: 'Свернуть в мини-виджет',
    sidebarCollapse: 'Свернуть меню',
    sidebarExit: 'Выход из Tempo',

    // Update (interfaces.md §2)
    updateIdle: 'Проверить обновления',
    updateChecking: 'Проверяем…',
    updateUpToDate: 'Версия актуальна',
    updateAvailable: 'Обновить до {version}',
    updateDownloading: 'Скачивание {percent}%',
    updateReady: 'Перезапустить',
    updateFailed: 'Не удалось обновить',

    // Chat and alarms (interfaces.md §2)
    chatNeedKey: 'Добавьте ключ в Настройки → ИИ',
    chatNewChat: 'Новый чат',
    alarmsQuickIn30: 'Через 30 минут',
    alarmsQuickTomorrow8: 'Завтра в 8:00',
    alarmsQuickDaily730: 'Каждый день в 7:30',

    // Swept component keys
    chatInputPlaceholder: 'Создать задачу, список, заметку, расписание…',
    chatCompiling: 'Анализирую и применяю…',
    chatSend: 'Отправить сообщение',
    chatOnline: 'Онлайн ИИ',
    chatOffline: 'Офлайн режим',

    // Stats (StatsView.tsx)
    statsLoading: 'Загружаем статистику…',
    statsFocusActivity: 'Активность фокуса',
    statsCurrentStreak: 'Текущая серия',
    statsLongest: 'Рекорд: {n}',
    statsDays: 'дней',
    statsFocusedTime: 'Время в фокусе',
    statsLast14Days: 'ПОСЛЕДНИЕ 14 ДНЕЙ',
    statsLast12Weeks: 'ПОСЛЕДНИЕ 12 НЕДЕЛЬ',

    // Speech (src/components/speech/)
    speechOverlayIndicator: 'Показывать индикатор записи',
    speechOverlayIndicatorHint: 'Уровень, режим и таймер во время диктовки (оверлей и пилюля)',
    speechRerunSetupHint: 'Сбросить состояние знакомства и запустить начальный мастер из 4 шагов',
    speechRerunSetup: 'Пройти мастер заново',
    speechClearLog: 'Очистить журнал',
    speechClearAllWords: 'Удалить все слова',
    speechClear: 'Очистить',
    speechAdd: 'Добавить',
    speechModelRussian: 'Русский (GigaAM)',
    speechModelMultilingual: 'Многоязычные (99+)',
    speechModelEnglishOnly: 'Только английский',
    speechSaved: 'Сохранённые',
    speechReady: 'Готово',
    speechStopTestRecording: 'Остановить пробную запись',
    speechClearShortcut: 'Сбросить сочетание',
    speechOnboardingSelectModel: 'Выберите локальную модель распознавания. Рекомендованные модели — разумный баланс скорости и точности.',

    // Bottom player (WinterBottomPlayer.tsx)
    playerToggleMenu: 'Меню навигации',
    playerPhaseSelector: 'Выбор фазы',
    playerTimerPresets: 'Наборы времени',
    playerStartTimer: 'Запустить таймер',
    playerPauseTimer: 'Пауза',
    playerResetTimer: 'Сбросить таймер',
    playerSkipPhase: 'Пропустить фазу',
    playerFocusAudio: 'Звук фокуса',
    playerFocusAudioActive: 'Звук фокуса включён',

    // Views & tools (Day, Calendar, Lists, Tasks, Notes, Recordings, Overlay, Timer, Palette)
    dayPreviousDay: 'Предыдущий день',
    dayNextDay: 'Следующий день',
    dayMarkTaskDone: 'Отметить задачу выполненной',
    dayMarkAsActive: 'Вернуть в работу',
    dayMarkAsCompleted: 'Отметить выполненной',
    dayToggleTask: 'Переключить задачу',
    calendarPrevious: 'Предыдущий месяц',
    calendarNext: 'Следующий месяц',
    calendarAddEvent: 'Добавить событие',
    listsRenameList: 'Переименовать список',
    listsRenameItem: 'Переименовать пункт',
    tasksMinutesPlaceholder: 'мин',
    notesTaskCompleted: 'Задача выполнена',
    notesTaskIncomplete: 'Задача не выполнена',
    recordingsPreviewAlt: 'Превью записи экрана',
    overlayClose: 'Закрыть оверлей',
    timerPomodoroMode: 'Режим «Помодоро»',
    timerStopwatchMode: 'Режим секундомера',
    paletteDialogLabel: 'Командная палитра',
  },

  en: {
    settingsAboutHint: 'App details, portable mode status, and connected services',
    settingsAboutTab: 'About & Account',
    settingsAccent: 'Accent Color',
    settingsActive: 'Active',
    settingsApiKey: 'API Key',
    settingsApiKeyAria: 'API Key input',
    settingsAssistant: 'Assistant',
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
    settingsMedia: 'Media storage',
    settingsMediaHint: 'Stored drawings, recordings, and cached previews',
    settingsModePomodoro: 'Pomodoro',
    settingsPruneMedia: 'Prune Media',
    settingsMediaUsed: 'Media Used: {used}',
    settingsMediaLimit: 'Limit: {limit}',
    settingsCategoriesTracked: '{count} categories tracked',
    settingsModeStopwatch: 'Stopwatch',
    settingsModel: 'Model',
    settingsModelAria: 'AI Model',
    settingsNotConnected: 'Not Connected',
    settingsPortable: 'Portable Mode',
    settingsRemove: 'Remove',
    settingsRollover: 'Day rollover',
    settingsRolloverHint: 'Calculates local dates and intervals',
    settingsRolloverHour: 'Day rollover hour',
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
    settingsAiTab: 'AI',
    settingsFetchModels: 'Fetch models',
    settingsFetchingModels: 'Fetching models...',
    settingsModelsFetched: 'Models fetched',
    settingsCustomModelHint: 'Or enter model name manually',
    settingsModelsFailed: 'Failed to fetch model list',
    settingsAlarmAudio: 'Alarm sound',
    settingsAlarmSoundEnabled: 'Enabled',
    settingsAlarmSoundDisabled: 'Disabled',
    settingsAlarmVolume: 'Alarm volume',
    settingsAlarmSoundProfile: 'Built-in sounds',
    settingsAlarmCustomFile: 'Use my own file',
    settingsAlarmCustomFileHint: 'Supports audio files (MP3, WAV, FLAC, etc.)',
    settingsAlarmChooseFile: 'Choose file...',
    settingsAlarmResetToBuiltin: 'Reset to built-in',
    settingsAlarmCustomActiveHint: 'Custom audio file is active',
    settingsAlarmPreview: 'Preview',
    settingsAlarmPreviewCustom: 'Preview custom sound',
    settingsAlarmClearCustom: 'Clear custom sound',
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
    settingsSpeechModelEngine: 'Engine',
    settingsSpeechModelExtracting: 'Extracting archive...',
    settingsSpeechModelArchive: 'Archive',
    settingsSpeechModelUnavailable: 'Unavailable',
    settingsSpeechModelEngineUnsupported: 'Engine is not supported on this system',
    settingsSpeechModelRussianBadge: 'Russian',
    settingsSpeechInputDevice: 'Microphone',
    settingsSpeechInputDeviceDefault: 'Default Device',
    settingsSpeechInputChannel: 'Audio Channel',
    settingsSpeechInputChannelDefault: 'All / Mono',
    settingsSpeechVadBackend: 'Voice Activity Detection (VAD)',
    settingsSpeechVadEnergy: 'Energy (RMS)',
    settingsSpeechVadEarshot: 'Earshot (Neural)',
    settingsSpeechVadSilero: 'Silero (Neural)',
    settingsSpeechVadSileroDesc: 'Neural detector finds speech at a low signal-to-noise ratio where energy thresholds give up.',
    settingsSpeechVadSileroReady: 'Silero VAD model is installed and ready.',
    settingsSpeechVadSileroNeedsDownload: 'Silero VAD model needs downloading (catalog: silero-vad, ~1.8 MB).',
    settingsSpeechVadSileroDownloadBtn: 'Download silero-vad',
    settingsSpeechVadSileroDownloading: 'Downloading silero-vad...',
    settingsSpeechVadSileroCatalogHint: 'The model is available in the catalog under "silero-vad".',
    settingsSpeechVadFallbackNotice: 'Notice: falling back to energy detector. Reason:',
    settingsSpeechVadThreshold: 'VAD Sensitivity Threshold',
    settingsSpeechTestMic: 'Test Microphone',
    settingsSpeechTestMicStop: 'Stop Test',
    settingsSpeechMicLevel: 'Input Level',
    settingsSpeechDenoiseTitle: 'Noise Suppression & Filters',
    settingsSpeechDenoiseSubtitle: 'Microphone audio processing before speech recognition',
    settingsSpeechDenoiseRnnoise: 'Neural noise suppression (RNNoise)',
    settingsSpeechDenoiseRnnoiseDesc: 'Eliminates background noise and ambient hum using a recurrent neural network.',
    settingsSpeechDenoiseHighpass: 'High-pass filter',
    settingsSpeechDenoiseHighpassDesc: 'Cuts low-frequency desk rumble, wind noise, and mic thumps.',
    settingsSpeechDenoiseHighpassHz: 'Cutoff frequency',
    settingsSpeechDenoiseGate: 'Noise gate',
    settingsSpeechDenoiseGateDesc: 'Silences background noise and breathing during pauses in speech.',
    settingsSpeechDenoiseGateDb: 'Gate threshold',
    settingsSpeechDenoiseAgc: 'Level normalisation (AGC)',
    settingsSpeechDenoiseAgcDesc: 'Automatically evens out volume between quiet and loud phrases.',
    settingsSpeechDenoiseAgcTargetDb: 'Target volume level',
    settingsSpeechModelsGroupRussian: 'Russian models (GigaAM)',
    settingsSpeechModelsGroupMultilingual: 'Multilingual models',
    settingsSpeechModelsGroupEnglishOnly: 'English only models',
    settingsSpeechModelsGroupDownloaded: 'Downloaded models',
    settingsSpeechModelsGroupAvailable: 'Available to download',
    settingsSpeechModelsDetectedFrom: 'Detected: {origin}',
    settingsSpeechModelsStreamingBadge: 'Streaming',
    settingsSpeechModelsNoMatches: 'No models match current search or filters.',
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
    syncNow: 'Sync Now',
    syncChangesPending: '{count} {pendingText}',
    syncOutcomeSent: 'Sent: {count}',
    syncOutcomeReceived: 'Received: {count}',
    syncOutcomeApplied: 'Applied: {count}',
    syncOutcomeMediaCopied: 'Media copied: {count}',
    syncOutcomeConflictSingle: '1 change was resolved in favour of the later edit',
    syncOutcomeConflictPlural: '{count} changes were resolved in favour of the later edit',
    syncConfirmMediaDescription: 'Enabling media sync copies audio recordings and attached media files to the sync folder so other devices can access them. Files leave this device.',
    syncSelectAiModel: 'Select AI Model',
    syncAiModelPlaceholder: 'e.g. gpt-4o, claude-3-5-sonnet...',
    syncApiKeyPlaceholderStored: '•••••••••••••••• (Stored securely)',
    syncApiKeyPlaceholderEmpty: 'Enter API Key...',
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
    // Alarms MVP
    alarmsTitle: 'Alarms',
    alarmsNew: 'New Alarm',
    alarmsEmpty: 'No alarms',
    alarmsNext: 'Next',
    alarmsRepeatOnce: 'Once',
    alarmsRepeatDaily: 'Daily',
    alarmsRepeatDays: 'Days of week',
    alarmsRepeatDate: 'Specific date',
    alarmsRepeatInterval: 'Interval',
    alarmsDate: 'Date',
    alarmsTime: 'Time',
    settingsEnabled: 'Enabled',
    settingsDisabled: 'Disabled',
    settingsAutostart: 'Start minimized to tray',
    settingsAutostartHint: 'Window does not appear on start — app stays in tray.',
    settingsRecognitionStatus: 'Recognition Status',
    settingsWhisperInstalled: 'Whisper model installed: {model} ({size} MB)',
    settingsWhisperNotFound: 'Recognition model not found. Open "Settings → Speech to Text" and download one.',
    settingsWhisperNotFoundHint: 'No models yet — download one on the "Speech to Text" page.',
    settingsStorageAndSystem: 'Storage & System',
    settingsStorageAndSystemHint: 'Model locations, cache, and application operating mode',
    settingsDirectories: 'Directories',
    settingsDirModels: 'Models',
    settingsDirEngine: 'Engine',
    settingsDirLogs: 'Logs',
    settingsOpenFolder: 'Open folder',
    settingsPortableDesc: 'All files are stored in a single folder next to the app. Can be unpacked onto a USB drive and transferred with models.',
    settingsCheckingUpdates: 'Checking for updates...',
    settingsLatestVersionInstalled: 'You have the latest version installed ({version})',
    settingsCheckUpdateFailed: 'Failed to check for updates',
    settingsCheckUpdateHint: 'Click the button to check for new releases',
    settingsCheckAgain: 'Check again',
    settingsChecking: 'Checking...',
    settingsCheckUpdate: 'Check for updates',
    settingsUpdatesTitle: 'Updates',
    settingsUpdatesSubtitle: 'Check for new versions of Tempo app',
    settingsExternalAccountsUnlinked: 'External cloud accounts are unlinked. Wave 8 OAuth pending.',
    alarmsLabel: 'Label',
    alarmsLabelPlaceholder: 'e.g. Workout',
    alarmsIntervalEvery: 'Every',
    alarmsIntervalMinutes: 'min',
    alarmsIntervalHours: 'h',
    alarmsWindowFrom: 'From',
    alarmsWindowTo: 'To',
    alarmsEnabled: 'Enabled',
    alarmsDisabled: 'Disabled',
    alarmsDelete: 'Delete',
    alarmsSave: 'Save',
    alarmsCancel: 'Cancel',
    alarmsToday: 'Today',
    alarmsTomorrow: 'Tomorrow',
    alarmsNever: 'Never',
    aiAlarmsPreviewTitle: 'Alarm Preview',
    aiAlarmsConfirm: 'Create',
    aiAlarmsCancel: 'Cancel',
    aiAlarmsCreated: 'Alarms created',
    aiAlarmsNone: 'No alarms found',
    alarmsNote: 'Note',
    alarmsNotePlaceholder: 'What to do when alarm fires',
    alarmsSnooze: 'Snooze',
    alarmsSound: 'Sound',
    alarmsSectionUpcoming: 'Upcoming',
    alarmsSectionAll: 'All Alarms',
    alarmsSkipped: 'Missed',
    alarmsNextAt: 'Fires at',

    // New shell - navigation / sidebar
    navDashboard: 'Pomodoro',
    navAlarms: 'Alarms',
    navTasks: 'Tasks',
    navNotes: 'Notes',
    sidebarAlarms: 'Alarms',
    sidebarTasks: 'Tasks',
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
    navStt: 'STT',
    navSettings: 'Settings',
    navDailyPlanning: 'Daily Planning',
    toggleSidebar: 'Toggle sidebar',
    sttScreenTitle: 'Speech to Text (STT)',
    sttScreenSubtitle: 'Configure models, hotkeys, animation and sound',
    sttTabModels: 'Models',
    sttTabKeys: 'Hotkeys',
    sttTabAnimation: 'Animation',
    sttTabSound: 'Sound',
    sttTabText: 'Text',
    sttTabHistory: 'History',
    sttTabAdvanced: 'Advanced',
    sttAnimationTitle: 'Indicator appearance',
    sttAnimationWave: 'Wave ribbon instead of bar',
    sttAnimationWaveDesc: 'Displays a live Handy wave ribbon with glow during dictation',
    sttAnimationWaveBars: 'Number of wave bars',
    sttAnimationWaveBarsDesc: 'Width and detail of the wave ribbon (from 12 to 48)',
    sttAnimationOverlay: 'Show floating indicator',
    sttAnimationOverlayDesc: 'Display the dictation indicator on top of all windows',
    settingsSpeechMovedTitle: 'Speech settings moved to STT section',
    settingsSpeechMovedHint: 'Manage models, hotkeys, wave animation, and sound in the dedicated sidebar section',
    settingsSpeechMovedAction: 'Go to STT section',
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
    vaultTitle: 'Vault',
    vaultFolder: 'Folder',
    vaultChangeFolder: 'Change folder',
    vaultOpenFolder: 'Open in Explorer',
    vaultRefresh: 'Refresh',
    vaultToday: 'Today',
    vaultNewNote: 'New note',
    vaultNewFolder: 'New folder',
    vaultRename: 'Rename',
    vaultDelete: 'Delete',
    vaultConfirmDelete: 'Delete {name}?',
    vaultExternalChanged: 'File was modified externally',
    vaultReload: 'Reload from disk',
    vaultKeepMine: 'Keep my version',
    vaultEmptyTree: 'No files in vault yet',
    vaultMigrationDone: 'Notes exported to files',
    notesUnsaved: 'Unsaved changes',
    editorPlaceholder: 'Start writing or type [[ to link...',
    notesFilesHint: 'Notes are stored as .md files',
    navRecordings: 'Recordings',
    recLibrary: 'Recording library',
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
    recChannels: 'Channels',
    recChannelsMono: 'Mono',
    recChannelsStereo: 'Stereo',
    playerPlay: 'Play',
    playerPause: 'Pause',
    playerSeek: 'Seek',
    playerVolume: 'Volume',
    playerMute: 'Mute',
    playerUnmute: 'Unmute',
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
    chatYesterday: 'yesterday',
    chatNew: 'New chat',
    chatClear: 'Clear',
    chatClearTitle: 'Clear current chat',
    chatModel: 'Model',
    chatCustomModel: 'Custom model...',
    chatRecentSessions: 'Recent chats',
    chatUntitled: 'New chat',

    // Window controls & sidebar (interfaces.md §2)
    titleBarMinimize: 'Minimize',
    titleBarMaximize: 'Maximize',
    titleBarCloseToTray: 'Hide to tray (keeps running)',
    titleBarPin: 'Keep on top',
    titleBarUnpin: 'Stop keeping on top',
    titleBarCompact: 'Collapse to mini widget',
    sidebarCollapse: 'Collapse menu',
    sidebarExit: 'Quit Tempo',

    // Update (interfaces.md §2)
    updateIdle: 'Check for updates',
    updateChecking: 'Checking…',
    updateUpToDate: 'Up to date',
    updateAvailable: 'Update to {version}',
    updateDownloading: 'Downloading {percent}%',
    updateReady: 'Restart',
    updateFailed: 'Update failed',

    // Chat and alarms (interfaces.md §2)
    chatNeedKey: 'Add a key in Settings → AI',
    chatNewChat: 'New chat',
    alarmsQuickIn30: 'In 30 minutes',
    alarmsQuickTomorrow8: 'Tomorrow at 8:00',
    alarmsQuickDaily730: 'Every day at 7:30',

    // Swept component keys
    chatInputPlaceholder: 'Create a task, list, note, schedule…',
    chatCompiling: 'Analyzing and applying…',
    chatSend: 'Send message',
    chatOnline: 'Online LLM',
    chatOffline: 'Offline Mode',

    // Stats (StatsView.tsx)
    statsLoading: 'Loading statistics...',
    statsFocusActivity: 'Focus Activity',
    statsCurrentStreak: 'Current Streak',
    statsLongest: 'Longest: {n}',
    statsDays: 'days',
    statsFocusedTime: 'Focused Time',
    statsLast14Days: 'LAST 14 DAYS',
    statsLast12Weeks: 'LAST 12 WEEKS',

    // Speech (src/components/speech/)
    speechOverlayIndicator: 'Show recording overlay indicator',
    speechOverlayIndicatorHint: 'Display visual level meter, mode and timer while dictating (overlay and pill)',
    speechRerunSetupHint: 'Reset onboarding state to launch the initial 4-step setup wizard',
    speechRerunSetup: 'Rerun Setup',
    speechClearLog: 'Clear log',
    speechClearAllWords: 'Clear all words',
    speechClear: 'Clear',
    speechAdd: 'Add',
    speechModelRussian: 'Russian (GigaAM)',
    speechModelMultilingual: 'Multilingual (99+)',
    speechModelEnglishOnly: 'English only',
    speechSaved: 'Saved',
    speechReady: 'Ready',
    speechStopTestRecording: 'Stop test recording',
    speechClearShortcut: 'Clear shortcut',
    speechOnboardingSelectModel: 'Select a local speech model. Recommended models balance speed and transcription accuracy.',

    // Bottom player (WinterBottomPlayer.tsx)
    playerToggleMenu: 'Toggle navigation menu',
    playerPhaseSelector: 'Phase selector',
    playerTimerPresets: 'Timer presets',
    playerStartTimer: 'Start timer',
    playerPauseTimer: 'Pause timer',
    playerResetTimer: 'Reset timer',
    playerSkipPhase: 'Skip phase',
    playerFocusAudio: 'Focus audio',
    playerFocusAudioActive: 'Focus audio active',

    // Views & tools (Day, Calendar, Lists, Tasks, Notes, Recordings, Overlay, Timer, Palette)
    dayPreviousDay: 'Previous day',
    dayNextDay: 'Next day',
    dayMarkTaskDone: 'Mark task done',
    dayMarkAsActive: 'Mark as active',
    dayMarkAsCompleted: 'Mark as completed',
    dayToggleTask: 'Toggle task',
    calendarPrevious: 'Previous',
    calendarNext: 'Next',
    calendarAddEvent: 'Add event',
    listsRenameList: 'Rename list',
    listsRenameItem: 'Rename item',
    tasksMinutesPlaceholder: 'min',
    notesTaskCompleted: 'Completed task',
    notesTaskIncomplete: 'Incomplete task',
    recordingsPreviewAlt: 'Preview',
    overlayClose: 'Close overlay',
    timerPomodoroMode: 'Pomodoro mode',
    timerStopwatchMode: 'Stopwatch mode',
    paletteDialogLabel: 'Command Palette',
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
