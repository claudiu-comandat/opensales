import { Injectable } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { toEmagOfferPayload, toTrendyolItem } from '../import/push-offer.mapper.js';
import {
  extractEmagErrors,
  extractRejectionReasons,
  normalizeValidationStatus,
  resolveListingStatus,
  syncOffersResultSchema,
} from '../import/workers/emag-reconcile.worker.js';
import { ListingsService } from '../listings/listings.service.js';
import {
  EMAG_PACKAGE,
  TEMU_PACKAGE,
  TRENDYOL_PACKAGE,
  trendyolStorefrontFor,
} from '../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../products/products.service.js';
import { StockCodeService } from '../products/stock-code.service.js';

export type PushFamily = 'emag' | 'trendyol' | 'temu' | 'unknown';

export interface ResyncFieldChange {
  field: string;
  before: unknown;
  after: unknown;
}

export interface ResyncOfferResult {
  listingId: string;
  ok: boolean;
  message: string;
  changes: ResyncFieldChange[];
}

function extractOfferImages(raw: unknown): { url: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((img) => {
    if (typeof img === 'string') return [{ url: img }];
    if (
      img &&
      typeof img === 'object' &&
      typeof (img as Record<string, unknown>).url === 'string'
    ) {
      return [{ url: (img as Record<string, unknown>).url as string }];
    }
    return [];
  });
}

