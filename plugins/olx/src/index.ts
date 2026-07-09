import {
  definePlugin,
  type ActionHandler,
  type ActionHandlerMap,
  type Plugin,
  type PluginContext,
} from '@opensales/plugin-sdk';
import { z } from 'zod';

import manifest from '../manifest.json' with { type: 'json' };

import {
  advertCommand,
  createAdvert,
  deleteAdvert,
  syncAdverts,
  updateAdvert,
} from './adverts/adverts.js';
import {
  advertCommandInputSchema,
  createAdvertInputSchema,
  deleteAdvertInputSchema,
  olxAdvertSchema,
  syncAdvertsInputSchema,
  syncAdvertsOutputSchema,
  updateAdvertInputSchema,
} from './adverts/types.js';
import { readCategoryAttributes, syncCategories } from './categories/categories.js';
import {
  readCategoryAttributesInputSchema,
  readCategoryAttributesOutputSchema,
  syncCategoriesInputSchema,
  syncCategoriesOutputSchema,
} from './categories/types.js';
import { OlxClient } from './client.js';
import { SecretSchema, type OlxSecrets } from './config.js';
import {
  advertCommandEvent,
  advertCreatedEvent,
  advertDeletedEvent,
  advertUpdatedEvent,
  type ListingEvent,
} from './events.js';
import { readMessages, sendMessage } from './messages/messages.js';
import {
  readMessagesInputSchema,
  readMessagesOutputSchema,
  sendMessageInputSchema,
  sendMessageOutputSchema,
} from './messages/types.js';

let storedCtx: PluginContext | null = null;
let storedSecrets: OlxSecrets | null = null;
let client: OlxClient | null = null;

function getCtx(): PluginContext {
  if (!storedCtx) throw new Error('olx plugin: not initialized');
  return storedCtx;
}

async function loadSecrets(): Promise<OlxSecrets> {
  if (storedSecrets) return storedSecrets;
  const ctx = getCtx();
  const clientId = await ctx.secrets.get<string>('clientId');
  const clientSecret = await ctx.secrets.get<string>('clientSecret');
  const refreshToken = await ctx.secrets.get<string>('refreshToken');
  if (!clientId || !clientSecret) {
    throw new Error(
      'olx plugin: missing credentials. Configure clientId/clientSecret via onConfigure.',
    );
  }
  storedSecrets = SecretSchema.parse({
    clientId,
    clientSecret,
    ...(refreshToken ? { refreshToken } : {}),
  });
  return storedSecrets;
}

async function getClient(): Promise<OlxClient> {
  if (client) return client;
  const ctx = getCtx();
  const secrets = await loadSecrets();
  client = new OlxClient({
    clientId: secrets.clientId,
    clientSecret: secrets.clientSecret,
    refreshToken: secrets.refreshToken,
    logger: ctx.logger,
    httpLog: ctx.httpLog,
    // Persistă refresh token-ul rotit de OLX (emis zilnic) în storage-ul criptat.
    onRefreshToken: async (rt) => {
      await ctx.secrets.set('refreshToken', rt);
      if (storedSecrets) storedSecrets.refreshToken = rt;
    },
  });
  return client;
}

/**
 * Helper care leagă o funcție de domeniu `(client, input) => Promise<O>` la
 * interfața `ActionHandler` a SDK-ului, validând input/output cu Zod.
 */
function action<I, O>(
  input: z.ZodType<I>,
  output: z.ZodType<O>,
  run: (c: OlxClient, input: I) => Promise<O>,
): ActionHandler<I, O> {
  return {
    input,
    output,
    handle: async (i) => run(await getClient(), i),
  };
}

/**
 * Ca `action`, dar emite un eveniment `listing.*` către platformă DUPĂ ce call-ul
 * a reușit. Emiterea e fire-and-forget: o eroare de event bus e logată, nu propagată
 * (operația pe OLX a reușit deja, nu o invalidăm pentru o problemă de notificare).
 */
