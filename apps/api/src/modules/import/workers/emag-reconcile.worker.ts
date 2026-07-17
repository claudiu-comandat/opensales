import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { type schema } from '@opensales/db';
import { type Plugin, invokeAction } from '@opensales/plugin-sdk';
import { Logger } from 'nestjs-pino';
import { z } from 'zod';

import { JobQueueService } from '../../../jobs/job-queue.service.js';
import { ListingsService } from '../../listings/listings.service.js';
import { EMAG_PACKAGE } from '../../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../../plugins/registry/plugin-registry.service.js';
import { ProductsService } from '../../products/products.service.js';
import { WorkspaceService } from '../../workspace/workspace.service.js';
import {
  EMAG_RECONCILE_JOB,
  PRELIST_VALIDATED_WEBHOOK_JOB,
  PUSH_OFFERS_JOB,
  type EmagReconcileJob,
  type PrelistValidatedWebhookJob,
  type PushOffersJob,
} from '../push-jobs.js';

/** Cron: la fiecare 2 ore (UTC). */
const RECONCILE_CRON = '0 */2 * * *';

const CATEGORY_CORRECTION_URL = 'https://automatizare.comandat.ro/webhook/get-right-category';
const SIZE_CORRECTION_URL = 'https://automatizare.comandat.ro/webhook/fix-sizes';
const IMAGE_TRANSLATION_URL =
  'https://image-translation-module-torii-production.up.railway.app/v2-image-translation';
const IMAGE_CHECK_URL = 'https://automatizare.comandat.ro/webhook/check-images';
const MAX_CORRECTION_BATCH = 500;
const SIZE_CHAR_ID = 6506;
const IMAGE_TRANSLATION_WAIT_MS = 30 * 60 * 1000; // 30 minute minim înainte de check
// O ofertă respinsă e re-verificată la fiecare ciclu (2h), dar re-corectată (webhook-uri
// externe) cel mult o dată la 4h — altfel o respingere cronică re-declanșează corecția
// la infinit, la fiecare ciclu. `needs_validation_sync` explicit sare peste cooldown.
const CORRECTION_COOLDOWN_MS = 4 * 60 * 60 * 1000;

/**
 * Mapare validation_status.value → listing status.
 * Coduri eMAG doc 2.9 — valori care blochează vânzarea = rejected/paused/pending.
 * Prețul invalid (offerValCode=2) suprascrie active→paused.
 */
export function validationStatusToListingStatus(
  valCode: number,
  offerValCode: number | undefined,
): schema.Listing['status'] {
  let status: schema.Listing['status'];
  switch (valCode) {
    case 0:
      status = 'draft';
      break;
    case 1:
    case 2:
    case 4:
      status = 'pending_approval';
      break;
    case 3:
      status = 'active'; // Conflict EAN — nu blochează vânzarea
      break;
    case 5:
    case 6:
    case 8:
      status = 'rejected';
      break;
    case 9:
    case 11:
    case 12:
      status = 'active'; // 11=update în validare, 12=update respins, ambele vandabile
      break;
    case 10:
      status = 'paused'; // Blocat de admin/OPC
      break;
    default:
      status = 'active';
  }
  // Preț invalid → oferta există dar nu se poate vinde → paused
  if (status === 'active' && offerValCode === 2) return 'paused';
  return status;
}

/**
 * Statusul final al listing-ului: switch-ul manual al vânzătorului pe eMAG
 * (`offer.status` — 0/2 = oprit de vânzător) câștigă necondiționat, ca reconcile-ul
 * automat să nu repornească o ofertă pe care vânzătorul a oprit-o manual din
 * interfața eMAG. Altfel, statusul se derivă din validation_status/offer_validation_status
 * (validationStatusToListingStatus) — folosită IDENTIC de reconcile-ul automat (2h) și de
 * resincronizarea manuală (PushDebugService.resyncOffer), ca să nu diverjeze.
 */
export function resolveListingStatus(
  offerStatusRaw: number | undefined,
  valCode: number,
  offerValCode: number | undefined,
): schema.Listing['status'] {
  if (offerStatusRaw !== undefined && offerStatusRaw !== 1) return 'paused';
  return validationStatusToListingStatus(valCode, offerValCode);
}

export interface NormalizedValidationStatus {
  value: number;
  description?: string;
  // Poate fi obiect { errors, warnings, info } (format eMAG) sau array (format vechi).
  errors?: unknown;
}

export function normalizeValidationStatus(raw: unknown): NormalizedValidationStatus | null {
  if (!raw) return null;
  const obj = Array.isArray(raw) ? (raw as unknown[])[0] : raw;
  if (!obj || typeof obj !== 'object') return null;
  const o = obj as Record<string, unknown>;
  const value = typeof o.value === 'number' ? o.value : Number(o.value);
  if (!Number.isFinite(value)) return null;
  const result: NormalizedValidationStatus = { value };
  const desc =
    typeof o.description === 'string'
      ? o.description
      : typeof o.Description === 'string'
        ? o.Description
        : undefined;
  if (desc !== undefined) result.description = desc;
  if (o.errors !== undefined && o.errors !== null) result.errors = o.errors;
  return result;
}

/** Normalizează câmpul `errors` care poate fi obiect eMAG sau array legacy. */
export function extractEmagErrors(raw: unknown): {
  errors: unknown[];
  warnings: unknown[];
  info: unknown[];
} {
  if (!raw) return { errors: [], warnings: [], info: [] };
  if (Array.isArray(raw)) return { errors: raw, warnings: [], info: [] };
  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    return {
      errors: Array.isArray(o.errors) ? o.errors : [],
      warnings: Array.isArray(o.warnings) ? o.warnings : [],
      info: Array.isArray(o.info) ? o.info : [],
    };
  }
  return { errors: [], warnings: [], info: [] };
}

