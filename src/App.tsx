import React, { useState, useEffect } from 'react';
import {
  Clock,
  CalendarDays,
  Calendar,
  FileText,
  BarChart2,
  Settings,
  Bot,
  PanelLeftClose,
  PanelLeftOpen,
  Mic,
  Power,
} from 'lucide-react';

import { TitleBar } from './components/TitleBar';
import { MiniOverlay } from './components/MiniOverlay';
import { ResizeHandles } from './components/ResizeHandles';
import { AIChatDrawer } from './components/AIChatDrawer';
import { DashboardView } from './components/DashboardView';
import { SettingsView } from './components/SettingsView';
import { Alarms } from './components/Alarms';
import { TasksView } from './components/TasksView';
import { DayView } from './components/DayView';
import { CalendarView } from './components/CalendarView';
import { ListsView } from './components/ListsView';
import { NotesView } from './components/NotesView';
import { DrawingsView } from './components/DrawingsView';
import { StatsView } from './components/StatsView';
import { RecordingsView } from './components/RecordingsView';
import { AlarmCenter } from './components/AlarmCenter';
import { UpdateBanner } from './components/UpdateBanner';
import { CommandPalette } from './components/CommandPalette';
import { SectionTabs } from './components/SectionTabs';

import { DictationIndicator } from './components/DictationIndicator';
import { DynamicBackground } from './components/DynamicBackground';
import { I18nService } from './services/i18n';
import { loadAccent, migrateLegacyPreferences } from './services/generalSettings';
import { pruneOnStartup } from './services/assets';
import { themeFromTokens } from './constants/themes';
import { ACCENTS, AccentId, applyAccent } from './constants/design';
import {
  ThemeColors,
  AlarmItem,
  AISettings,
  TaskItem,
  NoteItem,
  DynamicUIConfig,
  DEFAULT_DYNAMIC_UI,
  ChatMessage,
  BlockSettings,
} from './types';
import { BLOCK_PRESETS } from './types/focus';
import { StoreService } from './services/store';
import { soundService } from './services/sound';
import { windowService } from './services/window';
import {
  detectPortable,
  checkForUpdate,
  installUpdate,
  currentVersion,
  UpdateInfo,
} from './services/update';
import { isTauri } from './services/platform';
import { installShortcutLayer } from './services/shortcuts';
import { onDataChanged } from './services/appEvents';
import { listAlarms } from './services/alarms';
import { listTasks } from './services/tasks';
import { listNotes } from './services/notes';
import { TimerService } from './services/timer';

interface StoredChatShape {
  id: string;
  role?: 'user' | 'assistant' | 'system';
  content?: string;
  sender?: 'user' | 'assistant' | 'system';
  text?: string;
  timestamp?: string;
}

function mapStoredToChatMessage(msg: ChatMessage | StoredChatShape): ChatMessage {
  const sender: 'user' | 'assistant' | 'system' =
    'sender' in msg && msg.sender
      ? msg.sender
      : 'role' in msg && msg.role === 'assistant'
        ? 'assistant'
        : 'role' in msg && msg.role === 'system'
          ? 'system'
          : 'user';
  const text = 'text' in msg && msg.text ? msg.text : 'content' in msg && msg.content ? msg.content : '';
  return {
    id: msg.id,
    sender,
    text,
    timestamp: msg.timestamp || new Date().toISOString(),
  };
}

function welcomeMessage(): ChatMessage {
  return {
    id: 'welcome',
    sender: 'assistant',
    text: 'Привет! Я ассистент Tempo. Могу помочь распланировать задачи или настроить интерфейс под твои задачи.',
    timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
  };
}

class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('App Uncaught Crash:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="w-full h-full p-6 flex flex-col items-center justify-center bg-[var(--bg)] text-[var(--text)] select-none">
          <div className="w-12 h-12 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400 mb-4 font-bold text-xl">
            !
          </div>
          <h2 className="text-base font-semibold mb-1">Что-то пошло не так</h2>
          <p className="text-xs text-[var(--text-muted)] max-w-[280px] text-center mb-5 leading-relaxed">
            Интерфейс столкнулся с непредвиденной ошибкой при рендере.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => this.setState({ hasError: false, error: null })}
              className="px-4 py-2 bg-[var(--elevated)] hover:bg-[var(--surface)] text-[var(--text)] border border-[var(--border)] rounded-xl text-xs font-medium transition-colors"
            >
              Попробовать снова
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-[var(--accent)] hover:opacity-90 text-[var(--bg)] font-semibold rounded-xl text-xs transition-opacity"
            >
              Перезагрузить
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export type ScreenId = 'dashboard' | 'day' | 'calendar' | 'alarms' | 'tasks' | 'lists' | 'notes' | 'drawings' | 'recordings' | 'stats' | 'settings';
type SectionId = 'dashboard' | 'day' | 'calendar' | 'notes' | 'recordings' | 'stats' | 'settings';

