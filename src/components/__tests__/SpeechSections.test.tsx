import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { DEFAULT_SPEECH_CONFIG, type SpeechConfig } from '../../services/speechSettings';
import * as stt from '../../services/stt';
import { DeliverySettings } from '../speech/DeliverySettings';
import { LanguageSettings } from '../speech/LanguageSettings';
import { CustomWordsSettings } from '../speech/CustomWordsSettings';
import { HistoryPanel } from '../speech/HistoryPanel';
import { PostProcessSettings } from '../speech/PostProcessSettings';
import { SpeechDebug } from '../speech/SpeechDebug';
import { SpeechOnboarding } from '../speech/SpeechOnboarding';
import { HotkeyRecorder } from '../speech/HotkeyRecorder';
import { ModelLibrary } from '../speech/ModelLibrary';
import { I18nService } from '../../services/i18n';

vi.mock('../../services/stt', () => ({
  listModels: vi.fn(),
  downloadModel: vi.fn(),
  cancelDownload: vi.fn(),
  downloadProgress: vi.fn().mockResolvedValue([]),
  startDictation: vi.fn(),
  stopDictation: vi.fn(),
  cancelDictation: vi.fn(),
  modelsDir: vi.fn(),
  openModelsDir: vi.fn(),
  historyList: vi.fn(),
  historyDelete: vi.fn(),
  historySetSaved: vi.fn(),
  historyRetry: vi.fn(),
  historyClear: vi.fn(),
  postprocessText: vi.fn(),
  validateHotkey: vi.fn(),
  suspendShortcuts: vi.fn(),
  resumeShortcuts: vi.fn(),
  freeDiskSpace: vi.fn(),
  deleteModel: vi.fn(),
  loadModel: vi.fn(),
  importCustomModel: vi.fn(),
  setEngine: vi.fn(),
  rescanModels: vi.fn(),
  importModel: vi.fn(),
}));

vi.mock('../../services/sttEvents', () => ({
  onSttEvent: vi.fn(() => () => {}),
}));

describe('DeliverySettings', () => {
  it('renders initial options and emits patches on user interaction', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      pasteMethod: 'ctrl_v',
      clipboardBehavior: 'restore',
      pasteDelayMs: 60,
      pasteDelayAfterMs: 60,
      appendSpace: false,
      autoSubmit: false,
    };
    const onChange = vi.fn();

    render(<DeliverySettings config={config} onChange={onChange} />);

    expect(screen.getByTestId('delivery-settings')).toBeDefined();

    // Toggle appendSpace
    const appendSpaceToggle = screen.getByTestId('append-space-toggle').querySelector('button');
    expect(appendSpaceToggle).toBeDefined();
    fireEvent.click(appendSpaceToggle!);
    expect(onChange).toHaveBeenCalledWith({ appendSpace: true });

    // Toggle autoSubmit
    const autoSubmitToggle = screen.getByTestId('auto-submit-toggle').querySelector('button');
    expect(autoSubmitToggle).toBeDefined();
    fireEvent.click(autoSubmitToggle!);
    expect(onChange).toHaveBeenCalledWith({ autoSubmit: true });

    // Switch pasteMethod to direct
    const directOption = screen.getByRole('radio', { name: /Direct|Прямой/i });
    fireEvent.click(directOption);
    expect(onChange).toHaveBeenCalledWith({ pasteMethod: 'direct' });

    // Switch clipboardBehavior to keep
    const keepOption = screen.getByRole('radio', { name: /Keep|Оставлять/i });
    fireEvent.click(keepOption);
    expect(onChange).toHaveBeenCalledWith({ clipboardBehavior: 'keep' });
  });
});

describe('LanguageSettings', () => {
  it('renders recognition language picker and translate to English toggle', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      language: null,
      translateToEnglish: false,
    };
    const onChange = vi.fn();

    render(<LanguageSettings config={config} onChange={onChange} />);

    expect(screen.getByTestId('language-settings')).toBeDefined();

    // Select Russian
    const select = screen.getByTestId('language-select') as HTMLSelectElement;
    expect(select.value).toBe('auto');

    fireEvent.change(select, { target: { value: 'ru' } });
    expect(onChange).toHaveBeenCalledWith({ language: 'ru' });

    // Select auto again
    fireEvent.change(select, { target: { value: 'auto' } });
    expect(onChange).toHaveBeenCalledWith({ language: null });

    // Toggle translateToEnglish
    const toggle = screen.getByTestId('translate-to-english-toggle').querySelector('button');
    expect(toggle).toBeDefined();
    fireEvent.click(toggle!);
    expect(onChange).toHaveBeenCalledWith({ translateToEnglish: true });
  });
});

