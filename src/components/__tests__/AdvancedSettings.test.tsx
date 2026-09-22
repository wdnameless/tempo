import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_SPEECH_CONFIG, type SpeechConfig } from '../../services/speechSettings';
import * as stt from '../../services/stt';
import { AdvancedSettings } from '../speech/AdvancedSettings';
import { SpeechPanel } from '../speech/SpeechPanel';

vi.mock('../../services/stt', () => ({
  accelerators: vi.fn(),
  listModels: vi.fn().mockResolvedValue([]),
  downloadModel: vi.fn().mockResolvedValue(undefined),
  cancelDownload: vi.fn().mockResolvedValue(undefined),
  downloadProgress: vi.fn().mockResolvedValue([]),
  deleteModel: vi.fn().mockResolvedValue(undefined),
  rescanModels: vi.fn().mockResolvedValue([]),
  importModel: vi.fn(),
  modelsDir: vi.fn().mockResolvedValue('/mock/models'),
  openModelsDir: vi.fn().mockResolvedValue(undefined),
  freeDiskSpace: vi.fn().mockResolvedValue(1000000000),
  getEngine: vi.fn().mockResolvedValue({ engine: 'local', model_id: null, available: true }),
  setEngine: vi.fn().mockResolvedValue(undefined),
  startDictation: vi.fn().mockResolvedValue(undefined),
  stopDictation: vi.fn().mockResolvedValue({ text: '', duration_ms: 0, engine: 'local' }),
  cancelDictation: vi.fn().mockResolvedValue(undefined),
  dictationState: vi.fn().mockResolvedValue({ recording: false, level: 0, since: null }),
  transcribeFile: vi.fn(),
  getSpeechConfig: vi.fn(),
  applySpeechConfig: vi.fn(),
  validateHotkey: vi.fn().mockResolvedValue(undefined),
  suspendShortcuts: vi.fn().mockResolvedValue(undefined),
  resumeShortcuts: vi.fn().mockResolvedValue(undefined),
  inputDevices: vi.fn().mockResolvedValue([]),
  inputChannels: vi.fn().mockResolvedValue(1),
  outputDevices: vi.fn().mockResolvedValue([]),
  playTestSound: vi.fn().mockResolvedValue(undefined),
  micLevel: vi.fn().mockResolvedValue(0),
  historyList: vi.fn().mockResolvedValue([]),
  historyDelete: vi.fn().mockResolvedValue(undefined),
  historySetSaved: vi.fn().mockResolvedValue(undefined),
  historyRetry: vi.fn(),
  historyClear: vi.fn().mockResolvedValue(undefined),
  postprocessText: vi.fn(),
  sttErrorKey: vi.fn((code: string) => code),
}));

vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(() => () => {}),
}));

