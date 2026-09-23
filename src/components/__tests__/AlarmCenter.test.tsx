import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import type { AlarmItem } from '../../types';

/**
 * Handlers registered through the Tauri event bridge, so a test can deliver an
 * `alarm://fired` event the way the Rust scheduler does.
 */
const listeners = new Map<string, (event: { payload: unknown }) => void>();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (event: string, handler: (e: { payload: unknown }) => void) => {
    listeners.set(event, handler);
    return Promise.resolve(() => listeners.delete(event));
  },
}));

const invokeMock = vi.fn((cmd: string, args?: Record<string, unknown>) =>
  Promise.resolve<void>(undefined).then(() => ({ cmd, args })),
);
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (cmd: string, args?: Record<string, unknown>) => invokeMock(cmd, args),
}));

vi.mock('../services/sound', () => ({
  soundService: {
    startAlarmRamp: vi.fn(),
    stopAlarmRamp: vi.fn(),
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    stopSpeaking: vi.fn(),
  },
}));


import { AlarmCenter } from '../AlarmCenter';

const alarm: AlarmItem = {
  id: 'a1',
  title: 'Подъём',
  label: 'Подъём',
  time: '07:00',
  days: [1, 2, 3, 4, 5],
  repeat: 'days',
  enabled: true,
  sound: 'gentle',
  voicePrompt: 'Доброе утро!',
};

const theme = {
  id: 'winter' as const,
  name: 'Winter',
  bg: '#050505',
  surface: '#0a0a0a',
  cardBg: '#0f0f0f',
  border: '#27272a',
  text: '#fafafa',
  subtext: '#a1a1aa',
  accent: '#ff7a1a',
  accentGlow: 'rgba(255,122,26,0.28)',
  ringTrack: '#1c1c1f',
  ringProgress: '#ff7a1a',
  ticks: '#3f3f46',
};

/** Delivers a fire event exactly as `scheduler.rs` emits it. */
async function fireAlarm(overrides: Partial<Record<string, unknown>> = {}) {
  await act(async () => {
    listeners.get('alarm://fired')?.({
      payload: {
        id: 'a1',
        label: 'Подъём',
        time: '07:00',
        voice_prompt: 'Доброе утро!',
        snoozed_for: 0,
        late_by_minutes: 0,
        consumed: false,
        ...overrides,
      },
    });
  });
}