describe('CustomWordsSettings', () => {
  it('manages vocabulary list and filler-words toggle', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      customWords: ['Kubernetes', 'Tempo'],
      removeFillerWords: false,
    };
    const onChange = vi.fn();

    render(<CustomWordsSettings config={config} onChange={onChange} />);

    expect(screen.getByTestId('custom-words-settings')).toBeDefined();
    expect(screen.getByTestId('custom-word-chip-Kubernetes')).toBeDefined();
    expect(screen.getByTestId('custom-word-chip-Tempo')).toBeDefined();

    // Add a new word
    const input = screen.getByTestId('custom-word-input');
    fireEvent.change(input, { target: { value: 'Whisper' } });
    const addBtn = screen.getByTestId('custom-word-add-btn');
    fireEvent.click(addBtn);
    expect(onChange).toHaveBeenCalledWith({
      customWords: ['Kubernetes', 'Tempo', 'Whisper'],
    });

    // Remove a word
    const removeBtn = screen.getByTestId('custom-word-remove-Kubernetes');
    fireEvent.click(removeBtn);
    expect(onChange).toHaveBeenCalledWith({
      customWords: ['Tempo'],
    });

    // Toggle remove filler words
    const toggle = screen.getByTestId('remove-filler-words-toggle').querySelector('button');
    fireEvent.click(toggle!);
    expect(onChange).toHaveBeenCalledWith({ removeFillerWords: true });
  });
});

describe('HistoryPanel', () => {
  beforeEach(() => {
    vi.mocked(stt.historyList).mockResolvedValue([
      {
        id: 'hist-1',
        text: 'First dictation entry',
        createdAt: new Date().toISOString(),
        durationMs: 2500,
        modelId: 'whisper-small',
        saved: false,
      },
      {
        id: 'hist-2',
        text: 'Second dictation saved',
        createdAt: new Date().toISOString(),
        durationMs: 4000,
        modelId: 'whisper-small',
        saved: true,
      },
    ]);
  });

  it('fetches history on mount and provides search, copy, retry, save, delete', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      historyEnabled: true,
      historyLimit: 100,
      retentionDays: 30,
    };
    const onChange = vi.fn();

    // Mock clipboard API
    const writeTextMock = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: {
        writeText: writeTextMock,
      },
    });

    render(<HistoryPanel config={config} onChange={onChange} />);

    await waitFor(() => {
      expect(stt.historyList).toHaveBeenCalledWith(100);
      expect(screen.getByTestId('history-entry-hist-1')).toBeDefined();
      expect(screen.getByTestId('history-entry-hist-2')).toBeDefined();
    });

    // Test search filter
    const searchInput = screen.getByTestId('history-search-input');
    fireEvent.change(searchInput, { target: { value: 'First' } });
    expect(screen.getByTestId('history-entry-hist-1')).toBeDefined();
    expect(screen.queryByTestId('history-entry-hist-2')).toBeNull();

    // Clear search
    fireEvent.change(searchInput, { target: { value: '' } });

    // Copy action
    const copyBtn = screen.getByTestId('history-copy-hist-1');
    fireEvent.click(copyBtn);
    expect(writeTextMock).toHaveBeenCalledWith('First dictation entry');

    // Save toggle action
    const saveBtn = screen.getByTestId('history-save-hist-1');
    fireEvent.click(saveBtn);
    expect(stt.historySetSaved).toHaveBeenCalledWith('hist-1', true);

    // Retry action
    vi.mocked(stt.historyRetry).mockResolvedValue({
      text: 'Retried dictation text',
      duration_ms: 2500,
    });
    const retryBtn = screen.getByTestId('history-retry-hist-1');
    fireEvent.click(retryBtn);
    expect(stt.historyRetry).toHaveBeenCalledWith('hist-1');

    // Delete action
    const deleteBtn = screen.getByTestId('history-delete-hist-1');
    fireEvent.click(deleteBtn);
    expect(stt.historyDelete).toHaveBeenCalledWith('hist-1');

    // Retention select change
    const retentionSelect = screen.getByTestId('history-retention-select');
    fireEvent.change(retentionSelect, { target: { value: '90' } });
    expect(onChange).toHaveBeenCalledWith({ retentionDays: 90 });
  });
});