/** Extrage mesajele din array-ul de erori eMAG (preferă ro_RO, fallback en_GB). */
export function extractRejectionReasons(errors: unknown[]): string[] {
  if (!errors || errors.length === 0) return [];
  return errors.flatMap((e) => {
    if (typeof e === 'string') return [e];
    if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const msgObj = o.message;
      if (msgObj && typeof msgObj === 'object' && !Array.isArray(msgObj)) {
        const m = msgObj as Record<string, unknown>;
        const txt =
          typeof m.ro_RO === 'string' ? m.ro_RO : typeof m.en_GB === 'string' ? m.en_GB : undefined;
        if (txt) return [txt];
      }
      const msg = o.message ?? o.description ?? o.text ?? o.reason;
      if (typeof msg === 'string' || typeof msg === 'number') return [String(msg)];
      return [JSON.stringify(e)];
    }
    return [String(e)];
  });
}

/**
 * Detectează eroarea de categorie greșită (template:incorrect-template-extra) și
 * extrage numele categoriei corecte din mesajul ro_RO.
 * Returnează null dacă eroarea nu e prezentă sau nu se poate extrage categoria.
 */
function extractWrongCategoryName(rawErrors: unknown): string | null {
  const { errors } = extractEmagErrors(rawErrors);
  for (const e of errors) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    if (o.code !== 'template:incorrect-template-extra') continue;
    const msg = o.message;
    if (!msg || typeof msg !== 'object' || Array.isArray(msg)) continue;
    const roMsg = (msg as Record<string, unknown>).ro_RO;
    if (typeof roMsg !== 'string') continue;
    const match = /categoria de "([^"]+)"/i.exec(roMsg);
    if (match?.[1]) return match[1];
  }
  return null;
}

/**
 * Detectează eroarea de mărime invalidă (characteristic:size-value-invalid sau -33321 cu
 * identifier 6506) și returnează valoarea curentă (greșită).
 * Erorile sunt cuibărite în validation_status.errors.info[n].errors.
 */
function extractSizeError(rawErrors: unknown): { wrongValue: string } | null {
  const { info, errors } = extractEmagErrors(rawErrors);

  const allEntries: unknown[] = [...errors];
  for (const infoItem of info) {
    if (!infoItem || typeof infoItem !== 'object') continue;
    const o = infoItem as Record<string, unknown>;
    if (Array.isArray(o.errors)) allEntries.push(...(o.errors as unknown[]));
  }

  for (const e of allEntries) {
    if (!e || typeof e !== 'object') continue;
    const o = e as Record<string, unknown>;
    const code = typeof o.code === 'string' ? o.code : '';
    const identifier = typeof o.identifier === 'string' ? o.identifier : '';
    if (
      identifier === '6506' &&
      (code === 'characteristic:size-value-invalid' || code === '-33321') &&
      typeof o.value === 'string' &&
      o.value.trim() !== ''
    ) {
      return { wrongValue: o.value.trim() };
    }
  }
  return null;
}

/** Detectează erorile de brand (`invalid_brand` sau `brand:incorrect-brand`) în validation_status.errors. */
function hasBrandError(rawErrors: unknown): boolean {
  const { errors } = extractEmagErrors(rawErrors);
  return errors.some((e) => {
    if (!e || typeof e !== 'object') return false;
    const code = (e as Record<string, unknown>).code;
    return code === 'invalid_brand' || code === 'brand:incorrect-brand';
  });
}

function hasImageLanguageError(rawErrors: unknown): boolean {
  const { errors } = extractEmagErrors(rawErrors);
  return errors.some((e) => {
    if (!e || typeof e !== 'object') return false;
    return (e as Record<string, unknown>).code === 'photoGallery:other-language';
  });
}

function platformToLang(platform: string): string {
  if (platform === 'emag-bg') return 'bg';
  if (platform === 'emag-hu') return 'hu';
  return 'ro';
}

function stripCnSuffix(sku: string): string {
  return sku.replace(/CN$/i, '');
}

function extractListingImages(rawImages: unknown): string[] {
  if (!Array.isArray(rawImages)) return [];
  return rawImages.flatMap((img) => {
    if (typeof img === 'string') return [img];
    if (img && typeof img === 'object') {
      const url = (img as Record<string, unknown>).url;
      return typeof url === 'string' ? [url] : [];
    }
    return [];
  });
}

export const syncOffersResultSchema = z.object({
  items: z.array(z.record(z.unknown())).default([]),
});

const webhookResponseSchema = z.object({
  products: z.array(
    z.object({
      sku: z.string(),
      // Webhook-ul poate returna null sau omite câmpul dacă nu a găsit categoria.
      // Parsăm lenient și tratăm absența per-SKU în processCorrectionBatch.
      category_id: z
        .union([z.string(), z.number(), z.null()])
        .optional()
        .transform((v) => (v !== null && v !== undefined ? parseInt(String(v), 10) : null)),
      characteristics: z.array(z.object({ id: z.number(), value: z.string() })).default([]),
    }),
  ),
});

const sizeWebhookResponseSchema = z.object({
  products: z.array(
    z.object({
      sku: z.string(),
      corrected_size: z.string().nullable().optional(),
    }),
  ),
});

const imageCheckResponseSchema = z.object({
  products: z.array(
    z.object({
      asin: z.string(),
      lang: z.string(),
      images: z.array(z.string()).default([]),
    }),
  ),
});

interface CorrectionCandidate {
  listing: schema.Listing;
  /** syncState-ul scris în DB de applyOfferStatus — folosit la setarea erorii webhook. */
  currentSyncState: schema.ListingSyncState;
  suggestedCategoryName: string;
}

interface BrandCorrectionCandidate {
  listing: schema.Listing;
  currentSyncState: schema.ListingSyncState;
}

interface SizeCorrectionCandidate {
  listing: schema.Listing;
  currentSyncState: schema.ListingSyncState;
  wrongSize: string;
}

interface ImageTranslationCandidate {
  listing: schema.Listing;
  currentSyncState: schema.ListingSyncState;
}

interface PendingImageCheck {
  listing: schema.Listing;
}