/** eMAG întoarce uneori câmpuri numerice ca string (ex. sale_price) — coerce defensiv. */
function coerceNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === 'string' && raw.trim() !== '') {
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function extractOfferStock(raw: unknown): number | undefined {
  if (!Array.isArray(raw)) return undefined;
  return coerceNumber((raw[0] as Record<string, unknown> | undefined)?.value);
}

export interface PushTraceStep {
  step: string;
  ok: boolean;
  detail: string;
}

export interface PushOfferTrace {
  listingId: string;
  platform: string | null;
  pluginPackage: string | null;
  family: PushFamily | null;
  /** Pașii executați, în ordine — ultimul `ok:false` arată exact unde se oprește. */
  steps: PushTraceStep[];
  /** Payload-ul care s-ar trimite (sau s-a trimis) către marketplace. */
  payloadSent: unknown;
  /** True dacă s-a făcut efectiv apelul către API-ul marketplace-ului. */
  apiInvoked: boolean;
  /** Răspunsul brut al marketplace-ului, dacă apelul s-a făcut. */
  apiResult: unknown;
  /** Mesajul + stack-ul brut al erorii, dacă a apărut una. */
  error: string | null;
  /** Concluzie în limbaj clar: ce s-a întâmplat și ce înseamnă. */
  conclusion: string;
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.stack ? `${err.message}\n${err.stack}` : err.message;
  return typeof err === 'string' ? err : JSON.stringify(err);
}

/**
 * Tool de diagnostic: apelează SINCRON push-ul unei oferte către marketplace-ul
 * ei (eMAG / Trendyol), OCOLIND complet coada de job-uri (pg-boss) și worker-ul.
 * Întoarce un trace pas-cu-pas — ce plugin, dacă instanța e încărcată, ce payload
 * s-ar trimite, dacă apelul API s-a făcut și ce a întors / ce eroare a apărut.
 *
 * Folosit pentru a răspunde la întrebarea „de ce nu se cheamă push-ul pe eMAG?":
 *  - dacă apelul reușește aici dar push-ul automat NU se face → problema e în
 *    enqueue / coada de job-uri / worker (vezi GET /debug + deploy logs),
 *  - dacă apelul EȘUEAZĂ aici → `error` conține cauza directă (payload, auth, etc).
 *
 * NU mutează starea listing-ului (fără markPushed/markError) — doar testează calea.
 */
@Injectable()
export class PushDebugService {
  constructor(
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly products: ProductsService,
    private readonly listings: ListingsService,
    private readonly stockCodes: StockCodeService,
    private readonly logger: Logger,
  ) {}

  async tracePushOffer(
    listingId: string,
    opts: { dryRun?: boolean } = {},
  ): Promise<PushOfferTrace> {
    const steps: PushTraceStep[] = [];
    const trace: PushOfferTrace = {
      listingId,
      platform: null,
      pluginPackage: null,
      family: null,
      steps,
      payloadSent: null,
      apiInvoked: false,
      apiResult: null,
      error: null,
      conclusion: '',
    };
    const done = (conclusion: string): PushOfferTrace => {
      trace.conclusion = conclusion;
      this.logger.log({ listingId, conclusion, steps }, 'push-offer trace');
      return trace;
    };

    let listing: schema.Listing;
    try {
      listing = await this.listings.get(listingId);
    } catch (err) {
      steps.push({ step: 'load listing', ok: false, detail: errMsg(err) });
      return done('Listing inexistent.');
    }
    trace.platform = listing.platform;
    steps.push({
      step: 'load listing',
      ok: true,
      detail: `platform=${listing.platform} status=${listing.status}`,
    });

    const plugin = await this.registry.findById(listing.pluginId);
    if (!plugin) {
      steps.push({
        step: 'resolve plugin',
        ok: false,
        detail: `pluginId ${listing.pluginId} negăsit în registry`,
      });
      return done('Pluginul ofertei nu există în registry.');
    }
    trace.pluginPackage = plugin.packageName;
    steps.push({
      step: 'resolve plugin',
      ok: plugin.status === 'active',
      detail: `package=${plugin.packageName} status=${plugin.status}`,
    });
    if (plugin.status !== 'active') {
      return done(`Pluginul ${plugin.packageName} nu e activ (status=${plugin.status}).`);
    }

    const loaded = this.loaded.getById(listing.pluginId);
    if (!loaded) {
      steps.push({
        step: 'load plugin instance',
        ok: false,
        detail:
          'instanța plugin-ului NU e încărcată în proces (loaded registry gol pentru acest pluginId)',
      });
      return done(
        'Instanța plugin-ului nu e încărcată — push-ul nu poate rula. Cauză frecventă: plugin neîncărcat la bootstrap. Verifică deploy logs la pornire pentru erori de încărcare ale plugin-ului eMAG.',
      );
    }
    steps.push({ step: 'load plugin instance', ok: true, detail: 'instanță încărcată în proces' });

    const family = this.family(plugin.packageName);
    trace.family = family;
    if (family === 'unknown') {
      steps.push({
        step: 'select push branch',
        ok: false,
        detail: `package=${plugin.packageName}`,
      });
      return done(`Niciun branch de push pentru package=${plugin.packageName}.`);
    }
    if (family === 'temu') {
      steps.push({
        step: 'select push branch',
        ok: false,
        detail: 'Temu necesită upload imagini pe CDN înainte de push — netestabil sincron aici',
      });
      return done('Trace-ul nu suportă Temu (necesită upload imagini). Folosește push-ul normal.');
    }

    const product = await this.products.get(listing.productId);
    const stockCode = await this.stockCodes.ensureForProduct(product.id);
    steps.push({
      step: 'resolve product + stockCode',
      ok: true,
      detail: `sku=${product.sku} stockCode=${stockCode}`,
    });

    if (family === 'emag') {
      const payload = toEmagOfferPayload({
        product,
        syncState: listing.syncState,
        stockCode,
        platform: listing.platform,
      });
      trace.payloadSent = payload;
      steps.push({ step: 'build eMAG payload', ok: true, detail: `id=${String(payload.id)}` });
      if (opts.dryRun) {
        return done(
          'Dry-run: payload eMAG construit corect, fără apel API. Scoate dryRun ca să testezi apelul real.',
        );
      }
      try {
        this.logger.log(
          { listingId, marketplace: listing.platform },
          'debug: invoking eMAG pushOffers (product_offer/save)',
        );
        trace.apiInvoked = true;
        trace.apiResult = await invokeAction(loaded.instance, 'pushOffers', {
          mode: 'full',
          payloads: [payload],
          platform: listing.platform,
        });
        steps.push({
          step: 'invoke eMAG pushOffers → product_offer/save',
          ok: true,
          detail: 'apel API reușit',
        });
        return done(
          'eMAG product_offer/save a fost apelat cu SUCCES sincron. Dacă push-ul automat la import NU se face, problema NU e în pluginul eMAG, ci în enqueue / coada de job-uri / worker — verifică GET /debug (jobsByState pentru plugin.push_offers) și deploy logs ("push-offer worker: job received").',
        );
      } catch (err) {
        trace.error = errMsg(err);
        steps.push({
          step: 'invoke eMAG pushOffers → product_offer/save',
          ok: false,
          detail: errMsg(err),
        });
        return done(
          'Apelul eMAG product_offer/save a EȘUAT sincron — `error` conține cauza directă (payload, auth, sau răspunsul eMAG).',
        );
      }
    }

    // family === 'trendyol'
    const item = toTrendyolItem({ product, syncState: listing.syncState, stockCode });
    trace.payloadSent = item;
    const storeFrontCode = trendyolStorefrontFor(listing.platform);
    steps.push({
      step: 'build Trendyol item',
      ok: true,
      detail: `storeFront=${storeFrontCode ?? '-'}`,
    });
    if (opts.dryRun) {
      return done('Dry-run: item Trendyol construit, fără apel API.');
    }
    try {
      trace.apiInvoked = true;
      trace.apiResult = await invokeAction(loaded.instance, 'createProduct', {
        items: [item],
        ...(storeFrontCode ? { storeFrontCode } : {}),
      });
      steps.push({ step: 'invoke Trendyol createProduct', ok: true, detail: 'apel API reușit' });
      return done('Trendyol createProduct a fost apelat cu succes sincron.');
    } catch (err) {
      trace.error = errMsg(err);
      steps.push({ step: 'invoke Trendyol createProduct', ok: false, detail: errMsg(err) });
      return done('Apelul Trendyol createProduct a EȘUAT sincron — vezi `error`.');
    }
  }

  /**
   * Citește starea CURENTĂ a unei oferte direct de pe eMAG (product_offer/read,
   * via acțiunea `syncOffers` cu filtru pe id) și o trage înapoi în OpenSales, ca
   * override per-ofertă (syncState) — NU în produsul comun, ca să nu afecteze
   * celelalte canale. Acoperă cazul în care utilizatorul a modificat manual
   * titlu/poze/preț/stoc sau a activat/dezactivat oferta direct din interfața eMAG.
   *
   * Statusul local respectă switch-ul manual al vânzătorului (offer.status) când e
   * OFF; altfel e derivat din validation_status (aceeași mapare ca reconcile-ul
   * automat de 2h), ca să nu regresăm acea logică.
   */
  async resyncOffer(listingId: string): Promise<ResyncOfferResult> {
    const listing = await this.listings.get(listingId);
    const plugin = await this.registry.findById(listing.pluginId);
    if (!plugin || this.family(plugin.packageName) !== 'emag') {
      return {
        listingId,
        ok: false,
        message: 'Resincronizarea e disponibilă doar pentru oferte eMAG.',
        changes: [],
      };
    }
    if (plugin.status !== 'active') {
      return { listingId, ok: false, message: 'Pluginul eMAG nu este activ.', changes: [] };
    }
    const loaded = this.loaded.getById(listing.pluginId);
    if (!loaded) {
      return {
        listingId,
        ok: false,
        message: 'Instanța pluginului eMAG nu este încărcată în proces.',
        changes: [],
      };
    }

    const product = await this.products.get(listing.productId);
    const offerId = Number(
      listing.syncState.emag_offer_id ?? listing.syncState.external_offer_id ?? product.stockCode,
    );
    if (!Number.isInteger(offerId) || offerId <= 0) {
      return {
        listingId,
        ok: false,
        message: 'Oferta nu are încă un id eMAG — nu a fost publicată niciodată.',
        changes: [],
      };
    }

    let raw: Record<string, unknown>;
    try {
      const result = await invokeAction(loaded.instance, 'syncOffers', {
        platform: listing.platform,
        data: { id: offerId },
      });
      const parsed = syncOffersResultSchema.safeParse(result);
      const first = parsed.success ? parsed.data.items[0] : undefined;
      if (!first) {
        return {
          listingId,
          ok: false,
          message: `Oferta ${offerId} nu a fost găsită pe eMAG.`,
          changes: [],
        };
      }
      raw = first;
    } catch (err) {
      return {
        listingId,
        ok: false,
        message: `Eroare la citirea ofertei de pe eMAG: ${errMsg(err)}`,
        changes: [],
      };
    }

    const changes: ResyncFieldChange[] = [];
    const track = (field: string, before: unknown, after: unknown): void => {
      if (before === after) return;
      changes.push({ field, before, after });
    };

    const next: schema.ListingSyncState = { ...listing.syncState };

    const name = typeof raw.name === 'string' ? raw.name : undefined;
    if (name !== undefined) {
      track('title', next.title, name);
      next.title = name;
    }

    const description = typeof raw.description === 'string' ? raw.description : undefined;
    if (description !== undefined) {
      track('description', next.description, description);
      next.description = description;
    }

    // Prezența câmpului (nu doar length>0) decide dacă suprascriem — altfel o galerie
    // golită de vânzător pe eMAG (images: []) ar rămâne blocată pe ultima valoare cunoscută.
    if (Array.isArray(raw.images)) {
      const images = extractOfferImages(raw.images);
      track('images', next.images?.length ?? 0, images.length);
      next.images = images;
    }

    const brand = typeof raw.brand === 'string' ? raw.brand : undefined;
    if (brand !== undefined) {
      track('brand', next.brand, brand);
      next.brand = brand;
    }

    const salePrice = coerceNumber(raw.sale_price);
    if (salePrice !== undefined) {
      const minor = String(Math.round(salePrice * 100));
      track('price_amount_minor', next.price_amount_minor, minor);
      next.price_amount_minor = minor;
      next.price_currency = typeof raw.currency === 'string' ? raw.currency : next.price_currency;
    }

    const stockValue = extractOfferStock(raw.stock) ?? coerceNumber(raw.general_stock);
    if (stockValue !== undefined) {
      track('stock_quantity', next.stock_quantity, stockValue);
      next.stock_quantity = stockValue;
    }

    const valStatus = normalizeValidationStatus(raw.validation_status);
    const offerValStatus = normalizeValidationStatus(raw.offer_validation_status);
    if (valStatus) next.validation_status = valStatus;
    if (offerValStatus) next.offer_validation_status = offerValStatus;
    next.last_manual_resync_at = new Date().toISOString();

    const offerStatusRaw = coerceNumber(raw.status);
    const newStatus: schema.Listing['status'] = valStatus
      ? resolveListingStatus(offerStatusRaw, valStatus.value, offerValStatus?.value)
      : offerStatusRaw !== undefined && offerStatusRaw !== 1
        ? 'paused'
        : listing.status;
    track('status', listing.status, newStatus);

    // Aceeași curățare/populare a reject_reasons/last_error ca reconcile-ul automat
    // (applyOfferStatus) — altfel banner-ul de eroare rămâne blocat pe un mesaj vechi
    // după ce oferta a fost corectată, sau nu arată deloc motivul unei respingeri noi.
    if (newStatus === 'rejected' && valStatus) {
      const { errors: errorsArr } = extractEmagErrors(valStatus.errors);
      const reasons = extractRejectionReasons(errorsArr);
      next.reject_reasons = reasons.length > 0 ? reasons : ['Documentație respinsă — fără detalii'];
      next.last_error = {
        message: reasons.length > 0 ? reasons.join(' | ') : 'Documentație respinsă',
        at: new Date().toISOString(),
      };
    } else if (listing.status === 'rejected') {
      delete next.reject_reasons;
      next.last_error = null;
    }

    await this.listings.applyPushResult(listingId, newStatus, next);

    return {
      listingId,
      ok: true,
      message:
        changes.length > 0
          ? `Resincronizat — ${changes.length} câmp(uri) actualizate din eMAG.`
          : 'Resincronizat — nicio diferență față de eMAG.',
      changes,
    };
  }

  private family(pkg: string): PushFamily {
    if (pkg === EMAG_PACKAGE) return 'emag';
    if (pkg === TRENDYOL_PACKAGE) return 'trendyol';
    if (pkg === TEMU_PACKAGE) return 'temu';
    return 'unknown';
  }
}