describe('AlarmCenter', () => {
  beforeEach(() => {
    listeners.clear();
    invokeMock.mockClear();
    cleanup();
  });

  it('pushes the effective schedule to the backend', async () => {
    render(
      <AlarmCenter theme={theme} firings={[alarm]} alarmVolume={0.8} alarmEnabled missed={[]} onDismissMissed={() => {}} hydrated>
        <div />
      </AlarmCenter>,
    );

    const syncCall = invokeMock.mock.calls.find(([cmd]) => cmd === 'sync_alarms');
    expect(syncCall).toBeDefined();
    const payload = syncCall?.[1] as { alarms: Array<Record<string, unknown>> } | undefined;
    expect(payload?.alarms[0]).toMatchObject({ id: 'a1', time: '07:00', repeat: 'days' });
  });

  it('shows the ringing takeover whichever screen is mounted underneath', async () => {
    // Regression: ringing used to live inside the Alarms sub-tab, so an alarm
    // that fired while the user was on any other screen made no sound and no
    // visible takeover. Children here stand in for that other screen.
    render(
      <AlarmCenter theme={theme} firings={[alarm]} alarmVolume={0.8} alarmEnabled missed={[]} onDismissMissed={() => {}} hydrated>
        <div data-testid="other-screen">Сегодня</div>
      </AlarmCenter>,
    );

    expect(screen.queryByText('Остановить')).toBeNull();
    await fireAlarm();

    expect(screen.getByText('Остановить')).toBeDefined();
    expect(screen.getByText('07:00')).toBeDefined();
    // The underlying screen stays mounted; ringing is an overlay, not a swap.
    expect(screen.getByTestId('other-screen')).toBeDefined();
  });

  it('tells the backend to dismiss and closes the takeover on Stop', async () => {
    render(
      <AlarmCenter theme={theme} firings={[alarm]} alarmVolume={0.8} alarmEnabled missed={[]} onDismissMissed={() => {}} hydrated>
        <div />
      </AlarmCenter>,
    );
    await fireAlarm();

    act(() => {
      screen.getByText('Остановить').click();
    });

    expect(invokeMock).toHaveBeenCalledWith('dismiss_alarm', { id: 'a1' });
    expect(screen.queryByText('Остановить')).toBeNull();
  });

  it('snoozes for the chosen number of minutes', async () => {
    render(
      <AlarmCenter theme={theme} firings={[alarm]} alarmVolume={0.8} alarmEnabled missed={[]} onDismissMissed={() => {}} hydrated>
        <div />
      </AlarmCenter>,
    );
    await fireAlarm();

    act(() => {
      screen.getByText('+10 мин').click();
    });

    expect(invokeMock).toHaveBeenCalledWith('snooze_alarm', { id: 'a1', minutes: 10 });
    expect(screen.queryByText('Остановить')).toBeNull();
  });

  it('mirrors a consumed one-shot alarm as switched off', async () => {
    const onDisable = vi.fn();
    render(
      <AlarmCenter theme={theme} firings={[alarm]} alarmVolume={0.8} alarmEnabled missed={[]} onDismissMissed={() => {}} hydrated onDisableAlarm={onDisable}>
        <div />
      </AlarmCenter>,
    );

    await fireAlarm({ consumed: true });

    expect(onDisable).toHaveBeenCalledWith('a1');
  });


  it('silences the backend ringer before the webview starts its own', async () => {
    // Regression: the backend rings only while the window is hidden, then
    // reveals it — at which point this listener fires and played a second copy
    // of the alarm over the first.
    render(
      <AlarmCenter theme={theme} firings={[alarm]} alarmVolume={0.8} alarmEnabled missed={[]} onDismissMissed={() => {}} hydrated>
        <div />
      </AlarmCenter>,
    );

    await fireAlarm();

    expect(invokeMock).toHaveBeenCalledWith('stop_alarm_sound', undefined);
  });

  it('shows alarms that were missed instead of hiding them', async () => {
    const missed = [
      { id: 'a9', label: 'Тренировка', time: '07:15', late_by_minutes: 90 },
    ];

    render(
      <AlarmCenter
        theme={theme}
        firings={[]}
        alarmVolume={0.8}
        alarmEnabled
        missed={missed}
        onDismissMissed={() => {}}
        hydrated
      >
        <div />
      </AlarmCenter>,
    );

    expect(screen.getByText('Пропущено сегодня: 1')).toBeDefined();
    expect(screen.getByText(/07:15 · Тренировка · на 1 ч 30 мин позже/)).toBeDefined();
  });

  it('lets the missed list be acknowledged', async () => {
    const onDismiss = vi.fn();
    render(
      <AlarmCenter
        theme={theme}
        firings={[]}
        alarmVolume={0.8}
        alarmEnabled
        missed={[{ id: 'a9', label: 'X', time: '07:15', late_by_minutes: 30 }]}
        onDismissMissed={onDismiss}
        hydrated
      >
        <div />
      </AlarmCenter>,
    );

    act(() => {
      screen.getByLabelText('Скрыть список пропущенных').click();
    });

    expect(onDismiss).toHaveBeenCalled();
  });

  it('keeps the missed banner out of the way while an alarm is ringing', async () => {
    render(
      <AlarmCenter
        theme={theme}
        firings={[alarm]}
        alarmVolume={0.8}
        alarmEnabled
        missed={[{ id: 'a9', label: 'X', time: '07:15', late_by_minutes: 30 }]}
        onDismissMissed={() => {}}
        hydrated
      >
        <div />
      </AlarmCenter>,
    );

    await fireAlarm();

    // The takeover owns the screen; a second notice on top of it is noise.
    expect(screen.queryByText('Пропущено сегодня: 1')).toBeNull();
  });
});
