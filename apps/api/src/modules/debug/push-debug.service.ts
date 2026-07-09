import { Injectable } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';

import { toEmagOfferPayload, toTrendyolItem } from '../import/push-offer.mapper.js';
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

  private family(pkg: string): PushFamily {
    if (pkg === EMAG_PACKAGE) return 'emag';
    if (pkg === TRENDYOL_PACKAGE) return 'trendyol';
    if (pkg === TEMU_PACKAGE) return 'temu';
    return 'unknown';
  }
}