interface PrelistValidatedCandidate {
  listing: schema.Listing;
  currentSyncState: schema.ListingSyncState;
}

/**
 * Decide dacă un listing trebuie inclus în pool-ul de reconciliere:
 * - Nu a fost niciodată sincronizat (no validation_status).
 * - Are status nestabil (orice altceva decât 9/Approved).
 * - A primit flag needs_validation_sync (push cu modificări de conținut pe o ofertă stabilă).
 * Produsele respinse (cod 8) sunt mereu re-sincronizate — dacă au eroarea de categorie greșită,
 * reconcile-ul va re-corecta și re-pusha la fiecare ciclu până documentația e aprobată.
 */
function shouldSyncValidation(listing: schema.Listing): boolean {
  const vs = normalizeValidationStatus(listing.syncState.validation_status);
  if (!vs) return true; // niciodată sincronizat
  if (vs.value !== 8 && vs.value !== 9) return true; // status nestabil
  if (listing.syncState.needs_validation_sync === true) return true; // marcat explicit
  if (vs.value === 8) return true; // respins → re-verificăm și re-corectăm la fiecare ciclu
  return false;
}

function updateSizeInCharacteristics(
  rawCharacteristics: unknown,
  correctedSize: string,
): Record<string, unknown>[] {
  const existing: Record<string, unknown>[] = [];

  if (Array.isArray(rawCharacteristics)) {
    for (const ch of rawCharacteristics) {
      if (ch && typeof ch === 'object') {
        existing.push({ ...(ch as Record<string, unknown>) });
      }
    }
  }

  const filtered = existing.filter((c) => Number(c.id) !== SIZE_CHAR_ID);
  filtered.push({ id: SIZE_CHAR_ID, value: correctedSize });

  return filtered;
}

@Injectable()
export class EmagReconcileWorker implements OnApplicationBootstrap {
  // ponytail: guard simplu în memorie — un singur replica (numReplicas=1 în railway.toml),
  // deci nu e nevoie de lock distribuit. Dacă trecem la mai multe replici, mută în DB.
  private running = false;

  constructor(
    private readonly queue: JobQueueService,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly listings: ListingsService,
    private readonly products: ProductsService,
    private readonly workspace: WorkspaceService,
    private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test') return;

    await this.queue.register<EmagReconcileJob>(EMAG_RECONCILE_JOB, (data) => this.reconcile(data));
    await this.queue.register<PrelistValidatedWebhookJob>(PRELIST_VALIDATED_WEBHOOK_JOB, (data) =>
      this.sendPrelistWebhook(data),
    );

    const plugin = await this.registry.findByPackageName(EMAG_PACKAGE);
    if (!plugin) {
      this.logger.warn('eMAG plugin not found — validation sync cron not scheduled');
      return;
    }

    await this.queue
      .raw()
      .schedule(
        EMAG_RECONCILE_JOB,
        RECONCILE_CRON,
        { pluginId: plugin.id } satisfies EmagReconcileJob,
        { tz: 'UTC' },
      );
    this.logger.log({ pluginId: plugin.id }, 'eMAG validation sync scheduled (every 2h)');
  }

  async trigger(): Promise<{ ok: boolean; pluginId: string | null }> {
    const plugin = await this.registry.findByPackageName(EMAG_PACKAGE);
    if (!plugin) return { ok: false, pluginId: null };
    await this.queue.enqueue<EmagReconcileJob>(EMAG_RECONCILE_JOB, { pluginId: plugin.id });
    this.logger.log({ pluginId: plugin.id }, 'eMAG validation sync triggered manually');
    return { ok: true, pluginId: plugin.id };
  }

  async reconcile(data: EmagReconcileJob): Promise<void> {
    if (this.running) {
      this.logger.warn(
        { pluginId: data.pluginId },
        'eMAG reconcile: rulare anterioară încă activă, sar peste acest ciclu',
      );
      return;
    }
    this.running = true;
    try {
      const instance = await this.activeInstance(data.pluginId);
      if (!instance) return;

      const allListings = await this.listings.listAllByPlugin(data.pluginId);
      if (allListings.length === 0) return;

      // Grupare pe platformă (emag-ro / emag-bg / emag-hu) — fiecare are client separat
      const byPlatform = new Map<string, schema.Listing[]>();
      for (const listing of allListings) {
        if (!listing.platform.startsWith('emag-')) continue;
        const arr = byPlatform.get(listing.platform) ?? [];
        arr.push(listing);
        byPlatform.set(listing.platform, arr);
      }

      const correctionCandidates: CorrectionCandidate[] = [];
      const brandCandidates: BrandCorrectionCandidate[] = [];
      const sizeCandidates: SizeCorrectionCandidate[] = [];
      const imageTranslationCandidates: ImageTranslationCandidate[] = [];
      const pendingImageChecks: PendingImageCheck[] = [];
      const prelistValidatedCandidates: PrelistValidatedCandidate[] = [];

      for (const [platform, platformListings] of byPlatform) {
        try {
          const {
            categoryCandidates,
            brandCandidates: bcs,
            sizeCandidates: scs,
            imageTranslationCandidates: itcs,
            pendingImageChecks: pics,
            prelistValidatedCandidates: pvcs,
          } = await this.reconcilePlatform(instance, platform, platformListings);
          correctionCandidates.push(...categoryCandidates);
          brandCandidates.push(...bcs);
          sizeCandidates.push(...scs);
          imageTranslationCandidates.push(...itcs);
          pendingImageChecks.push(...pics);
          prelistValidatedCandidates.push(...pvcs);
        } catch (err) {
          this.logger.warn({ platform, err: errMsg(err) }, 'eMAG reconcile: platform sync failed');
        }
      }

      await this.applyCategoryCorrections(correctionCandidates, allListings);
      await this.applyBrandCorrections(brandCandidates, allListings);
      await this.applySizeCorrections(sizeCandidates, allListings);
      await this.applyImageTranslations(imageTranslationCandidates);
      await this.checkPendingImageTranslations(pendingImageChecks);
      await this.notifyPrelistValidated(prelistValidatedCandidates);
    } finally {
      this.running = false;
    }
  }

