import {
  definePlugin,
  type ActionHandler,
  type ActionHandlerMap,
  type Plugin,
  type PluginContext,
} from '@opensales/plugin-sdk';
import { type z } from 'zod';

import manifest from '../manifest.json' with { type: 'json' };

import { SkroutzApiError, SkroutzClient } from './client.js';
import { SKROUTZ_BASE_URL, SecretSchema, type SkroutzSecrets } from './config.js';
import { orderActions, type OrderActionContext } from './orders/index.js';
import { productActions, type ProductActionContext } from './products/index.js';

let storedCtx: PluginContext | null = null;
let storedSecrets: SkroutzSecrets | null = null;
let cachedClient: SkroutzClient | null = null;

async function loadSecrets(): Promise<SkroutzSecrets> {
  if (storedSecrets) return storedSecrets;
  if (!storedCtx) throw new Error('skroutz plugin: not initialized');
  const ordersToken = await storedCtx.secrets.get<string>('ordersToken');
  const productsToken = await storedCtx.secrets.get<string>('productsToken');
  const webhookSecret = await storedCtx.secrets.get<string>('webhookSecret');
  storedSecrets = SecretSchema.parse({
    ...(ordersToken ? { ordersToken } : {}),
    ...(productsToken ? { productsToken } : {}),
    ...(webhookSecret ? { webhookSecret } : {}),
  });
  return storedSecrets;
}

async function getClient(): Promise<SkroutzClient> {
  if (!storedCtx) throw new Error('skroutz plugin: not initialized');
  if (cachedClient) return cachedClient;
  const secrets = await loadSecrets();
  cachedClient = new SkroutzClient({
    ...(secrets.ordersToken ? { ordersToken: secrets.ordersToken } : {}),
    ...(secrets.productsToken ? { productsToken: secrets.productsToken } : {}),
    baseUrl: SKROUTZ_BASE_URL,
    logger: storedCtx.logger,
    ...(storedCtx.httpLog ? { httpLog: storedCtx.httpLog } : {}),
  });
  return cachedClient;
}

// ─── Adaptoare acțiune ────────────────────────────────────────────────────────

interface ProductActionDef {
  input: z.ZodType<unknown>;
  output: z.ZodType<unknown>;
  handler(input: unknown, ctx: ProductActionContext): Promise<unknown>;
}

interface OrderActionDef {
  input: z.ZodType<unknown>;
  output: z.ZodType<unknown>;
  handler(input: unknown, ctx: OrderActionContext): Promise<unknown>;
}

function adaptProduct(action: ProductActionDef): ActionHandler<unknown, unknown> {
  return {
    input: action.input,
    output: action.output,
    handle: async (input: unknown): Promise<unknown> => {
      const client = await getClient();
      return action.handler(input, { client });
    },
  };
}

function adaptOrder(action: OrderActionDef): ActionHandler<unknown, unknown> {
  return {
    input: action.input,
    output: action.output,
    handle: async (input: unknown): Promise<unknown> => {
      const client = await getClient();
      const secrets = await loadSecrets();
      return action.handler(input, { client, webhookSecret: secrets.webhookSecret });
    },
  };
}

const allActions: ActionHandlerMap = {
  // ── Products / oferte ─────────────────────────────────────────────────────────
  generateProductFeed: adaptProduct(productActions.generateProductFeed),
  updateInventory: adaptProduct(productActions.updateInventory),
  validateInventory: adaptProduct(productActions.validateInventory),
  setOfferActive: adaptProduct(productActions.setOfferActive),

  // ── Orders ────────────────────────────────────────────────────────────────────
  getOrder: adaptOrder(orderActions.getOrder),
  acceptOrder: adaptOrder(orderActions.acceptOrder),
  rejectOrder: adaptOrder(orderActions.rejectOrder),
  uploadInvoice: adaptOrder(orderActions.uploadInvoice),
  setAsReady: adaptOrder(orderActions.setAsReady),
  setAsNotReady: adaptOrder(orderActions.setAsNotReady),
  updateTrackingDetails: adaptOrder(orderActions.updateTrackingDetails),
  parseWebhook: adaptOrder(orderActions.parseWebhook),
};

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions: allActions,
  events: {},

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('Skroutz plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      const client = await getClient();
      // Demo order disponibil în producție pentru testare — nu modifică date.
      await client.get('orders', '/merchants/ecommerce/orders/DEMO-OPEN');
      return { ok: true as const };
    } catch (e) {
      const reason = e instanceof SkroutzApiError ? e.message : 'Skroutz API unreachable';
      return { ok: false as const, reason };
    }
  },

  destroy() {
    storedCtx?.logger.info('Skroutz plugin destroyed');
    storedCtx = null;
    cachedClient = null;
    storedSecrets = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    if (!storedCtx) throw new Error('skroutz plugin: not initialized');
    const parsed = SecretSchema.parse(raw);
    if (parsed.ordersToken !== undefined) {
      await storedCtx.secrets.set('ordersToken', parsed.ordersToken);
    }
    if (parsed.productsToken !== undefined) {
      await storedCtx.secrets.set('productsToken', parsed.productsToken);
    }
    if (parsed.webhookSecret !== undefined) {
      await storedCtx.secrets.set('webhookSecret', parsed.webhookSecret);
    }
    cachedClient = null;
    storedSecrets = null;
    storedCtx.logger.info('Skroutz plugin reconfigured');
  },
});

export default plugin;

// Re-exports
export { SkroutzClient, SkroutzApiError, SkroutzRateLimitError } from './client.js';
export type { SkroutzClientOptions, SkroutzAuthDomain } from './client.js';
export { SecretSchema, SKROUTZ_BASE_URL, SKROUTZ_CURRENCY } from './config.js';
export type { SkroutzSecrets } from './config.js';
