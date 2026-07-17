import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { type Plugin, invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import {
  EMAG_PACKAGE,
  TEMU_PACKAGE,
  TRENDYOL_PACKAGE,
} from '../../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../../products/products.service.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import { UPDATE_PRICE_JOB, type UpdatePriceJob } from '../push-jobs.js';
import { effectiveVatRate, emagVatIdForRate } from '../push-offer.mapper.js';
import { TrendyolInventorySyncService } from '../trendyol-inventory-sync.service.js';

function majorFromMinor(minor: string | number | bigint): number {
  return Number(minor) / 100;
}

/**
 * Propagă o schimbare de preț pentru O ofertă către marketplace-ul ei, folosind
 * cel mai LIGHT endpoint disponibil — ca produsul să NU reintre în validare:
 *  - eMAG: `updatePrice` (light offer/save, doar prețul),
 *  - Trendyol: `updateStockAndPrice` (price-and-inventory, fără re-aprobare),
 *  - Temu: `updatePrice` (bg.local.goods.partial.update, goodsId+skuId interni).
 *
 * Prețul e citit din `syncState.price_amount_minor` al ofertei (editabil
 * per-ofertă), cu fallback la prețul produsului. Enqueue-uit de
 * `ListingsService.mergeSyncState` (editare per-ofertă) și de `OfferPriceService`
 * (setare pe toate ofertele).
 */
@Injectable()
export class PriceUpdateWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly trendyolSync: TrendyolInventorySyncService,
    private readonly workspace: WorkspaceService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<UpdatePriceJob>(UPDATE_PRICE_JOB, (data) => this.run(data));
  }

  async run(job: UpdatePriceJob): Promise<void> {
    const listing = await this.listings.get(job.listingId);
    const plugin = await this.registry.findById(listing.pluginId);
    const loaded = this.loaded.getById(listing.pluginId);
    if (plugin?.status !== 'active' || !loaded) return;

    const product = await this.products.get(listing.productId);
    const sale = majorFromMinor(listing.syncState.price_amount_minor ?? product.priceAmountMinor);
    if (!(sale > 0)) return;

    try {
      if (plugin.packageName === EMAG_PACKAGE) {
        await this.emagPrice(loaded.instance, listing, product, sale);
      } else if (plugin.packageName === TRENDYOL_PACKAGE) {
        // ECC-aware: doar RO via API + oglindire locală pe celelalte țări Trendyol.
        await this.trendyolSync.syncPrice(product, listing.id);
      } else if (plugin.packageName === TEMU_PACKAGE) {
        await this.temuPrice(loaded.instance, listing, sale);
      }
    } catch (err) {
      this.logger.warn(
        { listingId: listing.id, err: err instanceof Error ? err.message : String(err) },
        'price update failed',
      );
    }
  }

  private async emagPrice(
    instance: Plugin,
    listing: schema.Listing,
    product: schema.Product,
    sale: number,
  ): Promise<void> {
    // Id-ul de SELLER al ofertei eMAG (cel trimis la `offer/save`). La import e salvat
    // în `syncState.emag_offer_id` (= offer.id), la push îl setăm tot acolo, egal cu
    // `external_offer_id` și cu `stockCode`. Același fallback ca `ActivateOfferWorker`
    // (acoperă și date istorice). Fără niciun id → skip.
    const offerId = Number(
      listing.syncState.emag_offer_id ?? listing.syncState.external_offer_id ?? product.stockCode,
    );
    if (!Number.isInteger(offerId) || offerId <= 0) {
      this.logger.warn({ listingId: listing.id }, 'skip eMAG price — missing offer id');
      return;
    }
    const { vatPayer } = await this.workspace.get();
    const vatId = emagVatIdForRate(listing.platform, effectiveVatRate({ product, vatPayer }));
    await invokeAction(instance, 'updatePrice', {
      offerId,
      salePrice: sale,
      minSalePrice: 1,
      maxSalePrice: Math.round(sale * 2 * 100) / 100,
      ...(vatId !== undefined ? { vatId } : {}),
      platform: listing.platform,
    });
  }

  private async temuPrice(instance: Plugin, listing: schema.Listing, sale: number): Promise<void> {
    const goodsId = Number(listing.syncState.temu_goods_id);
    const skuId = Number(listing.syncState.temu_sku_id);
    if (!Number.isInteger(goodsId) || goodsId <= 0 || !Number.isInteger(skuId) || skuId <= 0) {
      this.logger.warn({ listingId: listing.id }, 'skip Temu price — missing goodsId/skuId');
      return;
    }
    await invokeAction(instance, 'updatePrice', {
      goodsId,
      skuId,
      amount: sale.toFixed(2),
      currency: 'RON',
    });
  }
}
