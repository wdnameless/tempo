import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RolloverSettings } from '../RolloverSettings';
import * as rolloverService from '../../services/rollover';
import { I18nService } from '../../services/i18n';

describe('RolloverSettings component', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('renders the toggle and shows timezone', () => {
    const t = I18nService.t();
    vi.spyOn(rolloverService, 'rolloverSettings').mockReturnValue({
      enabled: false,
      afterHour: 3,
    });
    vi.spyOn(rolloverService, 'localTimeZone').mockReturnValue('Europe/Paris (UTC+1)');

    render(<RolloverSettings />);

    expect(screen.getAllByText(t.rollover).length).toBeGreaterThan(0);
    expect(screen.getByText(t.rolloverHint)).toBeDefined();
    expect(screen.getByText(t.rolloverDisabledHint)).toBeDefined();
    expect(screen.getByText('Europe/Paris (UTC+1)')).toBeDefined();
  });

  it('shows slider and manual run button when enabled', () => {
    const t = I18nService.t();
    vi.spyOn(rolloverService, 'rolloverSettings').mockReturnValue({
      enabled: true,
      afterHour: 4,
    });
    vi.spyOn(rolloverService, 'localTimeZone').mockReturnValue('America/New_York (UTC-5)');

    render(<RolloverSettings />);

    expect(screen.getByText(t.rolloverAfter)).toBeDefined();
    expect(screen.getByText('04:00')).toBeDefined();
    expect(screen.getByText('Run now')).toBeDefined();
    expect(screen.queryByText(t.rolloverDisabledHint)).toBeNull();
  });

  it('toggles setting and calls setRolloverSettings', async () => {
    const setSettingsSpy = vi.spyOn(rolloverService, 'setRolloverSettings').mockResolvedValue();
    vi.spyOn(rolloverService, 'rolloverSettings').mockReturnValue({
      enabled: false,
      afterHour: 3,
    });

    render(<RolloverSettings />);

    const toggle = screen.getByRole('switch');
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(setSettingsSpy).toHaveBeenCalledWith({ enabled: true });
    });
  });

  it('executes manual run and displays results', async () => {
    vi.spyOn(rolloverService, 'rolloverSettings').mockReturnValue({
      enabled: true,
      afterHour: 3,
    });
    vi.spyOn(rolloverService, 'runRollover').mockResolvedValue({ moved: 2, cleared: 1 });

    render(<RolloverSettings />);

    const runBtn = screen.getByText('Run now');
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(screen.getByText(/Rollover: 2 moved, 1 slots cleared/)).toBeDefined();
    });
  });
});
