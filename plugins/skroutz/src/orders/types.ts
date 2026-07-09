import { z } from 'zod';

// ─── Order states (din documentația Orders API / Webhook) ─────────────────────
export const OrderStateSchema = z.enum([
  'open',
  'accepted',
  'rejected',
  'cancelled',
  'expired',
  'dispatched',
  'delivered',
  'partially_returned',
  'returned',
  'for_return',
  'partially_delivered',
]);

export type OrderState = z.infer<typeof OrderStateSchema>;

// Order object-ul Skroutz e bogat; păstrăm forma deschisă (record) și validăm
// doar câmpurile pe care ne bazăm (code, state).
export const SkroutzOrderSchema = z
  .object({
    code: z.string(),
    state: OrderStateSchema,
  })
  .passthrough();

export type SkroutzOrder = z.infer<typeof SkroutzOrderSchema>;

// ─── getOrder ─────────────────────────────────────────────────────────────────
export const GetOrderInputSchema = z.object({
  code: z.string().min(1),
});

export type GetOrderInput = z.infer<typeof GetOrderInputSchema>;

export const GetOrderOutputSchema = z.object({
  order: z.record(z.unknown()),
});

export type GetOrderOutput = z.infer<typeof GetOrderOutputSchema>;

// ─── acceptOrder ────────────────────────────────────────────────────────────
export const AcceptOrderInputSchema = z.object({
  code: z.string().min(1),
  pickup_location: z.string().min(1),
  pickup_window: z.number().int(),
  number_of_parcels: z.number().int().min(1).optional(),
});

export type AcceptOrderInput = z.infer<typeof AcceptOrderInputSchema>;

// ─── rejectOrder ────────────────────────────────────────────────────────────
// Două variante: per line-item (cu reason_id) sau respingere totală cu „other”.
const RejectLineItemSchema = z.object({
  id: z.string().min(1),
  reason_id: z.number().int(),
  available_quantity: z.number().int().min(0).optional(),
});

export const RejectOrderInputSchema = z
  .object({
    code: z.string().min(1),
    line_items: z.array(RejectLineItemSchema).min(1).optional(),
    rejection_reason_other: z.string().min(1).optional(),
  })
  .refine((v) => v.line_items !== undefined || v.rejection_reason_other !== undefined, {
    message: 'Provide either line_items or rejection_reason_other',
  });

export type RejectOrderInput = z.infer<typeof RejectOrderInputSchema>;

// ─── uploadInvoice ──────────────────────────────────────────────────────────
export const UploadInvoiceInputSchema = z.object({
  code: z.string().min(1),
  /** Conținutul documentului encodat base64 (pdf/png/jpg, max 7MB). */
  fileBase64: z.string().min(1),
  filename: z.string().min(1).default('invoice.pdf'),
  contentType: z.enum(['application/pdf', 'image/png', 'image/jpeg']).default('application/pdf'),
});

export type UploadInvoiceInput = z.infer<typeof UploadInvoiceInputSchema>;

// ─── set_as_ready / set_as_not_ready ──────────────────────────────────────────
export const OrderCodeInputSchema = z.object({
  code: z.string().min(1),
});

export type OrderCodeInput = z.infer<typeof OrderCodeInputSchema>;

// ─── updateTrackingDetails (FBM) ──────────────────────────────────────────────
const TrackingDetailSchema = z.object({
  courier: z.enum(['acs', 'dhl', 'geniki_taxydromiki', 'dpd', 'gls']),
  tracking_code: z.string().min(1),
});

export const UpdateTrackingDetailsInputSchema = z.object({
  code: z.string().min(1),
  tracking_details: z.array(TrackingDetailSchema).min(1),
});

export type UpdateTrackingDetailsInput = z.infer<typeof UpdateTrackingDetailsInputSchema>;

// ─── Output comun pentru acțiuni de tip comandă ───────────────────────────────
export const OrderActionOutputSchema = z.object({
  success: z.boolean(),
  order: z.record(z.unknown()).optional(),
});

export type OrderActionOutput = z.infer<typeof OrderActionOutputSchema>;

// ─── parseWebhook ─────────────────────────────────────────────────────────────
// Payload-ul de webhook conține event_type, event_time, order și (opțional) changes.
export const WebhookEventSchema = z
  .object({
    event_type: z.enum(['new_order', 'order_updated']),
    event_time: z.string(),
    order: z.record(z.unknown()),
    changes: z.record(z.unknown()).optional(),
  })
  .passthrough();

export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const ParseWebhookInputSchema = z.object({
  /** Corpul brut al cererii de webhook (JSON string sau obiect deja parsat). */
  payload: z.union([z.string(), z.record(z.unknown())]),
  /** Secret partajat opțional de verificat contra celui configurat. */
  providedSecret: z.string().optional(),
});

export type ParseWebhookInput = z.infer<typeof ParseWebhookInputSchema>;

export const ParseWebhookOutputSchema = z.object({
  eventType: z.enum(['new_order', 'order_updated']),
  eventTime: z.string(),
  orderCode: z.string(),
  state: OrderStateSchema,
  order: z.record(z.unknown()),
});

export type ParseWebhookOutput = z.infer<typeof ParseWebhookOutputSchema>;