interface NavSection {
  id: SectionId;
  label: string;
  icon: React.ReactNode;
  tabs: ScreenId[];
}

/**
 * True when this webview is the mini overlay window rather than the main app.
 *
 * Read once per mount, not per render: the query string cannot change without a
 * reload, and reading it during render keeps the branch out of the hook order.
 */
function isMiniOverlayWindow(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('window') === 'mini-overlay';
}

/**
 * The main window's shell.
 *
 * Split from the default export so the mini overlay branch never has to return
 * before this component's hooks run: an early return above a `useState` breaks
 * the hook order the moment the window mode changes.
 */
function MainShell() {
  const [hydrated, setHydrated] = useState(false);
  /** Repaints the chrome when the interface language changes. */
  const [, setLangTick] = useState(0);
  useEffect(() => I18nService.subscribe(() => setLangTick((n) => n + 1)), []);
  const t = I18nService.t();
  const [accentKey, setAccentKey] = useState<AccentId>(() => {
    return loadAccent();
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => {
    return StoreService.getPreference<boolean>('tempo_sidebar_collapsed', false);
  });
  const [activeTab, setActiveTab] = useState<ScreenId>('dashboard');
  const [isAiOpen, setIsAiOpen] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [isCompact, setIsCompact] = useState(false);

  // Entities state
  const [alarms, setAlarms] = useState<AlarmItem[]>([]);
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [notes, setNotes] = useState<NoteItem[]>([]);
  const [timerMinutes, setTimerMinutes] = useState<number | undefined>(undefined);

  const [aiSettings, setAiSettings] = useState<AISettings>({
    apiKey: '',
    baseUrl: 'https://openrouter.ai/api/v1',
    model: 'google/gemini-2.5-flash',
  });

  const [dynamicUi, setDynamicUi] = useState<DynamicUIConfig>(DEFAULT_DYNAMIC_UI);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([welcomeMessage()]);

  const [alarmVolume, setAlarmVolume] = useState<number>(() =>
    StoreService.getPreference<number>('tempo_alarm_volume', 0.8),
  );
  const [alarmEnabled, setAlarmEnabled] = useState<boolean>(() =>
    StoreService.getPreference<boolean>('tempo_alarm_enabled', true),
  );

  const [blockSettings, setBlockSettings] = useState<BlockSettings>(BLOCK_PRESETS[0]);

  // Update banner state
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  // Initialize theme accent and shortcut layer
  useEffect(() => {
    applyAccent(accentKey);
  }, [accentKey]);

  useEffect(() => {
    if (typeof installShortcutLayer === 'function') {
      try {
        const cleanup = installShortcutLayer();
        return () => {
          if (typeof cleanup === 'function') cleanup();
        };
      } catch (err) {
        console.warn('Shortcut layer installation failed:', err);
      }
    }
  }, []);

  // Listen to window shortcut events
  useEffect(() => {
    const handleToggleSidebar = () => {
      soundService.playUiClick();
      setSidebarCollapsed((prev) => {
        const next = !prev;
        StoreService.setPreference('tempo_sidebar_collapsed', next);
        return next;
      });
    };

    const handleNavigate = (e: Event) => {
      const custom = e as CustomEvent<string>;
      const target = custom.detail?.toLowerCase();
      if (
        target &&
        ['dashboard', 'day', 'calendar', 'alarms', 'tasks', 'lists', 'notes', 'drawings', 'recordings', 'stats', 'settings'].includes(target)
      ) {
        soundService.playUiClick();
        setActiveTab(target as ScreenId);
      }
    };

    window.addEventListener('tempo:toggle-sidebar', handleToggleSidebar);
    window.addEventListener('tempo:navigate', handleNavigate);

    return () => {
      window.removeEventListener('tempo:toggle-sidebar', handleToggleSidebar);
      window.removeEventListener('tempo:navigate', handleNavigate);
    };
  }, []);

  // Hydration from store
  useEffect(() => {
    const loadState = async () => {
      try {
        const data = await StoreService.hydrate();
        if (data.alarms) setAlarms(data.alarms);
        if (data.tasks) setTasks(data.tasks);
        if (data.notes) setNotes(data.notes);
        if (data.aiSettings) setAiSettings(data.aiSettings);
        if (data.dynamicUi) setDynamicUi(data.dynamicUi);
        if (data.chatMessages && data.chatMessages.length > 0) {
          setChatMessages(data.chatMessages.map(mapStoredToChatMessage));
        }

        const savedAccent = loadAccent();
        if (savedAccent in ACCENTS) {
          setAccentKey(savedAccent);
          applyAccent(savedAccent);
        }

        const savedCollapsed = StoreService.getPreference<boolean>('tempo_sidebar_collapsed', false);
        setSidebarCollapsed(savedCollapsed);

        const savedFocus = StoreService.getPreference<number>('alarmer_block_focus_min', 50);
        const savedRest = StoreService.getPreference<number>('alarmer_block_rest_min', 10);
        setBlockSettings({ focusMin: savedFocus, restMin: savedRest });
      } catch (err) {
        console.error('Store hydrate error:', err);
      } finally {
        setHydrated(true);
      }
    };

    void loadState();
  }, []);
  // Re-read affected entities when assistant writes data (R01)
  useEffect(() => {
    return onDataChanged(async (table) => {
      try {
        if (table === 'alarms') {
          const fresh = await listAlarms();
          setAlarms(fresh.map((a) => ({ ...a, title: a.label } as unknown as AlarmItem)));
        } else if (table === 'tasks') {
          const fresh = await listTasks();
          setTasks(fresh);
        } else if (table === 'notes') {
          const fresh = await listNotes();
          setNotes(fresh);
        }
      } catch (err) {
        console.error('Failed to reload entity on data-changed signal:', err);
      }
    });
  }, []);

  // Startup assets pruning, and carrying preferences over from the previous name.
  useEffect(() => {
    void pruneOnStartup().catch((err) => {
      console.warn('Startup assets pruning failed:', err);
    });
    // Not only on the settings screen: a user who never opens it would otherwise
    // keep two copies of the same setting, one of them under a name we no longer read.
    void migrateLegacyPreferences().catch((err) => {
      console.warn('Preference migration failed:', err);
    });
  }, []);

  const [sidebarVersion, setSidebarVersion] = useState<string>('');

  useEffect(() => {
    void currentVersion().then((v) => {
      if (v) setSidebarVersion(v);
    });
  }, []);

  // Update check
  useEffect(() => {
    if (!isTauri()) return;
    void detectPortable();
    void windowService.restoreSavedSize();
    const timer = window.setTimeout(() => {
      void checkForUpdate().then((res) => {
        if (res && res.status === 'update') {
          setUpdateInfo(res.info);
        }
      });
    }, 4000);
    return () => window.clearTimeout(timer);
  }, []);

  const handleApplyUpdate = async () => {
    if (!updateInfo) return;
    setIsUpdating(true);
    try {
      await installUpdate(updateInfo);
    } catch (err: unknown) {
      setIsUpdating(false);
      console.error('Update failed:', err);
    }
  };

  const handleSelectAccent = (accent: AccentId) => {
    if (!(accent in ACCENTS)) return;
    setAccentKey(accent);
    applyAccent(accent);
    StoreService.setPreference('tempo_accent', accent);
  };

  const handleToggleSidebar = () => {
    soundService.playUiClick();
    setSidebarCollapsed((prev) => {
      const next = !prev;
      StoreService.setPreference('tempo_sidebar_collapsed', next);
      return next;
    });
  };

  const handleNavigate = (tab: ScreenId) => {
    soundService.playUiClick();
    setActiveTab(tab);
  };

  // The legacy theme bridge for components still requiring ThemeColors prop
  const theme: ThemeColors = {
    ...themeFromTokens(accentKey),
    ...dynamicUi.colors,
  };

  const navSections: NavSection[] = [
    { id: 'dashboard', label: t.navDashboard, icon: <Clock size={18} />, tabs: ['dashboard', 'alarms'] },
    { id: 'day', label: t.navDay, icon: <CalendarDays size={18} />, tabs: ['day', 'tasks', 'lists'] },
    { id: 'calendar', label: t.navCalendar, icon: <Calendar size={18} />, tabs: ['calendar'] },
    { id: 'notes', label: t.navNotes, icon: <FileText size={18} />, tabs: ['notes', 'drawings'] },
    { id: 'recordings', label: t.navRecordings, icon: <Mic size={18} />, tabs: ['recordings'] },
    { id: 'stats', label: t.navStats, icon: <BarChart2 size={18} />, tabs: ['stats'] },
    { id: 'settings', label: t.navSettings, icon: <Settings size={18} />, tabs: ['settings'] },
  ];

  const currentSection = navSections.find((s) => s.tabs.includes(activeTab)) ?? navSections[0];

  const handleSectionClick = (section: NavSection) => {
    soundService.playUiClick();
    setActiveTab(section.tabs[0]);
  };

  const getTabLabel = (id: ScreenId): string => {
    switch (id) {
      case 'dashboard': return t.navDashboard;
      case 'alarms': return t.navAlarms;
      case 'day': return t.navDay;
      case 'tasks': return t.navTasks;
      case 'lists': return t.navLists;
      case 'calendar': return t.navCalendar;
      case 'notes': return t.navNotes;
      case 'drawings': return t.navDrawings;
      case 'recordings': return t.navRecordings;
      case 'stats': return t.navStats;
      case 'settings': return t.navSettings;
    }
  };

  return (
    <ErrorBoundary>
      <div
        className="flex flex-col h-screen w-screen overflow-hidden select-none bg-[var(--bg)] text-[var(--text)] transition-colors duration-150 relative"
      >
        <DynamicBackground />
        <ResizeHandles />
        <CommandPalette />

        <AlarmCenter
          theme={theme}
          firings={alarms}
          alarmVolume={alarmVolume}
          alarmEnabled={alarmEnabled}
          missed={[]}
          onDismissMissed={() => {}}
          hydrated={hydrated}
        >
          {null}
        </AlarmCenter>

        <TitleBar
          theme={theme}
          isPinned={isPinned}
          onTogglePin={() => {
            const next = !isPinned;
            setIsPinned(next);
            void windowService.setAlwaysOnTop(next);
          }}
          isCompact={isCompact}
          onToggleCompact={() => {
            const next = !isCompact;
            setIsCompact(next);
            void windowService.toggleCompactMode(next);
          }}
        />

        {updateInfo && (
          <UpdateBanner
            theme={theme}
            version={updateInfo.version}
            onOpenSettings={() => setActiveTab('settings')}
            onInstall={handleApplyUpdate}
            installing={isUpdating}
            onDismiss={() => setUpdateInfo(null)}
          />
        )}

        <div className="flex flex-1 overflow-hidden relative">
          <aside
            data-testid="sidebar"
            className={`border-r border-white/10 bg-[#060608] flex flex-col justify-between transition-[width] duration-200 shrink-0 select-none z-30 ${
              sidebarCollapsed ? 'w-14' : 'w-52'
            }`}
          >
            <div className="flex flex-col p-2 gap-1">
              {!sidebarCollapsed && (
                <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-white/10 mb-1 select-none">
                  <div className="w-7 h-7 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center text-white shrink-0 shadow-xs">
                    <Clock className="w-3.5 h-3.5 text-white" />
                  </div>
                  <div className="flex flex-col leading-none min-w-0">
                    <span className="text-xs font-bold text-white tracking-wide">Tempo</span>
                    <span className="text-[10px] font-mono text-white/40 tracking-wider mt-0.5">{sidebarVersion ? (sidebarVersion.startsWith('v') ? sidebarVersion : `v${sidebarVersion}`) : ''}</span>
                  </div>
                </div>
              )}
              {navSections.map((section) => {
                const isActive = currentSection.id === section.id;
                return (
                  <button
                    key={section.id}
                    onClick={() => handleSectionClick(section)}
                    title={sidebarCollapsed ? section.label : undefined}
                    aria-label={section.label}
                    aria-current={isActive ? 'page' : undefined}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors relative ${
                      isActive
                        ? 'bg-white/10 text-white font-semibold'
                        : 'text-white/50 hover:text-white hover:bg-white/5'
                    } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
                  >
                    <span className="shrink-0">{section.icon}</span>
                    {!sidebarCollapsed && <span className="truncate">{section.label}</span>}
                  </button>
                );
              })}
            </div>

            <div className="p-2 border-t border-white/10 flex flex-col gap-1">
              <button
                onClick={() => {
                  soundService.playUiClick();
                  setIsAiOpen((prev) => !prev);
                }}
                title={sidebarCollapsed ? 'AI Ассистент' : undefined}
                aria-label="AI Ассистент"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  isAiOpen
                    ? 'bg-white/10 text-white font-semibold'
                    : 'text-white/50 hover:text-white hover:bg-white/5'
                } ${sidebarCollapsed ? 'justify-center px-0' : ''}`}
              >
                <Bot size={18} className="shrink-0" />
                {!sidebarCollapsed && <span className="truncate">AI Ассистент</span>}
              </button>

              <button
                data-testid="sidebar-collapse-button"
                onClick={handleToggleSidebar}
                title={sidebarCollapsed ? 'Развернуть меню (Cmd+S)' : 'Свернуть меню (Cmd+S)'}
                aria-label={sidebarCollapsed ? 'Развернуть меню' : 'Свернуть меню'}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/50 hover:text-white hover:bg-white/5 transition-colors ${
                  sidebarCollapsed ? 'justify-center px-0' : ''
                }`}
              >
                {sidebarCollapsed ? (
                  <PanelLeftOpen size={18} className="shrink-0" />
                ) : (
                  <>
                    <PanelLeftClose size={18} className="shrink-0" />
                    <span className="truncate">Свернуть</span>
                  </>
                )}
              </button>
              <button
                onClick={async () => {
                  soundService.playUiClick();
                  await windowService.close();
                }}
                title={sidebarCollapsed ? 'Выход из Tempo' : undefined}
                aria-label="Выход из Tempo"
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-white/40 hover:text-red-400 hover:bg-white/5 transition-colors ${
                  sidebarCollapsed ? 'justify-center px-0' : ''
                }`}
              >
                <Power size={18} className="shrink-0" />
                {!sidebarCollapsed && <span className="truncate">Выход из Tempo</span>}
              </button>
            </div>
          </aside>

          {/* Main content area */}
          <main className="flex-1 flex flex-col overflow-hidden bg-[var(--bg)] relative">
            <SectionTabs
              activeTab={activeTab}
              tabs={currentSection.tabs.map((tabId) => ({
                id: tabId,
                label: getTabLabel(tabId),
              }))}
              onChange={handleNavigate}
            />
            <div className={`flex-1 overflow-y-auto overflow-x-hidden ${['dashboard', 'drawings', 'stats'].includes(activeTab) ? 'p-0' : 'p-6'}`}>
              {activeTab === 'dashboard' && (
                <DashboardView
                  theme={theme}
                  dynamicUi={dynamicUi}
                  alarms={alarms}
                  aiSettings={aiSettings}
                  onUpdateAlarms={(newAlarms) => {
                    setAlarms(newAlarms);
                    void StoreService.persist({ alarms: newAlarms });
                  }}
                  onOpenAISettings={() => {
                    setActiveTab('settings');
                  }}
                  tasks={tasks}
                  onUpdateTasks={(newTasks) => {
                    setTasks(newTasks);
                    void StoreService.persist({ tasks: newTasks });
                  }}
                  notes={notes}
                  timerMinutes={timerMinutes}
                />
              )}

              {activeTab === 'alarms' && (
                <Alarms
                  alarms={alarms}
                  onUpdateAlarms={(newAlarms) => {
                    setAlarms(newAlarms);
                    void StoreService.persist({ alarms: newAlarms });
                  }}
                  theme={theme}
                />
              )}
              {activeTab === 'day' && <DayView />}
              {activeTab === 'calendar' && <CalendarView />}


              {activeTab === 'tasks' && <TasksView />}

              {activeTab === 'lists' && <ListsView />}

              {activeTab === 'notes' && <NotesView />}

              {activeTab === 'drawings' && <DrawingsView />}

              {activeTab === 'recordings' && <RecordingsView />}

              {activeTab === 'stats' && <StatsView tasks={tasks} />}

              {activeTab === 'settings' && (
                <SettingsView
                  theme={theme}
                  accentKey={accentKey}
                  onSelectAccent={handleSelectAccent}
                  alarmVolume={alarmVolume}
                  alarmEnabled={alarmEnabled}
                  onAlarmAudioChange={(vol, en) => {
                    setAlarmVolume(vol);
                    setAlarmEnabled(en);
                    StoreService.setPreference('tempo_alarm_volume', vol);
                    StoreService.setPreference('tempo_alarm_enabled', en);
                  }}
                  aiSettings={aiSettings}
                  onUpdateAISettings={(settings) => {
                    setAiSettings(settings);
                    void StoreService.persist({ aiSettings: settings });
                  }}
                  onUpdateUI={(cfg: DynamicUIConfig) => {
                    setDynamicUi(cfg);
                  }}
                  blockSettings={blockSettings}
                  onBlockSettingsChange={(next) => {
                    setBlockSettings(next);
                    StoreService.setPreference('alarmer_block_focus_min', next.focusMin);
                    StoreService.setPreference('alarmer_block_rest_min', next.restMin);
                  }}
                />
              )}
            </div>
          </main>

          {/* AI Drawer */}
          {isAiOpen && (
            <div className="absolute top-0 right-0 bottom-0 w-80 z-30 shadow-2xl bg-[var(--surface)] border-l border-[var(--border)] flex flex-col">
              <AIChatDrawer
                isOpen={isAiOpen}
                onClose={() => setIsAiOpen(false)}
                theme={theme}
                currentUi={dynamicUi}
                aiSettings={aiSettings}
                onApplyUI={(cfg: DynamicUIConfig) => {
                  setDynamicUi(cfg);
                }}
                onApplyAlarms={(newAlarms) => {
                  setAlarms((prev) => {
                    const existingIds = new Set(prev.map((a) => a.id));
                    const uniqueNew = newAlarms.filter((a) => !existingIds.has(a.id));
                    return [...prev, ...uniqueNew];
                  });
                }}
                messages={chatMessages}
                onSendMessage={(msg: ChatMessage) =>
                  setChatMessages((prev) => {
                    const next = [...prev, msg];
                    void StoreService.persist({ chatMessages: next as never });
                    return next;
                  })
                }
                onResetChat={() => {
                  const cleanChat: ChatMessage[] = [welcomeMessage()];
                  setChatMessages(cleanChat);
                  void StoreService.persist({ chatMessages: cleanChat as never });
                }}
                onSetTimerMinutes={(minutes: number) => {
                  setTimerMinutes(minutes);
                  void TimerService.setDuration(minutes);
                  setActiveTab('dashboard');
                }}
                onNavigateToModule={(mod) => {
                  if (mod === 'alarms') setActiveTab('alarms');
                  else setActiveTab('dashboard');
                }}
              />
            </div>
          )}

          {/* Sleek Upright Side Toggle Button on Right Edge for AI */}
          {!isAiOpen && (
            <button
              onClick={() => setIsAiOpen(true)}
              className="absolute right-0 top-1/2 -translate-y-1/2 z-40 flex items-center space-x-1.5 py-3 px-2 rounded-l-xl border border-r-0 shadow-2xl backdrop-blur-md transition-all active:scale-95 group hover:px-2.5 bg-[var(--surface)] border-[var(--border)]"
              title="Раскрыть AI Co-Pilot"
            >
              <div className="flex flex-col items-center space-y-1.5 opacity-55 group-hover:opacity-100 transition-opacity">
                <Bot size={16} className="text-[var(--text)]" />
                <span className="text-[10px] font-medium [writing-mode:vertical-lr] tracking-wider uppercase text-[var(--text-muted)]">
                  AI
                </span>
              </div>
            </button>
          )}
          {/* Dictation pill indicator: visible only while recording */}
          <DictationIndicator />
        </div>
      </div>
    </ErrorBoundary>
  );
}

/** Routes the webview to the window it was opened as. */
export default function App() {
  return (
    <ErrorBoundary>
      {isMiniOverlayWindow() ? (
        <div className="relative w-full h-full">
          <MiniOverlay />
          <DictationIndicator variant="overlay" />
        </div>
      ) : (
        <MainShell />
      )}
    </ErrorBoundary>
  );
}
