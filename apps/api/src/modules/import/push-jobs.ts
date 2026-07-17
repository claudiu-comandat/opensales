export const PUSH_OFFERS_JOB = 'plugin.push_offers';
export const UPDATE_STOCK_JOB = 'plugin.update_stock';
export const UPDATE_PRICE_JOB = 'plugin.update_price';
export const ACTIVATE_OFFERS_JOB = 'plugin.activate_offers';
export const IMPORT_BATCH_JOB = 'import.batch_process';
export const TRENDYOL_RECONCILE_BATCHES_JOB = 'plugin.trendyol_reconcile_batches';
export const TRENDYOL_RECONCILE_APPROVAL_JOB = 'plugin.trendyol_reconcile_approval';

/** Process an async import/products batch (create products + plan offers + push). */
export interface ImportBatchJob {
  batchId: string;
}

/** Create/publish a batch of new offers on one marketplace. */
export interface PushOffersJob {
  pluginId: string;
  marketplace: string;
  listingIds: string[];
  /** Job-ul enqueue-uit imediat după ce acesta se termină (push secvențial emag-ro→bg→hu). */
  afterComplete?: PushOffersJob;
}

/**
 * Fan stock out to the product's marketplace listings. Without `listingId` it
 * updates ALL listings (product-level stock change); with `listingId` it updates
 * only that one offer (per-offer stock override).
 */
export interface UpdateStockJob {
  productId: string;
  listingId?: string;
}

/** Push a price change for one listing to its marketplace (light, no re-approval). */
export interface UpdatePriceJob {
  listingId: string;
}

/** Activate any of the product's offers that are not already active. */
export interface ActivateOffersJob {
  productId: string;
}

export const UPDATE_PRODUCT_CONTENT_JOB = 'plugin.update_product_content';

/**
 * Suprascrie conținutul ofertelor (syncState) cu datele produsului și re-push pe
 * marketplace-uri:
 *  - eMAG → product_offer/save (full, upsert + re-validare) via PUSH_OFFERS_JOB,
 *  - Trendyol → updateApprovedContent (content-bulk-update) / updateUnapprovedProduct.
 *
 * Job-ul poartă MAI MULTE produse (`items`) ca worker-ul să AGREGE apelurile
 * marketplace peste toate produsele: eMAG max 50/request, Trendyol max 1000/request.
 * Un PATCH single trimite un singur element; bulk PATCH trimite toată lista.
 * `changedFields` = câmpurile produsului efectiv modificate (chei din `updateSet`,
 * ex. `images`, `name`, `description`, `priceAmountMinor`).
 */
export interface UpdateProductContentJob {
  items: { productId: string; changedFields: string[] }[];
}

/** Reconcile Trendyol batch-request results + assemble batched retries. */
export interface TrendyolReconcileBatchesJob {
  pluginId: string;
}

/** Track Trendyol approval status for submitted offers (live / rejected). */
export interface TrendyolReconcileApprovalJob {
  pluginId: string;
}

export const EMAG_RECONCILE_JOB = 'plugin.emag_reconcile';

/** Sync eMAG offer validation statuses back into the platform (runs every 2h). */
export interface EmagReconcileJob {
  pluginId: string;
}

export const PRELIST_VALIDATED_WEBHOOK_JOB = 'plugin.prelist_validated_webhook';

/**
 * Notifică webhook-ul extern de prelistare (workspace.prelistValidatedWebhookUrl) cu toate
 * produsele validate de eMAG într-un ciclu de reconciliere, într-un singur POST batched.
 * pg-boss reîncearcă automat la eșec (retryLimit/retryDelay/retryBackoff — vezi JobQueueService).
 */
export interface PrelistValidatedWebhookJob {
  url: string;
  products: {
    sku: string;
    platform: string;
    category_id: number | string | undefined;
    characteristics: unknown;
  }[];
}

export const EMAG_ASSOCIATE_JOB = 'plugin.emag_associate';

/**
 * eMAG a respins crearea unui produs fiindcă EAN-ul există deja în catalog
 * (PNK). Atașăm oferta noastră pe produsul existent (`part_number_key`), tragem
 * conținutul (poze/titlu/descriere/caracteristici) la noi și activăm oferta.
 * `partNumberKey`/`ean` sunt hint-uri extrase din mesajul eMAG; worker-ul
 * reconfirmă PNK via find_by_eans.
 */
export interface EmagAssociateJob {
  listingId: string;
  partNumberKey?: string;
  ean?: string;
}
