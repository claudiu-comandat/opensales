import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import {
  EMAG_PACKAGE,
  TRENDYOL_PACKAGE,
  trendyolStorefrontFor,
} from '../../marketplaces/marketplace-catalog.js';
import { MarketplaceEnablementService } from '../../marketplaces/marketplace-enablement.service.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { ProductsService, type ProductWithListings } from '../../products/products.service.js';
import { ACTIVATE_OFFERS_JOB, type ActivateOffersJob } from '../push-jobs.js';

import type { ListingInfo } from '../../products/dto/product-response.dto.js';

@Injectable()
export class ActivateOfferWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly enablement: MarketplaceEnablementService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<ActivateOffersJob>(ACTIVATE_OFFERS_JOB, (data) => this.run(data));
  }

  async run(job: ActivateOffersJob): Promise<void> {
    const product = await this.products.get(job.productId);
    for (const listing of product.listings) {
      // Nu activăm listing-uri în stări "terminale" gestionate de reconcile/marketplace:
      // pending_approval = în revizuire, rejected = respins (necesită re-push cu corecții).
      if (
        listing.status === 'active' ||
        listing.status === 'pending_approval' ||
        listing.status === 'rejected'
      )
        continue;
      const resolution = await this.enablement.resolve(listing.platform);
      if (!resolution.ok) continue;
      const loaded = this.loaded.getById(listing.pluginId);
      if (!loaded) continue;

      try {
        if (listing.pluginPackage === EMAG_PACKAGE) {
          await this.activateEmag(loaded.instance, listing, product);
        } else if (listing.pluginPackage === TRENDYOL_PACKAGE) {
          await this.activateTrendyol(loaded.instance, listing, product);
        } else {
          continue;
        }
        await this.listings.applyPushResult(listing.id, 'active', {
          ...listing.syncState,
          push_state: 'pushed',
          last_error: null,
        });
      } catch (err) {
        this.logger.warn(
          { listingId: listing.id, err: err instanceof Error ? err.message : String(err) },
          'activate offer failed',
        );
      }
    }
  }

  private async activateEmag(
    instance: Plugin,
    listing: ListingInfo,
    product: ProductWithListings,
  ): Promise<void> {
    const offerId = Number(
      listing.syncState.emag_offer_id ?? listing.syncState.external_offer_id ?? product.stockCode,
    );
    if (!Number.isInteger(offerId) || offerId <= 0) return;
    await invokeAction(instance, 'pushOffer', {
      mode: 'light',
      payload: { id: offerId, status: 1 },
      platform: listing.platform,
    });
  }

  private async activateTrendyol(
    instance: Plugin,
    listing: ListingInfo,
    product: ProductWithListings,
  ): Promise<void> {
    const storeFrontCode = trendyolStorefrontFor(listing.platform);
    const listingBarcode =
      typeof listing.syncState.barcode === 'string' ? listing.syncState.barcode : null;
    await invokeAction(instance, 'archiveProducts', {
      items: [{ barcode: listingBarcode ?? product.ean ?? product.sku, archived: false }],
      ...(storeFrontCode ? { storeFrontCode } : {}),
    });
  }
}
