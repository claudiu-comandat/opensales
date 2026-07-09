import { Injectable } from '@nestjs/common';

import { JobQueueService } from '../../jobs/job-queue.service.js';
import { CurrencyService } from '../currency/currency.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { marketplaceCurrency } from '../marketplaces/marketplace-catalog.js';

import { UPDATE_PRICE_JOB, type UpdatePriceJob } from './push-jobs.js';

@Injectable()
export class OfferPriceService {
  constructor(
    private readonly listings: ListingsService,
    private readonly currency: CurrencyService,
    private readonly queue: JobQueueService,
  ) {}

  /**
   * Setează prețul (RON, minor units) pe TOATE ofertele unui produs: convertește
   * în moneda fiecărui marketplace (Temu rămâne în RON), salvează pe fiecare
   * ofertă și enqueue-uiește propagarea light către marketplace. Per-marketplace
   * separat se face din editarea ofertei (PATCH /listings/:id/sync-state).
   */
  async setPriceForProduct(
    productId: string,
    amountMinorRon: bigint,
  ): Promise<{ updated: number }> {
    const listings = await this.listings.listByProduct(productId);
    for (const listing of listings) {
      const isTemu = listing.platform.startsWith('temu-');
      const target = isTemu ? 'RON' : (marketplaceCurrency(listing.platform) ?? 'RON');
      const converted =
        target === 'RON'
          ? amountMinorRon
          : await this.currency.convertMinor(amountMinorRon, 'RON', target);
      await this.listings.setSyncState(listing.id, {
        ...listing.syncState,
        price_amount_minor: String(converted),
        price_currency: target,
      });
      await this.queue.enqueue<UpdatePriceJob>(UPDATE_PRICE_JOB, { listingId: listing.id });
    }
    return { updated: listings.length };
  }
}
