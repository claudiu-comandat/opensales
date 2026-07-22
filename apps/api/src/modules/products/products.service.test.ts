import { createDb, schema } from '@opensales/db';
import { type ActionHandler, type Plugin } from '@opensales/plugin-sdk';
import { eq, sql } from 'drizzle-orm';
import { type Logger } from 'nestjs-pino';
import { v7 as uuidv7 } from 'uuid';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { type JobQueueService } from '../../jobs/job-queue.service.js';
import { type CurrencyService } from '../currency/currency.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { type PluginEventsBus } from '../plugins/events/plugin-events.bus.js';
import { type LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { type PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';

import { ProductsService } from './products.service.js';

type Handlers = Record<string, (input: unknown) => Promise<unknown>>;

function fakePlugin(handlers: Handlers): Plugin {
  const actions: Record<string, ActionHandler<unknown, unknown>> = {};
  for (const [name, handle] of Object.entries(handlers)) {
    actions[name] = { input: z.any(), output: z.any(), handle };
  }
  return { _actions: actions } as unknown as Plugin;
}

const DB_URL =
  process.env.DATABASE_URL_TEST ?? 'postgres://opensales:opensales@localhost:5433/opensales_test';
const hasDb = !!process.env.DATABASE_URL_TEST;

const { db, close } = createDb(DB_URL, { max: 2 });

afterAll(async () => {
  await close();
});

const emitMock = vi.fn();
const events = { emitFromPlatform: emitMock } as unknown as PluginEventsBus;
const enqueueMock = vi.fn(() => Promise.resolve('job-1'));
const queue = { enqueue: enqueueMock } as unknown as JobQueueService;
const listings = new ListingsService(db, events, queue);

/** Plugin/registry mocks — nu sunt atinse dacă produsul nu are stockCode (cazul comun). */
const findByIdMock = vi.fn(() => Promise.resolve(null as unknown));
const registry = { findById: findByIdMock } as unknown as PluginRegistryService;
const getByIdMock = vi.fn((): { instance: Plugin } | null => null);
const loaded = { getById: getByIdMock } as unknown as LoadedPluginsRegistry;

/** Fără cross-currency în teste (listing-urile eMAG seedate sunt RON) — trece prin neschimbat. */
const convertMinorMock = vi.fn((amount: bigint) => Promise.resolve(amount));
const currency = { convertMinor: convertMinorMock } as unknown as CurrencyService;

const warnMock = vi.fn();
const logger = { log: vi.fn(), warn: warnMock, error: vi.fn() } as unknown as Logger;

const makeService = () =>
  new ProductsService(db, events, queue, listings, registry, loaded, currency, logger);

async function seedEmagPlugin(): Promise<string> {
  const pluginId = uuidv7();
  await db.insert(schema.plugins).values({
    id: pluginId,
    packageName: '@opensales-plugin/emag',
    version: '1.0.0',
    displayName: 'eMAG',
    manifest: { name: 'emag', version: '1.0.0', permissions: [] },
    hash: `hash-${pluginId.slice(0, 8)}`,
  });
  return pluginId;
}

async function seedEmagListing(productId: string, pluginId: string): Promise<void> {
  await db.insert(schema.listings).values({
    id: uuidv7(),
    productId,
    pluginId,
    externalListingId: `emag-ro:${productId}`,
    platform: 'emag-ro',
    status: 'active',
    syncState: {},
  });
}

const base = {
  sku: 'SKU-SVC-001',
  name: 'Widget',
  priceAmountMinor: 9999n,
  priceCurrency: 'RON',
  stockQuantity: 10,
  images: [] as { url: string; alt?: string }[],
  attributes: {} as Record<string, unknown>,
  isActive: true,
};

describe.skipIf(!hasDb)('ProductsService', () => {
  beforeEach(async () => {
    await db.execute(
      sql`TRUNCATE TABLE ${schema.orderItems}, ${schema.orders}, ${schema.products}, ${schema.plugins} RESTART IDENTITY CASCADE`,
    );
    emitMock.mockClear();
    findByIdMock.mockReset().mockResolvedValue(null);
    getByIdMock.mockReset().mockReturnValue(null);
    warnMock.mockClear();
  });

  it('create returns product with id', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    expect(p.id).toBeTruthy();
    expect(p.sku).toBe('SKU-SVC-001');
    expect(p.priceAmountMinor).toBe(9999n);
  });

  it('create throws 409 on duplicate SKU', async () => {
    const svc = makeService();
    await svc.create(base);
    await expect(svc.create(base)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('list returns paginated results', async () => {
    const svc = makeService();
    await svc.create({ ...base, sku: 'P1', name: 'Alpha' });
    await svc.create({ ...base, sku: 'P2', name: 'Beta' });
    const { data, total } = await svc.list({ page: 1, pageSize: 10 });
    expect(total).toBe(2);
    expect(data).toHaveLength(2);
  });

  it('list search filters by name case-insensitively', async () => {
    const svc = makeService();
    await svc.create({ ...base, sku: 'PA', name: 'Apple Watch' });
    await svc.create({ ...base, sku: 'PB', name: 'Samsung Galaxy' });
    const { data, total } = await svc.list({ page: 1, pageSize: 10, search: 'apple' });
    expect(total).toBe(1);
    expect(data[0]?.name).toBe('Apple Watch');
  });

  it('list filters by isActive', async () => {
    const svc = makeService();
    await svc.create({ ...base, sku: 'ACTIVE', isActive: true });
    await svc.create({ ...base, sku: 'INACTIVE', isActive: false });
    const { total } = await svc.list({ page: 1, pageSize: 10, isActive: false });
    expect(total).toBe(1);
  });

  it('get returns product by id', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    const fetched = await svc.get(created.id);
    expect(fetched.sku).toBe('SKU-SVC-001');
  });

  it('get throws 404 for unknown id', async () => {
    const svc = makeService();
    await expect(svc.get(uuidv7())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update patches fields', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    const updated = await svc.update(created.id, { name: 'Updated Name' });
    expect(updated.product.name).toBe('Updated Name');
    expect(updated.product.sku).toBe('SKU-SVC-001');
    expect(updated.changedFields).toEqual(['name']);
  });

  it('update throws 404 for unknown id', async () => {
    const svc = makeService();
    await expect(svc.update(uuidv7(), { name: 'x' })).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('update allows changing the SKU and enqueues a content push (propagates new part_number to eMAG)', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    enqueueMock.mockClear();
    const updated = await svc.update(created.id, { sku: 'SKU-RENAMED' });
    expect(updated.product.sku).toBe('SKU-RENAMED');
    expect(enqueueMock).toHaveBeenCalledWith('plugin.update_product_content', {
      items: [{ productId: created.id, changedFields: ['sku'] }],
    });
  });

  it('update throws 409 when the new SKU is already used by another product', async () => {
    const svc = makeService();
    await svc.create({ ...base, sku: 'SKU-TAKEN' });
    const other = await svc.create({ ...base, sku: 'SKU-OTHER-2' });
    await expect(svc.update(other.id, { sku: 'SKU-TAKEN' })).rejects.toMatchObject({
      code: 'CONFLICT',
    });
  });

  it('delete removes product', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    await svc.delete(created.id);
    await expect(svc.get(created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('delete throws 404 for unknown id', async () => {
    const svc = makeService();
    await expect(svc.delete(uuidv7())).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('delete does not touch eMAG when the product was never pushed (no stockCode)', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    await svc.delete(created.id);
    expect(findByIdMock).not.toHaveBeenCalled();
  });

  it('delete sends eMAG End-of-Life (status 2, light offer/save) before removing a pushed product', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    await db
      .update(schema.products)
      .set({ stockCode: 4242 })
      .where(eq(schema.products.id, created.id));
    const pluginId = await seedEmagPlugin();
    await seedEmagListing(created.id, pluginId);

    const pushOffer = vi.fn((_input: unknown) => Promise.resolve({ ok: true, raw: {} }));
    findByIdMock.mockResolvedValue({ status: 'active', packageName: '@opensales-plugin/emag' });
    getByIdMock.mockReturnValue({ instance: fakePlugin({ pushOffer }) });

    await svc.delete(created.id);

    expect(pushOffer).toHaveBeenCalledWith({
      mode: 'light',
      payload: { id: 4242, status: 2 },
      platform: 'emag-ro',
    });
    await expect(svc.get(created.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('delete aborts (keeps the product) when the eMAG EOL push fails', async () => {
    const svc = makeService();
    const created = await svc.create(base);
    await db
      .update(schema.products)
      .set({ stockCode: 4243 })
      .where(eq(schema.products.id, created.id));
    const pluginId = await seedEmagPlugin();
    await seedEmagListing(created.id, pluginId);

    const pushOffer = vi.fn(() => Promise.reject(new Error('eMAG unavailable')));
    findByIdMock.mockResolvedValue({ status: 'active', packageName: '@opensales-plugin/emag' });
    getByIdMock.mockReturnValue({ instance: fakePlugin({ pushOffer }) });

    await expect(svc.delete(created.id)).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(svc.get(created.id)).resolves.toMatchObject({ id: created.id });
  });

  it('emits product.created on create', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    expect(emitMock).toHaveBeenCalledWith('product.created', { productId: p.id, sku: p.sku });
  });

  it('emits product.updated on update with changed keys', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    emitMock.mockClear();
    await svc.update(p.id, { name: 'New name' });
    expect(emitMock).toHaveBeenCalledWith('product.updated', {
      productId: p.id,
      changes: ['name'],
    });
  });

  it('enqueues UPDATE_STOCK_JOB when stockQuantity changes (fan-out to all offers)', async () => {
    const svc = makeService();
    const p = await svc.create(base); // stock 10
    enqueueMock.mockClear();
    await svc.update(p.id, { stockQuantity: 4 });
    expect(enqueueMock).toHaveBeenCalledWith(
      'plugin.update_stock',
      { productId: p.id },
      { singletonKey: p.id, singletonSeconds: 5 },
    );
  });

  it('does NOT enqueue UPDATE_STOCK_JOB when stock is unchanged', async () => {
    const svc = makeService();
    const p = await svc.create(base); // stock 10
    enqueueMock.mockClear();
    await svc.update(p.id, { name: 'x', stockQuantity: 10 });
    expect(enqueueMock).not.toHaveBeenCalledWith('plugin.update_stock', expect.anything());
  });

  it('does NOT enqueue a content push when the form resends every field but only stock changed', async () => {
    // Formularul de edit retrimite TOT obiectul produsului la fiecare save — un diff pe
    // simplă prezență ar declanșa (greșit) re-push de conținut. Verificăm diff-ul pe valoare.
    const svc = makeService();
    const p = await svc.create(base); // stock 10
    enqueueMock.mockClear();
    await svc.update(p.id, { ...base, stockQuantity: 4 });
    expect(enqueueMock).toHaveBeenCalledWith(
      'plugin.update_stock',
      { productId: p.id },
      { singletonKey: p.id, singletonSeconds: 5 },
    );
    expect(enqueueMock).not.toHaveBeenCalledWith(
      'plugin.update_product_content',
      expect.anything(),
    );
  });

  it('does NOT enqueue a content push when only price/vatRate changed — routes to UPDATE_PRICE_JOB per listing instead', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    const pluginId = await seedEmagPlugin();
    await seedEmagListing(p.id, pluginId);
    const [listing] = await listings.listByProduct(p.id);
    if (!listing) throw new Error('listing not seeded');
    enqueueMock.mockClear();

    await svc.update(p.id, { ...base, priceAmountMinor: 15000n });

    expect(enqueueMock).toHaveBeenCalledWith(
      'plugin.update_price',
      { listingId: listing.id },
      { singletonKey: listing.id, singletonSeconds: 5 },
    );
    expect(enqueueMock).not.toHaveBeenCalledWith(
      'plugin.update_product_content',
      expect.anything(),
    );
    expect(enqueueMock).not.toHaveBeenCalledWith('plugin.update_stock', expect.anything());

    const updatedListing = await listings.get(listing.id);
    expect(updatedListing.syncState.price_amount_minor).toBe('15000');
    expect(updatedListing.syncState.price_currency).toBe('RON');
  });

  it('DOES enqueue a content push when a real content field changes, even alongside unchanged stock/price', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    enqueueMock.mockClear();

    await svc.update(p.id, { ...base, name: 'New Name' });

    expect(enqueueMock).toHaveBeenCalledWith('plugin.update_product_content', {
      items: [{ productId: p.id, changedFields: ['name'] }],
    });
    expect(enqueueMock).not.toHaveBeenCalledWith('plugin.update_stock', expect.anything());
    expect(enqueueMock).not.toHaveBeenCalledWith('plugin.update_price', expect.anything());
  });

  it('does NOT flag "attributes" as changed when the form resends the same object with keys in a different order', async () => {
    // Postgres reordonează cheile JSONB canonic — un diff naiv (JSON.stringify simplu)
    // ar vedea "schimbat" chiar și fără nicio modificare reală de valoare.
    const svc = makeService();
    const p = await svc.create({
      ...base,
      attributes: { culoare: 'rosu', marime: 'M', material: 'bumbac' },
    });
    enqueueMock.mockClear();

    await svc.update(p.id, {
      ...base,
      attributes: { material: 'bumbac', marime: 'M', culoare: 'rosu' },
    });

    expect(enqueueMock).not.toHaveBeenCalledWith(
      'plugin.update_product_content',
      expect.anything(),
    );
  });

  it('updateMany() also propagates price-only changes to listings (bulk PATCH parity with single update)', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    const pluginId = await seedEmagPlugin();
    await seedEmagListing(p.id, pluginId);
    const [listing] = await listings.listByProduct(p.id);
    if (!listing) throw new Error('listing not seeded');
    enqueueMock.mockClear();

    const { updated } = await svc.updateMany([{ id: p.id, priceAmountMinor: 20000n }]);

    expect(updated).toBe(1);
    expect(enqueueMock).toHaveBeenCalledWith(
      'plugin.update_price',
      { listingId: listing.id },
      { singletonKey: listing.id, singletonSeconds: 5 },
    );
    expect(enqueueMock).not.toHaveBeenCalledWith(
      'plugin.update_product_content',
      expect.anything(),
    );
    const updatedListing = await listings.get(listing.id);
    expect(updatedListing.syncState.price_amount_minor).toBe('20000');
  });

  it('propagatePriceOnly does not abort the request when one listing fails (logs and continues)', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    const pluginId = await seedEmagPlugin();
    await seedEmagListing(p.id, pluginId);
    const [listing] = await listings.listByProduct(p.id);
    if (!listing) throw new Error('listing not seeded');
    // Simulează o ofertă ștearsă concurent: setSyncState aruncă NOT_FOUND pentru orice listing.
    const setSyncStateMock = vi
      .spyOn(listings, 'setSyncState')
      .mockRejectedValueOnce(new Error('Listing not found'));

    const updated = await svc.update(p.id, { ...base, priceAmountMinor: 30000n, name: 'New Name' });

    expect(updated.product.priceAmountMinor).toBe(30000n);
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ listingId: listing.id }),
      expect.stringContaining('push de preț eșuat'),
    );
    // Content job pentru 'name' tot trebuie să plece, chiar dacă push-ul de preț a eșuat.
    expect(enqueueMock).toHaveBeenCalledWith('plugin.update_product_content', {
      items: [{ productId: p.id, changedFields: ['name', 'priceAmountMinor'] }],
    });
    setSyncStateMock.mockRestore();
  });

  it('emits product.deleted on delete', async () => {
    const svc = makeService();
    const p = await svc.create(base);
    emitMock.mockClear();
    await svc.delete(p.id);
    expect(emitMock).toHaveBeenCalledWith('product.deleted', { productId: p.id, sku: p.sku });
  });

  // ── Backfill linkuri order_items orfane (comenzi importate înainte de produse) ──

  async function seedOrphanOrderItem(sku: string): Promise<string> {
    const pluginId = uuidv7();
    await db.insert(schema.plugins).values({
      id: pluginId,
      packageName: `test-plugin-${pluginId.slice(0, 8)}`,
      version: '1.0.0',
      displayName: 'Test Plugin',
      manifest: { name: 'test-plugin', version: '1.0.0', permissions: [] },
      hash: `hash-${pluginId.slice(0, 8)}`,
    });
    const orderId = uuidv7();
    await db.insert(schema.orders).values({
      id: orderId,
      externalId: `EXT-${orderId.slice(0, 8)}`,
      pluginId,
      status: 'new',
      totalAmountMinor: 1000n,
      totalCurrency: 'RON',
      billingAddress: {},
      shippingAddress: {},
      placedAt: new Date(),
    });
    const itemId = uuidv7();
    await db.insert(schema.orderItems).values({
      id: itemId,
      orderId,
      productId: null, // comanda importată înainte ca produsul să existe
      sku,
      name: 'Produs din comandă',
      quantity: 1,
      unitPriceAmountMinor: 1000n,
      unitPriceCurrency: 'RON',
    });
    return itemId;
  }

  async function productIdOfItem(itemId: string): Promise<string | null> {
    const [row] = await db
      .select({ productId: schema.orderItems.productId })
      .from(schema.orderItems)
      .where(sql`id = ${itemId}`)
      .limit(1);
    return row?.productId ?? null;
  }

  it('create backfills orphan order_items with the matching SKU', async () => {
    const itemId = await seedOrphanOrderItem('SKU-ORPHAN-1');
    const svc = makeService();
    const p = await svc.create({ ...base, sku: 'SKU-ORPHAN-1' });

    expect(await productIdOfItem(itemId)).toBe(p.id);
  });

  const upsertBase = {
    ...base,
    description: null,
    brand: null,
    ean: null,
    vatRate: null,
  };

  it('upsertBySku backfills orphan order_items (order imported before product)', async () => {
    const itemId = await seedOrphanOrderItem('SKU-ORPHAN-2');
    const svc = makeService();
    const p = await svc.upsertBySku({ ...upsertBase, sku: 'SKU-ORPHAN-2' });

    expect(await productIdOfItem(itemId)).toBe(p.id);
  });

  it('upsertBySku also repairs orphans when the product already exists (re-import)', async () => {
    const svc = makeService();
    const p = await svc.create({ ...base, sku: 'SKU-ORPHAN-3' });
    // Linia orfană apare DUPĂ ce produsul există deja (ex. legătură pierdută istoric).
    const itemId = await seedOrphanOrderItem('SKU-ORPHAN-3');

    await svc.upsertBySku({ ...upsertBase, sku: 'SKU-ORPHAN-3', name: 'Reimportat' });

    expect(await productIdOfItem(itemId)).toBe(p.id);
  });

  it('does NOT touch order_items already linked to another product', async () => {
    const svc = makeService();
    const other = await svc.create({ ...base, sku: 'SKU-OTHER' });
    const itemId = await seedOrphanOrderItem('SKU-LINKED');
    // Leagă manual linia de alt produs.
    await db
      .update(schema.orderItems)
      .set({ productId: other.id })
      .where(sql`id = ${itemId}`);

    await svc.create({ ...base, sku: 'SKU-LINKED' });

    // Rămâne legat de produsul original — backfill atinge doar product_id NULL.
    expect(await productIdOfItem(itemId)).toBe(other.id);
  });

  describe('applyStockContributionBySku', () => {
    it('re-trimiterea aceleiași comenzi (sku, sourceOrderId) nu dublează stocul', async () => {
      const svc = makeService();
      await svc.create({ ...base, sku: 'SKU-DEDUP-1', stockQuantity: 10 });

      const first = await svc.applyStockContributionBySku('SKU-DEDUP-1', 'ORDER-A', 5);
      expect(first.applied).toBe(true);
      expect(first.product?.stockQuantity).toBe(15);

      // Retry / dublu-click / re-rulare a EXACT aceleiași comenzi.
      const retry = await svc.applyStockContributionBySku('SKU-DEDUP-1', 'ORDER-A', 5);
      expect(retry.applied).toBe(false);
      expect(retry.product?.stockQuantity).toBe(15);
    });

    it('o comandă diferită pentru același SKU tot se adaugă', async () => {
      const svc = makeService();
      await svc.create({ ...base, sku: 'SKU-DEDUP-2', stockQuantity: 0 });

      await svc.applyStockContributionBySku('SKU-DEDUP-2', 'ORDER-A', 3);
      const second = await svc.applyStockContributionBySku('SKU-DEDUP-2', 'ORDER-B', 4);

      expect(second.applied).toBe(true);
      expect(second.product?.stockQuantity).toBe(7);
    });

    it('fără sourceOrderId cade pe comportamentul vechi (aditiv necondiționat)', async () => {
      const svc = makeService();
      await svc.create({ ...base, sku: 'SKU-DEDUP-3', stockQuantity: 1 });

      const first = await svc.applyStockContributionBySku('SKU-DEDUP-3', undefined, 2);
      const second = await svc.applyStockContributionBySku('SKU-DEDUP-3', undefined, 2);

      expect(first.applied).toBe(true);
      expect(second.applied).toBe(true);
      expect(second.product?.stockQuantity).toBe(5);
    });

    it('returnează applied=false pentru un SKU inexistent', async () => {
      const svc = makeService();
      const result = await svc.applyStockContributionBySku('SKU-LIPSA', 'ORDER-X', 5);
      expect(result.applied).toBe(false);
      expect(result.product).toBeNull();
    });
  });
});
