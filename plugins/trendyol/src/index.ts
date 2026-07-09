import {
  definePlugin,
  type ActionHandler,
  type ActionHandlerMap,
  type Plugin,
  type PluginContext,
  type SdkApiClient,
} from '@opensales/plugin-sdk';
import { type z } from 'zod';

import manifest from '../manifest.json' with { type: 'json' };

import { categoryActions } from './categories/index.js';
import { TrendyolApiError, TrendyolClient } from './client.js';
import {
  SecretSchema,
  resolveBaseUrl,
  type TrendyolSecrets,
  type TrendyolStoreFrontCode,
} from './config.js';
import { orderActions } from './orders/index.js';
import { productActions } from './products/index.js';
import { webhookActions } from './webhooks/index.js';

let storedCtx: PluginContext | null = null;
let storedSecrets: TrendyolSecrets | null = null;
const clientCache = new Map<TrendyolStoreFrontCode, TrendyolClient>();

async function loadSecrets(): Promise<TrendyolSecrets> {
  if (storedSecrets) return storedSecrets;
  if (!storedCtx) throw new Error('trendyol plugin: not initialized');
  const sellerId = await storedCtx.secrets.get<string>('sellerId');
  const apiKey = await storedCtx.secrets.get<string>('apiKey');
  const apiSecretKey = await storedCtx.secrets.get<string>('apiSecretKey');
  const userAgent = await storedCtx.secrets.get<string>('userAgent');
  const stage = await storedCtx.secrets.get<boolean>('stage');
  if (!sellerId || !apiKey || !apiSecretKey || !userAgent) {
    throw new Error(
      'trendyol plugin: missing credentials. Configure sellerId/apiKey/apiSecretKey/userAgent via onConfigure.',
    );
  }
  storedSecrets = SecretSchema.parse({
    sellerId,
    apiKey,
    apiSecretKey,
    userAgent,
    stage: stage ?? false,
  });
  return storedSecrets;
}

/** Storefront folosit implicit când acțiunile nu specifică unul (ex. healthCheck, filterProducts). */
const DEFAULT_STOREFRONT: TrendyolStoreFrontCode = 'RO';

/**
 * Construiește (și cache-uiește) un client pentru storefront-ul cerut, cu
 * aceleași credențiale (sellerId/apiKey/apiSecret) pentru toate. Fără argument
 * folosește DEFAULT_STOREFRONT ('RO').
 */
async function getClientFor(storeFrontCode?: TrendyolStoreFrontCode): Promise<TrendyolClient> {
  if (!storedCtx) throw new Error('trendyol plugin: not initialized');
  const secrets = await loadSecrets();
  const target = storeFrontCode ?? DEFAULT_STOREFRONT;
  const cached = clientCache.get(target);
  if (cached) return cached;
  const client = new TrendyolClient({
    sellerId: secrets.sellerId,
    apiKey: secrets.apiKey,
    apiSecretKey: secrets.apiSecretKey,
    storeFrontCode: target,
    userAgent: secrets.userAgent,
    baseUrl: resolveBaseUrl(secrets.stage),
    logger: storedCtx.logger,
  });
  clientCache.set(target, client);
  return client;
}

function getClient(): Promise<TrendyolClient> {
  return getClientFor();
}

interface TrendyolActionDef {
  input: z.ZodType<unknown>;
  output: z.ZodType<unknown>;
  handler(input: unknown, ctx: { client: TrendyolClient }): Promise<unknown>;
}

function adaptAction(action: TrendyolActionDef): ActionHandler<unknown, unknown> {
  return {
    input: action.input,
    output: action.output,
    handle: async (input: unknown): Promise<unknown> => {
      const client = await getClient();
      return action.handler(input, { client });
    },
  };
}

/**
 * Ca `adaptAction`, dar rutează requestul către storefront-ul din
 * `input.storeFrontCode` (dacă e prezent), folosind un client dedicat.
 */
