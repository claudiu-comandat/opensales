import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { invokeAction, type Plugin } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import {
  EMAG_PACKAGE,
  TEMU_PACKAGE,
  TRENDYOL_PACKAGE,
} from '../../marketplaces/marketplace-catalog.js';
import { MarketplaceEnablementService } from '../../marketplaces/marketplace-enablement.service.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { ProductsService } from '../../products/products.service.js';
import { UPDATE_STOCK_JOB, type UpdateStockJob } from '../push-jobs.js';
import { TrendyolInventorySyncService } from '../trendyol-inventory-sync.service.js';

import type { ListingInfo } from '../../products/dto/product-response.dto.js';

@Injectable()
export class UpdateStockWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly enablement: MarketplaceEnablementService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly trendyolSync: TrendyolInventorySyncService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.registerBatch<UpdateStockJob>(
      UPDATE_STOCK_JOB,
      (jobs) => this.runBatch(jobs),
      1000,
    );
  }

  async runBatch(jobs: UpdateStockJob[]): Promise<void> {
    // Jobs with a specific listingId are per-listing overrides — process individually.
    const withListing = jobs.filter((j) => j.listingId !== undefined);
    const productLevel = jobs.filter((j) => j.listingId === undefined);

    if (productLevel.length > 0) {
      const uniqueIds = [...new Set(productLevel.map((j) => j.productId))];
      const products = await this.products.getManyWithListings(uniqueIds);

      // Trendyol: up to 1000 products per price-and-inventory request
      await this.trendyolSync.syncStockMany(products);

      // eMAG / Temu: no batch API — still per-listing
      for (const product of products) {
        for (const listing of product.listings) {
          if (listing.pluginPackage === TRENDYOL_PACKAGE) continue;

          const resolution = await this.enablement.resolve(listing.platform);
          if (!resolution.ok) {
            this.logger.warn(
              { listingId: listing.id, marketplace: listing.platform },
              'skip stock fan-out — marketplace not enabled',
            );
            continue;
          }
          const loaded = this.loaded.getById(listing.pluginId);
          if (!loaded) continue;

          const stockValue =
            typeof listing.syncState.stock_quantity === 'number'
              ? listing.syncState.stock_quantity
              : Math.max(0, product.stockQuantity - product.stockReserved);

          try {
            if (listing.pluginPackage === EMAG_PACKAGE) {
              await this.emagStock(loaded.instance, listing, stockValue, product.stockCode);
            } else if (listing.pluginPackage === TEMU_PACKAGE) {
              await this.temuStock(loaded.instance, listing, stockValue);
            }
          } catch (err) {
            this.logger.warn(
              { listingId: listing.id, err: err instanceof Error ? err.message : String(err) },
              'stock update failed',
            );
          }
        }
      }
    }

    for (const job of withListing) {
      await this.run(job);
    }
  }

  async run(job: UpdateStockJob): Promise<void> {
    const product = await this.products.get(job.productId);
    // Fără listingId: toate ofertele (schimbare de stoc la nivel de produs).
    // Cu listingId: doar acea ofertă (override de stoc per-ofertă).
    const targets =
      job.listingId !== undefined
        ? product.listings.filter((l) => l.id === job.listingId)
        : product.listings;

    let trendyolHandled = false;
    for (const listing of targets) {
      // Trendyol e ECC-aware (doar RO via API + oglindire locală pe celelalte țări);
      // îl gestionăm o singură dată, la nivel de produs, prin serviciul dedicat.
      if (listing.pluginPackage === TRENDYOL_PACKAGE) {
        if (!trendyolHandled) {
          await this.trendyolSync.syncStock(product, job.listingId);
          trendyolHandled = true;
        }
        continue;
      }

      const resolution = await this.enablement.resolve(listing.platform);
      if (!resolution.ok) {
        this.logger.warn(
          { listingId: listing.id, marketplace: listing.platform },
          'skip stock fan-out — marketplace not enabled',
        );
        continue;
      }
      const loaded = this.loaded.getById(listing.pluginId);
      if (!loaded) continue;

      // Stocul per-ofertă (override) dacă există, altfel stocul disponibil (minus rezervat).
      const stockValue =
        typeof listing.syncState.stock_quantity === 'number'
          ? listing.syncState.stock_quantity
          : Math.max(0, product.stockQuantity - product.stockReserved);

      try {
        if (listing.pluginPackage === EMAG_PACKAGE) {
          await this.emagStock(loaded.instance, listing, stockValue, product.stockCode);
        } else if (listing.pluginPackage === TEMU_PACKAGE) {
          await this.temuStock(loaded.instance, listing, stockValue);
        }
      } catch (err) {
        this.logger.warn(
          { listingId: listing.id, err: err instanceof Error ? err.message : String(err) },
          'stock update failed',
        );
      }
    }
  }

  private async emagStock(
    instance: Plugin,
    listing: ListingInfo,
    stockValue: number,
    stockCode: number | null,
  ): Promise<void> {
    // Id-ul de SELLER al ofertei eMAG (cel trimis la `offer/save`). La import din eMAG
    // e salvat în `syncState.emag_offer_id` (= offer.id); la push live îl setăm tot acolo,
    // egal cu `external_offer_id` și cu `stockCode`-ul produsului. Folosim același fallback
    // ca `ActivateOfferWorker` ca să acoperim și date istorice. Fără niciun id → skip.
    const offerId = Number(
      listing.syncState.emag_offer_id ?? listing.syncState.external_offer_id ?? stockCode,
    );
    if (!Number.isInteger(offerId) || offerId <= 0) {
      this.logger.warn({ listingId: listing.id }, 'skip eMAG stock — missing offer id');
      return;
    }
    await invokeAction(instance, 'updateStock', {
      offerId,
      value: stockValue,
      platform: listing.platform,
    });
  }

  private async temuStock(
    instance: Plugin,
    listing: ListingInfo,
    stockValue: number,
  ): Promise<void> {
    // Temu cere id-urile interne (goodsId + skuId) persistate la push.
    const goodsId = Number(listing.syncState.temu_goods_id);
    const skuId = Number(listing.syncState.temu_sku_id);
    if (!Number.isInteger(goodsId) || goodsId <= 0 || !Number.isInteger(skuId) || skuId <= 0) {
      this.logger.warn({ listingId: listing.id }, 'skip Temu stock — missing goodsId/skuId');
      return;
    }
    await invokeAction(instance, 'updateStock', {
      goodsId,
      skuStockTargetList: [{ skuId, stockTarget: stockValue }],
    });
  }
}
