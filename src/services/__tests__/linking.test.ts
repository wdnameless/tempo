import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseLinks, upsertLinks, backlinksOf, linksOf, type LinkRef } from '../linking';

const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

describe('Linking domain service (linking.ts)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('parseLinks', () => {
    it('extracts wiki link titles from markdown', () => {
      const md = 'Hello [[World]] and [[Another Note]]!';
      expect(parseLinks(md)).toEqual(['World', 'Another Note']);
    });

    it('trims whitespace inside brackets', () => {
      const md = 'Links: [[  Spaced Out  ]] and [[Normal]]';
      expect(parseLinks(md)).toEqual(['Spaced Out', 'Normal']);
    });

    it('de-duplicates repeated links preserving first appearance order', () => {
      const md = 'Check [[Alpha]], then [[Beta]], and again [[Alpha]] or [[  Alpha  ]].';
      expect(parseLinks(md)).toEqual(['Alpha', 'Beta']);
    });

    it('ignores unclosed [[ links and empty brackets', () => {
      const md = 'Unclosed [[link without end and [[Valid]] and [[]] and [[   ]].';
      expect(parseLinks(md)).toEqual(['Valid']);
    });

    it('returns empty array on empty input or string without links', () => {
      expect(parseLinks('')).toEqual([]);
      expect(parseLinks('Just plain text with no links.')).toEqual([]);
    });
  });

  describe('upsertLinks', () => {
    it('sends one call to links_set with the full target set', async () => {
      mockInvoke.mockResolvedValueOnce(2);

      const from: LinkRef = { kind: 'note', id: 'source-1' };
      const to: LinkRef[] = [
        { kind: 'note', id: 'target-1' },
        { kind: 'task', id: 'target-2' },
      ];

      const count = await upsertLinks(from, to);

      expect(mockInvoke).toHaveBeenCalledTimes(1);
      expect(mockInvoke).toHaveBeenCalledWith('links_set', {
        fromKind: 'note',
        fromId: 'source-1',
        to: [
          { kind: 'note', id: 'target-1' },
          { kind: 'task', id: 'target-2' },
        ],
      });
      expect(count).toBe(2);
    });
  });

  describe('backlinksOf', () => {
    it('invokes links_backlinks with kind and id', async () => {
      mockInvoke.mockResolvedValueOnce([
        { kind: 'note', id: 'note-2', title: 'Referrer Note' },
      ]);

      const backlinks = await backlinksOf('note', 'note-1');

      expect(mockInvoke).toHaveBeenCalledWith('links_backlinks', {
        kind: 'note',
        id: 'note-1',
      });
      expect(backlinks).toEqual([
        { kind: 'note', id: 'note-2', title: 'Referrer Note' },
      ]);
    });
  });

  describe('linksOf', () => {
    it('queries links table and filters outgoing links', async () => {
      mockInvoke.mockResolvedValueOnce([
        { from_kind: 'note', from_id: 'n1', to_kind: 'note', to_id: 'n2', updated_at: '2026-09-20' },
        { from_kind: 'note', from_id: 'n1', to_kind: 'task', to_id: 't1', updated_at: '2026-09-20' },
        { from_kind: 'note', from_id: 'n2', to_kind: 'note', to_id: 'n3', updated_at: '2026-09-20' },
      ]);

      const outgoing = await linksOf('note', 'n1');

      expect(mockInvoke).toHaveBeenCalledWith('db_list', {
        table: 'links',
        includeDeleted: false,
      });
      expect(outgoing).toEqual([
        { kind: 'note', id: 'n2' },
        { kind: 'task', id: 't1' },
      ]);
    });
  });
});
