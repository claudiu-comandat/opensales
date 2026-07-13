import { describe, expect, it, vi } from 'vitest';

import { findByEans } from './ean-search.js';
import { buildTestClient, emagOkResponse } from './test-helpers.js';

describe('findByEans', () => {
  it('returns empty array for empty input without calling fetch', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(emagOkResponse([])));
    const client = buildTestClient(fetchFn);
    const result = await findByEans(client, []);
    expect(result).toEqual([]);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('POSTs eans array to documentation/find_by_eans (no /read suffix — standalone action, not a CRUD resource)', async () => {
    const fetchFn = vi.fn(() =>
      Promise.resolve(
        emagOkResponse([
          {
            ean: '5901234123457',
            part_number_key: 'ABC123XYZ',
            product_name: 'Test',
            allow_to_add_offer: true,
          },
        ]),
      ),
    );
    const client = buildTestClient(fetchFn);

    const result = await findByEans(client, ['5901234123457', '4006381333931']);
    expect(result).toHaveLength(1);
    expect(result[0]?.part_number_key).toBe('ABC123XYZ');

    const call = fetchFn.mock.calls[0] as unknown as [string, RequestInit] | undefined;
    if (!call) throw new Error('fetch not called');
    const [url, init] = call;
    expect(url).toBe('https://marketplace-api.emag.ro/api-3/documentation/find_by_eans');
    const body = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(body.eans).toEqual(['5901234123457', '4006381333931']);
  });
});
