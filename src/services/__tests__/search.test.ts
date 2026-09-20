import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  searchAll,
  reindex,
  registerSearchSource,
  listSearchSources,
  type SearchSource,
  type SearchHit,
} from '../search';
import { Search } from 'lucide-react';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('search service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('searchAll', () => {
    it('returns empty array immediately for empty string without invoking IPC', async () => {
      const result = await searchAll('');
      expect(result).toEqual([]);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('returns empty array immediately for whitespace-only query without invoking IPC', async () => {
      const result = await searchAll('   \t\n  ');
      expect(result).toEqual([]);
      expect(mockInvoke).not.toHaveBeenCalled();
    });

    it('passes trimmed query and limit to db_search invoke', async () => {
      const mockHits: SearchHit[] = [
        {
          kind: 'task',
          row_id: '1',
          title: 'Buy groceries',
          body: 'Milk, eggs',
          rank: -1.2,
        },
      ];
      mockInvoke.mockResolvedValueOnce(mockHits);

      const result = await searchAll('  groceries  ', 10);
      expect(mockInvoke).toHaveBeenCalledWith('db_search', { query: 'groceries', limit: 10 });
      expect(result).toEqual(mockHits);
    });

    it('passes query without limit if not specified', async () => {
      mockInvoke.mockResolvedValueOnce([]);

      await searchAll('test');
      expect(mockInvoke).toHaveBeenCalledWith('db_search', { query: 'test', limit: undefined });
    });
  });

  describe('reindex', () => {
    it('passes kind through to db_reindex', async () => {
      mockInvoke.mockResolvedValueOnce(5);

      const count = await reindex('alarm');
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: 'alarm' });
      expect(count).toBe(5);
    });

    it('passes undefined kind when no argument provided', async () => {
      mockInvoke.mockResolvedValueOnce(42);

      const count = await reindex();
      expect(mockInvoke).toHaveBeenCalledWith('db_reindex', { kind: undefined });
      expect(count).toBe(42);
    });
  });

  describe('search sources registry', () => {
    it('registers a source, appears in listSearchSources, and disposer removes it', () => {
      const initialCount = listSearchSources().length;
      const fakeIcon = Search;
      const openFn = vi.fn();

      const source: SearchSource = {
        kind: 'alarm',
        labelKey: 'searchGroupAlarms',
        icon: fakeIcon,
        open: openFn,
      };

      const unregister = registerSearchSource(source);
      expect(listSearchSources()).toContain(source);
      expect(listSearchSources().length).toBe(initialCount + 1);

      const hit: SearchHit = {
        kind: 'alarm',
        row_id: 'a1',
        title: 'Morning Alarm',
        body: 'Wake up 07:00',
        rank: -0.5,
      };
      source.open(hit);
      expect(openFn).toHaveBeenCalledWith(hit);

      unregister();
      expect(listSearchSources()).not.toContain(source);
      expect(listSearchSources().length).toBe(initialCount);
    });
  });
});
