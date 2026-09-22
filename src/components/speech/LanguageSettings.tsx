import React from 'react';
import type { SpeechConfig } from '../../services/speechSettings';
import { I18nService } from '../../services/i18n';
import { Toggle } from '../ui/Toggle';
import { Row } from '../ui/Row';

export interface SpeechSectionProps {
  config: SpeechConfig;
  onChange: (patch: Partial<SpeechConfig>) => void;
  disabled?: boolean;
}

export type LanguageSettingsProps = SpeechSectionProps;

export interface LanguageOption {
  code: string;
  name: string;
}

// Whisper ISO 639-1 language catalog
export const WHISPER_LANGUAGES: LanguageOption[] = [
  { code: 'en', name: 'English' },
  { code: 'ru', name: 'Russian (Русский)' },
  { code: 'es', name: 'Spanish (Español)' },
  { code: 'zh', name: 'Chinese (中文)' },
  { code: 'de', name: 'German (Deutsch)' },
  { code: 'fr', name: 'French (Français)' },
  { code: 'ja', name: 'Japanese (日本語)' },
  { code: 'pt', name: 'Portuguese (Português)' },
  { code: 'tr', name: 'Turkish (Türkçe)' },
  { code: 'pl', name: 'Polish (Polski)' },
  { code: 'ca', name: 'Catalan (Català)' },
  { code: 'nl', name: 'Dutch (Nederlands)' },
  { code: 'ar', name: 'Arabic (العربية)' },
  { code: 'sv', name: 'Swedish (Svenska)' },
  { code: 'it', name: 'Italian (Italiano)' },
  { code: 'id', name: 'Indonesian (Bahasa Indonesia)' },
  { code: 'hi', name: 'Hindi (हिन्दी)' },
  { code: 'fi', name: 'Finnish (Suomi)' },
  { code: 'vi', name: 'Vietnamese (Tiếng Việt)' },
  { code: 'he', name: 'Hebrew (עברית)' },
  { code: 'uk', name: 'Ukrainian (Українська)' },
  { code: 'el', name: 'Greek (Ελληνικά)' },
  { code: 'ms', name: 'Malay (Bahasa Melayu)' },
  { code: 'cs', name: 'Czech (Čeština)' },
  { code: 'ro', name: 'Romanian (Română)' },
  { code: 'da', name: 'Danish (Dansk)' },
  { code: 'hu', name: 'Hungarian (Magyar)' },
  { code: 'ta', name: 'Tamil (தமிழ்)' },
  { code: 'no', name: 'Norwegian (Norsk)' },
  { code: 'th', name: 'Thai (ไทย)' },
  { code: 'ur', name: 'Urdu (اردو)' },
  { code: 'hr', name: 'Croatian (Hrvatski)' },
  { code: 'bg', name: 'Bulgarian (Български)' },
  { code: 'lt', name: 'Lithuanian (Lietuvių)' },
  { code: 'la', name: 'Latin' },
  { code: 'mi', name: 'Maori' },
  { code: 'ml', name: 'Malayalam' },
  { code: 'cy', name: 'Welsh' },
  { code: 'sk', name: 'Slovak' },
  { code: 'te', name: 'Telugu' },
  { code: 'fa', name: 'Persian' },
  { code: 'lv', name: 'Latvian' },
  { code: 'bn', name: 'Bengali' },
  { code: 'sr', name: 'Serbian' },
  { code: 'az', name: 'Azerbaijani' },
  { code: 'sl', name: 'Slovenian' },
  { code: 'kn', name: 'Kannada' },
  { code: 'et', name: 'Estonian' },
  { code: 'mk', name: 'Macedonian' },
  { code: 'br', name: 'Breton' },
  { code: 'eu', name: 'Basque' },
  { code: 'is', name: 'Icelandic' },
  { code: 'hy', name: 'Armenian' },
  { code: 'ne', name: 'Nepali' },
  { code: 'mn', name: 'Mongolian' },
  { code: 'bs', name: 'Bosnian' },
  { code: 'kk', name: 'Kazakh' },
  { code: 'sq', name: 'Albanian' },
  { code: 'sw', name: 'Swahili' },
  { code: 'gl', name: 'Galician' },
  { code: 'mr', name: 'Marathi' },
  { code: 'pa', name: 'Punjabi' },
  { code: 'si', name: 'Sinhala' },
  { code: 'km', name: 'Khmer' },
  { code: 'sn', name: 'Shona' },
  { code: 'yo', name: 'Yoruba' },
  { code: 'so', name: 'Somali' },
  { code: 'af', name: 'Afrikaans' },
  { code: 'oc', name: 'Occitan' },
  { code: 'ka', name: 'Georgian' },
  { code: 'be', name: 'Belarusian' },
  { code: 'tg', name: 'Tajik' },
  { code: 'sd', name: 'Sindhi' },
  { code: 'gu', name: 'Gujarati' },
  { code: 'am', name: 'Amharic' },
  { code: 'yi', name: 'Yiddish' },
  { code: 'lo', name: 'Lao' },
  { code: 'uz', name: 'Uzbek' },
  { code: 'fo', name: 'Faroese' },
  { code: 'ht', name: 'Haitian Creole' },
  { code: 'ps', name: 'Pashto' },
  { code: 'tk', name: 'Turkmen' },
  { code: 'nn', name: 'Nynorsk' },
  { code: 'mt', name: 'Maltese' },
  { code: 'sa', name: 'Sanskrit' },
  { code: 'lb', name: 'Luxembourgish' },
  { code: 'my', name: 'Myanmar' },
  { code: 'bo', name: 'Tibetan' },
  { code: 'tl', name: 'Tagalog' },
  { code: 'mg', name: 'Malagasy' },
  { code: 'as', name: 'Assamese' },
  { code: 'tt', name: 'Tatar' },
  { code: 'haw', name: 'Hawaiian' },
  { code: 'ln', name: 'Lingala' },
  { code: 'ha', name: 'Hausa' },
  { code: 'ba', name: 'Bashkir' },
  { code: 'jw', name: 'Javanese' },
  { code: 'su', name: 'Sundanese' },
];

