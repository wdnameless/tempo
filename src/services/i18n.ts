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
    navDashboard: 'Pomodoro',
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
