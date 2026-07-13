import { type schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { type Logger } from 'nestjs-pino';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { type ListingsService } from '../listings/listings.service.js';
import { EMAG_PACKAGE, TRENDYOL_PACKAGE } from '../marketplaces/marketplace-catalog.js';
import { type LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { type PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { type ProductsService } from '../products/products.service.js';
import { type StockCodeService } from '../products/stock-code.service.js';

import { PushDebugService } from './push-debug.service.js';

vi.mock('@opensales/plugin-sdk', async (importOriginal) => {
  const actual = await importOriginal();
  return { ...(actual as object), invokeAction: vi.fn() };
});

vi.mock('../import/push-offer.mapper.js', () => ({
  toEmagOfferPayload: (): Record<string, unknown> => ({ id: 42 }),
  toTrendyolItem: (): Record<string, unknown> => ({ barcode: 'EAN-1' }),
}));

// Referință top-level (nu `listings.applyPushResult`) — evită unbound-method la
// asertare, exact ca `enqueueMock` în products.service.test.ts.
let applyPushResultMock = vi.fn((id: string, status: string, syncState: unknown) =>
  Promise.resolve({ id, status, syncState }),
);

function makeService(opts: {
  listing?: Record<string, unknown> | null;
  pluginStatus?: string;
  packageName?: string;
  loaded?: boolean;
}) {
  const listing =
    opts.listing === null
      ? null
      : {
          id: 'l1',
          pluginId: 'pg-1',
          productId: 'p-1',
          platform: 'emag-ro',
          status: 'error',
          syncState: { price_amount_minor: '9999' },
          ...opts.listing,
        };
  applyPushResultMock = vi.fn((id: string, status: string, syncState: unknown) =>
    Promise.resolve({ id, status, syncState }),
  );
  const listings = {
    get: vi.fn(() =>
      listing === null ? Promise.reject(new Error('not found')) : Promise.resolve(listing),
    ),
    applyPushResult: applyPushResultMock,
  } as unknown as ListingsService;
  const registry = {
    findById: vi.fn(() =>
      Promise.resolve({
        status: opts.pluginStatus ?? 'active',
        packageName: opts.packageName ?? EMAG_PACKAGE,
      }),
    ),
  } as unknown as PluginRegistryService;
  const loaded = {
    getById: vi.fn(() => (opts.loaded === false ? undefined : { instance: { _actions: {} } })),
  } as unknown as LoadedPluginsRegistry;
  const products = {
    get: vi.fn(() => Promise.resolve({ id: 'p-1', sku: 'SKU1', vatRate: 0, stockQuantity: 5 })),
  } as unknown as ProductsService;
  const stockCodes = {
    ensureForProduct: vi.fn(() => Promise.resolve(42)),
  } as unknown as StockCodeService;
  const logger = { log: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
  return new PushDebugService(registry, loaded, products, listings, stockCodes, logger);
}

describe('PushDebugService.tracePushOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('reports a missing listing', async () => {
    const svc = makeService({ listing: null });
    const trace = await svc.tracePushOffer('l1');
    expect(trace.conclusion).toMatch(/inexistent/i);
    expect(trace.steps.at(-1)).toMatchObject({ step: 'load listing', ok: false });
  });

  it('reports when the plugin instance is not loaded in the process', async () => {
    const svc = makeService({ loaded: false });
    const trace = await svc.tracePushOffer('l1');
    expect(trace.conclusion).toMatch(/nu e încărcat/i);
    expect(trace.apiInvoked).toBe(false);
  });

  it('builds the eMAG payload without calling the API in dryRun', async () => {
    const svc = makeService({});
    const trace = await svc.tracePushOffer('l1', { dryRun: true });
    expect(trace.family).toBe('emag');
    expect(trace.payloadSent).toEqual({ id: 42 });
    expect(trace.apiInvoked).toBe(false);
    expect(vi.mocked(invokeAction)).not.toHaveBeenCalled();
  });

  it('invokes eMAG pushOffers (product_offer/save) and returns the raw result', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({ isError: false });
    const svc = makeService({});
    const trace = await svc.tracePushOffer('l1');

    expect(vi.mocked(invokeAction)).toHaveBeenCalledWith(expect.anything(), 'pushOffers', {
      mode: 'full',
      payloads: [{ id: 42 }],
      platform: 'emag-ro',
    });
    expect(trace.apiInvoked).toBe(true);
    expect(trace.apiResult).toEqual({ isError: false });
    expect(trace.error).toBeNull();
    expect(trace.conclusion).toMatch(/SUCCES/);
  });

  it('captures the raw error when the eMAG call fails', async () => {
    vi.mocked(invokeAction).mockRejectedValueOnce(new Error('eMAG 401 Unauthorized'));
    const svc = makeService({});
    const trace = await svc.tracePushOffer('l1');

    expect(trace.apiInvoked).toBe(true);
    expect(trace.error).toMatch(/401 Unauthorized/);
    expect(trace.conclusion).toMatch(/EȘUAT/);
    expect(trace.steps.at(-1)).toMatchObject({ ok: false });
  });

  it('skips a non-active plugin', async () => {
    const svc = makeService({ pluginStatus: 'error' });
    const trace = await svc.tracePushOffer('l1');
    expect(trace.conclusion).toMatch(/nu e activ/i);
    expect(trace.apiInvoked).toBe(false);
  });

  it('routes a Trendyol listing to createProduct', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({ batchRequestId: 'b1' });
    const svc = makeService({
      packageName: TRENDYOL_PACKAGE,
      listing: { platform: 'trendyol-ro' },
    });
    const trace = await svc.tracePushOffer('l1');

    expect(trace.family).toBe('trendyol');
    expect(vi.mocked(invokeAction)).toHaveBeenCalledWith(
      expect.anything(),
      'createProduct',
      expect.objectContaining({ items: [{ barcode: 'EAN-1' }] }),
    );
    expect(trace.apiResult).toEqual({ batchRequestId: 'b1' });
  });
});

