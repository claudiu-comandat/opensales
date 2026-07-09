import {
  definePlugin,
  type ActionHandler,
  type ActionHandlerMap,
  type Plugin,
  type PluginContext,
  type SdkApiClient,
} from '@opensales/plugin-sdk';
import { z } from 'zod';

import manifest from '../manifest.json' with { type: 'json' };

import { proposeCampaign } from './campaigns/propose.js';
import { EmagClient } from './client.js';
import { SecretSchema, type EmagPlatformKey, type EmagSecrets } from './config.js';
import { buildLookupActions } from './lookups/index.js';
import { buildOfferActions } from './offers/actions.js';
import {
  orderActions,
  readAttachments,
  saveAttachment,
  stornoOrder,
  type OrderAction,
} from './orders/index.js';
import { readRmas } from './rma/read.js';
import { saveRma } from './rma/save.js';
import { shippingActions } from './shipping/index.js';

import type { CampaignProposalPayload } from './campaigns/types.js';
import type { RmaReadFilters, RmaSavePayload } from './rma/types.js';

let storedCtx: PluginContext | null = null;
let storedSecrets: EmagSecrets | null = null;
const clientCache = new Map<EmagPlatformKey, EmagClient>();

async function loadSecrets(): Promise<EmagSecrets> {
  if (storedSecrets) return storedSecrets;
  if (!storedCtx) throw new Error('emag plugin: not initialized');
  const username = await storedCtx.secrets.get<string>('username');
  const password = await storedCtx.secrets.get<string>('password');
  if (!username || !password) {
    throw new Error(
      'emag plugin: missing credentials. Configure username/password via onConfigure.',
    );
  }
  storedSecrets = SecretSchema.parse({ username, password });
  return storedSecrets;
}

/** Platforma folosită implicit când acțiunile nu specifică una (ex. healthCheck, syncOrders). */
const DEFAULT_PLATFORM: EmagPlatformKey = 'emag-ro';

/**
 * Construiește (și cache-uiește) un client pentru platforma cerută, folosind
 * aceleași credențiale pentru toate țările. Fără argument folosește DEFAULT_PLATFORM ('emag-ro').
 * Cache-ul e invalidat la onConfigure/destroy.
 */
async function getClientFor(platform?: EmagPlatformKey): Promise<EmagClient> {
  if (!storedCtx) throw new Error('emag plugin: not initialized');
  const secrets = await loadSecrets();
  const target = platform ?? DEFAULT_PLATFORM;
  const cached = clientCache.get(target);
  if (cached) return cached;
  const client = new EmagClient({
    platform: target,
    username: secrets.username,
    password: secrets.password,
    logger: storedCtx.logger,
  });
  clientCache.set(target, client);
  return client;
}

function getClient(): Promise<EmagClient> {
  return getClientFor();
}

function getCtx(): PluginContext {
  if (!storedCtx) throw new Error('emag plugin: not initialized');
  return storedCtx;
}

/**
 * Adaptează un `OrderAction<I,O>` (handler cu semnătura `(input, ctx)`) la
 * interfaţa SDK `ActionHandler<I,O>` (handle cu semnătura `(input)`).
 *
 * Dacă input-ul conține câmpul `platform` (opțional — adăugat la syncOrders /
 * acknowledgeOrder pentru suport multi-țară), rutează requestul către clientul
 * corespunzător platformei cerute. Fără `platform` folosește DEFAULT_PLATFORM.
 *
 * Clientul şi contextul sunt obţinute lazy la invocare — plugin-ul poate fi
 * reconfigurat între apeluri fără a invalida harta de acţiuni.
 */
function adaptOrderAction<I, O>(action: OrderAction<I, O>): ActionHandler<I, O> {
  return {
    input: action.input,
    output: action.output,
    handle: async (input: I): Promise<O> => {
      const platform = (input as unknown as { platform?: EmagPlatformKey }).platform;
      const client = await getClientFor(platform);
      const ctx = getCtx();
      return action.handler(input, { client, ctx });
    },
  };
}

// ── Invoice attachment helper ──────────────────────────────────────────────────

/**
 * Mapează marketplace-ul platformei la EmagPlatformKey pentru a selecta
 * clientul API corect la upload-ul atașamentului.
 * FBE folosește același API ca marketplace-ul regular din aceeași țară.
 */
function marketplaceToPlatform(marketplace: string | null | undefined): EmagPlatformKey | null {
  if (!marketplace) return null;
  if (marketplace === 'emag-ro' || marketplace === 'fbe-ro') return 'emag-ro';
  if (marketplace === 'emag-hu' || marketplace === 'fbe-hu') return 'emag-hu';
  if (marketplace === 'emag-bg' || marketplace === 'fbe-bg') return 'emag-bg';
  if (marketplace === 'fd-ro') return 'fd-ro';
  if (marketplace === 'fd-bg') return 'fd-bg';
  return null;
}

