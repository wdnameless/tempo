import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AIScheduleIntake } from '../AIScheduleIntake';
import * as alarmsService from '../../services/alarms';
import { AIGateway } from '../../services/aiGateway';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn().mockResolvedValue(() => {}) }));

vi.mock('../../services/aiGateway', () => ({
  AIGateway: {
    hasKey: vi.fn().mockResolvedValue(false),
    generateCompletion: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  },
}));

vi.mock('../../services/store', () => ({
  StoreService: {
    isHydrated: vi.fn().mockReturnValue(false),
    snapshot: vi.fn().mockReturnValue(null),
    getPreference: vi.fn().mockReturnValue(null),
    setPreference: vi.fn(),
  },
}));

describe('AIScheduleIntake (Slice B: alarms-ai-schedule)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(AIGateway.hasKey).mockResolvedValue(false);
  });

  it('renders intake textarea and submit button', () => {
    render(<AIScheduleIntake />);
    expect(screen.getByTestId('ai-schedule-intake')).toBeDefined();
    expect(screen.getByTestId('ai-schedule-input')).toBeDefined();
    expect(screen.getByTestId('ai-schedule-submit-btn')).toBeDefined();
  });

  it('shows error if submitted with empty or whitespace-only text', async () => {
    render(<AIScheduleIntake />);
    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, { target: { value: '   ' } });

    // Submit button should be disabled when empty/whitespace
    const btn = screen.getByTestId('ai-schedule-submit-btn') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('parses RU workout schedule and displays editable draft preview card', async () => {
    render(<AIScheduleIntake />);
    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: '09:00 зарядка, 10:00 завтрак, 18:00 тренировка' },
    });

    const submitBtn = screen.getByTestId('ai-schedule-submit-btn');
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-drafts-card')).toBeDefined();
    });

    expect(screen.getByTestId('ai-schedule-draft-0')).toBeDefined();
    expect(screen.getByTestId('ai-schedule-draft-1')).toBeDefined();
    expect(screen.getByTestId('ai-schedule-draft-2')).toBeDefined();

    const time0 = screen.getByTestId('draft-time-0') as HTMLInputElement;
    const label0 = screen.getByTestId('draft-label-0') as HTMLInputElement;
    expect(time0.value).toBe('09:00');
    expect(label0.value).toBe('Зарядка');

    const time1 = screen.getByTestId('draft-time-1') as HTMLInputElement;
    const label1 = screen.getByTestId('draft-label-1') as HTMLInputElement;
    expect(time1.value).toBe('10:00');
    expect(label1.value).toBe('Завтрак');

    const time2 = screen.getByTestId('draft-time-2') as HTMLInputElement;
    const label2 = screen.getByTestId('draft-label-2') as HTMLInputElement;
    expect(time2.value).toBe('18:00');
    expect(label2.value).toBe('Тренировка');
  });

  it('shows offline parser notice when no BYOK key is stored', async () => {
    vi.mocked(AIGateway.hasKey).mockResolvedValue(false);
    render(<AIScheduleIntake />);
    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: '09:00 зарядка, 10:00 завтрак' },
    });

    fireEvent.click(screen.getByTestId('ai-schedule-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-offline-notice')).toBeDefined();
    });
    expect(screen.getByTestId('ai-schedule-offline-notice').textContent).toContain('офлайн-парсера');
  });

  it('parses interval reminder «пить воду каждый час с 9 до 18» into repeat=interval draft', async () => {
    render(<AIScheduleIntake />);
    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: 'пить воду каждый час с 9 до 18' },
    });

    fireEvent.click(screen.getByTestId('ai-schedule-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-drafts-card')).toBeDefined();
    });

    const timeInput = screen.getByTestId('draft-time-0') as HTMLInputElement;
    const labelInput = screen.getByTestId('draft-label-0') as HTMLInputElement;
    const repeatSelect = screen.getByTestId('draft-repeat-0') as HTMLSelectElement;
    const intervalInput = screen.getByTestId('draft-interval-0') as HTMLInputElement;

    expect(timeInput.value).toBe('09:00');
    expect(labelInput.value).toBe('Пить воду');
    expect(repeatSelect.value).toBe('interval');
    expect(intervalInput.value).toBe('60');
  });

  it('flow: intake -> edit draft -> apply creates exactly confirmed alarms and calls onApplied', async () => {
    const applySpy = vi.spyOn(alarmsService, 'applyAlarms').mockImplementation(async (a) => a);
    const onApplied = vi.fn();

    render(<AIScheduleIntake onApplied={onApplied} />);

    // 1. Enter text and parse
    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: '09:00 зарядка, 10:00 завтрак' },
    });
    fireEvent.click(screen.getByTestId('ai-schedule-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-drafts-card')).toBeDefined();
    });

    // 2. Edit draft 0: change time to 08:30 and label to "Утренняя разминка"
    const time0 = screen.getByTestId('draft-time-0');
    const label0 = screen.getByTestId('draft-label-0');
    fireEvent.change(time0, { target: { value: '08:30' } });
    fireEvent.change(label0, { target: { value: 'Утренняя разминка' } });

    // 3. Confirm and Apply
    const applyBtn = screen.getByTestId('ai-schedule-apply-btn');
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(applySpy).toHaveBeenCalledTimes(1);
    });

    const passedAlarms = applySpy.mock.calls[0][0];
    expect(passedAlarms).toHaveLength(2);
    expect(passedAlarms[0]).toEqual(
      expect.objectContaining({
        label: 'Утренняя разминка',
        time: '08:30',
        repeat: 'once',
        enabled: true,
      }),
    );
    expect(passedAlarms[1]).toEqual(
      expect.objectContaining({
        label: 'Завтрак',
        time: '10:00',
        repeat: 'once',
        enabled: true,
      }),
    );

    expect(onApplied).toHaveBeenCalledWith(2);

    // Draft card should be dismissed
    await waitFor(() => {
      expect(screen.queryByTestId('ai-schedule-drafts-card')).toBeNull();
    });
  });

  it('cancel discards drafts and creates NO alarms', async () => {
    const applySpy = vi.spyOn(alarmsService, 'applyAlarms');
    const onApplied = vi.fn();

    render(<AIScheduleIntake onApplied={onApplied} />);

    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: '09:00 зарядка, 10:00 завтрак' },
    });
    fireEvent.click(screen.getByTestId('ai-schedule-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-drafts-card')).toBeDefined();
    });

    const cancelBtn = screen.getByTestId('ai-schedule-cancel-btn');
    fireEvent.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByTestId('ai-schedule-drafts-card')).toBeNull();
    });

    // Zero alarms created
    expect(applySpy).not.toHaveBeenCalled();
    expect(onApplied).not.toHaveBeenCalled();
  });

  it('allows deleting an individual draft before applying', async () => {
    const applySpy = vi.spyOn(alarmsService, 'applyAlarms').mockImplementation(async (a) => a);
    const onApplied = vi.fn();

    render(<AIScheduleIntake onApplied={onApplied} />);

    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: '09:00 зарядка, 10:00 завтрак, 18:00 тренировка' },
    });
    fireEvent.click(screen.getByTestId('ai-schedule-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-drafts-card')).toBeDefined();
    });

    // Delete draft 1 ("Завтрак")
    const deleteBtn1 = screen.getByTestId('draft-delete-1');
    fireEvent.click(deleteBtn1);

    await waitFor(() => {
      expect(screen.queryByTestId('ai-schedule-draft-2')).toBeNull();
    });

    // Now only 2 drafts remain: Зарядка (09:00) and Тренировка (18:00)
    const applyBtn = screen.getByTestId('ai-schedule-apply-btn');
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(applySpy).toHaveBeenCalledTimes(1);
    });

    const passedAlarms = applySpy.mock.calls[0][0];
    expect(passedAlarms).toHaveLength(2);
    expect(passedAlarms.map((a) => a.label)).toEqual(['Зарядка', 'Тренировка']);
    expect(onApplied).toHaveBeenCalledWith(2);
  });

  it('displays error if schedule text has no recognizable times or tasks', async () => {
    render(<AIScheduleIntake />);
    const input = screen.getByTestId('ai-schedule-input');
    fireEvent.change(input, {
      target: { value: 'просто бессмысленный текст без времени и задач' },
    });
    fireEvent.click(screen.getByTestId('ai-schedule-submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('ai-schedule-error')).toBeDefined();
    });
    expect(screen.queryByTestId('ai-schedule-drafts-card')).toBeNull();
  });
});
