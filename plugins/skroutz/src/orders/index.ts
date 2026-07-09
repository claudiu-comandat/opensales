import { Buffer } from 'node:buffer';

import {
  AcceptOrderInputSchema,
  GetOrderInputSchema,
  GetOrderOutputSchema,
  OrderActionOutputSchema,
  OrderCodeInputSchema,
  ParseWebhookInputSchema,
  ParseWebhookOutputSchema,
  RejectOrderInputSchema,
  UpdateTrackingDetailsInputSchema,
  UploadInvoiceInputSchema,
  WebhookEventSchema,
  type AcceptOrderInput,
  type GetOrderInput,
  type OrderCodeInput,
  type ParseWebhookInput,
  type RejectOrderInput,
  type UpdateTrackingDetailsInput,
  type UploadInvoiceInput,
} from './types.js';

import type { SkroutzClient } from '../client.js';

export interface OrderActionContext {
  client: SkroutzClient;
  /** Secret partajat configurat pentru verificarea webhook-urilor (opțional). */
  webhookSecret: string | undefined;
}

function orderPath(code: string, suffix = ''): string {
  return `/merchants/ecommerce/orders/${encodeURIComponent(code)}${suffix}`;
}

export const orderActions = {
  // ── Primire comandă — poll după code ────────────────────────────────────────
  getOrder: {
    description: 'Citește o comandă Skroutz după code (folosit la sync periodic sau după webhook).',
    input: GetOrderInputSchema,
    output: GetOrderOutputSchema,
    async handler(input: GetOrderInput, { client }: OrderActionContext) {
      const parsed = GetOrderInputSchema.parse(input);
      const result = await client.get<{ order?: Record<string, unknown> }>(
        'orders',
        orderPath(parsed.code),
      );
      return { order: result.order ?? {} };
    },
  },

  // ── Acceptare comandă ───────────────────────────────────────────────────────
  acceptOrder: {
    description: 'Acceptă o comandă (pickup_location + pickup_window din accept_options).',
    input: AcceptOrderInputSchema,
    output: OrderActionOutputSchema,
    async handler(input: AcceptOrderInput, { client }: OrderActionContext) {
      const parsed = AcceptOrderInputSchema.parse(input);
      const body: Record<string, unknown> = {
        pickup_location: parsed.pickup_location,
        pickup_window: parsed.pickup_window,
      };
      if (parsed.number_of_parcels !== undefined) {
        body.number_of_parcels = parsed.number_of_parcels;
      }
      const order = await client.post<Record<string, unknown>>(
        'orders',
        orderPath(parsed.code, '/accept'),
        body,
      );
      return { success: true, order };
    },
  },

  // ── Respingere comandă ──────────────────────────────────────────────────────
  rejectOrder: {
    description:
      'Respinge o comandă: fie per line_item (cu reason_id), fie întreaga comandă cu rejection_reason_other.',
    input: RejectOrderInputSchema,
    output: OrderActionOutputSchema,
    async handler(input: RejectOrderInput, { client }: OrderActionContext) {
      const parsed = RejectOrderInputSchema.parse(input);
      const body: Record<string, unknown> = {};
      if (parsed.line_items !== undefined) body.line_items = parsed.line_items;
      if (parsed.rejection_reason_other !== undefined) {
        body.rejection_reason_other = parsed.rejection_reason_other;
      }
      const order = await client.post<Record<string, unknown>>(
        'orders',
        orderPath(parsed.code, '/reject'),
        body,
      );
      return { success: true, order };
    },
  },

  // ── Upload factură/chitanță ─────────────────────────────────────────────────
  uploadInvoice: {
    description: 'Încarcă documentul fiscal (pdf/png/jpg, max 7MB) pentru o comandă.',
    input: UploadInvoiceInputSchema,
    output: OrderActionOutputSchema,
    async handler(input: UploadInvoiceInput, { client }: OrderActionContext) {
      const parsed = UploadInvoiceInputSchema.parse(input);
      const bytes = Buffer.from(parsed.fileBase64, 'base64');
      const form = new FormData();
      form.append('invoice_file', new Blob([bytes], { type: parsed.contentType }), parsed.filename);
      await client.postForm('orders', orderPath(parsed.code, '/invoices'), form);
      return { success: true };
    },
  },

  // ── Set as ready (SLM) ──────────────────────────────────────────────────────
  setAsReady: {
    description: 'Marchează comanda ca pregătită pentru ridicare (Skroutz Last Mile).',
    input: OrderCodeInputSchema,
    output: OrderActionOutputSchema,
    async handler(input: OrderCodeInput, { client }: OrderActionContext) {
      const parsed = OrderCodeInputSchema.parse(input);
      await client.post('orders', orderPath(parsed.code, '/set_as_ready'), {});
      return { success: true };
    },
  },

  setAsNotReady: {
    description: 'Anulează marcarea „ready” a unei comenzi (înainte de ridicarea de către curier).',
    input: OrderCodeInputSchema,
    output: OrderActionOutputSchema,
    async handler(input: OrderCodeInput, { client }: OrderActionContext) {
      const parsed = OrderCodeInputSchema.parse(input);
      await client.post('orders', orderPath(parsed.code, '/set_as_not_ready'), {});
      return { success: true };
    },
  },

  // ── Update tracking (doar FBM) ──────────────────────────────────────────────
  updateTrackingDetails: {
    description: 'Setează curierul și codul de tracking pentru o comandă FBM.',
    input: UpdateTrackingDetailsInputSchema,
    output: OrderActionOutputSchema,
    async handler(input: UpdateTrackingDetailsInput, { client }: OrderActionContext) {
      const parsed = UpdateTrackingDetailsInputSchema.parse(input);
      await client.post('orders', orderPath(parsed.code, '/tracking_details'), {
        tracking_details: parsed.tracking_details,
      });
      return { success: true };
    },
  },

  // ── Parse + verificare webhook ──────────────────────────────────────────────
  parseWebhook: {
    description:
      'Validează și normalizează un payload de webhook Skroutz (new_order / order_updated), extrăgând code + state.',
    input: ParseWebhookInputSchema,
    output: ParseWebhookOutputSchema,
    // eslint-disable-next-line @typescript-eslint/require-await
    async handler(input: ParseWebhookInput, { webhookSecret }: OrderActionContext) {
      const parsed = ParseWebhookInputSchema.parse(input);

      // Skroutz nu semnează payload-ul; dacă avem un secret partajat configurat,
      // cerem ca cel furnizat de webhook să se potrivească.
      if (webhookSecret !== undefined && parsed.providedSecret !== webhookSecret) {
        throw new Error('Skroutz webhook: invalid or missing shared secret');
      }

      const raw: unknown =
        typeof parsed.payload === 'string' ? JSON.parse(parsed.payload) : parsed.payload;
      const event = WebhookEventSchema.parse(raw);
      const order = event.order;
      const code = typeof order.code === 'string' ? order.code : '';
      const state = order.state;
      return ParseWebhookOutputSchema.parse({
        eventType: event.event_type,
        eventTime: event.event_time,
        orderCode: code,
        state,
        order,
      });
    },
  },
} as const;

export type OrderActions = typeof orderActions;