  private async reconcilePlatform(
    instance: Plugin,
    platform: string,
    listings: schema.Listing[],
  ): Promise<{
    categoryCandidates: CorrectionCandidate[];
    brandCandidates: BrandCorrectionCandidate[];
    sizeCandidates: SizeCorrectionCandidate[];
    imageTranslationCandidates: ImageTranslationCandidate[];
    pendingImageChecks: PendingImageCheck[];
    prelistValidatedCandidates: PrelistValidatedCandidate[];
  }> {
    // Scanăm TOATE listing-urile pentru traduceri pending (indiferent de stare eMAG)
    const pendingImageChecks: PendingImageCheck[] = listings
      .filter((l) => {
        if (l.syncState.image_translation_pending !== true) return false;
        const requestedAt = l.syncState.image_translation_requested_at;
        if (typeof requestedAt !== 'string') return false;
        return Date.now() - new Date(requestedAt).getTime() >= IMAGE_TRANSLATION_WAIT_MS;
      })
      .map((l) => ({ listing: l }));

    const toSync = listings.filter(shouldSyncValidation);
    if (toSync.length === 0) {
      this.logger.log({ platform, skipped: listings.length }, 'eMAG reconcile: all stable, skip');
      return {
        categoryCandidates: [],
        brandCandidates: [],
        sizeCandidates: [],
        imageTranslationCandidates: [],
        pendingImageChecks,
        prelistValidatedCandidates: [],
      };
    }

    let updated = 0;
    let errors = 0;
    const categoryCandidates: CorrectionCandidate[] = [];
    const brandCandidates: BrandCorrectionCandidate[] = [];
    const sizeCandidates: SizeCorrectionCandidate[] = [];
    const imageTranslationCandidates: ImageTranslationCandidate[] = [];
    const prelistValidatedCandidates: PrelistValidatedCandidate[] = [];

    // O singură baleiere paginată a catalogului (100/pagină, ca la import) în loc de
    // un product_offer/read separat per listing — evită mii de requesturi/ciclu.
    const offersById = await this.fetchAllOffersById(instance, platform);

    for (const listing of toSync) {
      const offerId = listing.syncState.emag_offer_id;
      if (!offerId || !Number.isFinite(Number(offerId))) {
        this.logger.warn(
          { listingId: listing.id, platform },
          'eMAG reconcile: emag_offer_id missing, skipping',
        );
        continue;
      }

      const firstItem = offersById.get(Number(offerId));
      if (firstItem === undefined) {
        errors++;
        continue;
      }

      const result = await this.applyOfferStatus(listing, firstItem);
      if (result.category) categoryCandidates.push(result.category);
      if (result.brand) brandCandidates.push(result.brand);
      if (result.size) sizeCandidates.push(result.size);
      if (result.imageTranslation) imageTranslationCandidates.push(result.imageTranslation);
      if (result.prelistValidated) prelistValidatedCandidates.push(result.prelistValidated);
      updated++;
    }

    this.logger.log(
      { platform, updated, errors, pool: toSync.length, total: listings.length },
      'eMAG reconcile: platform done',
    );

    return {
      categoryCandidates,
      brandCandidates,
      sizeCandidates,
      imageTranslationCandidates,
      pendingImageChecks,
      prelistValidatedCandidates,
    };
  }

  /** Citește tot catalogul unei platforme paginat (100/pagină, doc 2.8) și indexează după `id`. */
  private async fetchAllOffersById(
    instance: Plugin,
    platform: string,
  ): Promise<Map<number, Record<string, unknown>>> {
    const offersById = new Map<number, Record<string, unknown>>();
    for (let page = 1; ; page++) {
      let raw: unknown;
      try {
        raw = await invokeAction(instance, 'syncOffers', {
          platform,
          currentPage: page,
          itemsPerPage: 100,
        });
      } catch (err) {
        this.logger.warn({ platform, page, err: errMsg(err) }, 'eMAG reconcile: bulk read failed');
        break;
      }
      const parsed = syncOffersResultSchema.safeParse(raw);
      if (!parsed.success || parsed.data.items.length === 0) break;
      for (const item of parsed.data.items) {
        const id = Number((item as { id?: unknown }).id);
        if (Number.isFinite(id)) offersById.set(id, item);
      }
      if (parsed.data.items.length < 100) break;
    }
    return offersById;
  }