interface ResolvedEmagOrder {
  ctx: PluginContext;
  externalId: number;
  orderType: 2 | 3;
  platform: EmagPlatformKey;
  client: EmagClient;
}

async function resolveEmagOrderContext(orderId: string): Promise<ResolvedEmagOrder | null> {
  const ctx = getCtx();
  const api = ctx.api as unknown as SdkApiClient;
  const order = (await api.orders.get(orderId)) as Record<string, unknown>;
  if (order.pluginId !== ctx.pluginId) return null;
  const platform = marketplaceToPlatform(order.marketplace as string | null);
  if (!platform) return null;
  const externalId = parseInt(order.externalId as string, 10);
  if (isNaN(externalId)) return null;
  const rawOrderType = order.orderType;
  if (rawOrderType !== 2 && rawOrderType !== 3) {
    throw new Error(`eMAG order ${externalId} has unexpected order_type: ${String(rawOrderType)}`);
  }
  const orderType: 2 | 3 = rawOrderType;
  const client = await getClientFor(platform);
  return { ctx, externalId, orderType, platform, client };
}

async function attachInvoicePdf(
  client: EmagClient,
  externalId: number,
  orderType: 2 | 3,
  pdfUrl: string,
  invoice: Record<string, unknown> | null | undefined,
): Promise<boolean> {
  const existing = await readAttachments(client, externalId);
  const alreadyUploaded = existing.some((a) => typeof a.url === 'string' && a.url === pdfUrl);
  if (alreadyUploaded) return false;
  const invSeries = typeof invoice?.series === 'string' ? invoice.series : '';
  const invNumber = typeof invoice?.number === 'string' ? invoice.number : '';
  const attachmentName = [invSeries, invNumber].filter(Boolean).join(' ') || undefined;
  await saveAttachment(client, {
    order_id: externalId,
    order_type: orderType,
    url: pdfUrl,
    type: 1,
    ...(attachmentName ? { name: attachmentName } : {}),
  });
  return true;
}

// ── RMA schemas ───────────────────────────────────────────────────────────────
// Wave 4 RMA exports funcţii pure fără Zod schemas standalone; le învelim cu
// scheme permisive (record de unknown) — validarea structurală a câmpurilor
// specifice e responsabilitatea caller-ului.

const rmaReadInputSchema = z.record(z.unknown());
const rmaReadOutputSchema = z.unknown();
const rmaSaveInputSchema = z.record(z.unknown());
const rmaSaveOutputSchema = z.unknown();

// ── Campaign schemas ──────────────────────────────────────────────────────────

const campaignPayloadSchema = z.record(z.unknown());
const campaignResultSchema = z.record(z.unknown());

// ── Action map complet ────────────────────────────────────────────────────────
// Ordinea: orders → offers → shipping → lookups → rma → campaigns.
// Toate cheile match-uiesc 1:1 intrările din manifest.json → actions.

