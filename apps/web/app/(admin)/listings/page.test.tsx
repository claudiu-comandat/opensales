import { describe, expect, it } from 'vitest';

import { groupByPlugin, type ListingRow } from './page.js';

const sampleRows: ListingRow[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    productId: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    pluginId: 'plugin-a',
    externalListingId: 'EXT-1',
    status: 'active',
    lastSyncedAt: '2026-05-01T10:00:00.000Z',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    productId: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
    pluginId: 'plugin-b',
    externalListingId: 'EXT-2',
    status: 'draft',
    lastSyncedAt: null,
  },
  {
    id: '33333333-3333-3333-3333-333333333333',
    productId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
    pluginId: 'plugin-a',
    externalListingId: 'EXT-3',
    status: 'paused',
    lastSyncedAt: null,
  },
];

describe('groupByPlugin', () => {
  it('groups rows by pluginId in deterministic order', () => {
    const groups = groupByPlugin(sampleRows);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.pluginId).toBe('plugin-a');
    expect(groups[0]?.rows).toHaveLength(2);
    expect(groups[1]?.pluginId).toBe('plugin-b');
    expect(groups[1]?.rows).toHaveLength(1);
  });

  it('returns empty array for empty input', () => {
    expect(groupByPlugin([])).toEqual([]);
  });
});
