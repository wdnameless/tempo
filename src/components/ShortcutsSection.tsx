import { useEffect, useState } from 'react';
import { I18nService } from '../services/i18n';
import { listShortcuts, subscribeShortcuts, type ShortcutDef } from '../services/shortcuts';
import { Divider, Kbd, Row, SectionHeader } from './ui';

export function ShortcutsSection() {
  // The registry is the single source of truth: the initial value is read once
  // and every later change arrives through the subscription, so a shortcut
  // registered by a later wave appears here without a re-render loop.
  const [shortcuts, setShortcuts] = useState<ShortcutDef[]>(() => listShortcuts());
  const [lang, setLang] = useState(() => I18nService.getLang());

  useEffect(() => {
    const unsubShortcuts = subscribeShortcuts(() => setShortcuts(listShortcuts()));
    const unsubLang = I18nService.subscribe(() => setLang(I18nService.getLang()));
    return () => {
      unsubShortcuts();
      unsubLang();
    };
  }, []);

  const t = I18nService.t();

  // Group shortcuts by their group property (defaulting to 'general')
  const groups: Record<string, ShortcutDef[]> = {};
  for (const item of shortcuts) {
    const groupKey = item.group || 'general';
    if (!groups[groupKey]) {
      groups[groupKey] = [];
    }
    groups[groupKey].push(item);
  }

  const getGroupTitle = (groupKey: string): string => {
    switch (groupKey) {
      case 'general':
        return t.shortcutGroupGeneral;
      case 'navigation':
        return t.shortcutGroupNavigation;
      case 'actions':
        return t.shortcutGroupActions;
      default:
        return groupKey.charAt(0).toUpperCase() + groupKey.slice(1);
    }
  };

  const getItemLabel = (item: ShortcutDef): string => {
    if (item.description) {
      const record = t as unknown as Record<string, string>;
      if (record[item.description]) {
        return record[item.description];
      }
    }
    return item.description || item.id;
  };

  return (
    <div className="flex flex-col gap-6 w-full max-w-2xl py-2">
      <div className="px-3.5">
        <h2
          className="text-lg font-semibold tracking-tight"
          style={{ color: 'var(--text)' }}
        >
          {t.settingsShortcuts}
        </h2>
        <p
          className="text-xs mt-1"
          style={{ color: 'var(--text-muted)' }}
        >
          {lang === 'ru'
            ? 'Клавиатурные комбинации для быстрой навигации и управления'
            : 'Keyboard shortcuts for fast navigation and control'}
        </p>
      </div>

      <div className="flex flex-col gap-4">
        {Object.entries(groups).map(([groupKey, items]) => (
          <div key={groupKey} className="flex flex-col">
            <SectionHeader>{getGroupTitle(groupKey)}</SectionHeader>
            <div className="flex flex-col">
              {items.map((shortcut, index) => (
                <div key={shortcut.id}>
                  {index > 0 && <Divider />}
                  <Row
                    label={getItemLabel(shortcut)}
                    control={<Kbd keys={shortcut.keys} />}
                  />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