export const LanguageSettings: React.FC<LanguageSettingsProps> = ({
  config,
  onChange,
  disabled = false,
}) => {
  const t = I18nService.t();

  const currentLanguageValue = config.language || 'auto';

  const handleLanguageChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const val = e.target.value;
    onChange({ language: val === 'auto' ? null : val });
  };

  return (
    <div data-testid="language-settings" className="space-y-4">
      {/* Recognition Language Selector */}
      <div
        className="p-4 rounded-[10px] border space-y-3"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <div className="flex flex-col gap-1">
          <label
            htmlFor="recognition-language-select"
            className="text-sm font-medium"
            style={{ color: 'var(--text)' }}
          >
            {t.settingsSpeechLanguage}
          </label>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            {currentLanguageValue === 'auto'
              ? t.settingsSpeechLanguageAuto
              : WHISPER_LANGUAGES.find((l) => l.code === currentLanguageValue)?.name ??
                currentLanguageValue}
          </div>
        </div>

        <div className="relative">
          <select
            id="recognition-language-select"
            data-testid="language-select"
            value={currentLanguageValue}
            onChange={handleLanguageChange}
            disabled={disabled}
            className="w-full px-3 py-2 rounded-[8px] border text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--accent)] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--elevated)',
              borderColor: 'var(--border)',
              color: 'var(--text)',
            }}
          >
            <option value="auto">
              🌐 {t.settingsSpeechLanguageAuto || 'Auto Detect'}
            </option>
            {WHISPER_LANGUAGES.map((lang) => (
              <option key={lang.code} value={lang.code}>
                {lang.name} ({lang.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Translate to English */}
      <div
        className="p-2 rounded-[10px] border"
        style={{ backgroundColor: 'var(--surface)', borderColor: 'var(--border)' }}
      >
        <Row
          label={t.settingsSpeechTranslateToEnglish}
          description={t.settingsSpeechTranslateToEnglishDesc}
          control={
            <div data-testid="translate-to-english-toggle">
              <Toggle
                checked={config.translateToEnglish}
                onChange={(val) => onChange({ translateToEnglish: val })}
                disabled={disabled}
              />
            </div>
          }
          disabled={disabled}
        />
      </div>
    </div>
  );
};

export default LanguageSettings;