  private async applyOfferStatus(
    listing: schema.Listing,
    offer: Record<string, unknown>,
  ): Promise<{
    category: CorrectionCandidate | null;
    brand: BrandCorrectionCandidate | null;
    size: SizeCorrectionCandidate | null;
    imageTranslation: ImageTranslationCandidate | null;
    prelistValidated: PrelistValidatedCandidate | null;
  }> {
    const emptyResult = {
      category: null,
      brand: null,
      size: null,
      imageTranslation: null,
      prelistValidated: null,
    };
    const valStatus = normalizeValidationStatus(offer.validation_status);
    const offerValStatus = normalizeValidationStatus(offer.offer_validation_status);

    if (!valStatus) return emptyResult;

    const offerStatusRaw = typeof offer.status === 'number' ? offer.status : undefined;
    const newStatus = resolveListingStatus(offerStatusRaw, valStatus.value, offerValStatus?.value);
    const { errors: errorsArr } = extractEmagErrors(valStatus.errors);
    const reasons = extractRejectionReasons(errorsArr);

    // Skip dacă nu s-a schimbat nimic relevant.
    // Excepție: listing respins → mereu procesăm, ca să detectăm eroarea de categorie și să
    // re-corectăm la fiecare ciclu (inclusiv când statusul e stabil la rejected între cicluri).
    const prev = listing.syncState.validation_status as NormalizedValidationStatus | undefined;
    const nothingChanged =
      newStatus === listing.status &&
      prev?.value === valStatus.value &&
      prev?.description === valStatus.description;
    const needsErrorUpdate = newStatus === 'rejected';
    if (nothingChanged && !needsErrorUpdate) {
      return emptyResult;
    }

    const nextSyncState: schema.ListingSyncState = {
      ...listing.syncState,
      validation_status: valStatus,
      offer_validation_status: offerValStatus ?? undefined,
      last_sync_at: new Date().toISOString(),
      needs_validation_sync: undefined,
    };

    if (newStatus === 'rejected') {
      nextSyncState.reject_reasons =
        reasons.length > 0 ? reasons : ['Documentatie respinsa — fara detalii'];
      nextSyncState.last_error = {
        message: reasons.length > 0 ? reasons.join(' | ') : 'Documentatie respinsa',
        at: new Date().toISOString(),
      };
    } else if (listing.status === 'rejected') {
      delete nextSyncState.reject_reasons;
      nextSyncState.last_error = null;
    }

    // Prelistare: la prima aprobare a documentației, eMAG a atribuit categoria +
    // caracteristicile — le extragem o singură dată (guard: prelist_validated_at)
    // ca să nu suprascriem ulterior datele completate de procesul extern.
    const prelistValidated =
      listing.syncState.prelist === true &&
      newStatus === 'active' &&
      listing.syncState.prelist_validated_at === undefined;
    if (prelistValidated) {
      if (offer.category_id !== undefined) nextSyncState.category = offer.category_id as number;
      if (offer.characteristics !== undefined) {
        nextSyncState.characteristics = offer.characteristics;
      }
      if (typeof offer.part_number_key === 'string') {
        nextSyncState.part_number_key = offer.part_number_key;
      }
      nextSyncState.prelist_validated_at = new Date().toISOString();
    }

    const category = this.buildCorrectionCandidate(listing, nextSyncState, valStatus, newStatus);
    const brand = this.buildBrandCorrectionCandidate(listing, nextSyncState, valStatus, newStatus);
    const size = this.buildSizeCorrectionCandidate(listing, nextSyncState, valStatus, newStatus);
    const imageTranslation = this.buildImageTranslationCandidate(
      listing,
      nextSyncState,
      valStatus,
      newStatus,
    );
    if (category ?? brand ?? size ?? imageTranslation) {
      nextSyncState.correction_attempted_at = new Date().toISOString();
    }

    await this.listings.applyPushResult(listing.id, newStatus, nextSyncState);

    return {
      category,
      brand,
      size,
      imageTranslation,
      prelistValidated: prelistValidated ? { listing, currentSyncState: nextSyncState } : null,
    };
  }

  /**
   * Anunță procesul extern de completare (LLM + validare manuală) cu TOATE produsele
   * prelistate validate de eMAG în acest ciclu de reconciliere, într-un singur POST batched.
   * URL-ul se configurează în platformă (Setări → API & Webhook →
   * workspace.prelistValidatedWebhookUrl). Necompletat = fără notificare — datele rămân
   * interogabile prin GET /listings.
   *
   * SKU-ul e garantat: produsul e creat în aceeași operație de prelistare care creează
   * listing-ul (POST /import/products/prelist), deci un produs lipsă la acest punct e o
   * inconsistență reală, nu un caz normal — candidatul respectiv e exclus din batch și logat.
   *
   * Trimiterea efectivă rulează ca job (PRELIST_VALIDATED_WEBHOOK_JOB) — la eșec, pg-boss
   * reîncearcă automat (retryLimit/retryDelay/retryBackoff, vezi JobQueueService).
   */
  private async notifyPrelistValidated(candidates: PrelistValidatedCandidate[]): Promise<void> {
    if (candidates.length === 0) return;

    let url: string | null;
    try {
      url = (await this.workspace.get()).prelistValidatedWebhookUrl;
    } catch (err) {
      this.logger.warn(
        { err: errMsg(err) },
        'prelist validated: could not read workspace settings',
      );
      return;
    }
    if (!url) return;

    const products = await this.products.getMany(candidates.map((c) => c.listing.productId));
    const skuByProductId = new Map(products.map((p) => [p.id, p.sku]));

    const payloadProducts = candidates.flatMap(({ listing, currentSyncState }) => {
      const sku = skuByProductId.get(listing.productId);
      if (!sku) {
        this.logger.warn(
          { listingId: listing.id, productId: listing.productId },
          'prelist validated: product not found, excluding from webhook batch',
        );
        return [];
      }
      return [
        {
          sku,
          platform: listing.platform,
          category_id: currentSyncState.category,
          characteristics: currentSyncState.characteristics,
        },
      ];
    });
    if (payloadProducts.length === 0) return;

    await this.queue.enqueue<PrelistValidatedWebhookJob>(PRELIST_VALIDATED_WEBHOOK_JOB, {
      url,
      products: payloadProducts,
    });
    this.logger.log({ count: payloadProducts.length }, 'prelist validated: webhook batch queued');
  }

  /** Job handler pentru PRELIST_VALIDATED_WEBHOOK_JOB — aruncă la eșec ca pg-boss să reîncerce. */
  private async sendPrelistWebhook(data: PrelistValidatedWebhookJob): Promise<void> {
    const res = await fetch(data.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ products: data.products }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    this.logger.log({ count: data.products.length }, 'prelist validated: webhook notified');
  }

  /** true dacă o corecție a mai fost încercată recent — sărim peste re-corecție, dar tot re-verificăm statusul. */
  private correctionOnCooldown(listing: schema.Listing): boolean {
    if (listing.syncState.needs_validation_sync === true) return false;
    const attemptedAt = listing.syncState.correction_attempted_at;
    if (typeof attemptedAt !== 'string') return false;
    return Date.now() - new Date(attemptedAt).getTime() < CORRECTION_COOLDOWN_MS;
  }

  private buildCorrectionCandidate(
    listing: schema.Listing,
    currentSyncState: schema.ListingSyncState,
    valStatus: NormalizedValidationStatus,
    newStatus: schema.Listing['status'],
  ): CorrectionCandidate | null {
    if (newStatus !== 'rejected' || this.correctionOnCooldown(listing)) return null;
    const categoryName = extractWrongCategoryName(valStatus.errors);
    if (!categoryName) return null;
    return { listing, currentSyncState, suggestedCategoryName: categoryName };
  }

