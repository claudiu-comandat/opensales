import { z } from 'zod';

// ─── getOrders ────────────────────────────────────────────────────────────────

import { TRENDYOL_STOREFRONTS, type TrendyolStoreFrontCode } from '../config.js';

const storeFrontCodeSchema = z.enum(
  Object.keys(TRENDYOL_STOREFRONTS) as [TrendyolStoreFrontCode, ...TrendyolStoreFrontCode[]],
);

export const GetOrdersInputSchema = z.object({
  page: z.number().int().min(0).default(0),
  size: z.number().int().min(1).max(200).default(50),
  status: z
    .enum([
      'Created',
      'Picking',
      'Invoiced',
      'Shipped',
      'Cancelled',
      'Delivered',
      'UnDelivered',
      'Returned',
      'Unsupplied',
    ])
    .optional(),
  orderByField: z.enum(['PackageLastModifiedDate', 'CreatedDate']).optional(),
  orderByDirection: z.enum(['ASC', 'DESC']).optional(),
  startDate: z.number().int().optional(),
  endDate: z.number().int().optional(),
  shipmentPackageIds: z.array(z.number().int()).optional(),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type GetOrdersInput = z.infer<typeof GetOrdersInputSchema>;

export const GetOrdersOutputSchema = z.object({
  page: z.number(),
  size: z.number(),
  totalElements: z.number(),
  totalPages: z.number(),
  content: z.array(z.record(z.unknown())),
});

export type GetOrdersOutput = z.infer<typeof GetOrdersOutputSchema>;

// ─── getOrdersStream ─────────────────────────────────────────────────────────

export const GetOrdersStreamInputSchema = z.object({
  /** Cursor din răspunsul anterior. Omite la primul request. */
  cursor: z.string().optional(),
  /** Timestamp ms — data modificării de la care să înceapă. Max 14 zile față de end. */
  lastModifiedStartDate: z.number().int().optional(),
  /** Timestamp ms — data modificării până la care să returneze. */
  lastModifiedEndDate: z.number().int().optional(),
  /** Filtrează după statusul pachetului. */
  status: z
    .enum([
      'Created',
      'Picking',
      'Invoiced',
      'Shipped',
      'Cancelled',
      'Delivered',
      'UnDelivered',
      'Returned',
      'Unsupplied',
    ])
    .optional(),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type GetOrdersStreamInput = z.infer<typeof GetOrdersStreamInputSchema>;

export const GetOrdersStreamOutputSchema = z.object({
  hasMore: z.boolean(),
  nextCursor: z.string().nullable().optional(),
  size: z.number(),
  content: z.array(z.record(z.unknown())),
});

export type GetOrdersStreamOutput = z.infer<typeof GetOrdersStreamOutputSchema>;

// ─── updatePackageStatus ──────────────────────────────────────────────────────

export const UpdatePackageStatusInputSchema = z.object({
  packageId: z.number().int(),
  status: z.enum(['Picking', 'Invoiced', 'Shipped']),
  lines: z
    .array(
      z.object({
        lineId: z.number().int(),
        quantity: z.number().int().min(1),
      }),
    )
    .optional(),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type UpdatePackageStatusInput = z.infer<typeof UpdatePackageStatusInputSchema>;

export const UpdatePackageStatusOutputSchema = z.object({ success: z.boolean() });
export type UpdatePackageStatusOutput = z.infer<typeof UpdatePackageStatusOutputSchema>;

// ─── updateTrackingNumber ─────────────────────────────────────────────────────

export const UpdateTrackingNumberInputSchema = z.object({
  packageId: z.number().int(),
  /** Cargo tracking / sender number */
  cargoTrackingNumber: z.string().min(1),
  /** Cargo provider code (courier identifier) */
  cargoProviderCode: z.string().min(1),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type UpdateTrackingNumberInput = z.infer<typeof UpdateTrackingNumberInputSchema>;

export const UpdateTrackingNumberOutputSchema = z.object({ success: z.boolean() });
export type UpdateTrackingNumberOutput = z.infer<typeof UpdateTrackingNumberOutputSchema>;

// ─── cancelPackage ────────────────────────────────────────────────────────────

export const CancelPackageInputSchema = z.object({
  packageId: z.number().int(),
  reasonId: z.number().int().positive(),
  lines: z.array(
    z.object({
      lineId: z.number().int(),
      quantity: z.number().int().min(1),
    }),
  ),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type CancelPackageInput = z.infer<typeof CancelPackageInputSchema>;

export const CancelPackageOutputSchema = z.object({ success: z.boolean() });
export type CancelPackageOutput = z.infer<typeof CancelPackageOutputSchema>;

// ─── getAwbLabel ──────────────────────────────────────────────────────────────

export const GetAwbLabelInputSchema = z.object({
  /** Numărul de tracking al coletului (cargo tracking number / barcode AWB). */
  cargoTrackingNumber: z.string().min(1),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type GetAwbLabelInput = z.infer<typeof GetAwbLabelInputSchema>;

export const GetAwbLabelOutputSchema = z.object({
  /** Conținutul PDF-ului AWB encodat base64. */
  pdfBase64: z.string(),
  /** MIME type returnat de Trendyol (de obicei application/pdf). */
  contentType: z.string().optional(),
});

export type GetAwbLabelOutput = z.infer<typeof GetAwbLabelOutputSchema>;

// ─── sendInvoiceLink ──────────────────────────────────────────────────────────

export const SendInvoiceLinkInputSchema = z.object({
  invoiceLink: z.string().min(1),
  shipmentPackageId: z.number().int().positive(),
  /** Storefront opțional pentru rutare multi-țară (extras de adaptRoutableAction). */
  storeFrontCode: storeFrontCodeSchema.optional(),
});

export type SendInvoiceLinkInput = z.infer<typeof SendInvoiceLinkInputSchema>;

export const SendInvoiceLinkOutputSchema = z.object({ ok: z.literal(true) });
export type SendInvoiceLinkOutput = z.infer<typeof SendInvoiceLinkOutputSchema>;