function adaptRoutableAction(action: TrendyolActionDef): ActionHandler<unknown, unknown> {
  return {
    input: action.input,
    output: action.output,
    handle: async (input: unknown): Promise<unknown> => {
      const storeFrontCode = (input as { storeFrontCode?: TrendyolStoreFrontCode }).storeFrontCode;
      const client = await getClientFor(storeFrontCode);
      return action.handler(input, { client });
    },
  };
}

const allActions: ActionHandlerMap = {
  // ── Products ──────────────────────────────────────────────────────────────────
  // Push/stock/archive rutează pe storefront-ul cerut (input.storeFrontCode).
  createProduct: adaptRoutableAction(productActions.createProduct),
  updateApprovedContent: adaptRoutableAction(productActions.updateApprovedContent),
  updateUnapprovedProduct: adaptRoutableAction(productActions.updateUnapprovedProduct),
  filterProducts: adaptRoutableAction(productActions.filterProducts),
  updateStockAndPrice: adaptRoutableAction(productActions.updateStockAndPrice),
  checkBatchRequest: adaptRoutableAction(productActions.checkBatchRequest),
  archiveProducts: adaptRoutableAction(productActions.archiveProducts),

  // ── Categories & Brands ───────────────────────────────────────────────────────
  getCategoryList: adaptAction(categoryActions.getCategoryList),
  getBrandList: adaptAction(categoryActions.getBrandList),
  getCategoryAttributes: adaptAction(categoryActions.getCategoryAttributes),

  // ── Orders ────────────────────────────────────────────────────────────────────
  getOrders: adaptRoutableAction(orderActions.getOrders),
  getOrdersStream: adaptRoutableAction(orderActions.getOrdersStream),
  updatePackageStatus: adaptAction(orderActions.updatePackageStatus),
  updateTrackingNumber: adaptAction(orderActions.updateTrackingNumber),
  cancelPackage: adaptAction(orderActions.cancelPackage),
  getAwbLabel: adaptAction(orderActions.getAwbLabel),
  sendInvoiceLink: adaptAction(orderActions.sendInvoiceLink),

  // ── Webhooks ──────────────────────────────────────────────────────────────────
  createWebhook: adaptAction(webhookActions.createWebhook),
  listWebhooks: adaptAction(webhookActions.listWebhooks),
  deleteWebhook: adaptAction(webhookActions.deleteWebhook),
};

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions: allActions,
  events: {
    /**
     * Când o factură e emisă, o atașăm automat la comanda Trendyol via seller-invoice-links.
     * Condiții: comanda aparține acestui plugin, are pdfUrl și marketplace trendyol-*.
     * Erorile sunt logate și înghițite — factura a fost deja emisă cu succes.
     */
    'invoice.issued': async (payload: unknown) => {
      try {
        const p = payload as Record<string, unknown>;
        const orderId = p.orderId as string | undefined;
        const invoice = p.invoice as Record<string, unknown> | null | undefined;
        const pdfUrl = invoice?.pdf_url;

        if (!orderId || typeof pdfUrl !== 'string' || !pdfUrl) return;

        if (!storedCtx) return;
        const api = storedCtx.api as unknown as SdkApiClient;
        const order = (await api.orders.get(orderId)) as Record<string, unknown>;

        if (order.pluginId !== storedCtx.pluginId) return;
        if (typeof order.marketplace !== 'string' || !order.marketplace.startsWith('trendyol-'))
          return;

        const shipmentPackageId =
          typeof order.shipmentPackageId === 'number' ? order.shipmentPackageId : null;
        if (!shipmentPackageId) {
          storedCtx.logger.warn('Trendyol invoice.issued: shipmentPackageId lipsă din rawPayload', {
            orderId,
          });
          return;
        }

        const client = await getClient();
        try {
          await client.sendInvoiceLink(pdfUrl, shipmentPackageId);
          storedCtx.logger.info('Link factură trimis la Trendyol', { orderId, shipmentPackageId });
        } catch (linkErr) {
          if (linkErr instanceof TrendyolApiError && linkErr.status === 409) {
            storedCtx.logger.info('Factura deja atașată pe comanda Trendyol, skip', {
              orderId,
              shipmentPackageId,
            });
            return;
          }
          throw linkErr;
        }
      } catch (err) {
        storedCtx?.logger.warn('Eroare la atașarea facturii pe comanda Trendyol', {
          error: err instanceof Error ? err.message : String(err),
          payload,
        });
      }
    },

    /**
     * Când o factură storno e emisă, trimitem link-ul ei la Trendyol.
     * Trendyol permite un singur invoice link per colet — dacă factura originală
     * e deja atașată, API-ul returnează 409 și logăm warning (nu putem adăuga
     * al doilea link). Factura storno rămâne accesibilă în sistemul FGO.
     */
    'invoice.storno.issued': async (payload: unknown) => {
      try {
        const p = payload as Record<string, unknown>;
        const orderId = p.orderId as string | undefined;
        const invoice = p.invoice as Record<string, unknown> | null | undefined;
        const pdfUrl = invoice?.pdf_url;

        if (!orderId || typeof pdfUrl !== 'string' || !pdfUrl) return;

        if (!storedCtx) return;
        const api = storedCtx.api as unknown as SdkApiClient;
        const order = (await api.orders.get(orderId)) as Record<string, unknown>;

        if (order.pluginId !== storedCtx.pluginId) return;
        if (typeof order.marketplace !== 'string' || !order.marketplace.startsWith('trendyol-'))
          return;

        const shipmentPackageId =
          typeof order.shipmentPackageId === 'number' ? order.shipmentPackageId : null;
        if (!shipmentPackageId) {
          storedCtx.logger.warn(
            'Trendyol invoice.storno.issued: shipmentPackageId lipsă din rawPayload',
            { orderId },
          );
          return;
        }

        const client = await getClient();
        try {
          await client.sendInvoiceLink(pdfUrl, shipmentPackageId);
          storedCtx.logger.info('Link factură storno trimis la Trendyol', {
            orderId,
            shipmentPackageId,
          });
        } catch (linkErr) {
          if (linkErr instanceof TrendyolApiError && linkErr.status === 409) {
            storedCtx.logger.warn(
              'Trendyol nu permite al doilea invoice link — factura storno nu a putut fi atașată pe colet',
              { orderId, shipmentPackageId },
            );
            return;
          }
          throw linkErr;
        }
      } catch (err) {
        storedCtx?.logger.warn('Eroare la atașarea facturii storno pe comanda Trendyol', {
          error: err instanceof Error ? err.message : String(err),
          payload,
        });
      }
    },
  },

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('Trendyol plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      const client = await getClient();
      // Cheapest call — category list (50 req/min bucket)
      await client.get('/integration/product/product-categories', true);
      return { ok: true as const };
    } catch (e) {
      const reason = e instanceof TrendyolApiError ? e.message : 'Trendyol API unreachable';
      return { ok: false as const, reason };
    }
  },

  destroy() {
    storedCtx?.logger.info('Trendyol plugin destroyed');
    storedCtx = null;
    clientCache.clear();
    storedSecrets = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    if (!storedCtx) throw new Error('trendyol plugin: not initialized');
    const parsed = SecretSchema.parse(raw);
    await storedCtx.secrets.set('sellerId', parsed.sellerId);
    await storedCtx.secrets.set('apiKey', parsed.apiKey);
    await storedCtx.secrets.set('apiSecretKey', parsed.apiSecretKey);
    await storedCtx.secrets.set('userAgent', parsed.userAgent);
    await storedCtx.secrets.set('stage', parsed.stage);
    clientCache.clear();
    storedSecrets = null;
    storedCtx.logger.info('Trendyol plugin reconfigured', { stage: parsed.stage });
  },
});

export default plugin;

// Re-exports
export { TrendyolClient, TrendyolApiError, TrendyolRateLimitError } from './client.js';
export type { TrendyolClientOptions } from './client.js';
export {
  SecretSchema,
  TRENDYOL_STOREFRONTS,
  resolveBaseUrl,
  resolveDefaultCurrency,
} from './config.js';
export type { TrendyolStoreFrontCode, TrendyolSecrets } from './config.js';
