import {
  definePlugin,
  type ActionHandler,
  type ActionHandlerMap,
  type Plugin,
  type PluginContext,
} from '@opensales/plugin-sdk';
import { z } from 'zod';

import manifest from '../manifest.json' with { type: 'json' };

import { aftersalesActions } from './aftersales/index.js';
import { TemuApiError, TemuClient } from './client.js';
import { complianceActions } from './compliance/index.js';
import { SecretSchema, resolveApiUrl, type TemuSecrets } from './config.js';
import { fulfillmentActions } from './fulfillment/index.js';
import { goodsActions } from './goods/index.js';
import { orderActions } from './orders/index.js';

let storedCtx: PluginContext | null = null;
let storedClient: TemuClient | null = null;
let storedSecrets: TemuSecrets | null = null;

/**
 * Lazy getter — citește secrets-urile la primul apel și construiește clientul.
 * La onConfigure, storedClient este invalidat și se recreează la următorul apel.
 */
async function getClient(): Promise<TemuClient> {
  if (storedClient) return storedClient;
  if (!storedCtx) throw new Error('temu plugin: not initialized');
  if (!storedSecrets) {
    const platform = await storedCtx.secrets.get<TemuSecrets['platform']>('platform');
    const appKey = await storedCtx.secrets.get<string>('appKey');
    const appSecret = await storedCtx.secrets.get<string>('appSecret');
    const accessToken = await storedCtx.secrets.get<string>('accessToken');
    if (!platform || !appKey || !appSecret || !accessToken) {
      throw new Error(
        'temu plugin: missing credentials. Configure platform/appKey/appSecret/accessToken via onConfigure.',
      );
    }
    storedSecrets = SecretSchema.parse({ platform, appKey, appSecret, accessToken });
  }
  storedClient = new TemuClient({
    platform: storedSecrets.platform,
    apiUrl: resolveApiUrl(storedSecrets.platform),
    appKey: storedSecrets.appKey,
    appSecret: storedSecrets.appSecret,
    accessToken: storedSecrets.accessToken,
    logger: storedCtx.logger,
  });
  return storedClient;
}

function getCtx(): PluginContext {
  if (!storedCtx) throw new Error('temu plugin: not initialized');
  return storedCtx;
}

/**
 * Adaptează un action cu semnătura `handler(input, { client })` la
 * interfața SDK `ActionHandler.handle(input)`.
 */
function adaptAction<I, O>(action: {
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler(input: I, ctx: { client: TemuClient }): Promise<O>;
}): ActionHandler<I, O> {
  return {
    input: action.input,
    output: action.output,
    handle: async (input: I): Promise<O> => {
      const client = await getClient();
      return action.handler(input, { client });
    },
  };
}

// ─── createAccessToken — acțiune specială, actualizează stored token ──────────

const createAccessTokenInputSchema = z.object({
  code: z.string().min(1, 'Authorization code obligatoriu'),
});

const createAccessTokenOutputSchema = z.object({
  accessToken: z.string(),
  mallId: z.string().optional(),
});

// ─── Action map complet ────────────────────────────────────────────────────────

