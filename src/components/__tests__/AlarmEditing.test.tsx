import { describe, expect, it, beforeEach, vi } from 'vitest';
import { render, screen, act, cleanup, fireEvent } from '@testing-library/react';
import { useEffect, useState } from 'react';
import type { AlarmItem } from '../../types';
import { Alarms } from '../Alarms';
import { I18nService } from '../../services/i18n';

/**
 * Alarms had no way to pick weekdays and no way to change one after creating it:
 * "days" always meant Mon–Fri, and fixing a typo meant deleting the alarm. Both
 * are the sort of thing a universal alarm clock is expected to do.
 */

vi.mock('../services/sound', () => ({
  soundService: {
    playUiClick: vi.fn(),
    playCountdownTick: vi.fn(),
    speak: vi.fn(),
    playBeep: vi.fn(),
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

  it('offers a chip for every weekday', () => {
    render(<Harness />);

    for (const label of ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб']) {
      expect(screen.getByTitle(`Звонить в ${label}`)).toBeDefined();
    }
  });

  it('defaults to the working week', () => {
    render(<Harness />);

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

  it('changes the time in place instead of forcing a re-create', () => {
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

    const field = screen.getByLabelText('Время будильника Разминка') as HTMLInputElement;
    field.value = '06:30';
    fireEvent.blur(field);

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

    const field = screen.getByLabelText('Время будильника Разминка') as HTMLInputElement;
    field.value = 'скоро';
    fireEvent.blur(field);

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

    act(() => {
      screen.getByTitle('Добавить Сб').click();
    });

    expect(latest[0].days).toContain(6);
    // Adding a day must not silently drop the others.
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

    act(() => {
      screen.getByTitle('Добавить описание').click();
    });
    const field = screen.getByLabelText('Описание будильника') as HTMLInputElement;
    field.value = 'Выпить воду';
    fireEvent.blur(field);

    expect(latest[0].note).toBe('Выпить воду');
  });
});

describe('an alarm that could never ring', () => {
  beforeEach(cleanup);

  /*
   * "days" mode with no days matches no weekday, so the alarm would sit in the
   * list labelled "Каждый день" and never fire — indistinguishable from a
   * working one until the morning it stays silent.
   */

  it('refuses to remove the last remaining weekday in the create form', () => {
    render(<Harness />);

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
    act(() => {
      screen.getByTitle('Убрать Пн').click();
    });

    // Still armed on Monday rather than silently dead.
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
    act(() => {
      screen.getByTitle('Убрать Пт').click();
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
    act(() => {
      screen.getByTitle('Добавить описание').click();
    });

    const field = screen.getByLabelText('Описание будильника') as HTMLInputElement;
    field.value = 'Случайно набрано';
    fireEvent.keyDown(field, { key: 'Escape' });
    // Escape blurs, and the blur that follows must not commit the abandoned text.
    fireEvent.blur(field);

    expect(latest[0].note).toBeUndefined();
  });
});

describe('rows derived from a program', () => {
  beforeEach(cleanup);

  // The list is built from schedules expanded into firings, and those firings
  // are recomputed on every render. Editing one writes to an object that is
  // thrown away, so the controls must be inert and say where to edit instead.
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

    const field = screen.getByLabelText('Время будильника Разминка') as HTMLInputElement;
    expect(field.readOnly).toBe(true);
  });

  it('does not offer a note button on a derived row', () => {
    renderDerived();

    expect(screen.getByTitle('Описание задаётся в шаге программы').hasAttribute('disabled')).toBe(true);
  });

  it('does not let the day chips be toggled on a derived row', () => {
    renderDerived();

    // No per-row day chips at all: the program owns the schedule.
    expect(screen.queryByTitle('Добавить Сб')).toBeNull();
  });

  it('lets a derived row step be removed and keeps toggle tied to program', () => {
    renderDerived();

    expect(screen.getByTitle('Удалить').hasAttribute('disabled')).toBe(false);
    expect(screen.getByTitle('Включается вместе с программой').hasAttribute('disabled')).toBe(true);
  });
});
