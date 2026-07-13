import { describe, expect, it, vi } from 'vitest';

import { DomainError } from '../../../errors/domain.error.js';
import { type JobQueueService } from '../../../jobs/job-queue.service.js';
import { type ListingsService } from '../../listings/listings.service.js';
import { type LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { type ProductsService } from '../../products/products.service.js';
import { type StockCodeService } from '../../products/stock-code.service.js';
import { type TrendyolInventorySyncService } from '../trendyol-inventory-sync.service.js';

import { UpdateProductContentWorker } from './update-product-content.worker.js';

function makeWorker(
  getMock: ReturnType<typeof vi.fn>,
  listByProductMock: ReturnType<typeof vi.fn>,
  warnMock: ReturnType<typeof vi.fn>,
): UpdateProductContentWorker {
  return new UpdateProductContentWorker(
    {} as unknown as JobQueueService,
    {} as unknown as LoadedPluginsRegistry,
    { get: getMock } as unknown as ProductsService,
    { listByProduct: listByProductMock } as unknown as ListingsService,
    {} as unknown as StockCodeService,
    {} as unknown as TrendyolInventorySyncService,
    { warn: warnMock } as never,
  );
}

describe('UpdateProductContentWorker.run', () => {
  it('a NOT_FOUND item (product deleted between enqueue and processing) is skipped, others still process', async () => {
    const getMock = vi.fn((productId: string) => {
      if (productId === 'bad-1') return Promise.reject(DomainError.notFound('Product not found'));
      return Promise.resolve({ id: productId }) as never;
    });
    const listByProductMock = vi.fn(() => Promise.resolve([]));
    const warnMock = vi.fn();
    const worker = makeWorker(getMock, listByProductMock, warnMock);

    await worker.run({
      items: [
        { productId: 'bad-1', changedFields: ['name'] },
        { productId: 'good-1', changedFields: ['name'] },
      ],
    });

    expect(getMock).toHaveBeenCalledWith('bad-1');
    expect(getMock).toHaveBeenCalledWith('good-1');
    expect(listByProductMock).toHaveBeenCalledWith('good-1');
    expect(warnMock).toHaveBeenCalledWith(
      expect.objectContaining({ productId: 'bad-1' }),
      expect.stringContaining('not found'),
    );
  });

  it('a transient (non-NOT_FOUND) failure propagates so pg-boss retries the whole job, instead of being silently swallowed', async () => {
    const getMock = vi.fn((productId: string) => {
      if (productId === 'bad-1') return Promise.reject(new Error('connection reset'));
      return Promise.resolve({ id: productId }) as never;
    });
    const listByProductMock = vi.fn(() => Promise.resolve([]));
    const warnMock = vi.fn();
    const worker = makeWorker(getMock, listByProductMock, warnMock);

    await expect(
      worker.run({
        items: [
          { productId: 'bad-1', changedFields: ['name'] },
          { productId: 'good-1', changedFields: ['name'] },
        ],
      }),
    ).rejects.toThrow('connection reset');

    // Nu s-a înghițit eroarea și nu s-a continuat silențios la produsul următor.
    expect(getMock).not.toHaveBeenCalledWith('good-1');
    expect(warnMock).not.toHaveBeenCalled();
  });
});
