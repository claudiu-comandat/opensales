import { buildProductFeed } from './feed.js';
import {
  GenerateProductFeedInputSchema,
  GenerateProductFeedOutputSchema,
  SetOfferActiveInputSchema,
  UpdateInventoryInputSchema,
  UpdateInventoryOutputSchema,
  type GenerateProductFeedInput,
  type ProductUpdate,
  type SetOfferActiveInput,
  type UpdateInventoryInput,
} from './types.js';

import type { SkroutzClient } from '../client.js';

export interface ProductActionContext {
  client: SkroutzClient;
}

const BATCH_PATH = '/merchants/products/batch';
const BATCH_VALIDATIONS_PATH = '/merchants/products/batch/validations';

export const productActions = {
  // ── Update stoc + preț + enabled (batch) ────────────────────────────────────
  updateInventory: {
    description:
      'Actualizează stoc, preț și disponibilitate (enabled) pentru până la 500 produse într-un singur batch.',
    input: UpdateInventoryInputSchema,
    output: UpdateInventoryOutputSchema,
    async handler(input: UpdateInventoryInput, { client }: ProductActionContext) {
      const parsed = UpdateInventoryInputSchema.parse(input);
      await client.post('products', BATCH_PATH, { data: parsed.data });
      return { success: true, count: parsed.data.length };
    },
  },

  // ── Validare batch (dry-run) ────────────────────────────────────────────────
  validateInventory: {
    description: 'Validează un payload de batch fără a aplica modificările (dry-run).',
    input: UpdateInventoryInputSchema,
    output: UpdateInventoryOutputSchema,
    async handler(input: UpdateInventoryInput, { client }: ProductActionContext) {
      const parsed = UpdateInventoryInputSchema.parse(input);
      await client.post('products', BATCH_VALIDATIONS_PATH, { data: parsed.data });
      return { success: true, count: parsed.data.length };
    },
  },

  // ── Activare / dezactivare ofertă ───────────────────────────────────────────
  setOfferActive: {
    description:
      'Activează (enabled=true) sau dezactivează (enabled=false) o ofertă pe Skroutz, ca batch de un singur produs.',
    input: SetOfferActiveInputSchema,
    output: UpdateInventoryOutputSchema,
    async handler(input: SetOfferActiveInput, { client }: ProductActionContext) {
      const parsed = SetOfferActiveInputSchema.parse(input);
      const item: ProductUpdate = {
        product_id: parsed.product_id,
        enabled: parsed.enabled,
        quantity: parsed.quantity,
        price: parsed.price,
      };
      await client.post('products', BATCH_PATH, { data: [item] });
      return { success: true, count: 1 };
    },
  },

  // ── Postare produse (XML Feed) ──────────────────────────────────────────────
  generateProductFeed: {
    description:
      'Generează feed-ul XML Skroutz pentru postarea/publicarea catalogului. Crearea de produse noi se face exclusiv prin XML Feed (Products API nu creează produse).',
    input: GenerateProductFeedInputSchema,
    output: GenerateProductFeedOutputSchema,
    handler(input: GenerateProductFeedInput, _ctx: ProductActionContext) {
      const parsed = GenerateProductFeedInputSchema.parse(input);
      const xml = buildProductFeed(parsed);
      return Promise.resolve({ xml, productCount: parsed.products.length });
    },
  },
} as const;

export type ProductActions = typeof productActions;
