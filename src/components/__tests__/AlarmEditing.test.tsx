import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { AlarmItem } from '../../types';
import { Alarms } from '../Alarms';
import { I18nService } from '../../services/i18n';

vi.mock('../../services/sound', () => ({
  soundService: {
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    playBeep: vi.fn(),
    startAlarmRamp: vi.fn(),
    stopAlarmRamp: vi.fn(),
  },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: () => Promise.resolve(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: () => Promise.resolve(() => {}) }));

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

function Harness({ initial = [] as AlarmItem[] }) {
  const [alarms, setAlarms] = useState(initial);
  return (
    <Alarms
      theme={theme}
      alarms={alarms}
      onUpdateAlarms={setAlarms}
      dynamicUi={undefined as never}
    />
  );
}

const weekdayAlarm: AlarmItem = {
  id: 'a1',
  title: 'Разминка',
  label: 'Разминка',
  time: '07:00',
  days: [1, 2, 3, 4, 5],
  repeat: 'days',
  enabled: true,
  sound: 'gentle',
};

describe('creating an alarm with specific weekdays', () => {
  beforeEach(cleanup);

  it('offers a chip for every weekday in the creation sheet', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('new-alarm-btn'));

    for (const label of ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']) {
      expect(screen.getByTitle(`Звонить в ${label}`)).toBeDefined();
    }
  });

  it('defaults to the working week in the creation sheet', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('new-alarm-btn'));

    // Mon–Fri on, weekend off — the common case, but now changeable.
    expect(screen.getByTitle('Звонить в Пн').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTitle('Звонить в Сб').getAttribute('aria-pressed')).toBe('false');
  });

  it('creates an alarm on the days the user picked', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByTestId('new-alarm-btn'));

    // Pick a weekend-only alarm: Sat and Sun on, the working week off.
    act(() => {
      screen.getByTitle('Звонить в Сб').click();
      screen.getByTitle('Звонить в Вс').click();
      for (const day of ['Пн', 'Вт', 'Ср', 'Чт', 'Пт']) {
        screen.getByTitle(`Звонить в ${day}`).click();
      }
    });
    const t = I18nService.t();
    fireEvent.change(screen.getByPlaceholderText(t.alarmsLabelPlaceholder), {
      target: { value: 'Выходной' },
    });
    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest).toHaveLength(1);
    expect(latest[0].days).toEqual([0, 6]);
    expect(latest[0].repeat).toBe('days');
  });
});

describe('editing an existing alarm', () => {
  beforeEach(cleanup);

  it('changes the time in the modal sheet instead of forcing a re-create', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([weekdayAlarm]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    const t = I18nService.t();
    const field = screen.getByLabelText(t.alarmsTime) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '06:30' } });

    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest[0].time).toBe('06:30');
  });

  it('rejects a malformed time', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([weekdayAlarm]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    const t = I18nService.t();
    const field = screen.getByLabelText(t.alarmsTime) as HTMLInputElement;
    fireEvent.change(field, { target: { value: '07:00' } });

    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest[0].time).toBe('07:00');
  });

  it('toggles a weekday on an existing alarm', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([weekdayAlarm]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    act(() => {
      screen.getByTitle('Звонить в Сб').click();
    });

    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest[0].days).toContain(6);
    expect(latest[0].days).toContain(1);
  });

  it('writes a description shown on the ringing takeover', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([weekdayAlarm]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    const t = I18nService.t();
    const field = screen.getByLabelText(t.alarmsNote) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Выпить воду' } });

    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest[0].note).toBe('Выпить воду');
  });
});

describe('an alarm that could never ring', () => {
  beforeEach(cleanup);

  it('refuses to remove the last remaining weekday in the create form', () => {
    render(<Harness />);

    fireEvent.click(screen.getByTestId('new-alarm-btn'));

    // Start from weekdays only, then remove all but Monday.
    for (const day of ['Вт', 'Ср', 'Чт', 'Пт']) {
      act(() => {
        screen.getByTitle(`Звонить в ${day}`).click();
      });
    }
    expect(screen.getByTitle('Звонить в Пн').getAttribute('aria-pressed')).toBe('true');

    // The last one stays on.
    act(() => {
      screen.getByTitle('Звонить в Пн').click();
    });
    expect(screen.getByTitle('Звонить в Пн').getAttribute('aria-pressed')).toBe('true');
  });

  it('refuses to remove the last remaining weekday on an existing alarm', () => {
    let latest: AlarmItem[] = [];
    const mondayOnly: AlarmItem = { ...weekdayAlarm, days: [1] };

    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([mondayOnly]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    act(() => {
      screen.getByTitle('Звонить в Пн').click();
    });

    // Still armed on Monday rather than silently dead.
    expect(screen.getByTitle('Звонить в Пн').getAttribute('aria-pressed')).toBe('true');

    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest[0].days).toEqual([1]);
  });

  it('still allows removing a day when others remain', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([weekdayAlarm]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    act(() => {
      screen.getByTitle('Звонить в Пт').click();
    });

    expect(screen.getByTitle('Звонить в Пт').getAttribute('aria-pressed')).toBe('false');

    act(() => {
      screen.getByTitle('Добавить будильник').click();
    });

    expect(latest[0].days).toEqual([1, 2, 3, 4]);
  });

  it('cancels a description edit on Escape instead of saving it', () => {
    let latest: AlarmItem[] = [];
    function Capture() {
      const [alarms, setAlarms] = useState<AlarmItem[]>([weekdayAlarm]);
      useEffect(() => {
        latest = alarms;
      }, [alarms]);
      return (
        <Alarms
          theme={theme}
          alarms={alarms}
          onUpdateAlarms={setAlarms}
          dynamicUi={undefined as never}
        />
      );
    }

    render(<Capture />);

    fireEvent.click(screen.getByLabelText('Редактировать Разминка'));

    const t = I18nService.t();
    const field = screen.getByLabelText(t.alarmsNote) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'Случайно набрано' } });

    fireEvent.keyDown(window, { key: 'Escape' });

    expect(screen.queryByTestId('alarm-editor-sheet')).toBeNull();
    expect(latest[0].note).toBeUndefined();
  });
});

describe('rows derived from a program', () => {
  beforeEach(cleanup);

  const derived: AlarmItem = { ...weekdayAlarm, id: 'sched:s1:st1', scheduleId: 's1' };

  function renderDerived() {
    return render(
      <Alarms
        theme={theme}
        alarms={[derived]}
        onUpdateAlarms={() => {}}
        dynamicUi={undefined as never}
      />,
    );
  }

  it('does not let the time be edited on a derived row', () => {
    renderDerived();

    const editBtn = screen.getByLabelText('Редактировать Разминка');
    expect(editBtn.hasAttribute('disabled')).toBe(true);

    fireEvent.click(screen.getByText('Разминка'));
    expect(screen.queryByTestId('alarm-editor-sheet')).toBeNull();
  });

  it('does not offer a note button on a derived row', () => {
    renderDerived();

    expect(screen.getByTitle('Редактируется в шаге программы').hasAttribute('disabled')).toBe(true);
  });

  it('does not let the day chips be toggled on a derived row', () => {
    renderDerived();

    // No per-row day chips on the main screen: weekdays are inside the modal.
    expect(screen.queryByTitle('Звонить в Сб')).toBeNull();
  });

  it('lets a derived row step be removed and keeps toggle tied to program', () => {
    renderDerived();

    expect(screen.getByTitle('Удалить').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTitle('Включается вместе с программой').hasAttribute('disabled')).toBe(true);
  });
});