describe('PostProcessSettings', () => {
  it('manages prompt and executes interactive test polish', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      postprocessEnabled: true,
      postprocessPrompt: 'Clean up filler words',
    };
    const onChange = vi.fn();

    vi.mocked(stt.postprocessText).mockResolvedValue('Cleaned up text result');

    render(<PostProcessSettings config={config} onChange={onChange} />);

    expect(screen.getByTestId('postprocess-settings')).toBeDefined();

    // Change prompt
    const textarea = screen.getByTestId('postprocess-prompt-textarea');
    fireEvent.change(textarea, { target: { value: 'New prompt instructions' } });
    expect(onChange).toHaveBeenCalledWith({ postprocessPrompt: 'New prompt instructions' });

    // Run test run
    const testInput = screen.getByTestId('postprocess-test-input');
    fireEvent.change(testInput, { target: { value: 'test sample text' } });

    const runBtn = screen.getByTestId('postprocess-test-run-btn');
    fireEvent.click(runBtn);

    await waitFor(() => {
      expect(stt.postprocessText).toHaveBeenCalledWith('test sample text');
      expect(screen.getByTestId('postprocess-test-result')).toBeDefined();
      expect(screen.getByText('Cleaned up text result')).toBeDefined();
    });
  });
});

describe('SpeechDebug', () => {
  beforeEach(() => {
    vi.mocked(stt.modelsDir).mockResolvedValue('C:/AppData/Tempo/models');
    vi.mocked(stt.openModelsDir).mockResolvedValue(undefined);
  });

  it('displays models directory, error collector, config snapshot, and overlay toggle', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      overlayEnabled: true,
      onboarded: true,
    };
    const onChange = vi.fn();

    render(<SpeechDebug config={config} onChange={onChange} />);

    await waitFor(() => {
      expect(screen.getByTestId('models-dir-path').textContent).toBe('C:/AppData/Tempo/models');
    });

    // Open models dir
    const openBtn = screen.getByTestId('open-models-dir-button');
    fireEvent.click(openBtn);
    expect(stt.openModelsDir).toHaveBeenCalled();

    // Rerun onboarding
    const rerunBtn = screen.getByTestId('rerun-onboarding-button');
    fireEvent.click(rerunBtn);
    expect(onChange).toHaveBeenCalledWith({ onboarded: false });

    // Toggle overlay enabled
    const overlayToggle = screen.getByTestId('overlay-enabled-toggle').querySelector('button');
    fireEvent.click(overlayToggle!);
    expect(onChange).toHaveBeenCalledWith({ overlayEnabled: false });

    // Snapshot is visible
    expect(screen.getByTestId('config-snapshot')).toBeDefined();
  });
});

describe('SpeechOnboarding', () => {
  beforeEach(() => {
    vi.mocked(stt.listModels).mockResolvedValue([
      {
        id: 'whisper-small',
        name: 'Whisper Small',
        bytes: 480_000_000,
        languages: ['en', 'ru'],
        installed: false,
        recommended: true,
        description: 'Recommended model',
      },
      {
        id: 'whisper-tiny',
        name: 'Whisper Tiny',
        bytes: 75_000_000,
        languages: ['en'],
        installed: true,
        recommended: false,
        description: 'Fast model',
      },
    ]);
  });

  it('steps through onboarding wizard from model selection to completion', async () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      modelId: 'whisper-small',
      onboarded: false,
    };
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onComplete = vi.fn();

    render(
      <SpeechOnboarding
        open={true}
        config={config}
        onChange={onChange}
        onClose={onClose}
        onComplete={onComplete}
      />,
    );

    // Step 1: Select Model
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-1')).toBeDefined();
    });

    const nextBtn = screen.getByTestId('onboarding-next-btn');
    fireEvent.click(nextBtn);

    // Step 2: Download Model
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-2')).toBeDefined();
    });

    const downloadBtn = screen.getByTestId('onboarding-download-model-btn');
    fireEvent.click(downloadBtn);
    expect(stt.downloadModel).toHaveBeenCalledWith('whisper-small');

    // Go to Step 3
    fireEvent.click(screen.getByTestId('onboarding-next-btn'));

    // Step 3: Hotkey Setup
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-3')).toBeDefined();
    });

    // Go to Step 4
    fireEvent.click(screen.getByTestId('onboarding-next-btn'));

    // Step 4: Test Dictation
    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-4')).toBeDefined();
    });

    // Finish onboarding
    const finishBtn = screen.getByTestId('onboarding-finish-btn');
    fireEvent.click(finishBtn);

    expect(onChange).toHaveBeenCalledWith({ onboarded: true, enabled: true });
    expect(onComplete).toHaveBeenCalled();
  });

  it('honestly calls onClose on skip button click', () => {
    const config: SpeechConfig = {
      ...DEFAULT_SPEECH_CONFIG,
      onboarded: false,
    };
    const onChange = vi.fn();
    const onClose = vi.fn();
    const onComplete = vi.fn();

    render(
      <SpeechOnboarding
        open={true}
        config={config}
        onChange={onChange}
        onClose={onClose}
        onComplete={onComplete}
      />,
    );

    const skipBtn = screen.getByTestId('onboarding-skip-btn');
    fireEvent.click(skipBtn);

    expect(onClose).toHaveBeenCalled();
    expect(onComplete).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalledWith(expect.objectContaining({ onboarded: true }));
  });
});

