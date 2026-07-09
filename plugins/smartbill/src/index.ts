import {
  definePlugin,
  type ActionHandlerMap,
  type EventHandlerMap,
  type Plugin,
  type PluginContext,
} from '@opensales/plugin-sdk';

import manifest from '../manifest.json' with { type: 'json' };

import { SmartBillClient } from './client.js';
import { SecretSchema, type SmartBillSecrets } from './config.js';
import { buildOnOrderCreated } from './events/on-order-created.js';
import { buildInvoiceActions } from './invoices/actions.js';
import { buildNomenclatureActions } from './nomenclatures/actions.js';

// ── Module-level state ─────────────────────────────────────────────────────────
// Plugin SDK nu pasează ctx la event handlers, deci handler-ele se închid peste
// state-ul de mai jos. Resetat la destroy()/onConfigure().

let storedCtx: PluginContext | null = null;
let storedSecrets: SmartBillSecrets | null = null;
let storedClient: SmartBillClient | null = null;
let actionMap: ActionHandlerMap | null = null;

async function getClient(): Promise<SmartBillClient> {
  if (storedClient) return storedClient;
  if (!storedCtx) throw new Error('smartbill plugin: not initialized');
  storedSecrets ??= await loadSecrets(storedCtx);
  storedClient = new SmartBillClient({
    companyVatCode: storedSecrets.companyVatCode,
    username: storedSecrets.username,
    token: storedSecrets.token,
    logger: storedCtx.logger,
    ...(storedCtx.httpLog ? { httpLog: storedCtx.httpLog } : {}),
  });
  return storedClient;
}

function getCtx(): PluginContext {
  if (!storedCtx) throw new Error('smartbill plugin: not initialized');
  return storedCtx;
}

function getEmitConfig(): {
  defaultSeriesName?: string | undefined;
  language?: string | undefined;
  useStock?: boolean | undefined;
  saveClientToDb?: boolean | undefined;
} {
  if (!storedSecrets) return {};
  const cfg: {
    defaultSeriesName?: string;
    language?: string;
    useStock?: boolean;
    saveClientToDb?: boolean;
  } = {};
  if (storedSecrets.defaultSeriesName !== undefined) {
    cfg.defaultSeriesName = storedSecrets.defaultSeriesName;
  }
  if (storedSecrets.language !== undefined) cfg.language = storedSecrets.language;
  if (storedSecrets.useStock !== undefined) cfg.useStock = storedSecrets.useStock;
  if (storedSecrets.saveClientToDb !== undefined) cfg.saveClientToDb = storedSecrets.saveClientToDb;
  return cfg;
}

async function loadSecrets(ctx: PluginContext): Promise<SmartBillSecrets> {
  const companyVatCode = await ctx.secrets.get<string>('companyVatCode');
  const username = await ctx.secrets.get<string>('username');
  const token = await ctx.secrets.get<string>('token');
  if (!companyVatCode || !username || !token) {
    throw new Error(
      'smartbill plugin: lipsesc credențialele. Configurează companyVatCode + username + token prin onConfigure.',
    );
  }
  const raw: Record<string, unknown> = { companyVatCode, username, token };
  const defaultSeriesName = await ctx.secrets.get<string>('defaultSeriesName');
  if (defaultSeriesName) raw.defaultSeriesName = defaultSeriesName;
  const language = await ctx.secrets.get<string>('language');
  if (language) raw.language = language;
  const useStock = await ctx.secrets.get<boolean>('useStock');
  if (useStock !== null && useStock !== undefined) raw.useStock = useStock;
  const saveClientToDb = await ctx.secrets.get<boolean>('saveClientToDb');
  if (saveClientToDb !== null && saveClientToDb !== undefined) raw.saveClientToDb = saveClientToDb;
  const autoEmit = await ctx.secrets.get<boolean>('autoEmitOnOrderCreated');
  if (autoEmit !== null && autoEmit !== undefined) raw.autoEmitOnOrderCreated = autoEmit;
  return SecretSchema.parse(raw);
}

// ── Action map ─────────────────────────────────────────────────────────────────

actionMap = {
  ...buildInvoiceActions(getClient, getCtx, getEmitConfig),
  ...buildNomenclatureActions(getClient),
};

// ── Event handlers ─────────────────────────────────────────────────────────────

const onOrderCreated = buildOnOrderCreated({
  isEnabled: () => storedSecrets?.autoEmitOnOrderCreated === true,
  getActions: () => actionMap,
  logger: () => storedCtx?.logger ?? null,
});

const eventHandlers: EventHandlerMap = {
  'order.created': onOrderCreated,
};

// ── Plugin ─────────────────────────────────────────────────────────────────────

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions: actionMap,
  events: eventHandlers,

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('SmartBill plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      const client = await getClient();
      await client.getTaxes();
      return { ok: true as const };
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'SmartBill API unreachable';
      return { ok: false as const, reason };
    }
  },

  destroy() {
    storedCtx?.logger.info('SmartBill plugin destroyed');
    storedCtx = null;
    storedClient = null;
    storedSecrets = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    if (!storedCtx) throw new Error('smartbill plugin: not initialized');
    const parsed = SecretSchema.parse(raw);
    await storedCtx.secrets.set('companyVatCode', parsed.companyVatCode);
    await storedCtx.secrets.set('username', parsed.username);
    await storedCtx.secrets.set('token', parsed.token);
    if (parsed.defaultSeriesName !== undefined) {
      await storedCtx.secrets.set('defaultSeriesName', parsed.defaultSeriesName);
    }
    await storedCtx.secrets.set('language', parsed.language);
    await storedCtx.secrets.set('useStock', parsed.useStock);
    await storedCtx.secrets.set('saveClientToDb', parsed.saveClientToDb);
    await storedCtx.secrets.set('autoEmitOnOrderCreated', parsed.autoEmitOnOrderCreated);
    // Invalidate cache for next call.
    storedSecrets = null;
    storedClient = null;
    storedCtx.logger.info('SmartBill plugin reconfigured', {
      autoEmit: parsed.autoEmitOnOrderCreated,
    });
  },
});

export default plugin;

// Re-exports pentru consumatori (tests, future actions).
export { SmartBillApiError, SmartBillClient, SmartBillRateLimitError } from './client.js';
export type {
  SmartBillClientInfo,
  SmartBillClientOptions,
  SmartBillEmitInput,
  SmartBillEmitResponse,
  SmartBillPaymentStatusResponse,
  SmartBillPdfResponse,
  SmartBillProduct,
  SmartBillRecordPaymentInput,
  SmartBillStandardResponse,
} from './client.js';
export { SMARTBILL_API_URL, SecretSchema, buildBasicAuthHeader } from './config.js';
export type { SmartBillSecrets } from './config.js';
export {
  buildSmartBillEmitInput,
  fromSmartBillEmitResponse,
  minorToMajor,
  orderWithItemsSchema,
  toCancelledInvoice,
  toIssuedInvoice,
  toStornoInvoice,
} from './invoices/mappers.js';
export type { OrderWithItems, BuildSmartBillEmitInputOptions } from './invoices/mappers.js';
