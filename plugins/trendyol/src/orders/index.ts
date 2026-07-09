import {
  CancelPackageInputSchema,
  CancelPackageOutputSchema,
  GetAwbLabelInputSchema,
  GetAwbLabelOutputSchema,
  GetOrdersInputSchema,
  GetOrdersOutputSchema,
  GetOrdersStreamInputSchema,
  GetOrdersStreamOutputSchema,
  SendInvoiceLinkInputSchema,
  SendInvoiceLinkOutputSchema,
  UpdatePackageStatusInputSchema,
  UpdatePackageStatusOutputSchema,
  UpdateTrackingNumberInputSchema,
  UpdateTrackingNumberOutputSchema,
} from './types.js';

import type { TrendyolClient } from '../client.js';

export interface OrderActionContext {
  client: TrendyolClient;
}

export const orderActions = {
  getOrders: {
    description: 'Pull comenzile (shipment packages) din Trendyol.',
    input: GetOrdersInputSchema,
    output: GetOrdersOutputSchema,
    async handler(
      input: {
        page?: number;
        size?: number;
        status?: string;
        orderByField?: string;
        orderByDirection?: string;
        startDate?: number;
        endDate?: number;
        shipmentPackageIds?: number[];
      },
      { client }: OrderActionContext,
    ) {
      const parsed = GetOrdersInputSchema.parse(input);
      const params = new URLSearchParams();
      params.set('page', String(parsed.page));
      params.set('size', String(parsed.size));
      if (parsed.status) params.set('status', parsed.status);
      if (parsed.orderByField) params.set('orderByField', parsed.orderByField);
      if (parsed.orderByDirection) params.set('orderByDirection', parsed.orderByDirection);
      if (parsed.startDate !== undefined) params.set('startDate', String(parsed.startDate));
      if (parsed.endDate !== undefined) params.set('endDate', String(parsed.endDate));
      if (parsed.shipmentPackageIds?.length) {
        params.set('shipmentPackageIds', parsed.shipmentPackageIds.join(','));
      }
      const path = `/integration/order/sellers/${client.sellerId}/orders?${params.toString()}`;
      const result = await client.get<{
        page: number;
        size: number;
        totalElements: number;
        totalPages: number;
        content: Record<string, unknown>[];
      }>(path);
      return {
        page: result.page ?? parsed.page,
        size: result.size ?? parsed.size,
        totalElements: result.totalElements ?? 0,
        totalPages: result.totalPages ?? 0,
        content: result.content ?? [],
      };
    },
  },

  getOrdersStream: {
    description:
      'Pull comenzile via cursor-based stream (optimizat pentru volume mari, max 3 luni).',
    input: GetOrdersStreamInputSchema,
    output: GetOrdersStreamOutputSchema,
    async handler(
      input: {
        cursor?: string;
        lastModifiedStartDate?: number;
        lastModifiedEndDate?: number;
        status?: string;
      },
      { client }: OrderActionContext,
    ) {
      const parsed = GetOrdersStreamInputSchema.parse(input);
      const params = new URLSearchParams();
      if (parsed.cursor) params.set('cursor', parsed.cursor);
      if (parsed.lastModifiedStartDate !== undefined)
        params.set('lastModifiedStartDate', String(parsed.lastModifiedStartDate));
      if (parsed.lastModifiedEndDate !== undefined)
        params.set('lastModifiedEndDate', String(parsed.lastModifiedEndDate));
      if (parsed.status) params.set('status', parsed.status);
      const qs = params.toString();
      const path = `/integration/order/sellers/${client.sellerId}/orders/stream${qs ? `?${qs}` : ''}`;
      const result = await client.get<{
        hasMore: boolean;
        nextCursor?: string | null;
        size: number;
        content: Record<string, unknown>[];
      }>(path);
      return {
        hasMore: result.hasMore ?? false,
        nextCursor: result.nextCursor ?? null,
        size: result.size ?? 0,
        content: result.content ?? [],
      };
    },
  },

  updatePackageStatus: {
    description: 'Actualizează statusul unui pachet (PICKING, INVOICED, SHIPPED).',
    input: UpdatePackageStatusInputSchema,
    output: UpdatePackageStatusOutputSchema,
    async handler(
      input: { packageId: number; status: string; lines?: { lineId: number; quantity: number }[] },
      { client }: OrderActionContext,
    ) {
      const parsed = UpdatePackageStatusInputSchema.parse(input);
      await client.put<void>(
        `/integration/order/sellers/${client.sellerId}/shipment-packages/${parsed.packageId}`,
        {
          status: parsed.status,
          ...(parsed.lines && { lines: parsed.lines }),
        },
      );
      return { success: true };
    },
  },

  updateTrackingNumber: {
    description: 'Setează tracking number și codul curierului pentru un pachet.',
    input: UpdateTrackingNumberInputSchema,
    output: UpdateTrackingNumberOutputSchema,
    async handler(
      input: { packageId: number; cargoTrackingNumber: string; cargoProviderCode: string },
      { client }: OrderActionContext,
    ) {
      const parsed = UpdateTrackingNumberInputSchema.parse(input);
      await client.put<void>(
        `/integration/order/sellers/${client.sellerId}/shipment-packages/${parsed.packageId}/tracking-details`,
        {
          cargoTrackingNumber: parsed.cargoTrackingNumber,
          cargoProviderCode: parsed.cargoProviderCode,
        },
      );
      return { success: true };
    },
  },

  cancelPackage: {
    description: 'Anulează un pachet (total sau parțial — UNSUPPLIED).',
    input: CancelPackageInputSchema,
    output: CancelPackageOutputSchema,
    async handler(
      input: { packageId: number; reasonId: number; lines: { lineId: number; quantity: number }[] },
      { client }: OrderActionContext,
    ) {
      const parsed = CancelPackageInputSchema.parse(input);
      await client.put<void>(
        `/integration/order/sellers/${client.sellerId}/shipment-packages/${parsed.packageId}/items/unsupplied`,
        { reasonId: parsed.reasonId, lines: parsed.lines },
      );
      return { success: true };
    },
  },
  getAwbLabel: {
    description: 'Descarcă PDF-ul AWB (common label) pentru un colet, după cargoTrackingNumber.',
    input: GetAwbLabelInputSchema,
    output: GetAwbLabelOutputSchema,
    async handler(input: { cargoTrackingNumber: string }, { client }: OrderActionContext) {
      const parsed = GetAwbLabelInputSchema.parse(input);
      // Doc: GET /integration/sellers/{sellerId}/common-label/query?id={cargoTrackingNumber}
      // Răspuns: JSON { data: [{ label: "<url>", format: "PDF" }] } — nu PDF direct.
      const path = `/integration/sellers/${client.sellerId}/common-label/query?id=${parsed.cargoTrackingNumber}`;
      const response = await client.get<{ data: { label: string; format: string }[] }>(path);
      const labelUrl = response.data?.[0]?.label;
      if (!labelUrl) {
        throw new Error('Trendyol getCommonLabel: răspuns fără URL etichetă');
      }
      // Descarcă PDF-ul de la URL-ul returnat (Fareye / curier Trendyol).
      const pdfResponse = await fetch(labelUrl, { signal: AbortSignal.timeout(30_000) });
      if (!pdfResponse.ok) {
        throw new Error(`Eroare la descărcarea PDF AWB: HTTP ${pdfResponse.status}`);
      }
      const bytes = new Uint8Array(await pdfResponse.arrayBuffer());
      const contentType = pdfResponse.headers.get('content-type') ?? 'application/pdf';
      const pdfBase64 = Buffer.from(bytes).toString('base64');
      return { pdfBase64, contentType };
    },
  },
  sendInvoiceLink: {
    description: 'Trimite link factură la Trendyol via POST /seller-invoice-links.',
    input: SendInvoiceLinkInputSchema,
    output: SendInvoiceLinkOutputSchema,
    async handler(
      input: { invoiceLink: string; shipmentPackageId: number },
      { client }: OrderActionContext,
    ) {
      await client.sendInvoiceLink(input.invoiceLink, input.shipmentPackageId);
      return { ok: true as const };
    },
  },
} as const;

export type OrderActions = typeof orderActions;
