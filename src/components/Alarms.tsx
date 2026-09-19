import React, { useState, useEffect } from 'react';
import { Plus, Trash2, Bell, BellOff, Volume2, Sparkles, Loader2, StickyNote } from 'lucide-react';
import { ThemeColors, AlarmItem, AISettings, DynamicUIConfig } from '../types';
import { soundService } from '../services/sound';
import { AIService } from '../services/ai';

/** Short weekday labels, indexed 0 = Sunday to match the stored data. */
const WEEKDAY_LABELS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

interface AlarmsProps {
  theme: ThemeColors;
  alarms: AlarmItem[];
  aiSettings?: AISettings;
  onUpdateAlarms: (alarms: AlarmItem[]) => void;
  onOpenAISettings?: () => void;
  dynamicUi?: DynamicUIConfig;
}

/**
 * Standalone alarms and saved schedules.
 *
 * Ringing is not handled here: firing and the ringing takeover live in
 * `AlarmCenter` above the tabs, so an alarm rings whatever screen is open.
 */
export const Alarms: React.FC<AlarmsProps> = ({
  theme,
  alarms,
  aiSettings,
  onUpdateAlarms,
  onOpenAISettings,
  dynamicUi,
}) => {
  const [newTime, setNewTime] = useState('08:00');
  const [newLabel, setNewLabel] = useState('Утренняя разминка');
  const [newRepeat, setNewRepeat] = useState<AlarmItem['repeat']>('days');
  /** Weekdays the new alarm runs on; only used when repeat is 'days'. */
  const [newDays, setNewDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [currentTime, setCurrentTime] = useState('');

  /**
   * Adds or removes a weekday, keeping the list sorted so labels read in order.
   *
   * The last remaining day cannot be removed: an alarm in "days" mode with no
   * days matches nothing, so it would sit in the list labelled "Каждый день"
   * and never ring. Refusing the last removal keeps every saved alarm able to
   * fire.
   */
  const toggleNewDay = (day: number) => {
    soundService.playUiClick();
    setNewDays((prev) => {
      if (prev.includes(day)) {
        if (prev.length === 1) return prev;
        return prev.filter((d) => d !== day);
      }
      return [...prev, day].sort((a, b) => a - b);
    });
  };
  /** The alarm whose note field is open; null when none is. */
  const [noteEditingId, setNoteEditingId] = useState<string | null>(null);

  /** Writes an alarm's note, dropping the field when it's emptied. */
  const setAlarmNote = (id: string, note: string) => {
    onUpdateAlarms(alarms.map((a) => (a.id === id ? { ...a, note: note || undefined } : a)));
  };

  /** Applies a partial change to one alarm, leaving the rest untouched. */
  const patchAlarm = (id: string, patch: Partial<AlarmItem>) => {
    onUpdateAlarms(alarms.map((a) => (a.id === id ? { ...a, ...patch } : a)));
  };

  const isDerived = (alarm: AlarmItem) => Boolean(alarm.scheduleId);
  /** Changes an alarm's time, rejecting anything that is not a clock time. */
  const editAlarmTime = (id: string, value: string) => {
    if (!/^\d{1,2}:\d{2}$/.test(value)) return;
    patchAlarm(id, { time: value.padStart(5, '0') });
  };

  /**
   * Toggles one weekday on an existing alarm.
   *
   * Like the create form, the last day is not removable: an alarm that matches
   * no weekday is indistinguishable from a broken one.
   */
  const toggleAlarmDay = (alarm: AlarmItem, day: number) => {
    soundService.playUiClick();
    if (alarm.days.includes(day) && alarm.days.length === 1) return;
    const days = alarm.days.includes(day)
      ? alarm.days.filter((d) => d !== day)
      : [...alarm.days, day].sort((a, b) => a - b);
    patchAlarm(alarm.id, { days, repeat: 'days' });
  };

  // AI Smart Setup state
  const [showAiModal, setShowAiModal] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('Вот моя тренировка: в 7:00 подъем, в 7:15 силовая разминка, в 19:30 вечерняя растяжка');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  // Display clock only. Firing is owned by the Rust scheduler so alarms ring
  // with this tab closed, the window hidden, or the app in the tray.
  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now
        .getMinutes()
        .toString()
        .padStart(2, '0')}`;
      setCurrentTime(timeStr);
    };

    updateTime();
    const interval = window.setInterval(updateTime, 1000);
    return () => window.clearInterval(interval);
  }, []);

  const toggleAlarm = (id: string) => {
    soundService.playCountdownTick();
    onUpdateAlarms(
      alarms.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    );
  };

  const deleteAlarm = (id: string) => {
    soundService.playCountdownTick();
    onUpdateAlarms(alarms.filter((a) => a.id !== id));
  };

  const addAlarm = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTime) return;

    soundService.playCountdownTick();
    const newAlarm: AlarmItem = {
      id: Date.now().toString(),
      title: newLabel || 'Будильник',
      label: newLabel || 'Будильник',
      time: newTime,
      repeat: newRepeat,
      days: newRepeat === 'days' ? newDays : [],
      enabled: true,
      sound: 'gentle',
      voicePrompt: newLabel,
    };

    onUpdateAlarms([...alarms, newAlarm]);
    setNewLabel('');
  };

  const handleAiSchedule = async () => {
    if (!aiSettings?.apiKey) {
      onOpenAISettings?.();
      return;
    }
    setAiLoading(true);
    setAiError(null);
    try {
      soundService.playCountdownTick();
      const { alarms: newAlarms, error } = await AIService.generateAlarms(aiPrompt, aiSettings);
      if (newAlarms.length > 0) {
        onUpdateAlarms([...alarms, ...newAlarms]);
        soundService.speak(`ИИ настроил ${newAlarms.length} будильников!`);
        setShowAiModal(false);
      } else {
        setAiError('Не удалось выделить будильники из запроса.');
      }
      // The model being unreachable is worth saying out loud even when the
      // offline parser managed to produce something.
      if (error) setAiError(error);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Ошибка при обращении к ИИ';
      setAiError(msg);
      soundService.playBeep(200, 0.4, 0.4);
    } finally {
      setAiLoading(false);
    }
  };

  return (
    <div className="flex flex-col w-full max-w-[340px] px-1 py-1 space-y-2.5 overflow-hidden">
      {/* Responsive Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 w-full">
        <div className="flex items-center space-x-1.5 shrink-0">
          <Bell size={15} style={{ color: theme.subtext }} />
          <span className="text-xs font-bold tracking-wider uppercase opacity-90 truncate">
            Будильники
          </span>
        </div>
        <div className="flex items-center space-x-1 shrink-0">
          {dynamicUi?.layout?.showSleepButton !== false && (
            <button
              onClick={() => {
                const sleepAlarm: AlarmItem = {
                  id: 'sleep_' + Date.now(),
                  title: 'Отход ко сну (Wind-down)',
                  time: '23:00',
                  repeat: 'daily',
                  days: [],
                  enabled: true,
                  sound: 'gentle',
                  voicePrompt: 'Пора готовиться ко сну. Закрой рабочие вкладки и отдохни.',
                };
                onUpdateAlarms([sleepAlarm, ...alarms]);
                soundService.playUiClick();
                soundService.speak('Будильник ко сну установлен на 23:00');
              }}
              className="px-2 py-0.5 text-[10px] font-semibold rounded-lg border transition-colors shrink-0" style={{ borderColor: theme.border, color: theme.subtext }}
              title="Reverse Alarm: Будильник ко сну"
            >
              🌙 Ко сну
            </button>
          )}
          {dynamicUi?.layout?.showAiScheduleButton !== false && (
            <button
              onClick={() => setShowAiModal(true)}
              className="flex items-center space-x-1 px-2 py-0.5 text-[10px] font-bold rounded-lg transition-all shadow-sm shrink-0"
              style={{
                backgroundColor: theme.border,
                color: theme.text,
                border: `1px solid ${theme.border}`,
              }}
            >
              <Sparkles size={11} className="animate-pulse" />
              <span>ИИ</span>
            </button>
          )}
          {dynamicUi?.layout?.showCurrentTimeBadge !== false && (
            <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded bg-black/40 border border-white/5 shrink-0">
              {currentTime || '--:--'}
            </span>
          )}
        </div>
      </div>

      {/* AI Orchestration Modal Banner */}
      {showAiModal && (
        <div
          className="p-4 rounded-2xl border backdrop-blur-2xl flex flex-col space-y-2 animate-in fade-in zoom-in-95 duration-150"
          style={{
            backgroundColor: theme.cardBg,
            borderColor: theme.border,
            boxShadow: '0 18px 48px rgba(0,0,0,0.45)',
          }}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-1.5 text-xs font-bold" style={{ color: theme.text }}>
              <Sparkles size={14} />
              <span>Умная расстановка будильников ИИ</span>
            </div>
            <button
              onClick={() => setShowAiModal(false)}
              className="text-xs opacity-60 hover:opacity-100"
            >
              ✕
            </button>
          </div>
          <p className="text-[11px] opacity-70">
            Напишите вашу тренировку, режим дня или задачи в свободной форме — ИИ сам расставит точное время и голосовые напоминания.
          </p>
          <textarea
            value={aiPrompt}
            onChange={(e) => setAiPrompt(e.target.value)}
            rows={2}
            className="w-full text-xs p-2 rounded-lg bg-black/40 border border-white/10 focus:outline-none"
            style={{ color: theme.text }}
            placeholder="Например: Вот моя тренировка: в 7:00 подъем, в 7:15 разминка, в 19:30 растяжка"
          />
          {aiError && <div className="text-[11px] text-red-400 font-medium">{aiError}</div>}
          <div className="flex items-center justify-end space-x-2 pt-1">
            <button
              onClick={() => setShowAiModal(false)}
              className="px-2.5 py-1 text-xs rounded-lg hover:bg-white/5 opacity-70"
            >
              Отмена
            </button>
            <button
              onClick={handleAiSchedule}
              disabled={aiLoading}
              className="flex items-center space-x-1 px-3 py-1 text-xs font-bold rounded-lg shadow-sm"
              style={{
                backgroundColor: '#fafafa',
                color: '#0a0a0a',
              }}
            >
              {aiLoading ? (
                <>
                  <Loader2 size={13} className="animate-spin" />
                  <span>Анализ и создание...</span>
                </>
              ) : (
                <>
                  <Sparkles size={13} />
                  <span>Расставить расписание</span>
                </>
              )}
            </button>
          </div>
        </div>
      )}

      {/* Quick Add Form */}
      {/* Responsive Quick Add Form */}
      <form
        onSubmit={addAlarm}
        className="flex items-center gap-1.5 p-2 rounded-2xl border w-full"
        style={{ backgroundColor: theme.surface, borderColor: theme.border }}
      >
        <input
          type="time"
          value={newTime}
          onChange={(e) => setNewTime(e.target.value)}
          className="bg-black/40 text-xs font-mono px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none w-[80px] shrink-0"
          style={{ color: theme.text }}
        />
        <div className="flex flex-col gap-1 min-w-0 flex-1">
          <input
            type="text"
            placeholder="Название будильника..."
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            className="w-full bg-black/40 text-xs px-2 py-1.5 rounded-lg border border-white/10 focus:outline-none"
            style={{ color: theme.text }}
          />
          {/* Weekday chips, so "Пн, Ср, Пт" is expressible. The preset used to
              hardcode Mon–Fri, which made a two-day alarm impossible. */}
          <div className="flex items-center gap-0.5">
            {WEEKDAY_LABELS.map((label, index) => {
              const active = newRepeat === 'days' && newDays.includes(index);
              return (
                <button
                  key={label}
                  type="button"
                  onClick={() => toggleNewDay(index)}
                  className="flex-1 h-5 rounded text-[9px] font-bold transition-colors"
                  style={{
                    backgroundColor: active ? 'rgba(255,255,255,0.16)' : 'transparent',
                    color: active ? theme.text : theme.subtext,
                    border: `1px solid ${active ? 'rgba(255,255,255,0.24)' : 'transparent'}`,
                  }}
                  title={`Звонить в ${label}`}
                  aria-pressed={active}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
        <select
          value={newRepeat}
          onChange={(e) => setNewRepeat(e.target.value as AlarmItem['repeat'])}
          className="bg-black/40 text-[10px] px-1 py-1.5 rounded-lg border border-white/10 focus:outline-none shrink-0 cursor-pointer self-start"
          style={{ color: theme.text }}
          title="Как часто звонить"
        >
          <option value="once" className="bg-neutral-900">Один раз</option>
          <option value="daily" className="bg-neutral-900">Каждый день</option>
          <option value="days" className="bg-neutral-900">По дням</option>
        </select>
        <button
          type="submit"
          className="w-7 h-7 rounded-lg transition-transform active:scale-95 flex items-center justify-center shrink-0"
          style={{ backgroundColor: "#fafafa", color: "#0a0a0a" }}
          title="Добавить будильник"
        >
          <Plus size={15} />
        </button>
      </form>
      {/* Alarm List */}
      {/* Alarm list. Each row can carry a note, which the ringing takeover shows
          so "что именно надо сделать" is on the screen when the alarm fires. */}
      <div className="flex flex-col space-y-2 max-h-[300px] overflow-y-auto pr-1">
        {alarms.length === 0 ? (
          <div className="text-center py-6 text-xs opacity-40">
            Нет активных будильников. Добавьте вручную или нажмите «ИИ Настройка».
          </div>
        ) : (
          alarms.map((alarm) => (
            <div
              key={alarm.id}
              className="flex items-center justify-between p-3 rounded-2xl border backdrop-blur-xl transition-all"
              style={{
                backgroundColor: alarm.enabled ? theme.cardBg : theme.surface,
                // Interactive rows keep a boundary that clears the 3.0 UI floor.
                borderColor: theme.border,
                boxShadow: alarm.enabled ? '0 8px 24px rgba(0,0,0,0.32)' : 'none',
                opacity: alarm.enabled ? 1 : 0.55,
              }}
            >
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => toggleAlarm(alarm.id)}
                  disabled={isDerived(alarm)}
                  className="p-1.5 rounded-lg transition-colors hover:bg-white/10 disabled:cursor-not-allowed"
                  style={{ color: alarm.enabled ? theme.text : theme.subtext }}
                  title={isDerived(alarm) ? 'Включается вместе с программой' : undefined}
                >
                  {alarm.enabled ? <Bell size={16} /> : <BellOff size={16} />}
                </button>
                <div className="flex flex-col">
                  <div className="flex items-baseline space-x-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      defaultValue={alarm.time}
                      readOnly={isDerived(alarm)}
                      onBlur={(e) => editAlarmTime(alarm.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
                      className={`text-lg font-mono font-bold bg-transparent outline-none border-b border-transparent ${
                        isDerived(alarm) ? 'cursor-not-allowed' : 'hover:border-white/20 focus:border-white/40'
                      } w-[62px] ${alarm.enabled ? '' : 'line-through'}`}
                      style={{ color: alarm.enabled ? theme.text : theme.subtext }}
                      aria-label={`Время будильника ${alarm.label || alarm.title}`}
                      title={isDerived(alarm)
                        ? 'Время задаётся в самой программе — откройте её шаги во вкладке «Алармы»'
                        : 'Время в формате 24 часа, например 07:30'}
                    />
                    <span className="text-xs font-medium truncate max-w-[120px]">
                      {alarm.label || alarm.title}
                    </span>
                  </div>
                  {/* Days are editable on the alarm itself, so changing "Пн–Пт"
                      to "Сб, Вс" does not mean deleting and re-creating it. */}
                  {alarm.repeat === 'days' && !isDerived(alarm) && (
                    <div className="flex items-center gap-0.5 mt-0.5">
                      {WEEKDAY_LABELS.map((label, index) => {
                        const active = alarm.days.includes(index);
                        return (
                          <button
                            key={label}
                            type="button"
                            onClick={() => toggleAlarmDay(alarm, index)}
                            className="px-1 h-4 rounded text-[9px] font-bold transition-colors"
                            style={{
                              backgroundColor: active ? 'rgba(255,255,255,0.16)' : 'transparent',
                              color: active ? theme.text : theme.subtext,
                              opacity: active ? 1 : 0.5,
                            }}
                            title={`${active ? 'Убрать' : 'Добавить'} ${label}`}
                            aria-pressed={active}
                          >
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  )}
                  {alarm.note !== undefined && noteEditingId !== alarm.id && (
                    <span className="text-[10px] opacity-70 truncate max-w-[180px] block" style={{ color: theme.subtext }}>
                      {alarm.note}
                    </span>
                  )}
                  {noteEditingId === alarm.id && (
                    <input
                      type="text"
                      autoFocus
                      defaultValue={alarm.note ?? ''}
                      placeholder="Описание к будильнику..."
                      onBlur={(e) => {
                        // Escape already cancelled: the blur that follows would
                        // otherwise save the text the user just abandoned.
                        if (e.currentTarget.dataset.cancelled === 'true') {
                          setNoteEditingId(null);
                          return;
                        }
                        setAlarmNote(alarm.id, e.target.value);
                        setNoteEditingId(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur();
                        if (e.key === 'Escape') {
                          e.currentTarget.dataset.cancelled = 'true';
                          e.currentTarget.blur();
                        }
                      }}
                      className="mt-0.5 text-[10px] bg-black/40 px-1.5 py-1 rounded border border-white/10 focus:outline-none"
                      style={{ color: theme.text }}
                      aria-label="Описание будильника"
                    />
                  )}
                  <span className="text-[10px] opacity-60">
                    {alarm.repeat === 'once' ? 'Один раз' : alarm.repeat === 'daily' ? 'Каждый день' : alarm.days.map((d) => WEEKDAY_LABELS[d]).join(', ')}
                  </span>
                  {alarm.voicePrompt && (
                    <span className="text-[10px] opacity-60 flex items-center space-x-1 truncate max-w-[180px]">
                      <Volume2 size={10} className="shrink-0" />
                      <span className="truncate">{alarm.voicePrompt}</span>
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center space-x-1">
                <button
                  onClick={() => setNoteEditingId(noteEditingId === alarm.id ? null : alarm.id)}
                  disabled={isDerived(alarm)}
                  title={isDerived(alarm)
                    ? 'Описание задаётся в шаге программы'
                    : alarm.note ? 'Показать описание' : 'Добавить описание'}
                  className="p-1.5 rounded-lg hover:bg-white/10 transition-colors"
                  style={{ color: alarm.note ? theme.accent : theme.subtext, opacity: alarm.note ? 1 : 0.6 }}
                >
                  <StickyNote size={14} />
                </button>
                <button
                  onClick={() => soundService.speak(alarm.voicePrompt || alarm.label || alarm.title)}
                  title="Прослушать голос"
                  className="p-1.5 rounded-lg hover:bg-white/10 opacity-60 hover:opacity-100"
                >
                  <Volume2 size={14} />
                </button>
                <button
                  onClick={() => deleteAlarm(alarm.id)}
                  title="Удалить"
                  className="p-1.5 rounded-lg hover:bg-red-500/20 text-red-400 opacity-60 hover:opacity-100 transition-colors"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
};