const allActions: ActionHandlerMap = {
  // ── Auth ─────────────────────────────────────────────────────────────────────
  createAccessToken: {
    input: createAccessTokenInputSchema,
    output: createAccessTokenOutputSchema,
    handle: async (input: unknown): Promise<unknown> => {
      const parsed = createAccessTokenInputSchema.parse(input);
      const client = await getClient();
      const ctx = getCtx();
      const result = await client.call<Record<string, unknown>>('bg.open.accesstoken.create', {
        data: { code: parsed.code },
      });
      const newToken = result.accessToken as string;
      // Persistă noul token
      await ctx.secrets.set('accessToken', newToken);
      // Invalidate client so next call uses updated token
      storedClient = null;
      storedSecrets = null;
      return {
        accessToken: newToken,
        mallId: result.mallId as string | undefined,
      };
    },
  },

  // ── Orders ───────────────────────────────────────────────────────────────────
  syncOrders: adaptAction(orderActions.syncOrders) as unknown as ActionHandler<unknown, unknown>,
  getOrderDetail: adaptAction(orderActions.getOrderDetail) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  getShippingInfo: adaptAction(orderActions.getShippingInfo) as unknown as ActionHandler<
    unknown,
    unknown
  >,

  // ── Fulfillment ───────────────────────────────────────────────────────────────
  confirmShipment: adaptAction(fulfillmentActions.confirmShipment) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  getLogisticsCompanies: adaptAction(
    fulfillmentActions.getLogisticsCompanies,
  ) as unknown as ActionHandler<unknown, unknown>,

  // ── Goods ─────────────────────────────────────────────────────────────────────
  pushGoods: adaptAction(goodsActions.pushGoods),
  uploadGoodsImage: adaptAction(goodsActions.uploadGoodsImage),
  syncGoods: adaptAction(goodsActions.syncGoods) as unknown as ActionHandler<unknown, unknown>,
  updateStock: adaptAction(goodsActions.updateStock),
  updatePrice: adaptAction(goodsActions.updatePrice),
  setSaleStatus: adaptAction(goodsActions.setSaleStatus) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  readCategories: adaptAction(goodsActions.readCategories) as unknown as ActionHandler<
    unknown,
    unknown
  >,

  // ── Aftersales ────────────────────────────────────────────────────────────────
  syncAftersales: adaptAction(aftersalesActions.syncAftersales) as unknown as ActionHandler<
    unknown,
    unknown
  >,
  refundOrder: adaptAction(aftersalesActions.refundOrder) as unknown as ActionHandler<
    unknown,
    unknown
  >,

  // ── Compliance & submit (completare produs + trimitere la validare) ────────────
  getBrandTrademarks: adaptAction(complianceActions.getBrandTrademarks),
  getComplianceContacts: adaptAction(complianceActions.getComplianceContacts),
  getProductAttributes: adaptAction(complianceActions.getProductAttributes),
  getComplianceExtraTemplate: adaptAction(complianceActions.getComplianceExtraTemplate),
  editCompliance: adaptAction(complianceActions.editCompliance),
  submitForReview: adaptAction(complianceActions.submitForReview),
};

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions: allActions,
  events: {},

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('Temu plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      const client = await getClient();
      // Cel mai cheap call disponibil — verifică dacă token-ul e valid
      await client.call('bg.open.accesstoken.info.get', { data: {} });
      return { ok: true as const };
    } catch (e) {
      const reason = e instanceof TemuApiError ? e.message : 'Temu API unreachable';
      return { ok: false as const, reason };
    }
  },

  destroy() {
    storedCtx?.logger.info('Temu plugin destroyed');
    storedCtx = null;
    storedClient = null;
    storedSecrets = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    if (!storedCtx) throw new Error('temu plugin: not initialized');
    const parsed = SecretSchema.parse(raw);
    await storedCtx.secrets.set('platform', parsed.platform);
    await storedCtx.secrets.set('appKey', parsed.appKey);
    await storedCtx.secrets.set('appSecret', parsed.appSecret);
    await storedCtx.secrets.set('accessToken', parsed.accessToken);
    // Invalidate cached client so next call uses new credentials
    storedClient = null;
    storedSecrets = null;
    storedCtx.logger.info('Temu plugin reconfigured', { platform: parsed.platform });
  },
});

export default plugin;

// Re-exports pentru consumatori (teste, wave-uri viitoare)
export {
  TemuClient,
  TemuApiError,
  TemuRateLimitError,
  acquireTemuSlot,
  TEMU_MAX_PER_SEC,
  _resetTemuLimiterForTest,
} from './client.js';
export type { TemuResponse, TemuClientOptions } from './client.js';
export { SecretSchema, TEMU_PLATFORMS, resolveApiUrl, resolveDefaultCurrency } from './config.js';
export type { TemuPlatformKey, TemuPlatformConfig, TemuSecrets } from './config.js';
export { computeSign } from './sign.js';
