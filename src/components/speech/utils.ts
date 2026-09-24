import type { ModelInfo } from '../../services/stt';

/**
 * Common formatting utilities for speech components.
 */

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1000) {
    return `${(mb / 1024).toFixed(2)} GB`;
  }
  return `${mb.toFixed(mb >= 10 ? 0 : 1)} MB`;
}

export function formatSpeed(bps: number | undefined): string {
  if (!bps || bps <= 0) return '';
  const mbps = bps / (1024 * 1024);
  return `${mbps.toFixed(1)} MB/s`;
}

export function formatEta(secs: number | null | undefined): string {
  if (secs === null || secs === undefined || secs < 0) return '';
  if (secs < 60) return `${Math.round(secs)}s`;
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  return `${m}m ${s}s`;
}

export function formatDuration(ms: number): string {
  if (ms <= 0) return '0s';
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) {
    return `${totalSeconds.toFixed(1)}s`;
  }
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${minutes}m ${seconds}s`;
}

export function getModelQuant(model: ModelInfo): string {
  if (model.quant) return model.quant;
  if (model.quants && model.quants.length > 0) return model.quants[0];
  const match = /(q\d+[_a-z0-9]*)/i.exec(model.filename || model.id);
  if (match) return match[1].toUpperCase();
  return 'Q8_0';
}

export function formatModelSizeMB(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = Math.round(bytes / (1024 * 1024));
  return `${Math.max(1, mb)} MB`;
}
export function formatEngineName(engine?: string): string {
  if (!engine) return 'Whisper';
  const lower = engine.toLowerCase();
  switch (lower) {
    case 'whisper':
      return 'Whisper';
    case 'parakeet':
      return 'Parakeet';
    case 'canary':
      return 'Canary';
    case 'cohere':
      return 'Cohere';
    case 'moonshine':
      return 'Moonshine';
    case 'sensevoice':
      return 'SenseVoice';
    case 'gigaam':
      return 'GigaAM';
    default:
      return engine.charAt(0).toUpperCase() + engine.slice(1);
  }
}

export function isRussianModel(model: ModelInfo): boolean {
  if (model.engine?.toLowerCase() === 'gigaam') {
    return true;
  }
  if (model.id.toLowerCase().includes('gigaam') || model.id.toLowerCase().includes('giga-am')) {
    return true;
  }
  if (model.languages && model.languages.length === 1 && model.languages[0].toLowerCase() === 'ru') {
    return true;
  }
  return false;
}

export function isModelSupported(model: ModelInfo): boolean {
  if (model.supported === false) return false;
  if (model.unsupported === true) return false;
  if (Boolean(model.unsupportedReason) || Boolean(model.unsupported_reason)) return false;
  return true;
}

export function getUnsupportedReason(model: ModelInfo, fallbackText?: string): string | null {
  if (isModelSupported(model)) return null;
  return (
    model.unsupportedReason ||
    model.unsupported_reason ||
    fallbackText ||
    'Engine is not supported on this platform'
  );
}

export function formatLanguages(model: ModelInfo, russianLabel = 'RU'): string {
  if (isRussianModel(model)) {
    return russianLabel;
  }
  if (isEnglishOnlyModel(model)) {
    return 'EN';
  }
  const langs = model.languages;
  if (langs && langs.length > 0) {
    if (langs.length <= 3) {
      return langs.map((l) => l.toUpperCase()).join(', ');
    }
    return `${langs.length} langs`;
  }
  const count = model.languageCount ?? model.language_count;
  if (count && count > 1) {
    return `${count} langs`;
  }
  return 'Multilingual';
}

export function isEnglishOnlyModel(model: ModelInfo): boolean {
  if (isRussianModel(model)) {
    return false;
  }
  if (model.languages && model.languages.length === 1 && model.languages[0].toLowerCase() === 'en') {
    return true;
  }
  if (model.id.toLowerCase().endsWith('.en')) {
    return true;
  }
  return false;
}

export function getModelSpeedScore(m: ModelInfo): number {
  if (m.speedScore !== undefined && m.speedScore !== null) return m.speedScore;
  if (m.speed_score !== undefined && m.speed_score !== null) return m.speed_score;
  return 0;
}

export function getModelAccuracyScore(m: ModelInfo): number {
  if (m.accuracyScore !== undefined && m.accuracyScore !== null) return m.accuracyScore;
  if (m.accuracy_score !== undefined && m.accuracy_score !== null) return m.accuracy_score;
  return 0;
}

export function sortModelsFastToAccurate(models: ModelInfo[]): ModelInfo[] {
  return [...models].sort((a, b) => {
    const speedA = getModelSpeedScore(a);
    const speedB = getModelSpeedScore(b);
    if (speedA !== speedB && (speedA > 0 || speedB > 0)) {
      return speedB - speedA;
    }
    if (a.bytes !== b.bytes) {
      return a.bytes - b.bytes;
    }
    const accA = getModelAccuracyScore(a);
    const accB = getModelAccuracyScore(b);
    if (accA !== accB) {
      return accA - accB;
    }
    return a.name.localeCompare(b.name);
  });
}

export interface GroupedModels {
  russian: ModelInfo[];
  multilingual: ModelInfo[];
  englishOnly: ModelInfo[];
}

export function groupAndSortModels(models: ModelInfo[]): GroupedModels {
  const russian: ModelInfo[] = [];
  const multilingual: ModelInfo[] = [];
  const englishOnly: ModelInfo[] = [];

  for (const m of models) {
    if (isRussianModel(m)) {
      russian.push(m);
    } else if (isEnglishOnlyModel(m)) {
      englishOnly.push(m);
    } else {
      multilingual.push(m);
    }
  }

  return {
    russian: sortModelsFastToAccurate(russian),
    multilingual: sortModelsFastToAccurate(multilingual),
    englishOnly: sortModelsFastToAccurate(englishOnly),
  };
}