  private buildBrandCorrectionCandidate(
    listing: schema.Listing,
    currentSyncState: schema.ListingSyncState,
    valStatus: NormalizedValidationStatus,
    newStatus: schema.Listing['status'],
  ): BrandCorrectionCandidate | null {
    if (newStatus !== 'rejected' || this.correctionOnCooldown(listing)) return null;
    if (!hasBrandError(valStatus.errors)) return null;
    return { listing, currentSyncState };
  }

  private buildSizeCorrectionCandidate(
    listing: schema.Listing,
    currentSyncState: schema.ListingSyncState,
    valStatus: NormalizedValidationStatus,
    newStatus: schema.Listing['status'],
  ): SizeCorrectionCandidate | null {
    if (newStatus !== 'rejected' || this.correctionOnCooldown(listing)) return null;
    const sizeErr = extractSizeError(valStatus.errors);
    if (!sizeErr) return null;
    return { listing, currentSyncState, wrongSize: sizeErr.wrongValue };
  }

  private buildImageTranslationCandidate(
    listing: schema.Listing,
    currentSyncState: schema.ListingSyncState,
    valStatus: NormalizedValidationStatus,
    newStatus: schema.Listing['status'],
  ): ImageTranslationCandidate | null {
    if (newStatus !== 'rejected' || this.correctionOnCooldown(listing)) return null;
    if (!hasImageLanguageError(valStatus.errors)) return null;
    // Nu re-trimite dacă cererea e deja în așteptare
    if (listing.syncState.image_translation_pending === true) return null;
    return { listing, currentSyncState };
  }

  /**
   * Apelează webhook-ul de corecție categorie pentru toate listing-urile cu eroare
   * template:incorrect-template-extra. Trimite în batch-uri de max 500 produse,
   * aplică noua categorie și caracteristici pe TOATE platformele eMAG ale fiecărui
   * produs, apoi repushează. Dacă după repush documentația e tot respinsă cu aceeași
   * eroare, reconcile-ul va detecta-o la ciclul următor și va re-corecta din nou.
   */
  private async applyCategoryCorrections(
    candidates: CorrectionCandidate[],
    allListings: schema.Listing[],
  ): Promise<void> {
    if (candidates.length === 0) return;

    // Un singur candidat per produs — primul detectat (poate fi de pe orice platformă)
    const byProduct = new Map<string, CorrectionCandidate>();
    for (const c of candidates) {
      if (!byProduct.has(c.listing.productId)) byProduct.set(c.listing.productId, c);
    }

    const unique = [...byProduct.values()];

    // Fetch produse pentru SKU-uri
    const productMap = new Map<string, schema.Product>();
    for (const c of unique) {
      try {
        const p = await this.products.get(c.listing.productId);
        productMap.set(c.listing.productId, p);
      } catch (err) {
        this.logger.warn(
          { productId: c.listing.productId, err: errMsg(err) },
          'eMAG category correction: product not found',
        );
      }
    }

    // Procesare în batch-uri de max 500
    for (let i = 0; i < unique.length; i += MAX_CORRECTION_BATCH) {
      const batch = unique.slice(i, i + MAX_CORRECTION_BATCH);
      await this.processCorrectionBatch(batch, productMap, allListings);
    }
  }