describe('Speech components localization (ru/en)', () => {
  beforeEach(() => {
    vi.mocked(stt.modelsDir).mockResolvedValue('C:/AppData/Tempo/models');
    vi.mocked(stt.freeDiskSpace).mockResolvedValue(10_000_000_000);
    vi.mocked(stt.listModels).mockResolvedValue([
      {
        id: 'whisper-small',
        name: 'Whisper Small',
        bytes: 480_000_000,
        languages: ['en', 'ru'],
        installed: true,
        recommended: true,
        description: 'Recommended model',
      },
    ]);
  });

  it('renders speech components with Russian localized strings in ru locale', async () => {
    I18nService.setLang('ru');

    // 1. CustomWordsSettings: Clear all words, Clear, Add
    const { unmount: unmountWords } = render(
      <CustomWordsSettings
        config={{ ...DEFAULT_SPEECH_CONFIG, customWords: ['test'] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Удалить все слова')).toBeDefined();
    expect(screen.getByText('Очистить')).toBeDefined();
    expect(screen.getByText('Добавить')).toBeDefined();
    unmountWords();

    // 2. SpeechDebug: Show recording overlay indicator, hints, rerun setup
    const { unmount: unmountDebug } = render(
      <SpeechDebug
        config={{ ...DEFAULT_SPEECH_CONFIG, overlayEnabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Показывать индикатор записи')).toBeDefined();
    expect(screen.getByText('Уровень, режим и таймер во время диктовки (оверлей и пилюля)')).toBeDefined();
    expect(screen.getByText('Сбросить состояние знакомства и запустить начальный мастер из 4 шагов')).toBeDefined();
    expect(screen.getByText('Пройти мастер заново')).toBeDefined();
    unmountDebug();

    // 3. HistoryPanel: Saved filter button
    const { unmount: unmountHistory } = render(
      <HistoryPanel
        config={{ ...DEFAULT_SPEECH_CONFIG, historyEnabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Сохранённые')).toBeDefined();
    unmountHistory();

    // 4. ModelLibrary: Multilingual (99+), English only options
    const { unmount: unmountModels } = render(
      <ModelLibrary activeModelId="whisper-small" onSelectModel={vi.fn()} />,
    );
    expect(screen.getByText('Многоязычные (99+)')).toBeDefined();
    expect(screen.getByText('Только английский')).toBeDefined();
    unmountModels();

    // 5. SpeechOnboarding: Ready
    const { unmount: unmountOnboarding } = render(
      <SpeechOnboarding
        open={true}
        config={{ ...DEFAULT_SPEECH_CONFIG, modelId: 'whisper-small' }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );
    await waitFor(() => {
      const nextBtn = screen.getByTestId('onboarding-next-btn');
      fireEvent.click(nextBtn);
    });
    await waitFor(() => {
      expect(screen.getByText('Готово')).toBeDefined();
    });
    unmountOnboarding();

    // 6. HotkeyRecorder: Clear shortcut
    const { unmount: unmountHotkey } = render(
      <HotkeyRecorder value="Ctrl+Shift+Space" onChange={vi.fn()} />,
    );
    expect(screen.getByTitle('Сбросить сочетание')).toBeDefined();
    unmountHotkey();
  });

  it('renders speech components with English strings in en locale', async () => {
    I18nService.setLang('en');

    // 1. CustomWordsSettings
    const { unmount: unmountWords } = render(
      <CustomWordsSettings
        config={{ ...DEFAULT_SPEECH_CONFIG, customWords: ['test'] }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByTitle('Clear all words')).toBeDefined();
    expect(screen.getByText('Clear')).toBeDefined();
    expect(screen.getByText('Add')).toBeDefined();
    unmountWords();

    // 2. SpeechDebug
    const { unmount: unmountDebug } = render(
      <SpeechDebug
        config={{ ...DEFAULT_SPEECH_CONFIG, overlayEnabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Show recording overlay indicator')).toBeDefined();
    expect(screen.getByText('Display visual level meter, mode and timer while dictating (overlay and pill)')).toBeDefined();
    expect(screen.getByText('Reset onboarding state to launch the initial 4-step setup wizard')).toBeDefined();
    expect(screen.getByText('Rerun Setup')).toBeDefined();
    unmountDebug();

    // 3. HistoryPanel
    const { unmount: unmountHistory } = render(
      <HistoryPanel
        config={{ ...DEFAULT_SPEECH_CONFIG, historyEnabled: true }}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByText('Saved')).toBeDefined();
    unmountHistory();

    // 4. ModelLibrary
    const { unmount: unmountModels } = render(
      <ModelLibrary activeModelId="whisper-small" onSelectModel={vi.fn()} />,
    );
    expect(screen.getByText('Multilingual (99+)')).toBeDefined();
    expect(screen.getByText('English only')).toBeDefined();
    unmountModels();

    // 5. HotkeyRecorder
    const { unmount: unmountHotkey } = render(
      <HotkeyRecorder value="Ctrl+Shift+Space" onChange={vi.fn()} />,
    );
    expect(screen.getByTitle('Clear shortcut')).toBeDefined();
    unmountHotkey();

    // Reset back to default ru
    I18nService.setLang('ru');
  });
});

describe('Speech Models - Grouping, Quants, Size and Installed Badge', () => {
  const sampleModels: stt.ModelInfo[] = [
    {
      id: 'whisper-large-v3',
      name: 'Whisper Large v3',
      quant: 'Q5_K_M',
      bytes: 1_540_000_000,
      languages: ['en', 'ru', 'es'],
      installed: true,
      speedScore: 0.25,
      accuracyScore: 0.95,
      description: 'Accurate model',
    },
    {
      id: 'whisper-small',
      name: 'Whisper Small',
      quant: 'Q8_0',
      bytes: 488_000_000,
      languages: ['en', 'ru'],
      installed: false,
      speedScore: 0.8,
      accuracyScore: 0.85,
      description: 'Balanced multilingual model',
    },
    {
      id: 'whisper-tiny.en',
      name: 'Whisper Tiny EN',
      quant: 'Q8_0',
      bytes: 75_000_000,
      languages: ['en'],
      installed: true,
      speedScore: 1.0,
      accuracyScore: 0.6,
      description: 'Fast English model',
    },
    {
      id: 'whisper-base.en',
      name: 'Whisper Base EN',
      quant: 'Q5_0',
      bytes: 145_000_000,
      languages: ['en'],
      installed: false,
      speedScore: 0.9,
      accuracyScore: 0.7,
      description: 'Standard English model',
    },
  ];

  beforeEach(() => {
    vi.mocked(stt.listModels).mockResolvedValue(sampleModels);
  });

  it('ModelLibrary displays quant, size in MB, marks installed models, and groups multilingual before English-only', async () => {
    render(<ModelLibrary activeModelId="whisper-small" onSelectModel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('models-group-multilingual')).toBeDefined();
      expect(screen.getByTestId('models-group-english-only')).toBeDefined();
    });

    const multiGroup = screen.getByTestId('models-group-multilingual');
    const enGroup = screen.getByTestId('models-group-english-only');

    // Multilingual appears before English-only in DOM order
    expect(multiGroup.compareDocumentPosition(enGroup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // Multilingual group contains Whisper Small and Whisper Large v3
    expect(multiGroup.textContent).toContain('Whisper Small');
    expect(multiGroup.textContent).toContain('Whisper Large v3');

    // Fast to accurate: Whisper Small (speed 0.8) before Whisper Large v3 (speed 0.25)
    const smallIdx = multiGroup.textContent!.indexOf('Whisper Small');
    const largeIdx = multiGroup.textContent!.indexOf('Whisper Large v3');
    expect(smallIdx).toBeLessThan(largeIdx);

    // English group: Tiny EN (speed 1.0) before Base EN (speed 0.9)
    const tinyIdx = enGroup.textContent!.indexOf('Whisper Tiny EN');
    const baseIdx = enGroup.textContent!.indexOf('Whisper Base EN');
    expect(tinyIdx).toBeLessThan(baseIdx);

    // Check size in MB and quant for models
    expect(multiGroup.textContent).toContain('Q8_0');
    expect(multiGroup.textContent).toContain('465 MB');
    expect(multiGroup.textContent).toContain('Q5_K_M');
    expect(multiGroup.textContent).toContain('1469 MB');

    // Installed badges: large-v3 is installed, small is not
    const largeCard = screen.getByTestId('model-card-whisper-large-v3');
    expect(largeCard.querySelector('[data-testid="model-installed-badge"]')).toBeDefined();

    const smallCard = screen.getByTestId('model-card-whisper-small');
    expect(smallCard.querySelector('[data-testid="model-installed-badge"]')).toBeNull();
  });

  it('SpeechOnboarding step 1 displays quant, size in MB, installed badge, and groups multilingual before English-only', async () => {
    render(
      <SpeechOnboarding
        open={true}
        config={{ ...DEFAULT_SPEECH_CONFIG, modelId: 'whisper-small' }}
        onChange={vi.fn()}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-step-1')).toBeDefined();
      expect(screen.getByTestId('onboarding-models-group-multilingual')).toBeDefined();
      expect(screen.getByTestId('onboarding-models-group-english-only')).toBeDefined();
    });

    const multiGroup = screen.getByTestId('onboarding-models-group-multilingual');
    const enGroup = screen.getByTestId('onboarding-models-group-english-only');

    // Multilingual appears before English-only in DOM order
    expect(multiGroup.compareDocumentPosition(enGroup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // Fast to accurate: Whisper Small before Whisper Large v3
    expect(multiGroup.textContent!.indexOf('Whisper Small')).toBeLessThan(multiGroup.textContent!.indexOf('Whisper Large v3'));

    // Shows quant and size in MB
    expect(multiGroup.textContent).toContain('Q8_0');
    expect(multiGroup.textContent).toContain('465 MB');
    expect(multiGroup.textContent).toContain('Q5_K_M');
    expect(multiGroup.textContent).toContain('1469 MB');

    // Installed badge present for installed model
    const installedBadges = screen.getAllByTestId('model-installed-badge');
    expect(installedBadges.length).toBe(2); // large-v3 and tiny.en
  });
});

describe('Handy STT Engines - Display, Grouping, Support, and Archives', () => {
  const handyModels: stt.ModelInfo[] = [
    {
      id: 'gigaam-v3',
      name: 'GigaAM v3 (русский)',
      engine: 'gigaam',
      filename: 'giga-am-v3-int8',
      archive: 'https://blob.handy.computer/giga-am-v3-int8.tar.gz',
      bytes: 159_235_143,
      languages: ['ru'],
      speed_score: 0.9,
      accuracy_score: 0.85,
      recommended: true,
      installed: false,
    },
    {
      id: 'parakeet-v3',
      name: 'Parakeet v3',
      engine: 'parakeet',
      bytes: 456_000_000,
      languages: ['en'],
      speedScore: 0.85,
      accuracyScore: 0.9,
      installed: true,
    },
    {
      id: 'canary-unsupported',
      name: 'Canary Multilingual',
      engine: 'canary',
      bytes: 600_000_000,
      languages: ['en', 'de', 'es', 'fr'],
      supported: false,
      unsupportedReason: 'Requires ONNX runtime with DirectML',
      installed: false,
    },
    {
      id: 'whisper-small',
      name: 'Whisper Small',
      engine: 'whisper',
      bytes: 488_000_000,
      languages: ['en', 'ru'],
      installed: false,
      speedScore: 0.8,
      accuracyScore: 0.85,
    },
  ];

  beforeEach(() => {
    vi.mocked(stt.listModels).mockResolvedValue(handyModels);
  });

  it('a card shows engine and languages', async () => {
    render(<ModelLibrary activeModelId="parakeet-v3" onSelectModel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-card-gigaam-v3')).toBeDefined();
    });

    const gigaCard = screen.getByTestId('model-card-gigaam-v3');
    const parakeetCard = screen.getByTestId('model-card-parakeet-v3');
    const whisperCard = screen.getByTestId('model-card-whisper-small');

    // Engine is shown on each card
    expect(gigaCard.querySelector('[data-testid="model-engine"]')?.textContent).toBe('GigaAM');
    expect(parakeetCard.querySelector('[data-testid="model-engine"]')?.textContent).toBe('Parakeet');
    expect(whisperCard.querySelector('[data-testid="model-engine"]')?.textContent).toBe('Whisper');

    // Languages are shown on each card
    expect(gigaCard.querySelector('[data-testid="model-languages"]')?.textContent).toBe('Русский');
    expect(parakeetCard.querySelector('[data-testid="model-languages"]')?.textContent).toBe('EN');
    expect(whisperCard.querySelector('[data-testid="model-languages"]')?.textContent).toBe('EN, RU');

    // Archive-backed model shows archive badge
    expect(gigaCard.querySelector('[data-testid="model-archive-badge"]')).toBeDefined();
  });

  it('GigaAM is grouped and labelled as Russian', async () => {
    render(<ModelLibrary activeModelId="parakeet-v3" onSelectModel={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('models-group-russian')).toBeDefined();
      expect(screen.getByTestId('models-group-multilingual')).toBeDefined();
      expect(screen.getByTestId('models-group-english-only')).toBeDefined();
    });

    const ruGroup = screen.getByTestId('models-group-russian');
    const multiGroup = screen.getByTestId('models-group-multilingual');

    // Russian group appears first (findable, not buried)
    expect(ruGroup.compareDocumentPosition(multiGroup)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    // GigaAM is inside the Russian group
    expect(ruGroup.textContent).toContain('GigaAM v3 (русский)');

    // GigaAM card has Russian badge
    const gigaCard = screen.getByTestId('model-card-gigaam-v3');
    expect(gigaCard.querySelector('[data-testid="model-russian-badge"]')).toBeDefined();
  });

  it('an unsupported engine is not selectable and displays reason', async () => {
    const onSelect = vi.fn();
    render(<ModelLibrary activeModelId="parakeet-v3" onSelectModel={onSelect} />);

    await waitFor(() => {
      expect(screen.getByTestId('model-card-canary-unsupported')).toBeDefined();
    });

    const canaryCard = screen.getByTestId('model-card-canary-unsupported');

    // Unsupported badge and reason are displayed
    expect(canaryCard.querySelector('[data-testid="model-unsupported-badge"]')).toBeDefined();
    const reasonEl = canaryCard.querySelector('[data-testid="model-unsupported-reason"]');
    expect(reasonEl).toBeDefined();
    expect(reasonEl?.textContent).toContain('Requires ONNX runtime with DirectML');

    // Action button is disabled / unavailable
    const actionBtn = canaryCard.querySelector('[data-testid="model-unsupported-button"]') as HTMLButtonElement;
    expect(actionBtn).toBeDefined();
    expect(actionBtn.disabled).toBe(true);

    fireEvent.click(actionBtn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('SpeechOnboarding groups GigaAM as Russian and prevents selecting unsupported engines', async () => {
    const onChange = vi.fn();
    render(
      <SpeechOnboarding
        open={true}
        config={{ ...DEFAULT_SPEECH_CONFIG, modelId: 'parakeet-v3' }}
        onChange={onChange}
        onClose={vi.fn()}
        onComplete={vi.fn()}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTestId('onboarding-models-group-russian')).toBeDefined();
    });

    const ruGroup = screen.getByTestId('onboarding-models-group-russian');
    expect(ruGroup.textContent).toContain('GigaAM v3 (русский)');
    expect(ruGroup.querySelector('[data-testid="model-russian-badge"]')).toBeDefined();

    // Clicking unsupported model does not trigger onChange
    const canaryItem = screen.getByTestId('onboarding-model-canary-unsupported');
    expect(canaryItem.querySelector('[data-testid="model-unsupported-reason"]')?.textContent).toContain(
      'Requires ONNX runtime with DirectML',
    );
    fireEvent.click(canaryItem);
    expect(onChange).not.toHaveBeenCalled();

    // Clicking supported GigaAM triggers onChange
    const gigaItem = screen.getByTestId('onboarding-model-gigaam-v3');
    fireEvent.click(gigaItem);
    expect(onChange).toHaveBeenCalledWith({ modelId: 'gigaam-v3' });
  });
});
