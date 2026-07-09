import {
  definePlugin,
  defineSecretSchema,
  type Plugin,
  type PluginContext,
} from '@opensales/plugin-sdk';
import { z } from 'zod';

import manifest from '../manifest.json' with { type: 'json' };

let storedCtx: PluginContext | null = null;

const SecretSchema = defineSecretSchema({
  apiKey: z.string().min(1).optional(),
});

const plugin: Plugin = definePlugin({
  manifest: manifest as Plugin['manifest'],
  actions: {},
  events: {},

  init(ctx) {
    storedCtx = ctx;
    ctx.logger.info('Example plugin initialized', { pluginId: ctx.pluginId });
    return Promise.resolve();
  },

  healthCheck() {
    if (!storedCtx) return Promise.resolve({ ok: false as const, reason: 'not initialized' });
    return Promise.resolve({ ok: true as const });
  },

  destroy() {
    storedCtx?.logger.info('Example plugin destroyed');
    storedCtx = null;
    return Promise.resolve();
  },

  async onConfigure(raw) {
    const secrets = SecretSchema.parse(raw);
    if (secrets.apiKey && storedCtx) {
      await storedCtx.secrets.set('apiKey', secrets.apiKey);
    }
  },
});

export default plugin;