describe('PushDebugService.resyncOffer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('refuses non-eMAG listings', async () => {
    const svc = makeService({
      packageName: TRENDYOL_PACKAGE,
      listing: { platform: 'trendyol-ro' },
    });
    const result = await svc.resyncOffer('l1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/doar pentru oferte eMAG/i);
  });

  it('refuses when the plugin is not active', async () => {
    const svc = makeService({
      pluginStatus: 'error',
      listing: { syncState: { emag_offer_id: 42 } },
    });
    const result = await svc.resyncOffer('l1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/nu este activ/i);
  });

  it('refuses when the offer was never published (no eMAG offer id)', async () => {
    const svc = makeService({ listing: { syncState: {} } });
    const result = await svc.resyncOffer('l1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/nu a fost publicată/i);
    expect(vi.mocked(invokeAction)).not.toHaveBeenCalled();
  });

  it('reports when eMAG has no offer for that id', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({ items: [] });
    const svc = makeService({ listing: { syncState: { emag_offer_id: 42 } } });
    const result = await svc.resyncOffer('l1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/nu a fost găsită/i);
  });

  it('surfaces the raw error when the eMAG call fails', async () => {
    vi.mocked(invokeAction).mockRejectedValueOnce(new Error('eMAG 401 Unauthorized'));
    const svc = makeService({ listing: { syncState: { emag_offer_id: 42 } } });
    const result = await svc.resyncOffer('l1');
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/401 Unauthorized/);
  });

  it('pulls title/price/stock/images/brand from a live eMAG offer as a per-listing override, active status', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({
      items: [
        {
          id: 42,
          name: 'Titlu nou',
          description: 'Descriere noua',
          brand: 'ACME',
          sale_price: 150.5,
          currency: 'RON',
          stock: [{ warehouse_id: 1, value: 7 }],
          status: 1,
          images: [{ url: 'https://x/1.jpg' }],
          validation_status: { value: 9, description: 'Approved' },
          offer_validation_status: { value: 1, description: 'Price ok' },
        },
      ],
    });
    const svc = makeService({
      listing: { status: 'rejected', syncState: { emag_offer_id: 42, title: 'Vechi' } },
    });

    const result = await svc.resyncOffer('l1');

    expect(vi.mocked(invokeAction)).toHaveBeenCalledWith(expect.anything(), 'syncOffers', {
      platform: 'emag-ro',
      data: { id: 42 },
    });
    expect(result.ok).toBe(true);
    expect(result.changes.length).toBeGreaterThan(0);
    expect(result.changes).toEqual(
      expect.arrayContaining([expect.objectContaining({ field: 'title', after: 'Titlu nou' })]),
    );

    expect(applyPushResultMock).toHaveBeenCalledWith(
      'l1',
      'active',
      expect.objectContaining({
        title: 'Titlu nou',
        description: 'Descriere noua',
        brand: 'ACME',
        price_amount_minor: '15050',
        price_currency: 'RON',
        stock_quantity: 7,
        images: [{ url: 'https://x/1.jpg' }],
      }),
    );
  });

  it('maps a manually-deactivated eMAG offer (status 0) to local status "paused", even when validation is fine', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({
      items: [{ id: 42, status: 0, validation_status: { value: 9 } }],
    });
    const svc = makeService({ listing: { status: 'active', syncState: { emag_offer_id: 42 } } });

    const result = await svc.resyncOffer('l1');

    expect(result.ok).toBe(true);
    expect(applyPushResultMock).toHaveBeenCalledWith('l1', 'paused', expect.anything());
  });

  it('clears reject_reasons/last_error when the listing leaves the rejected status', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({
      items: [{ id: 42, status: 1, validation_status: { value: 9 } }],
    });
    const svc = makeService({
      listing: {
        status: 'rejected',
        syncState: {
          emag_offer_id: 42,
          reject_reasons: ['categorie greșită'],
          last_error: { message: 'categorie greșită', at: '2026-01-01T00:00:00Z' },
        },
      },
    });

    const result = await svc.resyncOffer('l1');

    expect(result.ok).toBe(true);
    expect(applyPushResultMock).toHaveBeenCalledWith(
      'l1',
      'active',
      expect.objectContaining({ last_error: null }),
    );
    const [, , syncState] = applyPushResultMock.mock.calls[0] as unknown as [
      string,
      string,
      Record<string, unknown>,
    ];
    expect(syncState).not.toHaveProperty('reject_reasons');
  });

  it('populates reject_reasons/last_error from the live eMAG errors when the offer is rejected', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({
      items: [
        {
          id: 42,
          status: 1,
          validation_status: {
            value: 8,
            errors: { errors: [{ message: { ro_RO: 'Categorie incorectă' } }] },
          },
        },
      ],
    });
    const svc = makeService({ listing: { status: 'active', syncState: { emag_offer_id: 42 } } });

    const result = await svc.resyncOffer('l1');

    expect(result.ok).toBe(true);
    expect(applyPushResultMock).toHaveBeenCalledWith(
      'l1',
      'rejected',
      expect.objectContaining({ reject_reasons: ['Categorie incorectă'] }),
    );
    const [, , syncState] = applyPushResultMock.mock.calls[0] as unknown as [
      string,
      string,
      schema.ListingSyncState,
    ];
    expect(syncState.last_error?.message).toBe('Categorie incorectă');
  });

  it('clears stored images when eMAG returns an empty images array (seller removed all photos)', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({
      items: [{ id: 42, status: 1, images: [], validation_status: { value: 9 } }],
    });
    const svc = makeService({
      listing: {
        status: 'active',
        syncState: { emag_offer_id: 42, images: [{ url: 'https://x/old.jpg' }] },
      },
    });

    const result = await svc.resyncOffer('l1');

    expect(result.ok).toBe(true);
    expect(applyPushResultMock).toHaveBeenCalledWith(
      'l1',
      'active',
      expect.objectContaining({ images: [] }),
    );
  });

  it('coerces sale_price returned as a string (a known eMAG response quirk)', async () => {
    vi.mocked(invokeAction).mockResolvedValueOnce({
      items: [
        {
          id: 42,
          status: 1,
          sale_price: '150.5',
          currency: 'RON',
          validation_status: { value: 9 },
        },
      ],
    });
    const svc = makeService({ listing: { status: 'active', syncState: { emag_offer_id: 42 } } });

    const result = await svc.resyncOffer('l1');

    expect(result.ok).toBe(true);
    expect(applyPushResultMock).toHaveBeenCalledWith(
      'l1',
      'active',
      expect.objectContaining({ price_amount_minor: '15050' }),
    );
  });
});
