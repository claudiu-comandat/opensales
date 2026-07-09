import {
  definePlugin,
  type ActionHandlerMap,
  type EventHandlerMap,
  type Plugin,
  type PluginContext,
} from '@opensales/plugin-sdk';

import manifest from '../manifest.json' with { type: 'json' };

import { FgoClient } from './client.js';
import { SecretSchema, type FgoSecrets } from './config.js';
import { buildOnOrderCreated } from './events/on-order-created.js';
import { buildInvoiceActions } from './invoices/actions.js';
import { buildNomenclatureActions } from './nomenclatures/actions.js';

// ── Module-level state ─────────────────────────────────────────────────────────
// Plugin SDK nu pasează ctx la event handlers, deci handler-ele se închid peste
// state-ul de mai jos. Resetat la destroy()/onConfigure().

let storedCtx: PluginContext | null = null;
let storedSecrets: FgoSecrets | null = null;
let storedClient: FgoClient | null = null;
let actionMap: ActionHandlerMap | null = null;

async function getClient(): Promise<FgoClient> {
  if (storedClient) return storedClient;
  if (!storedCtx) throw new Error('fgo plugin: not initialized');
  storedSecrets ??= await loadSecrets(storedCtx);
  storedClient = new FgoClient({
    codUnic: storedSecrets.codUnic,
    privateKey: storedSecrets.privateKey,
    environment: storedSecrets.environment,
    logger: storedCtx.logger,
    platformUrl: storedSecrets.platformUrl,
  });
  return storedClient;
}

function getCtx(): PluginContext {
  if (!storedCtx) throw new Error('fgo plugin: not initialized');
  return storedCtx;
}

function getEmitConfig(): {
  platformUrl?: string | undefined;
  defaultSerie?: string | undefined;
  verificareDuplicat?: boolean | undefined;
} {
  if (!storedSecrets) return {};
  const cfg: { platformUrl?: string; defaultSerie?: string; verificareDuplicat?: boolean } = {};
  // platformUrl: secrets override > PUBLIC_API_URL env var > RAILWAY_STATIC_URL (zero-config)
  const platformUrl =
    storedSecrets.platformUrl ?? process.env.PUBLIC_API_URL ?? process.env.RAILWAY_STATIC_URL;
  if (platformUrl !== undefined) cfg.platformUrl = platformUrl;
  if (storedSecrets.defaultSerie !== undefined) cfg.defaultSerie = storedSecrets.defaultSerie;
  if (storedSecrets.verificareDuplicat !== undefined) {
    cfg.verificareDuplicat = storedSecrets.verificareDuplicat;
  }
  return cfg;
}

async function loadSecrets(ctx: PluginContext): Promise<FgoSecrets> {
  const codUnic = await ctx.secrets.get<string>('codUnic');
  const privateKey = await ctx.secrets.get<string>('privateKey');
  const environment = await ctx.secrets.get<'prod' | 'uat'>('environment');
  if (!codUnic || !privateKey) {
    throw new Error(
      'fgo plugin: lipsesc credențialele. Configurează codUnic + privateKey prin onConfigure.',
    );
  }
  const raw: Record<string, unknown> = { codUnic, privateKey };
  if (environment !== null && environment !== undefined) raw.environment = environment;
  const platformUrl = await ctx.secrets.get<string>('platformUrl');
  if (platformUrl) raw.platformUrl = platformUrl;
  const defaultSerie = await ctx.secrets.get<string>('defaultSerie');
  if (defaultSerie) raw.defaultSerie = defaultSerie;
  const autoEmit = await ctx.secrets.get<boolean>('autoEmitOnOrderCreated');
  if (autoEmit !== null && autoEmit !== undefined) raw.autoEmitOnOrderCreated = autoEmit;
  const verificareDuplicat = await ctx.secrets.get<boolean>('verificareDuplicat');
  if (verificareDuplicat !== null && verificareDuplicat !== undefined) {
    raw.verificareDuplicat = verificareDuplicat;
  }
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
    ctx.logger.info('FGO plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      const client = await getClient();
      await client.getNomenclature('valuta');
      return { ok: true as const };
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'FGO API unreachable';
      return { ok: false as const, reason };
    }
  },

  destroy() {
    storedCtx?.logger.info('FGO plugin destroyed');
    storedCtx = null;
    storedClient = null;
    storedSecrets = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    if (!storedCtx) throw new Error('fgo plugin: not initialized');
    const parsed = SecretSchema.parse(raw);
    await storedCtx.secrets.set('codUnic', parsed.codUnic);
    await storedCtx.secrets.set('privateKey', parsed.privateKey);
    await storedCtx.secrets.set('environment', parsed.environment);
    if (parsed.platformUrl !== undefined) {
      await storedCtx.secrets.set('platformUrl', parsed.platformUrl);
    }
    if (parsed.defaultSerie !== undefined) {
      await storedCtx.secrets.set('defaultSerie', parsed.defaultSerie);
    }
    await storedCtx.secrets.set('autoEmitOnOrderCreated', parsed.autoEmitOnOrderCreated);
    await storedCtx.secrets.set('verificareDuplicat', parsed.verificareDuplicat);
    // Invalidate cache for next call.
    storedSecrets = null;
    storedClient = null;
    storedCtx.logger.info('FGO plugin reconfigured', {
      environment: parsed.environment,
      autoEmit: parsed.autoEmitOnOrderCreated,
    });
  },
});

export default plugin;

// Re-exports pentru consumatori (tests, future actions).
export { FgoApiError, FgoClient, FgoRateLimitError } from './client.js';
export type {
  FgoClientInfo,
  FgoClientOptions,
  FgoEmitInput,
  FgoEmitResponse,
  FgoLineItem,
  FgoNomenclatureItem,
  FgoPdfResponse,
  FgoRecordPaymentInput,
  FgoStandardResponse,
} from './client.js';
export { FGO_ENVIRONMENTS, SecretSchema, resolveApiUrl } from './config.js';
export type { FgoEnvironment, FgoSecrets } from './config.js';
export {
  buildFgoEmitInput,
  fromFgoEmitResponse,
  minorToMajor,
  orderWithItemsSchema,
  toCancelledInvoice,
} from './invoices/mappers.js';
export type { OrderWithItems, BuildFgoEmitInputOptions } from './invoices/mappers.js';