  private async processCorrectionBatch(
    batch: CorrectionCandidate[],
    productMap: Map<string, schema.Product>,
    allListings: schema.Listing[],
  ): Promise<void> {
    const payloadProducts = batch.flatMap((c) => {
      const product = productMap.get(c.listing.productId);
      if (!product) return [];

      const rawChars = c.listing.syncState.characteristics;
      const charValues: string[] = Array.isArray(rawChars)
        ? rawChars.flatMap((ch) => {
            if (typeof ch === 'string') return [ch];
            if (ch && typeof ch === 'object') {
              const v = (ch as Record<string, unknown>).value;
              return typeof v === 'string' ? [v] : [];
            }
            return [];
          })
        : [];

      return [
        {
          sku: product.sku,
          title: c.listing.syncState.title ?? product.name,
          description: c.listing.syncState.description ?? product.description ?? '',
          characteristics: charValues,
          suggested_category_name: c.suggestedCategoryName,
        },
      ];
    });

    if (payloadProducts.length === 0) return;

    this.logger.log({ count: payloadProducts.length }, 'eMAG category correction: calling webhook');

    let raw: unknown;
    try {
      const res = await fetch(CATEGORY_CORRECTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payloadProducts }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      this.logger.warn({ err: errMsg(err) }, 'eMAG category correction: webhook call failed');
      return;
    }

    const parsed = webhookResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        { err: parsed.error.message },
        'eMAG category correction: invalid webhook response',
      );
      return;
    }

    // Index răspuns după SKU
    const skuToResult = new Map(parsed.data.products.map((r) => [r.sku, r]));

    for (const c of batch) {
      const product = productMap.get(c.listing.productId);
      if (!product) continue;

      const result = skuToResult.get(product.sku);
      const categoryId = result?.category_id ?? null;

      if (categoryId === null) {
        // Webhook n-a returnat o categorie pentru acest SKU (absent sau null).
        // Marcăm eroarea pe listing ca să fie vizibilă în UI, DAR nu schimbăm statusul
        // (rămâne 'rejected') → intră în pool la ciclul următor și re-încearcă.
        const noCategMsg =
          `eMAG a cerut categoria "${c.suggestedCategoryName}", am încercat să retrimitem` +
          ` însă această categorie nu există în get-right-category`;
        this.logger.warn(
          { sku: product.sku, suggestedCategory: c.suggestedCategoryName },
          'eMAG category correction: no category from webhook',
        );
        try {
          await this.listings.setSyncState(c.listing.id, {
            ...c.currentSyncState,
            last_error: { message: noCategMsg, at: new Date().toISOString() },
          });
        } catch (err) {
          this.logger.warn(
            { listingId: c.listing.id, err: errMsg(err) },
            'eMAG category correction: set no-category error failed',
          );
        }
        continue;
      }

      // Aplică corecția pe TOATE listing-urile eMAG ale acestui produs
      const emagListings = allListings.filter(
        (l) => l.productId === c.listing.productId && l.platform.startsWith('emag-'),
      );

      for (const listing of emagListings) {
        try {
          const correctedState: schema.ListingSyncState = {
            ...listing.syncState,
            category: categoryId,
            characteristics: result?.characteristics ?? [],
            push_state: 'pending',
            last_error: null,
          };
          await this.listings.applyPushResult(listing.id, 'draft', correctedState);
          await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, {
            pluginId: listing.pluginId,
            marketplace: listing.platform,
            listingIds: [listing.id],
          });
          this.logger.log(
            {
              listingId: listing.id,
              platform: listing.platform,
              categoryId,
              sku: product.sku,
            },
            'eMAG category correction: repush queued',
          );
        } catch (err) {
          this.logger.warn(
            { listingId: listing.id, err: errMsg(err) },
            'eMAG category correction: apply failed',
          );
        }
      }
    }
  }

  /**
   * Pentru fiecare produs cu eroare `invalid_brand`, suprascrie brandul cu 'OEM' pe:
   * 1) produsul în DB (`applyMarketplaceContent`) — persistent,
   * 2) syncState-ul TUTUROR listing-urilor eMAG ale produsului → repush.
   * Nu afectează Trendyol sau alte marketplace-uri.
   */
  private async applyBrandCorrections(
    candidates: BrandCorrectionCandidate[],
    allListings: schema.Listing[],
  ): Promise<void> {
    if (candidates.length === 0) return;

    const byProduct = new Map<string, BrandCorrectionCandidate>();
    for (const c of candidates) {
      if (!byProduct.has(c.listing.productId)) byProduct.set(c.listing.productId, c);
    }

    for (const [productId] of byProduct) {
      try {
        await this.products.applyMarketplaceContent(productId, { brand: 'OEM' });
        this.logger.log({ productId }, 'eMAG brand correction: brand set to OEM in DB');
      } catch (err) {
        this.logger.warn(
          { productId, err: errMsg(err) },
          'eMAG brand correction: failed to update product brand',
        );
      }

      const emagListings = allListings.filter(
        (l) => l.productId === productId && l.platform.startsWith('emag-'),
      );

      for (const listing of emagListings) {
        try {
          const correctedState: schema.ListingSyncState = {
            ...listing.syncState,
            brand: 'OEM',
            push_state: 'pending',
          };
          await this.listings.setSyncState(listing.id, correctedState);
          await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, {
            pluginId: listing.pluginId,
            marketplace: listing.platform,
            listingIds: [listing.id],
          });
          this.logger.log(
            { listingId: listing.id, platform: listing.platform, productId },
            'eMAG brand correction: brand set to OEM, repush queued',
          );
        } catch (err) {
          this.logger.warn(
            { listingId: listing.id, err: errMsg(err) },
            'eMAG brand correction: apply failed',
          );
        }
      }
    }
  }

  private async applySizeCorrections(
    candidates: SizeCorrectionCandidate[],
    allListings: schema.Listing[],
  ): Promise<void> {
    if (candidates.length === 0) return;

    const byProduct = new Map<string, SizeCorrectionCandidate>();
    for (const c of candidates) {
      if (!byProduct.has(c.listing.productId)) byProduct.set(c.listing.productId, c);
    }

    const unique = [...byProduct.values()];

    const productMap = new Map<string, schema.Product>();
    for (const c of unique) {
      try {
        const p = await this.products.get(c.listing.productId);
        productMap.set(c.listing.productId, p);
      } catch (err) {
        this.logger.warn(
          { productId: c.listing.productId, err: errMsg(err) },
          'eMAG size correction: product not found',
        );
      }
    }

    for (let i = 0; i < unique.length; i += MAX_CORRECTION_BATCH) {
      const batch = unique.slice(i, i + MAX_CORRECTION_BATCH);
      await this.processSizeCorrectionBatch(batch, productMap, allListings);
    }
  }

  private async processSizeCorrectionBatch(
    batch: SizeCorrectionCandidate[],
    productMap: Map<string, schema.Product>,
    allListings: schema.Listing[],
  ): Promise<void> {
    const payloadProducts = batch.flatMap((c) => {
      const product = productMap.get(c.listing.productId);
      if (!product) return [];
      return [{ sku: product.sku, size: c.wrongSize }];
    });

    if (payloadProducts.length === 0) return;

    this.logger.log({ count: payloadProducts.length }, 'eMAG size correction: calling webhook');

    let raw: unknown;
    try {
      const res = await fetch(SIZE_CORRECTION_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payloadProducts }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      this.logger.warn({ err: errMsg(err) }, 'eMAG size correction: webhook call failed');
      return;
    }

    const parsed = sizeWebhookResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        { err: parsed.error.message },
        'eMAG size correction: invalid webhook response',
      );
      return;
    }

    const skuToResult = new Map(parsed.data.products.map((r) => [r.sku, r]));

    for (const c of batch) {
      const product = productMap.get(c.listing.productId);
      if (!product) continue;

      const result = skuToResult.get(product.sku);
      const correctedSize = result?.corrected_size ?? null;

      if (!correctedSize) {
        this.logger.warn(
          { sku: product.sku, wrongSize: c.wrongSize },
          'eMAG size correction: no corrected size from webhook',
        );
        try {
          await this.listings.setSyncState(c.listing.id, {
            ...c.currentSyncState,
            last_error: {
              message: `eMAG a respins marimea "${c.wrongSize}" (id: ${SIZE_CHAR_ID}), webhook-ul nu a returnat o valoare corectă`,
              at: new Date().toISOString(),
            },
          });
        } catch (err) {
          this.logger.warn(
            { listingId: c.listing.id, err: errMsg(err) },
            'eMAG size correction: set error failed',
          );
        }
        continue;
      }

      const emagListings = allListings.filter(
        (l) => l.productId === c.listing.productId && l.platform.startsWith('emag-'),
      );

      for (const listing of emagListings) {
        try {
          const updatedCharacteristics = updateSizeInCharacteristics(
            listing.syncState.characteristics,
            correctedSize,
          );
          const correctedState: schema.ListingSyncState = {
            ...listing.syncState,
            characteristics: updatedCharacteristics,
            push_state: 'pending',
            last_error: null,
          };
          await this.listings.applyPushResult(listing.id, 'draft', correctedState);
          await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, {
            pluginId: listing.pluginId,
            marketplace: listing.platform,
            listingIds: [listing.id],
          });
          this.logger.log(
            { listingId: listing.id, platform: listing.platform, correctedSize, sku: product.sku },
            'eMAG size correction: repush queued',
          );
        } catch (err) {
          this.logger.warn(
            { listingId: listing.id, err: errMsg(err) },
            'eMAG size correction: apply failed',
          );
        }
      }
    }
  }

  private async applyImageTranslations(candidates: ImageTranslationCandidate[]): Promise<void> {
    if (candidates.length === 0) return;

    for (const c of candidates) {
      let product: schema.Product;
      try {
        product = await this.products.get(c.listing.productId);
      } catch (err) {
        this.logger.warn(
          { productId: c.listing.productId, err: errMsg(err) },
          'eMAG image translation: product not found',
        );
        continue;
      }

      const asin = stripCnSuffix(product.sku);
      const lang = platformToLang(c.listing.platform);
      const images = extractListingImages(c.listing.syncState.images);

      if (images.length === 0) {
        this.logger.warn(
          { listingId: c.listing.id, asin, lang },
          'eMAG image translation: no images in syncState, skipping',
        );
        continue;
      }

      try {
        const res = await fetch(IMAGE_TRANSLATION_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ asin, lang, images }),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
      } catch (err) {
        this.logger.warn(
          { listingId: c.listing.id, asin, lang, err: errMsg(err) },
          'eMAG image translation: webhook call failed',
        );
        continue;
      }

      try {
        await this.listings.setSyncState(c.listing.id, {
          ...c.currentSyncState,
          image_translation_pending: true,
          image_translation_requested_at: new Date().toISOString(),
        });
        this.logger.log(
          { listingId: c.listing.id, asin, lang },
          'eMAG image translation: request sent, marked pending',
        );
      } catch (err) {
        this.logger.warn(
          { listingId: c.listing.id, err: errMsg(err) },
          'eMAG image translation: failed to mark pending',
        );
      }
    }
  }

  private async checkPendingImageTranslations(checks: PendingImageCheck[]): Promise<void> {
    if (checks.length === 0) return;

    // Fetch produse pentru SKU-uri
    const productMap = new Map<string, schema.Product>();
    for (const ch of checks) {
      try {
        const p = await this.products.get(ch.listing.productId);
        productMap.set(ch.listing.productId, p);
      } catch (err) {
        this.logger.warn(
          { productId: ch.listing.productId, err: errMsg(err) },
          'eMAG image check: product not found',
        );
      }
    }

    const payload = checks.flatMap((ch) => {
      const product = productMap.get(ch.listing.productId);
      if (!product) return [];
      return [{ asin: stripCnSuffix(product.sku), lang: platformToLang(ch.listing.platform) }];
    });

    if (payload.length === 0) return;

    this.logger.log({ count: payload.length }, 'eMAG image check: calling check-images webhook');

    let raw: unknown;
    try {
      const res = await fetch(IMAGE_CHECK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ products: payload }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      raw = await res.json();
    } catch (err) {
      this.logger.warn({ err: errMsg(err) }, 'eMAG image check: webhook call failed');
      return;
    }

    const parsed = imageCheckResponseSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn({ err: parsed.error.message }, 'eMAG image check: invalid webhook response');
      return;
    }

    // Index răspuns după asin:lang
    const resultMap = new Map(parsed.data.products.map((r) => [`${r.asin}:${r.lang}`, r.images]));

    for (const ch of checks) {
      const product = productMap.get(ch.listing.productId);
      if (!product) continue;

      const asin = stripCnSuffix(product.sku);
      const lang = platformToLang(ch.listing.platform);
      const translatedImages = resultMap.get(`${asin}:${lang}`);

      if (!translatedImages || translatedImages.length === 0) {
        // Imaginile nu sunt gata încă — așteptăm ciclul următor
        this.logger.log(
          { listingId: ch.listing.id, asin, lang },
          'eMAG image check: images not ready yet',
        );
        continue;
      }

      try {
        const updatedState: schema.ListingSyncState = {
          ...ch.listing.syncState,
          images: translatedImages.map((url) => ({ url })),
          image_translation_pending: undefined,
          image_translation_requested_at: undefined,
          push_state: 'pending',
          last_error: null,
        };
        await this.listings.applyPushResult(ch.listing.id, 'draft', updatedState);
        await this.queue.enqueue<PushOffersJob>(PUSH_OFFERS_JOB, {
          pluginId: ch.listing.pluginId,
          marketplace: ch.listing.platform,
          listingIds: [ch.listing.id],
        });
        this.logger.log(
          { listingId: ch.listing.id, asin, lang, count: translatedImages.length },
          'eMAG image check: translated images applied, repush queued',
        );
      } catch (err) {
        this.logger.warn(
          { listingId: ch.listing.id, err: errMsg(err) },
          'eMAG image check: apply failed',
        );
      }
    }
  }

  private async activeInstance(pluginId: string): Promise<Plugin | null> {
    const plugin = await this.registry.findById(pluginId);
    const loaded = this.loaded.getById(pluginId);
    if (plugin?.status !== 'active' || !loaded) return null;
    return loaded.instance;
  }
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
