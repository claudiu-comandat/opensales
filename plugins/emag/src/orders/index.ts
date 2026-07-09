import { z } from 'zod';

import type { PluginContext } from '@opensales/plugin-sdk';

import { readAttachments, saveAttachment } from './attachments.js';
import { readOrders } from './read.js';
import {
  acknowledgeOrder,
  cancelOrder,
  partialStornoOrder,
  registerCallback,
  saveOrder,
  unlockCourier,
} from './save.js';
import { readVolumetry } from './volumetry.js';

import type { EmagClient } from '../client.js';

export * from './types.js';
export { readOrders, countOrders } from './read.js';
export {
  saveOrder,
  acknowledgeOrder,
  unlockCourier,
  registerCallback,
  cancelOrder,
  stornoOrder,
  partialStornoOrder,
} from './save.js';
export { readVolumetry } from './volumetry.js';
export { readAttachments, saveAttachment } from './attachments.js';

/**
 * Definiția unei acțiuni a plugin-ului eMAG (Wave 1 — orders).
 *
 * Combină metadata din manifest (`description`, `input`, `output`) cu un
 * handler tipat. Handler-ul primește input-ul deja parsed și o referință la
 * contextul plugin-ului (folosit pentru a obține clientul sau pentru logging).
 *
 * Forma e compatibilă cu `ActionHandler` din SDK la nivel de runtime —
 * platforma poate apela `handler` direct sau prin `invokeAction`.
 */
export interface OrderActionContext {
  client: EmagClient;
  ctx: PluginContext;
}

export interface OrderAction<I, O> {
  description: string;
  input: z.ZodType<I>;
  output: z.ZodType<O>;
  handler: (input: I, ctx: OrderActionContext) => Promise<O>;
}

const orderStatusSchema = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

const paymentModeSchema = z.union([z.literal(1), z.literal(2), z.literal(3)]);

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}( \d{2}:\d{2}:\d{2})?$/, 'Expected YYYY-MM-DD or YYYY-MM-DD HH:ii:ss');

const emagPlatformSchema = z.enum(['emag-ro', 'emag-bg', 'emag-hu', 'fd-ro', 'fd-bg']);

const syncOrdersInput = z.object({
  status: z.union([orderStatusSchema, z.array(orderStatusSchema)]).optional(),
  payment_mode_id: z.union([paymentModeSchema, z.array(paymentModeSchema)]).optional(),
  is_complete: z.union([z.literal(0), z.literal(1)]).optional(),
  type: z.union([z.literal(2), z.literal(3)]).optional(),
  createdBefore: dateString.optional(),
  createdAfter: dateString.optional(),
  modifiedBefore: dateString.optional(),
  modifiedAfter: dateString.optional(),
  itemsPerPage: z.number().int().min(1).max(100).optional(),
  currentPage: z.number().int().min(1).max(65535).optional(),
  /** Platforma țintă pentru rutare multi-țară (extrasă de adaptOrderAction, nu trimisă la API). */
  platform: emagPlatformSchema.optional(),
});
type SyncOrdersInput = z.infer<typeof syncOrdersInput>;

// Output e modelat permisiv: comanda eMAG are >40 câmpuri optionale și
// preferăm să nu blocăm sync-ul dacă eMAG adaugă o coloană nouă. Validăm
// strict doar câmpurile load-bearing pentru noi.
const orderProductSchema = z
  .object({
    id: z.number(),
    quantity: z.number(),
    sale_price: z.union([z.number(), z.string()]),
    status: z.number(),
  })
  .passthrough();

const orderSchema = z
  .object({
    id: z.number(),
    status: orderStatusSchema,
    products: z.array(orderProductSchema),
  })
  .passthrough();

const syncOrdersOutput = z.object({
  items: z.array(orderSchema),
  currentPage: z.number(),
  itemsPerPage: z.number(),
  totalCount: z.number().optional(),
});
type SyncOrdersOutput = z.infer<typeof syncOrdersOutput>;

const saveOrderInput = z.object({
  order: orderSchema,
});
type SaveOrderInput = z.infer<typeof saveOrderInput>;

