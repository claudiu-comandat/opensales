import {
  type ActionHandler,
  type ActionHandlerMap,
  type OrderInvoiceInput,
  type PluginContext,
  type SdkApiClient,
} from '@opensales/plugin-sdk';
import { z } from 'zod';

import { type SmartBillClient, type SmartBillClientProvider } from '../client.js';

import {
  buildSmartBillEmitInput,
  fromSmartBillEmitResponse,
  orderWithItemsSchema,
  toCancelledInvoice,
  toIssuedInvoice,
  toStornoInvoice,
} from './mappers.js';

/** Provider pentru contextul plugin-ului (lazy, ca să nu îl evaluăm la registrare). */
export type SmartBillContextProvider = () => PluginContext;
export type SmartBillEmitConfigProvider = () => {
  defaultSeriesName?: string | undefined;
  language?: string | undefined;
  useStock?: boolean | undefined;
  saveClientToDb?: boolean | undefined;
};

// ── Zod schemas ────────────────────────────────────────────────────────────────

const orderIdInput = z.object({ orderId: z.string().min(1) });

const emitOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  issuedAt: z.string(),
});

const cancelOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  cancelled: z.literal(true),
});

const deleteDirectOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  deletedAtSmartBill: z.literal(true),
});

const stornoOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
});

const restoreOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  restored: z.literal(true),
});

const paymentStatusOutputSchema = z.object({
  invoiceTotalAmount: z.number().optional(),
  paidAmount: z.number().optional(),
  unpaidAmount: z.number().optional(),
  raw: z.record(z.unknown()),
});

const pdfOutputSchema = z.object({
  pdfBase64: z.string(),
  contentType: z.string().optional(),
});

const recordPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
  type: z.string().min(1),
  currency: z.string().optional(),
  paymentSeries: z.string().optional(),
  issueDate: z.string().optional(),
});
const recordPaymentOutputSchema = z.object({
  ok: z.literal(true),
  raw: z.record(z.unknown()),
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function getSdkApi(ctx: PluginContext): SdkApiClient {
  // PluginContext.api e tipăt ca PluginApiClient (just .request()), dar runtime-ul
  // expune SdkApiClient (vezi apps/api/.../sdk-api.factory.ts). Cast intenționat.
  return ctx.api as unknown as SdkApiClient;
}

async function loadOrder(api: SdkApiClient, orderId: string) {
  const raw = await api.orders.get(orderId);
  return orderWithItemsSchema.parse(raw);
}

async function loadExistingInvoice(
  api: SdkApiClient,
  orderId: string,
  field: 'invoice' | 'invoiceStorno',
): Promise<OrderInvoiceInput> {
  const raw = await api.orders.get(orderId);
  const obj = raw as Record<string, unknown> | null;
  if (!obj) throw new Error(`Order not found: ${orderId}`);
  const inv = obj[field] as Record<string, unknown> | null | undefined;
  if (!inv || typeof inv.series !== 'string' || typeof inv.number !== 'string') {
    throw new Error(`Order ${orderId} nu are factură ${field} emisă`);
  }
  const parsed: OrderInvoiceInput = {
    series: inv.series,
    number: inv.number,
    status: (inv.status as 'draft' | 'issued' | 'cancelled') ?? 'issued',
    issuedAt:
      typeof inv.issuedAt === 'string'
        ? inv.issuedAt
        : typeof inv.issued_at === 'string'
          ? inv.issued_at
          : new Date().toISOString(),
  };
  if (typeof inv.pdfUrl === 'string') parsed.pdfUrl = inv.pdfUrl;
  else if (typeof inv.pdf_url === 'string') parsed.pdfUrl = inv.pdf_url;
  return parsed;
}

// ── Action builders ────────────────────────────────────────────────────────────

export function buildInvoiceActions(
  clientProvider: SmartBillClientProvider,
  ctxProvider: SmartBillContextProvider,
  emitConfigProvider: SmartBillEmitConfigProvider,
): ActionHandlerMap {
  // ── emitInvoice ────────────────────────────────────────────────────────────
  const emitHandler: ActionHandler<
    z.infer<typeof orderIdInput>,
    z.infer<typeof emitOutputSchema>
  > = {
    input: orderIdInput,
    output: emitOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const order = await loadOrder(api, input.orderId);
      // clientProvider încarcă storedSecrets (lazy) — apelat ÎNAINTE de
      // emitConfigProvider() ca să nu returneze {} la primul apel.
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const effectiveSeries = order.marketplaceInvoiceSeries ?? cfg.defaultSeriesName;
      const sbInput = buildSmartBillEmitInput(order, {
        ...cfg,
        defaultSeriesName: effectiveSeries ?? undefined,
      });
      const res = await client.emit(sbInput);
      const invoice = fromSmartBillEmitResponse(res);
      await api.orders.updateInvoice(input.orderId, invoice);
      return { series: invoice.series, number: invoice.number, issuedAt: invoice.issuedAt };
    },
  };

  // ── cancelInvoice (anulare, fără ștergere) ──────────────────────────────────
  const cancelHandler: ActionHandler<
    z.infer<typeof orderIdInput>,
    z.infer<typeof cancelOutputSchema>
  > = {
    input: orderIdInput,
    output: cancelOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      await client.cancel(existing.series, existing.number);
      await api.orders.updateInvoice(input.orderId, toCancelledInvoice(existing));
      return { series: existing.series, number: existing.number, cancelled: true };
    },
  };

  // ── smartbillDeleteDirect (DELETE /invoice, fără DB write) ───────────────────
  const deleteDirectHandler: ActionHandler<
    z.infer<typeof orderIdInput>,
    z.infer<typeof deleteDirectOutputSchema>
  > = {
    input: orderIdInput,
    output: deleteDirectOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      await client.deleteInvoice(existing.series, existing.number);
      return { series: existing.series, number: existing.number, deletedAtSmartBill: true };
    },
  };

  // ── stornoInvoice ──────────────────────────────────────────────────────────
  const stornoHandler: ActionHandler<
    z.infer<typeof orderIdInput>,
    z.infer<typeof stornoOutputSchema>
  > = {
    input: orderIdInput,
    output: stornoOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const res = await client.storno(existing.series, existing.number);
      const stornoInvoice = toStornoInvoice(existing.series, existing.number, res);
      await api.orders.updateInvoiceStorno(input.orderId, stornoInvoice);
      return { series: stornoInvoice.series, number: stornoInvoice.number };
    },
  };

  // ── restoreInvoice ─────────────────────────────────────────────────────────
  const restoreHandler: ActionHandler<
    z.infer<typeof orderIdInput>,
    z.infer<typeof restoreOutputSchema>
  > = {
    input: orderIdInput,
    output: restoreOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      await client.restore(existing.series, existing.number);
      await api.orders.updateInvoice(input.orderId, toIssuedInvoice(existing));
      return { series: existing.series, number: existing.number, restored: true };
    },
  };

  // ── getInvoicePaymentStatus ─────────────────────────────────────────────────
  const paymentStatusHandler: ActionHandler<
    z.infer<typeof orderIdInput>,
    z.infer<typeof paymentStatusOutputSchema>
  > = {
    input: orderIdInput,
    output: paymentStatusOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const raw = await client.getPaymentStatus(existing.series, existing.number);
      const out: z.infer<typeof paymentStatusOutputSchema> = { raw };
      if (typeof raw.invoiceTotalAmount === 'number')
        out.invoiceTotalAmount = raw.invoiceTotalAmount;
      if (typeof raw.paidAmount === 'number') out.paidAmount = raw.paidAmount;
      if (typeof raw.unpaidAmount === 'number') out.unpaidAmount = raw.unpaidAmount;
      return out;
    },
  };

  // ── getInvoicePdf ──────────────────────────────────────────────────────────
  const pdfHandler: ActionHandler<z.infer<typeof orderIdInput>, z.infer<typeof pdfOutputSchema>> = {
    input: orderIdInput,
    output: pdfOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const res = await client.getPdf(existing.series, existing.number);
      const out: z.infer<typeof pdfOutputSchema> = { pdfBase64: res.pdfBase64 };
      if (res.contentType) out.contentType = res.contentType;
      return out;
    },
  };

  // ── recordPayment ──────────────────────────────────────────────────────────
  const recordPaymentHandler: ActionHandler<
    z.infer<typeof recordPaymentInputSchema>,
    z.infer<typeof recordPaymentOutputSchema>
  > = {
    input: recordPaymentInputSchema,
    output: recordPaymentOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const paymentInput: Parameters<SmartBillClient['recordPayment']>[0] = {
        value: input.amount,
        type: input.type,
        invoicesList: [{ seriesName: existing.series, number: existing.number }],
      };
      if (input.currency) paymentInput.currency = input.currency;
      if (input.paymentSeries) paymentInput.paymentSeries = input.paymentSeries;
      if (input.issueDate) paymentInput.issueDate = input.issueDate;
      const raw = await client.recordPayment(paymentInput);
      return { ok: true, raw };
    },
  };

  return {
    emitInvoice: emitHandler as unknown as ActionHandler<unknown, unknown>,
    cancelInvoice: cancelHandler as unknown as ActionHandler<unknown, unknown>,
    smartbillDeleteDirect: deleteDirectHandler as unknown as ActionHandler<unknown, unknown>,
    stornoInvoice: stornoHandler as unknown as ActionHandler<unknown, unknown>,
    restoreInvoice: restoreHandler as unknown as ActionHandler<unknown, unknown>,
    getInvoicePaymentStatus: paymentStatusHandler as unknown as ActionHandler<unknown, unknown>,
    getInvoicePdf: pdfHandler as unknown as ActionHandler<unknown, unknown>,
    recordPayment: recordPaymentHandler as unknown as ActionHandler<unknown, unknown>,
  };
}
