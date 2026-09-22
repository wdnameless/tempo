import { Segmented } from './ui';

export interface SectionTabItem<T extends string = string> {
  id: T;
  label: string;
}

export interface SectionTabsProps<T extends string = string> {
  activeTab: T;
  tabs: SectionTabItem<T>[];
  onChange: (tab: T) => void;
}

export function SectionTabs<T extends string = string>({
  activeTab,
  tabs,
  onChange,
}: SectionTabsProps<T>) {
  if (tabs.length <= 1) return null;

  return (
    <div
      data-testid="section-tabs"
      className="px-6 pt-3 pb-2 shrink-0 flex items-center border-b border-[var(--border)] bg-[var(--bg)]"
    >
      <Segmented<T>
        value={activeTab}
        options={tabs.map((tab) => ({
          value: tab.id,
          label: tab.label,
        }))}
        onChange={onChange}
      />
    </div>
  );
}