function advertAction<I, O>(
  input: z.ZodType<I>,
  output: z.ZodType<O>,
  run: (c: OlxClient, input: I) => Promise<O>,
  makeEvent: (pluginId: string, input: I, result: O) => ListingEvent,
): ActionHandler<I, O> {
  return {
    input,
    output,
    handle: async (i) => {
      const result = await run(await getClient(), i);
      const ctx = getCtx();
      const { event, payload } = makeEvent(ctx.pluginId, i, result);
      try {
        ctx.events.emit(event, payload);
      } catch (err) {
        ctx.logger.warn('olx: failed to emit listing event', {
          event,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      return result;
    },
  };
}

const advertOutput = olxAdvertSchema;
const voidOutput = z.void();

const actions: ActionHandlerMap = {
  syncCategories: action(
    syncCategoriesInputSchema,
    syncCategoriesOutputSchema,
    syncCategories,
  ) as ActionHandler<unknown, unknown>,
  readCategoryAttributes: action(
    readCategoryAttributesInputSchema,
    readCategoryAttributesOutputSchema,
    readCategoryAttributes,
  ) as ActionHandler<unknown, unknown>,
  createAdvert: advertAction(createAdvertInputSchema, advertOutput, createAdvert, (pid, _i, r) =>
    advertCreatedEvent(pid, r),
  ) as ActionHandler<unknown, unknown>,
  updateAdvert: advertAction(updateAdvertInputSchema, advertOutput, updateAdvert, (pid, _i, r) =>
    advertUpdatedEvent(pid, r),
  ) as ActionHandler<unknown, unknown>,
  deleteAdvert: advertAction(deleteAdvertInputSchema, voidOutput, deleteAdvert, (pid, i) =>
    advertDeletedEvent(pid, i.advertId),
  ) as ActionHandler<unknown, unknown>,
  syncAdverts: action(
    syncAdvertsInputSchema,
    syncAdvertsOutputSchema,
    syncAdverts,
  ) as ActionHandler<unknown, unknown>,
  advertCommand: advertAction(advertCommandInputSchema, voidOutput, advertCommand, (pid, i) =>
    advertCommandEvent(pid, i.advertId, i.command),
  ) as ActionHandler<unknown, unknown>,
  readMessages: action(
    readMessagesInputSchema,
    readMessagesOutputSchema,
    readMessages,
  ) as ActionHandler<unknown, unknown>,
  sendMessage: action(
    sendMessageInputSchema,
    sendMessageOutputSchema,
    sendMessage,
  ) as ActionHandler<unknown, unknown>,
};

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions,

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('OLX plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  async healthCheck() {
    if (!storedCtx) return { ok: false as const, reason: 'not initialized' };
    try {
      // /categories e cel mai ieftin call (context client_credentials) care
      // validează clientId/clientSecret fără a avea nevoie de refresh token.
      const c = await getClient();
      await c.get('/categories', { context: 'client' });
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, reason: e instanceof Error ? e.message : 'OLX API unreachable' };
    }
  },

  destroy() {
    storedCtx?.logger.info('OLX plugin destroyed');
    storedCtx = null;
    storedSecrets = null;
    client = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    const ctx = getCtx();
    const parsed = SecretSchema.parse(raw);
    await ctx.secrets.set('clientId', parsed.clientId);
    await ctx.secrets.set('clientSecret', parsed.clientSecret);
    if (parsed.refreshToken) await ctx.secrets.set('refreshToken', parsed.refreshToken);
    storedSecrets = null;
    client = null;
    ctx.logger.info('OLX plugin reconfigured');
  },
});

export default plugin;

export { OlxClient, OlxApiError, OlxRateLimitError } from './client.js';
export type { OlxClientOptions, OlxAuthContext } from './client.js';
export { SecretSchema, OLX_BASE_URL, OLX_TOKEN_URL, OLX_VERSION_HEADER } from './config.js';
export type { OlxSecrets } from './config.js';