const saveOrderOutput = z.object({ ok: z.literal(true) });
type SaveOrderOutput = z.infer<typeof saveOrderOutput>;

const acknowledgeOrderInput = z.object({
  orderId: z.number().int().positive(),
  /** Platforma țintă — necesară pentru acknowledge pe emag-hu/bg (rutare multi-țară). */
  platform: emagPlatformSchema.optional(),
});
type AcknowledgeOrderInput = z.infer<typeof acknowledgeOrderInput>;
const acknowledgeOrderOutput = z.object({ ok: z.literal(true) });
type AcknowledgeOrderOutput = z.infer<typeof acknowledgeOrderOutput>;

const readVolumetryInput = z.object({
  order_id: z.number().int().positive(),
  type: z.union([z.literal(2), z.literal(3)]).optional(),
  product_id: z.number().int().positive().optional(),
});
type ReadVolumetryInput = z.infer<typeof readVolumetryInput>;

const volumetryItemSchema = z.object({
  product_id: z.number(),
  weight: z.number(),
  length: z.number(),
  width: z.number(),
  height: z.number(),
});

const readVolumetryOutput = z.object({
  order_id: z.number(),
  type: z.union([z.literal(2), z.literal(3)]).optional(),
  volumetric_data: z.array(volumetryItemSchema),
});
type ReadVolumetryOutput = z.infer<typeof readVolumetryOutput>;

const sync: OrderAction<SyncOrdersInput, SyncOrdersOutput> = {
  description: 'Pull comenzile noi din eMAG (paginat, idempotent).',
  input: syncOrdersInput,
  output: syncOrdersOutput,
  handler: async (input, { client, ctx }) => {
    // `platform` e metadata de rutare — nu se trimite la API eMAG.
    const { platform: _platform, ...apiInput } = input;
    const result = await readOrders(client, apiInput);
    ctx.logger.info('eMAG sync orders', {
      count: result.items.length,
      currentPage: result.currentPage,
    });
    // Re-parse: orderSchema uses .passthrough() and EmagOrder lacks an index
    // signature; .parse round-trips through unknown.
    return syncOrdersOutput.parse(result);
  },
};

const save: OrderAction<SaveOrderInput, SaveOrderOutput> = {
  description: 'Update unei comenzi (status, courier, products) prin order/save.',
  input: saveOrderInput,
  output: saveOrderOutput,
  handler: async (input, { client }) => {
    // input.order vine din schema cu .passthrough() — câmpuri arbitrare permise.
    // saveOrder primește EmagOrder; cast-ul e safe pentru că payload-ul merge
    // brut prin JSON.stringify.
    await saveOrder(client, input.order);
    return { ok: true };
  },
};

const acknowledge: OrderAction<AcknowledgeOrderInput, AcknowledgeOrderOutput> = {
  description: 'Confirmă procesarea unei comenzi (order/acknowledge/{id}).',
  input: acknowledgeOrderInput,
  output: acknowledgeOrderOutput,
  handler: async (input, { client }) => {
    await acknowledgeOrder(client, input.orderId);
    return { ok: true };
  },
};

const volumetry: OrderAction<ReadVolumetryInput, ReadVolumetryOutput> = {
  description: 'Citește datele volumetrice ale unei comenzi (order/volumetry/read).',
  input: readVolumetryInput,
  output: readVolumetryOutput,
  handler: async (input, { client }) => {
    const filters: { order_id: number; type?: 2 | 3; product_id?: number } = {
      order_id: input.order_id,
    };
    if (input.type !== undefined) filters.type = input.type;
    if (input.product_id !== undefined) filters.product_id = input.product_id;
    const r = await readVolumetry(client, filters);
    return readVolumetryOutput.parse(r);
  },
};

/**
 * Acțiunile expuse de plugin pentru orders. Cheile match-uiesc 1:1 entry-urile
 * din `manifest.json -> actions`. Plugin-ul principal (src/index.ts) le
 * va wire-ui în `definePlugin` la sfârșitul Wave 1+.
 */