const allActions: ActionHandlerMap = {
  // ── Orders (Wave 1) ─────────────────────────────────────────────────────────
  // Adapter necesar: OrderAction.handler(input, ctx) → ActionHandler.handle(input)
  syncOrders: adaptOrderAction(orderActions.syncOrders) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  saveOrder: adaptOrderAction(orderActions.saveOrder) as unknown as ActionHandler<unknown, unknown>,
  acknowledgeOrder: adaptOrderAction(orderActions.acknowledgeOrder) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  readOrderVolumetry: adaptOrderAction(orderActions.readOrderVolumetry) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  unlockCourier: adaptOrderAction(orderActions.unlockCourier) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  readOrderAttachments: adaptOrderAction(
    orderActions.readOrderAttachments,
  ) as unknown as ActionHandler<unknown, unknown>,
  saveOrderAttachment: adaptOrderAction(
    orderActions.saveOrderAttachment,
  ) as unknown as ActionHandler<unknown, unknown>,
  registerCallback: adaptOrderAction(orderActions.registerCallback) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  cancelOrder: adaptOrderAction(orderActions.cancelOrder) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  emagStornoPartial: adaptOrderAction(orderActions.emagStornoPartial) as unknown as ActionHandler<
    unknown,
    unknown
  >,

  // ── Offers (Wave 2) ──────────────────────────────────────────────────────────
  // buildOfferActions returnează ActionHandlerMap direct — spread fără adapter.
  // Primește getClientFor pentru a ruta push/stock pe platforma cerută.
  ...buildOfferActions(getClientFor),

  // ── Shipping (Wave 3) ────────────────────────────────────────────────────────
  // shippingActions primește getClientFor (platform-aware) pentru suport multi-țară.
  ...(shippingActions(getClientFor) as unknown as ActionHandlerMap),

  // ── Lookups (Wave 5) ─────────────────────────────────────────────────────────
  // buildLookupActions returnează ActionHandlerMap direct — spread fără adapter.
  ...buildLookupActions(getClient),

  // ── RMA (Wave 4) ─────────────────────────────────────────────────────────────
  syncRma: {
    input: rmaReadInputSchema,
    output: rmaReadOutputSchema,
    handle: async (input: unknown): Promise<unknown> => {
      const client = await getClient();
      return readRmas(client, input as RmaReadFilters);
    },
  },

  saveRma: {
    input: rmaSaveInputSchema,
    output: rmaSaveOutputSchema,
    handle: async (input: unknown): Promise<unknown> => {
      const client = await getClient();
      return saveRma(client, input as RmaSavePayload);
    },
  },

  // ── Campaigns (Wave 4) ───────────────────────────────────────────────────────
  proposeCampaign: {
    input: campaignPayloadSchema,
    output: campaignResultSchema,
    handle: async (input: unknown): Promise<unknown> => {
      const client = await getClient();
      return proposeCampaign(client, input as CampaignProposalPayload);
    },
  },
};

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions: allActions,
  events: {
    /**
     * Când o factură e emisă cu succes, o atașăm automat la comanda eMAG.
     * Condiții: comanda aparține acestui plugin, are pdfUrl și marketplace eMAG.
     * Erorile sunt logate și înghițite — factura a fost deja emisă cu succes.
     */
    /**
     * Când o factură storno e emisă: atașăm PDF-ul la comanda eMAG și setăm
     * statusul comenzii la 5 (returned) — storno total.
     * Erorile sunt logate și înghițite — factura a fost deja emisă cu succes.
     */
    'invoice.storno.issued': async (payload: unknown) => {
      try {
        const p = payload as Record<string, unknown>;
        const orderId = p.orderId as string | undefined;
        const invoice = p.invoice as Record<string, unknown> | null | undefined;
        const pdfUrl = invoice?.pdf_url;

        if (!orderId) return;

        const resolved = await resolveEmagOrderContext(orderId);
        if (!resolved) return;
        const { ctx, externalId, orderType, platform, client } = resolved;

        if (typeof pdfUrl === 'string' && pdfUrl) {
          await attachInvoicePdf(client, externalId, orderType, pdfUrl, invoice);
        }

        // FBE (type=2): eMAG nu permite vânzătorilor modificarea statusului comenzii.
        // Singurul lucru permis e upload-ul de atașament, făcut mai sus.
        if (orderType !== 2) {
          await stornoOrder(client, externalId);
        }

        ctx.logger.info('eMAG order marked as returned after storno invoice', {
          orderId,
          externalId,
          platform,
        });
      } catch (err) {
        const fallbackCtx = storedCtx;
        fallbackCtx?.logger.warn('Failed to process storno for eMAG order', {
          error: err instanceof Error ? err.message : String(err),
          payload,
        });
      }
    },

    'invoice.issued': async (payload: unknown) => {
      try {
        const p = payload as Record<string, unknown>;
        const orderId = p.orderId as string | undefined;
        const invoice = p.invoice as Record<string, unknown> | null | undefined;
        const pdfUrl = invoice?.pdf_url;

        if (!orderId || typeof pdfUrl !== 'string' || !pdfUrl) return;

        const resolved = await resolveEmagOrderContext(orderId);
        if (!resolved) return;
        const { ctx, externalId, orderType, platform, client } = resolved;

        const attached = await attachInvoicePdf(client, externalId, orderType, pdfUrl, invoice);
        if (!attached) {
          ctx.logger.info('Invoice already attached to eMAG order, skipping', {
            orderId,
            externalId,
          });
          return;
        }

        ctx.logger.info('Invoice attached to eMAG order', {
          orderId,
          externalId,
          platform,
          orderType,
        });
      } catch (err) {
        const fallbackCtx = storedCtx;
        fallbackCtx?.logger.warn('Failed to attach invoice to eMAG order', {
          error: err instanceof Error ? err.message : String(err),
          payload,
        });
      }
    },
  },

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('eMAG plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      const client = await getClient();
      // VAT read e cel mai cheap call disponibil care validează credențialele.
      await client.read('vat');
      return { ok: true as const };
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'eMAG API unreachable';
      return { ok: false as const, reason };
    }
  },

  destroy() {
    storedCtx?.logger.info('eMAG plugin destroyed');
    storedCtx = null;
    clientCache.clear();
    storedSecrets = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    if (!storedCtx) throw new Error('emag plugin: not initialized');
    const parsed = SecretSchema.parse(raw);
    await storedCtx.secrets.set('username', parsed.username);
    await storedCtx.secrets.set('password', parsed.password);
    // Invalidate cached clients so next call uses new credentials.
    clientCache.clear();
    storedSecrets = null;
    storedCtx.logger.info('eMAG plugin reconfigured');
  },
});

export default plugin;

// Re-exports pentru consumatori (test, action handlers — wave-uri viitoare).
export { EmagClient, EmagApiError, EmagRateLimitError } from './client.js';
export type { EmagResponse, EmagClientOptions } from './client.js';
export { SecretSchema, EMAG_PLATFORMS, resolveApiUrl, resolveDefaultCurrency } from './config.js';
export type { EmagPlatformKey, EmagPlatformConfig, EmagSecrets } from './config.js';
