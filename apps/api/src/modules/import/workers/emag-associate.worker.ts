import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { ProductsService, type ProductWithListings } from '../../products/products.service.js';
import { StockCodeService } from '../../products/stock-code.service.js';
import { EMAG_ASSOCIATE_JOB, type EmagAssociateJob } from '../push-jobs.js';
import { emagVatIdForRate } from '../push-offer.mapper.js';

/** Câmpurile pe care le întoarce find_by_eans pentru un produs existent în catalog. */
interface FindByEanMatch {
  ean?: string;
  part_number_key?: string;
  product_name?: string;
  brand_name?: string;
  product_image?: string;
  allow_to_add_offer?: boolean;
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Asociere eMAG: când `product_offer/save` a eșuat fiindcă EAN-ul există deja în
 * catalogul eMAG (PNK), atașăm oferta noastră pe produsul existent și o activăm.
 *
 * LIMITARE eMAG (doc 2.11, verificată): pentru un produs al cărui conținut NU ne
 * aparține (ownership=2), API-ul NU expune documentația proprietarului — nici
 * `product_offer/read`, nici alt endpoint nu întorc descrierea/caracteristicile/
 * toate pozele. Singurul conținut disponibil non-owner-ilor e ce dă `find_by_eans`:
 * `product_name`, `brand_name` și O singură imagine 150×150. Deci PĂSTRĂM conținutul
 * nostru existent (descriere/caracteristici/poze) și doar îl îmbogățim cu titlul/
 * brand-ul canonic eMAG; imaginea mică o folosim doar dacă produsul nu are deja poze.
 *
 * Pași:
 *  1) `find_by_eans` (platform-routed) → PNK + titlu/brand/imagine.
 *  2) Atașează + activează: `product_offer/save` cu `id, name (OBLIGATORIU), part_number_key,
 *     status:1, sale_price, min/max_sale_price, vat_id, stock, handling_time`.
 *  3) Salvează conținutul disponibil pe produs + listing și marchează `active`.
 */
@Injectable()
export class EmagAssociateWorker implements OnApplicationBootstrap {
  constructor(
    private readonly queue: JobQueueService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly stockCodes: StockCodeService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;
    await this.queue.register<EmagAssociateJob>(EMAG_ASSOCIATE_JOB, (data) => this.run(data));
  }

  async run(job: EmagAssociateJob): Promise<void> {
    const listing = await this.listings.get(job.listingId);
    const loaded = this.loaded.getById(listing.pluginId);
    if (!loaded) return;
    const instance = loaded.instance;
    const product = await this.products.get(listing.productId);
    const platform = listing.platform;

    // 1) find_by_eans → PNK + conținutul de bază disponibil non-owner-ilor.
    const ean = job.ean ?? product.ean ?? undefined;
    let match: FindByEanMatch | undefined;
    if (ean) {
      try {
        const res = (await invokeAction(instance, 'findByEan', { eans: [ean], platform })) as {
          items?: FindByEanMatch[];
        };
        match = res.items?.find((i) => i.part_number_key) ?? res.items?.[0];
      } catch (err) {
        this.logger.warn({ listingId: listing.id, err: errMsg(err) }, 'eMAG find_by_eans failed');
      }
    }
    const partNumberKey = match?.part_number_key ?? job.partNumberKey;
    if (!partNumberKey) {
      this.logger.warn({ listingId: listing.id }, 'eMAG associate: part_number_key indisponibil');
      await this.markError(listing, 'Asociere eMAG: part_number_key indisponibil');
      return;
    }

    // 2) Atașează + activează. `name` e OBLIGATORIU la asociere (doc 2.11); folosim
    //    numele canonic eMAG dacă există, altfel numele produsului nostru.
    const name =
      typeof match?.product_name === 'string' && match.product_name
        ? match.product_name
        : product.name;
    const stockCode = await this.stockCodes.ensureForProduct(product.id);
    const sale = Number(listing.syncState.price_amount_minor ?? product.priceAmountMinor) / 100;
    const vatId = emagVatIdForRate(platform, product.vatRate);
    const stockVal =
      typeof listing.syncState.stock_quantity === 'number'
        ? listing.syncState.stock_quantity
        : product.stockQuantity;
    const handlingDays = product.handlingTimeDays ?? 1;
    const attachPayload: Record<string, unknown> = {
      id: stockCode,
      name,
      part_number_key: partNumberKey,
      status: 1,
      sale_price: sale,
      min_sale_price: 1,
      max_sale_price: Math.round(sale * 2 * 100) / 100,
      stock: [{ warehouse_id: 1, value: stockVal }],
      handling_time: [{ warehouse_id: 1, value: handlingDays }],
      ...(vatId !== undefined ? { vat_id: vatId } : {}),
    };
    try {
      await invokeAction(instance, 'pushOffer', { mode: 'full', payload: attachPayload, platform });
    } catch (err) {
      this.logger.warn({ listingId: listing.id, err: errMsg(err) }, 'eMAG associate save failed');
      await this.markError(listing, `Asociere eMAG eșuată: ${errMsg(err)}`);
      return;
    }

    // 3) Salvează conținutul disponibil (titlu/brand/imagine-mică) + marchează activ.
    await this.saveContent(listing, product, partNumberKey, match, stockCode);
    this.logger.log({ listingId: listing.id, partNumberKey }, 'eMAG association complete');
  }

  private async saveContent(
    listing: schema.Listing,
    product: ProductWithListings,
    partNumberKey: string,
    match: FindByEanMatch | undefined,
    stockCode: number,
  ): Promise<void> {
    const title = typeof match?.product_name === 'string' ? match.product_name : undefined;
    const brand = typeof match?.brand_name === 'string' ? match.brand_name : undefined;
    const image = typeof match?.product_image === 'string' ? match.product_image : undefined;
    // Imaginea find_by_eans e doar 150×150 → o folosim DOAR dacă produsul nu are deja poze.
    const hasOwnImages = Array.isArray(product.images) && product.images.length > 0;
    const images = !hasOwnImages && image ? [{ url: image }] : undefined;

    // Produs: titlu/brand canonic eMAG; descrierea/caracteristicile/pozele bune rămân ale
    // noastre (eMAG nu le expune non-owner-ilor).
    await this.products.applyMarketplaceContent(product.id, {
      ...(title !== undefined ? { name: title } : {}),
      ...(brand !== undefined ? { brand } : {}),
      ...(images !== undefined ? { images } : {}),
      partNumberKey,
    });

    // Listing: marchează oferta activă, persistă PNK + emag_offer_id (= id-ul trimis).
    await this.listings.applyPushResult(listing.id, 'active', {
      ...listing.syncState,
      emag_offer_id: stockCode,
      external_offer_id: stockCode,
      part_number_key: partNumberKey,
      ...(title !== undefined ? { title } : {}),
      ...(images !== undefined ? { images } : {}),
      push_state: 'pushed',
      last_error: null,
    });
  }

  private async markError(listing: schema.Listing, message: string): Promise<void> {
    // Status terminal `error` (nu rămâne `pending_approval` la nesfârșit, invizibil în
    // UI și re-selectat inutil de reconcile). Oglindește PushOfferWorker.markError.
    await this.listings.applyPushResult(listing.id, 'error', {
      ...listing.syncState,
      push_state: 'error',
      last_error: { message, at: new Date().toISOString() },
    });
  }
}
