import { Injectable } from '@nestjs/common';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { ListingsService } from '../listings/listings.service.js';
import { trendyolStorefrontFor } from '../marketplaces/marketplace-catalog.js';
import { MarketplaceEnablementService } from '../marketplaces/marketplace-enablement.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { WorkspaceService } from '../workspace/workspace.service.js';

import { effectiveVatRate } from './push-offer.mapper.js';

import type { ListingInfo } from '../products/dto/product-response.dto.js';
import type { ProductWithListings } from '../products/products.service.js';

const TRENDYOL_RO = 'trendyol-ro';

function majorFromMinor(minor: string | number | bigint): number {
  return Number(minor) / 100;
}

/**
 * Propagă stoc/preț pe ofertele Trendyol ale unui produs, respectând Easy Cross
 * Country (ECC):
 *   - ECC ON  → trimite DOAR pe RO prin API; celelalte țări (GR/BG/…) sunt oglinzi
 *     gestionate de Trendyol, deci doar le actualizăm LOCAL (syncState) ca platforma
 *     să reflecte schimbarea, fără request către Trendyol.
 *   - ECC OFF → trimite pe fiecare ofertă independent (cu TVA, cerut de unele țări).
 * Update-urile folosesc endpoint-ul `updateStockAndPrice` (price-and-inventory),
 * care NU re-declanșează aprobarea, și trimit DOAR câmpul modificat (stoc sau preț).
 */
@Injectable()
export class TrendyolInventorySyncService {
  constructor(
    private readonly enablement: MarketplaceEnablementService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly listings: ListingsService,
    private readonly workspace: WorkspaceService,
    private readonly logger: Logger,
  ) {}

  async syncStock(product: ProductWithListings, changedListingId?: string): Promise<void> {
    await this.fanOut(product, { stock: true }, changedListingId);
  }

  async syncPrice(product: ProductWithListings, changedListingId?: string): Promise<void> {
    await this.fanOut(product, { price: true }, changedListingId);
  }

  private async eccOn(): Promise<boolean> {
    const res = await this.enablement.resolve(TRENDYOL_RO);
    return res.ok && res.plugin.config.trendyolEasyCrossCountry === true;
  }

  private stockOf(listing: ListingInfo, product: ProductWithListings): number {
    // ponytail: listing override nu e ajustat pentru rezervări — e un plafon manual per-marketplace
    if (typeof listing.syncState.stock_quantity === 'number')
      return listing.syncState.stock_quantity;
    return Math.max(0, product.stockQuantity - product.stockReserved);
  }

  private priceMinorOf(
    listing: ListingInfo,
    product: ProductWithListings,
  ): string | number | bigint {
    const v = listing.syncState.price_amount_minor;
    return typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint'
      ? v
      : product.priceAmountMinor;
  }

  private async fanOut(
    product: ProductWithListings,
    opts: { stock?: boolean; price?: boolean },
    changedListingId?: string,
  ): Promise<void> {
    const trendyol = product.listings.filter((l) => l.platform.startsWith('trendyol-'));
    if (trendyol.length === 0) return;

    const { vatPayer } = await this.workspace.get();
    const ro = trendyol.find((l) => l.platform === TRENDYOL_RO);
    if ((await this.eccOn()) && ro) {
      // Push doar pe RO; oglindim local restul țărilor.
      await this.pushItem(ro, product, opts, vatPayer);
      const roStock = this.stockOf(ro, product);
      const roPriceMinor = String(this.priceMinorOf(ro, product));
      const roCurrency =
        typeof ro.syncState.price_currency === 'string' ? ro.syncState.price_currency : 'RON';
      for (const mirror of trendyol) {
        if (mirror.platform === TRENDYOL_RO) continue;
        const patch = { ...mirror.syncState };
        if (opts.stock) patch.stock_quantity = roStock;
        if (opts.price) {
          patch.price_amount_minor = roPriceMinor;
          patch.price_currency = roCurrency;
        }
        await this.listings.setSyncState(mirror.id, patch);
      }
      return;
    }

    // ECC off (sau fără ofertă RO): trimite independent oferta țintă (sau toate).
    const targets =
      changedListingId !== undefined ? trendyol.filter((l) => l.id === changedListingId) : trendyol;
    for (const listing of targets) await this.pushItem(listing, product, opts, vatPayer);
  }

  async syncStockMany(products: ProductWithListings[]): Promise<void> {
    await this.fanOutMany(products, { stock: true });
  }

