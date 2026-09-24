import { describe, expect, it, beforeEach, vi } from 'vitest';
import { useState } from 'react';
import { render, screen, act, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { AlarmItem } from '../../types';
import { Alarms } from '../Alarms';
import * as alarmsService from '../../services/alarms';

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

describe('Alarms Component Behavior', () => {
  beforeEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('renders the empty state when there are no alarms', () => {
    render(<Harness initial={[]} />);
    expect(screen.getByText('Нет будильников')).toBeDefined();
  });
  it('renders next firing from mocked previewAlarms', async () => {
    const sampleAlarm: AlarmItem = {
      id: 'alarm_1',
      title: 'Утренний подъем',
      label: 'Утренний подъем',
      time: '07:30',
      repeat: 'daily',
      days: [],
      enabled: true,
      sound: 'gentle',
    };

    vi.spyOn(alarmsService, 'previewAlarms').mockResolvedValue([
      {
        id: 'alarm_1',
        next: ['2026-09-22T07:30:00'],
        disabled: false,
      },
    ]);

    render(<Harness initial={[sampleAlarm]} />);

    await waitFor(() => {
      expect(screen.getAllByText(/07:30/).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Сегодня в 07:30|Завтра в 07:30|22\.09 в 07:30/)).toBeDefined();
    });
  });

  it('is list-first: no creation sheet visible by default until + New alarm is clicked', () => {
    render(<Harness initial={[]} />);
    expect(screen.queryByTestId('alarm-editor-sheet')).toBeNull();
    fireEvent.click(screen.getByTestId('new-alarm-btn'));
    expect(screen.getByTestId('alarm-editor-sheet')).toBeDefined();
    expect(screen.getByLabelText(/Время/i)).toBeDefined();
  });

  describe('creating each of the five repeat modes', () => {
    it('creates "once" repeat mode alarm and calls saveAlarm', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      // Open creation sheet
      fireEvent.click(screen.getByTestId('new-alarm-btn'));

      // Change time
      const timeInput = screen.getByLabelText(/Время/i) as HTMLInputElement;
      fireEvent.change(timeInput, { target: { value: '09:15' } });

      // Change label
      const labelInput = screen.getByPlaceholderText(/Например: Тренировка|Название будильника/i) as HTMLInputElement;
      fireEvent.change(labelInput, { target: { value: 'Встреча' } });

      // Select 'once' repeat
      const repeatSelect = screen.getByTitle('Как часто звонить') as HTMLSelectElement;
      fireEvent.change(repeatSelect, { target: { value: 'once' } });

      // Submit
      const submitBtn = screen.getByTitle('Добавить будильник');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.time).toBe('09:15');
      expect(saved.label).toBe('Встреча');
      expect(saved.repeat).toBe('once');
    });

    it('creates "daily" repeat mode alarm and calls saveAlarm', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      fireEvent.click(screen.getByTestId('new-alarm-btn'));

      const timeInput = screen.getByLabelText(/Время/i) as HTMLInputElement;
      fireEvent.change(timeInput, { target: { value: '06:45' } });

      const labelInput = screen.getByPlaceholderText(/Например: Тренировка|Название будильника/i) as HTMLInputElement;
      fireEvent.change(labelInput, { target: { value: 'Ежедневный подъем' } });

      const repeatSelect = screen.getByTitle('Как часто звонить') as HTMLSelectElement;
      fireEvent.change(repeatSelect, { target: { value: 'daily' } });

      const submitBtn = screen.getByTitle('Добавить будильник');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.time).toBe('06:45');
      expect(saved.label).toBe('Ежедневный подъем');
      expect(saved.repeat).toBe('daily');
    });

    it('creates "days" repeat mode alarm with picked weekdays', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      fireEvent.click(screen.getByTestId('new-alarm-btn'));

      const timeInput = screen.getByLabelText(/Время/i) as HTMLInputElement;
      fireEvent.change(timeInput, { target: { value: '08:00' } });

      const labelInput = screen.getByPlaceholderText(/Например: Тренировка|Название будильника/i) as HTMLInputElement;
      fireEvent.change(labelInput, { target: { value: 'Спорт' } });

      const repeatSelect = screen.getByTitle('Как часто звонить') as HTMLSelectElement;
      fireEvent.change(repeatSelect, { target: { value: 'days' } });

      // Pick Monday, Wednesday, Friday: toggle Tuesday and Thursday off
      fireEvent.click(screen.getByTitle('Звонить в Вт'));
      fireEvent.click(screen.getByTitle('Звонить в Чт'));

      const submitBtn = screen.getByTitle('Добавить будильник');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.time).toBe('08:00');
      expect(saved.label).toBe('Спорт');
      expect(saved.repeat).toBe('days');
      expect(saved.days).toEqual([1, 3, 5]);
    });

    it('creates "date" repeat mode alarm with specific date', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      fireEvent.click(screen.getByTestId('new-alarm-btn'));

      const timeInput = screen.getByLabelText(/Время/i) as HTMLInputElement;
      fireEvent.change(timeInput, { target: { value: '14:30' } });

      const labelInput = screen.getByPlaceholderText(/Например: Тренировка|Название будильника/i) as HTMLInputElement;
      fireEvent.change(labelInput, { target: { value: 'Прием врача' } });

      const repeatSelect = screen.getByTitle('Как часто звонить') as HTMLSelectElement;
      fireEvent.change(repeatSelect, { target: { value: 'date' } });

      const dateInput = screen.getByLabelText(/Дата/i) as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: '2026-10-15' } });

      const submitBtn = screen.getByTitle('Добавить будильник');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.time).toBe('14:30');
      expect(saved.label).toBe('Прием врача');
      expect(saved.repeat).toBe('date');
      expect(saved.date).toBe('2026-10-15');
    });

    it('creates "interval" repeat mode alarm with step and window', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      fireEvent.click(screen.getByTestId('new-alarm-btn'));

      const timeInput = screen.getByLabelText(/Время/i) as HTMLInputElement;
      fireEvent.change(timeInput, { target: { value: '10:00' } });

      const labelInput = screen.getByPlaceholderText(/Например: Тренировка|Название будильника/i) as HTMLInputElement;
      fireEvent.change(labelInput, { target: { value: 'Пить воду' } });

      const repeatSelect = screen.getByTitle('Как часто звонить') as HTMLSelectElement;
      fireEvent.change(repeatSelect, { target: { value: 'interval' } });

      const stepInput = screen.getByLabelText(/Каждые/i) as HTMLInputElement;
      fireEvent.change(stepInput, { target: { value: '45' } });

      const fromInput = screen.getByLabelText(/^С$/) as HTMLInputElement;
      fireEvent.change(fromInput, { target: { value: '09:00' } });

      const toInput = screen.getByLabelText(/^До$/) as HTMLInputElement;
      fireEvent.change(toInput, { target: { value: '18:00' } });

      const submitBtn = screen.getByTitle('Добавить будильник');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.label).toBe('Пить воду');
      expect(saved.repeat).toBe('interval');
      expect(saved.intervalMinutes).toBe(45);
      expect(saved.windowStart).toBe('09:00');
      expect(saved.windowEnd).toBe('18:00');
    });

    it('configures sound per alarm in the editor sheet', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      fireEvent.click(screen.getByTestId('new-alarm-btn'));

      const chimeBtn = screen.getByTestId('editor-profile-chime');
      fireEvent.click(chimeBtn);

      const submitBtn = screen.getByTitle('Добавить будильник');
      await act(async () => {
        fireEvent.click(submitBtn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      expect(saveSpy.mock.calls[0][0].sound).toBe('chime');
    });
  });

  describe('toggling and deleting alarms', () => {
    const existingAlarm: AlarmItem = {
      id: 'a1',
      title: 'Работа',
      label: 'Работа',
      time: '09:00',
      repeat: 'days',
      days: [1, 2, 3, 4, 5],
      enabled: true,
      sound: 'gentle',
    };

    it('calls toggleAlarm when switch is pressed', async () => {
      const toggleSpy = vi.spyOn(alarmsService, 'toggleAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[existingAlarm]} />);

      const toggleBtn = screen.getByTitle('Выключить будильник');
      await act(async () => {
        fireEvent.click(toggleBtn);
      });

      expect(toggleSpy).toHaveBeenCalledWith('a1', false);
    });

    it('calls deleteAlarm when delete button is pressed', async () => {
      const deleteSpy = vi.spyOn(alarmsService, 'deleteAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[existingAlarm]} />);

      const deleteBtn = screen.getByTitle('Удалить');
      await act(async () => {
        fireEvent.click(deleteBtn);
      });

      expect(deleteSpy).toHaveBeenCalledWith('a1');
    });
  });

  describe('quick action alarms creation', () => {
    it('creates "in 30 minutes" alarm on click', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      const btn = screen.getByTestId('quick-alarm-in-30');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.repeat).toBe('once');
    });

    it('creates "tomorrow at 8:00" alarm on click', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      const btn = screen.getByTestId('quick-alarm-tomorrow-8');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.time).toBe('08:00');
      expect(saved.repeat).toBe('once');
    });

    it('creates "daily at 7:30" alarm on click', async () => {
      const saveSpy = vi.spyOn(alarmsService, 'saveAlarm').mockResolvedValue(undefined);

      render(<Harness initial={[]} />);

      const btn = screen.getByTestId('quick-alarm-daily-730');
      await act(async () => {
        fireEvent.click(btn);
      });

      expect(saveSpy).toHaveBeenCalledTimes(1);
      const saved = saveSpy.mock.calls[0][0];
      expect(saved.time).toBe('07:30');
      expect(saved.repeat).toBe('daily');
    });
  });
});
