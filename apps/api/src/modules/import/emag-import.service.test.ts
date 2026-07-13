import { type ActionHandler, type Plugin } from '@opensales/plugin-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { type JobQueueService } from '../../jobs/job-queue.service.js';
import { type ListingsService } from '../listings/listings.service.js';
import { type LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { type PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { type ProductsService } from '../products/products.service.js';

import { EmagImportService } from './emag-import.service.js';

type Handlers = Record<string, (input: unknown) => Promise<unknown>>;

function fakePlugin(handlers: Handlers): Plugin {
  const actions: Record<string, ActionHandler<unknown, unknown>> = {};
  for (const [name, handle] of Object.entries(handlers)) {
    actions[name] = { input: z.any(), output: z.any(), handle };
  }
  return { _actions: actions } as unknown as Plugin;
}

function makeService(): EmagImportService {
  return new EmagImportService(
    {} as unknown as JobQueueService,
    {} as unknown as PluginRegistryService,
    {} as unknown as LoadedPluginsRegistry,
    {} as unknown as ProductsService,
    {} as unknown as ListingsService,
    { warn: () => undefined } as never,
  );
}

// Access the private method directly — no DB needed, this only exercises the
// action-name + response-shape parsing. Two bugs are covered here:
//  1) `readVats`/`items` didn't match the plugin's real `readVatRates`/`{ rates }`
//     contract, so this lookup silently always returned empty.
//  2) even after fixing the action name, the item schema assumed `{vat_id,
//     vat_rate}` (integer percent) while the real plugin returns `{id, value}`
//     with `value` as a DECIMAL FRACTION (0.19 for 19%) — see
//     plugins/emag/src/lookups/types.ts EmagVatRate.
async function buildVatLookup(
  svc: EmagImportService,
  instance: Plugin,
): Promise<Map<number, number>> {
  return (
    svc as unknown as { buildVatLookup: (i: Plugin) => Promise<Map<number, number>> }
  ).buildVatLookup(instance);
}

describe('EmagImportService.buildVatLookup', () => {
  it('reads VAT rates via the readVatRates action (rates envelope, real {id,value} decimal shape)', async () => {
    const svc = makeService();
    const instance = fakePlugin({
      readVatRates: () =>
        Promise.resolve({
          rates: [
            { id: 5, name: 'Fara TVA', value: 0 },
            { id: 6, name: 'Standard', value: 0.19 },
          ],
        }),
    });

    const lookup = await buildVatLookup(svc, instance);

    expect(lookup.get(5)).toBe(0);
    expect(lookup.get(6)).toBe(19);
  });

  it('returns an empty lookup when the plugin does not register readVatRates', async () => {
    const svc = makeService();
    const instance = fakePlugin({});

    const lookup = await buildVatLookup(svc, instance);

    expect(lookup.size).toBe(0);
  });
});