  private async fanOutMany(
    products: ProductWithListings[],
    opts: { stock?: boolean; price?: boolean },
  ): Promise<void> {
    if (products.length === 0) return;

    const isEcc = await this.eccOn();
    const { vatPayer } = await this.workspace.get();

    interface BatchEntry {
      pluginId: string;
      storeFrontCode: string | undefined;
      items: Record<string, unknown>[];
    }
    const batches = new Map<string, BatchEntry>();

    for (const product of products) {
      const trendyol = product.listings.filter((l) => l.platform.startsWith('trendyol-'));
      if (trendyol.length === 0) continue;

      if (isEcc) {
        const ro = trendyol.find((l) => l.platform === TRENDYOL_RO);
        if (!ro) continue;

        const resolution = await this.enablement.resolve(TRENDYOL_RO);
        if (!resolution.ok) continue;
        if (!this.loaded.getById(ro.pluginId)) continue;

        const existing = batches.get(ro.pluginId);
        if (existing) {
          existing.items.push(this.buildItem(ro, product, opts, vatPayer));
        } else {
          batches.set(ro.pluginId, {
            pluginId: ro.pluginId,
            storeFrontCode: trendyolStorefrontFor(TRENDYOL_RO),
            items: [this.buildItem(ro, product, opts, vatPayer)],
          });
        }

        const roStock = this.stockOf(ro, product);
        const roPriceMinor = String(this.priceMinorOf(ro, product));
        const roCurrency =
          typeof ro.syncState.price_currency === 'string' ? ro.syncState.price_currency : 'RON';
        for (const mirror of trendyol) {
          if (mirror.platform === TRENDYOL_RO) continue;
          const patch = { ...mirror.syncState };
          if (opts.stock) patch.stock_quantity = roStock;
          if (opts.price) {
            patch.price_amount_minor = roPriceMinor;
            patch.price_currency = roCurrency;
          }
          await this.listings.setSyncState(mirror.id, patch);
        }
      } else {
        for (const listing of trendyol) {
          const resolution = await this.enablement.resolve(listing.platform);
          if (!resolution.ok) continue;
          if (!this.loaded.getById(listing.pluginId)) continue;

          const key = `${listing.pluginId}::${listing.platform}`;
          const existing = batches.get(key);
          if (existing) {
            existing.items.push(this.buildItem(listing, product, opts, vatPayer));
          } else {
            batches.set(key, {
              pluginId: listing.pluginId,
              storeFrontCode: trendyolStorefrontFor(listing.platform),
              items: [this.buildItem(listing, product, opts, vatPayer)],
            });
          }
        }
      }
    }

    for (const { pluginId, storeFrontCode, items } of batches.values()) {
      const loaded = this.loaded.getById(pluginId);
      if (!loaded) continue;
      for (let i = 0; i < items.length; i += 1000) {
        const chunk = items.slice(i, i + 1000);
        await invokeAction(loaded.instance, 'updateStockAndPrice', {
          items: chunk,
          ...(storeFrontCode ? { storeFrontCode } : {}),
        });
      }
    }
  }

  private async pushItem(
    listing: ListingInfo,
    product: ProductWithListings,
    opts: { stock?: boolean; price?: boolean },
    vatPayer: boolean,
  ): Promise<void> {
    const resolution = await this.enablement.resolve(listing.platform);
    if (!resolution.ok) {
      this.logger.warn(
        { listingId: listing.id, marketplace: listing.platform },
        'skip Trendyol inventory sync — marketplace not enabled',
      );
      return;
    }
    const loaded = this.loaded.getById(listing.pluginId);
    if (!loaded) return;

    const storeFrontCode = trendyolStorefrontFor(listing.platform);
    await invokeAction(loaded.instance, 'updateStockAndPrice', {
      items: [this.buildItem(listing, product, opts, vatPayer)],
      ...(storeFrontCode ? { storeFrontCode } : {}),
    });
  }

  private buildItem(
    listing: ListingInfo,
    product: ProductWithListings,
    opts: { stock?: boolean; price?: boolean },
    vatPayer: boolean,
  ): Record<string, unknown> {
    // barcode + DOAR câmpul modificat (nu zero-uim celălalt câmp). vatRate se
    // trimite NUMAI la update de preț (la stoc nu e cerut).
    const listingBarcode =
      typeof listing.syncState.barcode === 'string' ? listing.syncState.barcode : null;
    const item: Record<string, unknown> = { barcode: listingBarcode ?? product.ean ?? product.sku };
    if (opts.stock) item.quantity = this.stockOf(listing, product);
    if (opts.price) {
      const sale = majorFromMinor(this.priceMinorOf(listing, product));
      const list =
        product.fullPriceAmountMinor !== null ? majorFromMinor(product.fullPriceAmountMinor) : sale;
      item.salePrice = sale;
      item.listPrice = list;
      item.vatRate = effectiveVatRate({ product, vatPayer }) ?? 0;
    }
    return item;
  }
}