export const orderActions = {
  syncOrders: sync,
  saveOrder: save,
  acknowledgeOrder: acknowledge,
  readOrderVolumetry: volumetry,
  // Expuse pentru completitudine — folosite intern de alte wave-uri (AWB).
  unlockCourier: {
    description: 'Deblochează courier-ul forțat de eMAG pentru o comandă.',
    input: z.object({ orderId: z.number().int().positive() }),
    output: z.object({ ok: z.literal(true) }),
    handler: async (input: { orderId: number }, ctx: OrderActionContext) => {
      await unlockCourier(ctx.client, input.orderId);
      return { ok: true as const };
    },
  } satisfies OrderAction<{ orderId: number }, { ok: true }>,
  readOrderAttachments: {
    description: 'Citește atașamentele unei comenzi (order/attachments/read).',
    input: z.object({ orderId: z.number().int().positive() }),
    output: z.object({
      attachments: z.array(z.object({ url: z.string() }).passthrough()),
    }),
    handler: async (
      input: { orderId: number },
      ctx: OrderActionContext,
    ): Promise<{ attachments: { url: string; [key: string]: unknown }[] }> => {
      const attachments = await readAttachments(ctx.client, input.orderId);
      return {
        attachments: attachments.map((a) => ({ ...a, url: a.url })),
      };
    },
  },
  saveOrderAttachment: {
    description: 'Salvează factura sau garanția unei comenzi (order/attachments/save).',
    input: z.object({
      attachment: z
        .object({
          url: z.string().url(),
        })
        .passthrough(),
    }),
    output: z.object({ ok: z.literal(true) }),
    handler: async (
      input: { attachment: { url: string; [key: string]: unknown } },
      ctx: OrderActionContext,
    ) => {
      await saveAttachment(ctx.client, input.attachment);
      return { ok: true as const };
    },
  },
  registerCallback: {
    description: 'Înregistrează URL-ul de callback la eMAG (suprascrie cel existent).',
    input: z.object({ callbackUrl: z.string().url() }),
    output: z.object({ ok: z.literal(true) }),
    handler: async (input: { callbackUrl: string }, ctx: OrderActionContext) => {
      await registerCallback(ctx.client, input.callbackUrl);
      return { ok: true as const };
    },
  } satisfies OrderAction<{ callbackUrl: string }, { ok: true }>,
  cancelOrder: {
    description: 'Anulează o comandă pe eMAG (status=0 via order/save).',
    input: z.object({
      orderId: z.number().int().positive(),
      reasonId: z.number().int().positive(),
    }),
    output: z.object({ ok: z.literal(true) }),
    handler: async (input: { orderId: number; reasonId: number }, ctx: OrderActionContext) => {
      await cancelOrder(ctx.client, input.orderId, input.reasonId);
      return { ok: true as const };
    },
  } satisfies OrderAction<{ orderId: number; reasonId: number }, { ok: true }>,

  emagStornoPartial: {
    description:
      'Storno parțial eMAG — is_storno=true cu cantitățile reduse. Status 5 se setează automat când toate produsele ajung la qty=0.',
    input: z.object({
      orderId: z.number().int().positive(),
      products: z.array(
        z.object({ id: z.number().int().positive(), quantity: z.number().int().min(0) }),
      ),
      platform: emagPlatformSchema.optional(),
    }),
    output: z.object({ ok: z.literal(true) }),
    handler: async (
      input: {
        orderId: number;
        products: { id: number; quantity: number }[];
        platform?: 'emag-ro' | 'emag-bg' | 'emag-hu' | 'fd-ro' | 'fd-bg' | undefined;
      },
      ctx: OrderActionContext,
    ): Promise<{ ok: true }> => {
      const products = input.products.map((p) => ({
        id: p.id,
        quantity: p.quantity,
        status: p.quantity === 0 ? 0 : 1,
      }));
      await partialStornoOrder(ctx.client, input.orderId, products);
      return { ok: true as const };
    },
  } satisfies OrderAction<
    {
      orderId: number;
      products: { id: number; quantity: number }[];
      platform?: 'emag-ro' | 'emag-bg' | 'emag-hu' | 'fd-ro' | 'fd-bg' | undefined;
    },
    { ok: true }
  >,
} as const;

export type OrderActions = typeof orderActions;