describe('AdvancedSettings', () => {
  const mockGpuDevice: stt.AcceleratorInfo = {
    id: 'cuda:0',
    name: 'NVIDIA GeForce RTX 3060',
    kind: 'cuda',
    deviceType: 'gpu',
    memoryTotal: 12 * 1024 * 1024 * 1024,
    memoryFree: 8 * 1024 * 1024 * 1024,
    isCpu: false,
  };

  const mockCpuDevice: stt.AcceleratorInfo = {
    id: 'cpu',
    name: 'AMD Ryzen 5',
    kind: 'cpu',
    deviceType: 'cpu',
    memoryTotal: 16 * 1024 * 1024 * 1024,
    memoryFree: 8 * 1024 * 1024 * 1024,
    isCpu: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stt.accelerators).mockResolvedValue([mockGpuDevice, mockCpuDevice]);
  });

  it('renders with a mocked accelerators() response and asserts device list content', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      accelerator: 'auto',
      gpuDevice: null,
      modelUnloadSecs: 60,
    };
    const onChange = vi.fn();

    render(<AdvancedSettings config={config} onChange={onChange} />);

    expect(screen.getByTestId('advanced-settings')).toBeDefined();

    await waitFor(() => {
      const select = screen.getByTestId('speech-accelerator-select') as HTMLSelectElement;
      expect(select.options.length).toBe(3);
    });

    const select = screen.getByTestId('speech-accelerator-select') as HTMLSelectElement;
    expect(select.options[0].value).toBe('auto');
    expect(select.options[1].value).toBe('gpu:cuda:0');
    expect(select.options[1].text).toContain('NVIDIA GeForce RTX 3060');
    expect(select.options[1].text).toContain('8.0 GB free');
    expect(select.options[2].value).toBe('cpu');
  });

  it('emits exact onChange patches ({accelerator:"cpu"}, {gpuDevice:"<id>"}/{accelerator:"gpu"}, {modelUnloadSecs:300}) on interaction', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      accelerator: 'auto',
      gpuDevice: null,
      modelUnloadSecs: 60,
    };
    const onChange = vi.fn();

    render(<AdvancedSettings config={config} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('speech-accelerator-select')).toBeDefined();
    });

    const select = screen.getByTestId('speech-accelerator-select');

    // 1. Select CPU -> exact patch { accelerator: 'cpu' }
    fireEvent.change(select, { target: { value: 'cpu' } });
    expect(onChange).toHaveBeenCalledWith({ accelerator: 'cpu' });

    // 2. Select GPU device -> exact patch { accelerator: 'gpu', gpuDevice: 'cuda:0' }
    fireEvent.change(select, { target: { value: 'gpu:cuda:0' } });
    expect(onChange).toHaveBeenCalledWith({ accelerator: 'gpu', gpuDevice: 'cuda:0' });

    // 3. Select 5 min unload timeout -> exact patch { modelUnloadSecs: 300 }
    const segmentedContainer = screen.getByTestId('speech-model-unload-segmented');
    const buttons = segmentedContainer.querySelectorAll('button');
    // Options: 0 (Never), 120 (2 min), 300 (5 min), 600 (10 min), 900 (15 min)
    const min5Button = Array.from(buttons).find((b) => b.textContent?.includes('5'));
    expect(min5Button).toBeDefined();
    fireEvent.click(min5Button!);
    expect(onChange).toHaveBeenCalledWith({ modelUnloadSecs: 300 });
  });

  it('survives a mocked empty device list and displays no-GPU hint', async () => {
    vi.mocked(stt.accelerators).mockResolvedValue([]);
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      accelerator: 'auto',
      gpuDevice: null,
    };
    const onChange = vi.fn();

    render(<AdvancedSettings config={config} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('speech-no-gpu-hint')).toBeDefined();
    });

    const select = screen.getByTestId('speech-accelerator-select') as HTMLSelectElement;
    expect(select.options.length).toBe(2);
    expect(select.options[0].value).toBe('auto');
    expect(select.options[1].value).toBe('cpu');
  });

  it('survives a missing device without crashing, falls back to auto, and warns without writing', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      accelerator: 'gpu',
      gpuDevice: 'non-existent-device-id',
    };
    const onChange = vi.fn();

    render(<AdvancedSettings config={config} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('speech-accelerator-missing')).toBeDefined();
    });

    const select = screen.getByTestId('speech-accelerator-select') as HTMLSelectElement;
    // Display value falls back to 'auto'
    expect(select.value).toBe('auto');

    // Does NOT write another value silently
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('SpeechPanel Advanced Tab Integration', () => {
  it('renders the advanced sub-tab and shows AdvancedSettings on click', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      onboarded: true,
    };
    const onChange = vi.fn();

    render(<SpeechPanel config={config} onChange={onChange} />);

    const advancedTabBtn = screen.getByTestId('speech-tab-advanced');
    expect(advancedTabBtn).toBeDefined();

    fireEvent.click(advancedTabBtn);

    await waitFor(() => {
      expect(screen.getByTestId('speech-panel-advanced')).toBeDefined();
      expect(screen.getByTestId('advanced-settings')).toBeDefined();
    });
  });
});
