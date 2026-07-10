import {
  type ActionHandler,
  type ActionHandlerMap,
  type OrderInvoiceInput,
  type PluginContext,
  type SdkApiClient,
} from '@opensales/plugin-sdk';
import { z } from 'zod';

import { type FgoClient, type FgoClientProvider } from '../client.js';

import {
  amountSchema,
  buildFgoEmitInput,
  fromFgoEmitResponse,
  orderItemSchema,
  orderWithItemsSchema,
  toCancelledInvoice,
} from './mappers.js';

import type { OrderWithItems } from './mappers.js';

// Invoices imported from marketplaces store the full reference (e.g. "E 5137") in `number`
// with `series=''`. Split them so FGO receives separate Serie/Numar fields.
function parseInvoiceRef(number: string, series: string): { number: string; series: string } {
  if (series) return { number, series };
  const match = /^([A-Za-z]+)\s+(\d+)$/.exec(number);
  if (match) return { number: match[2] ?? number, series: match[1] ?? series };
  return { number, series };
}

/** Provider pentru contextul plugin-ului (lazy, ca să nu îl evaluăm la registrare). */
export type FgoContextProvider = () => PluginContext;
export type FgoEmitConfigProvider = () => {
  platformUrl?: string | undefined;
  defaultSerie?: string | undefined;
  verificareDuplicat?: boolean | undefined;
};

// ── Zod schemas ────────────────────────────────────────────────────────────────

const emitInputSchema = z.object({
  orderId: z.string().min(1),
});
const emitOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  issuedAt: z.string(),
});

const cancelInputSchema = z.object({
  orderId: z.string().min(1),
});
const cancelOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  cancelled: z.literal(true),
});

const cancelDirectInputSchema = z.object({
  orderId: z.string().min(1),
});
const cancelDirectOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  cancelledAtFgo: z.literal(true),
});

const stornoInputSchema = z.object({
  orderId: z.string().min(1),
});
const stornoOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
});

// `items` sunt liniile RĂMASE de facturat (deja calculate de platformă — comanda originală
// minus tot ce s-a returnat până acum). Pluginul nu decide plafonul/regulile de retur, doar
// construiește factura din ce primește (consistent cu restul integrării: regulile rămân la
// apelant, nu se duplică în plugin).
const emitReturnInputSchema = z.object({
  orderId: z.string().min(1),
  items: z.array(orderItemSchema),
  feeAmountMinor: amountSchema.optional(),
  feeCurrency: z.string().length(3).optional(),
});
const emitReturnOutputSchema = z.object({
  series: z.string(),
  number: z.string(),
  issuedAt: z.string(),
});

const statusInputSchema = z.object({
  orderId: z.string().min(1),
});
const statusOutputSchema = z.object({
  status: z.string().optional(),
  raw: z.record(z.unknown()),
});

const pdfInputSchema = z.object({
  orderId: z.string().min(1),
});
const pdfOutputSchema = z.object({
  pdfBase64: z.string(),
  contentType: z.string().optional(),
});

const recordPaymentInputSchema = z.object({
  orderId: z.string().min(1),
  amount: z.number().positive(),
  date: z.string().min(1),
  paymentType: z.string().min(1),
  reference: z.string().optional(),
});
const recordPaymentOutputSchema = z.object({
  ok: z.literal(true),
  raw: z.record(z.unknown()),
});

// ── Debug / test schemas ───────────────────────────────────────────────────────

const debugOutputSchema = z.record(z.unknown());

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

/**
 * Construiește harta de action-handlers pentru facturare. Toate handler-ele
 * primesc clientul lazy via `clientProvider` și contextul lazy via `ctxProvider`
 * (configurat la plugin init).
 */
export function buildInvoiceActions(
  clientProvider: FgoClientProvider,
  ctxProvider: FgoContextProvider,
  emitConfigProvider: FgoEmitConfigProvider,
): ActionHandlerMap {
  // ── emitInvoice ────────────────────────────────────────────────────────────
  const emitHandler: ActionHandler<
    z.infer<typeof emitInputSchema>,
    z.infer<typeof emitOutputSchema>
  > = {
    input: emitInputSchema,
    output: emitOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const order = await loadOrder(api, input.orderId);
      // clientProvider încarcă storedSecrets (lazy) — trebuie apelat ÎNAINTE de
      // emitConfigProvider(), altfel getEmitConfig() returnează {} la primul apel.
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      // Prefer the series configured on the marketplace plugin over FGO's fallback.
      const effectiveSerie = order.marketplaceInvoiceSeries ?? cfg.defaultSerie;
      const fgoInput = buildFgoEmitInput(order, {
        ...cfg,
        defaultSerie: effectiveSerie ?? undefined,
      });
      const res = await client.emit(fgoInput);
      const invoice = fromFgoEmitResponse(res);
      await api.orders.updateInvoice(input.orderId, invoice);
      // Platform InvoiceService emits invoice.issued and syncs stock — no need to re-emit here.
      return { series: invoice.series, number: invoice.number, issuedAt: invoice.issuedAt };
    },
  };

  // ── cancelInvoice ──────────────────────────────────────────────────────────
  const cancelHandler: ActionHandler<
    z.infer<typeof cancelInputSchema>,
    z.infer<typeof cancelOutputSchema>
  > = {
    input: cancelInputSchema,
    output: cancelOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const { number: parsedNum, series: parsedSeries } = parseInvoiceRef(
        existing.number,
        existing.series,
      );
      await client.cancel(parsedNum, parsedSeries);
      await api.orders.updateInvoice(input.orderId, toCancelledInvoice(existing));
      return { series: existing.series, number: existing.number, cancelled: true };
    },
  };

  // ── fgoCancelDirect ───────────────────────────────────────────────────────
  // Deletes at the FGO API only (/factura/stergere) — does NOT write to the platform DB.
  // The platform calls InvoiceService.clear() after this to update its own DB.
  const cancelDirectHandler: ActionHandler<
    z.infer<typeof cancelDirectInputSchema>,
    z.infer<typeof cancelDirectOutputSchema>
  > = {
    input: cancelDirectInputSchema,
    output: cancelDirectOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const { number: parsedNum, series: parsedSeries } = parseInvoiceRef(
        existing.number,
        existing.series,
      );
      await client.stergere(parsedNum, parsedSeries, cfg.platformUrl);
      return { series: existing.series, number: existing.number, cancelledAtFgo: true };
    },
  };

  // ── stornoInvoice ──────────────────────────────────────────────────────────
  const stornoHandler: ActionHandler<
    z.infer<typeof stornoInputSchema>,
    z.infer<typeof stornoOutputSchema>
  > = {
    input: stornoInputSchema,
    output: stornoOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const { number: parsedNum, series: parsedSeries } = parseInvoiceRef(
        existing.number,
        existing.series,
      );
      const stornoRes = await client.storno(parsedNum, parsedSeries, cfg.platformUrl);
      const factura = stornoRes.Factura as
        | { Numar?: string; Serie?: string; Link?: string }
        | undefined;
      const stornoInvoice: OrderInvoiceInput = {
        series: factura?.Serie ?? parsedSeries,
        number: factura?.Numar ?? parsedNum,
        status: 'issued',
        issuedAt: new Date().toISOString(),
      };
      if (factura?.Link) {
        stornoInvoice.pdfUrl = factura.Link;
      }
      await api.orders.updateInvoiceStorno(input.orderId, stornoInvoice);
      // Platform InvoiceService emits invoice.storno.issued and syncs stock.
      return { series: stornoInvoice.series ?? '', number: stornoInvoice.number ?? '' };
    },
  };

  // ── emitReturnInvoice ──────────────────────────────────────────────────────
  // Emite o factură NOUĂ pentru liniile rămase după un retur parțial/total, opțional cu o
  // linie de "Taxă Returnare". NU stornează — apelantul (OrderReturnsService) apelează întâi
  // `stornoInvoice` pe factura activă, apoi asta. API-ul oficial FGO nu are stornare parțială
  // (doar Numar/Serie, /factura/stornare) — storno complet + reemitere corectată e singura cale.
  const emitReturnHandler: ActionHandler<
    z.infer<typeof emitReturnInputSchema>,
    z.infer<typeof emitReturnOutputSchema>
  > = {
    input: emitReturnInputSchema,
    output: emitReturnOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const order = await loadOrder(api, input.orderId);
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const effectiveSerie = order.marketplaceInvoiceSeries ?? cfg.defaultSerie;
      const orderForReissue: OrderWithItems = { ...order, items: input.items };
      const fgoInput = buildFgoEmitInput(orderForReissue, {
        ...cfg,
        defaultSerie: effectiveSerie ?? undefined,
        ...(input.feeAmountMinor !== undefined
          ? { extraLine: { name: 'Taxă Returnare', amountMinor: input.feeAmountMinor } }
          : {}),
      });
      const res = await client.emit(fgoInput);
      const invoice = fromFgoEmitResponse(res);
      await api.orders.updateInvoice(input.orderId, invoice);
      return { series: invoice.series, number: invoice.number, issuedAt: invoice.issuedAt };
    },
  };

  // ── getInvoiceStatus ───────────────────────────────────────────────────────
  const statusHandler: ActionHandler<
    z.infer<typeof statusInputSchema>,
    z.infer<typeof statusOutputSchema>
  > = {
    input: statusInputSchema,
    output: statusOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const raw = await client.getStatus(existing.number, existing.series);
      const out: { status?: string; raw: Record<string, unknown> } = {
        raw: raw,
      };
      if (typeof raw.Status === 'string') out.status = raw.Status;
      return out;
    },
  };

  // ── getInvoicePdf ──────────────────────────────────────────────────────────
  const pdfHandler: ActionHandler<
    z.infer<typeof pdfInputSchema>,
    z.infer<typeof pdfOutputSchema>
  > = {
    input: pdfInputSchema,
    output: pdfOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const res = await client.getPdf(existing.number, existing.series);
      const out: { pdfBase64: string; contentType?: string } = { pdfBase64: res.Pdf };
      if (res.ContentType) out.contentType = res.ContentType;
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
      const paymentInput: Parameters<FgoClient['recordPayment']>[0] = {
        NumarFactura: existing.number,
        SerieFactura: existing.series,
        Data: input.date,
        TipIncasare: input.paymentType,
        Suma: input.amount,
      };
      if (input.reference) paymentInput.Referinta = input.reference;
      const raw = await client.recordPayment(paymentInput);
      return { ok: true, raw: raw };
    },
  };

  // ── previewEmitInput ──────────────────────────────────────────────────────
  // Returns the FgoEmitInput payload that would be sent — no FGO call, no DB write.
  const previewEmitInputHandler: ActionHandler<
    z.infer<typeof emitInputSchema>,
    z.infer<typeof debugOutputSchema>
  > = {
    input: emitInputSchema,
    output: debugOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const order = await loadOrder(api, input.orderId);
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const effectiveSerie = order.marketplaceInvoiceSeries ?? cfg.defaultSerie;
      const fgoInput = buildFgoEmitInput(order, {
        ...cfg,
        defaultSerie: effectiveSerie ?? undefined,
      });
      return client.buildEmitBody(fgoInput);
    },
  };

  // ── testEmitInvoice ────────────────────────────────────────────────────────
  // Calls FGO emit — returns raw response. No DB write.
  const testEmitInvoiceHandler: ActionHandler<
    z.infer<typeof emitInputSchema>,
    z.infer<typeof debugOutputSchema>
  > = {
    input: emitInputSchema,
    output: debugOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const order = await loadOrder(api, input.orderId);
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const effectiveSerie = order.marketplaceInvoiceSeries ?? cfg.defaultSerie;
      const fgoInput = buildFgoEmitInput(order, {
        ...cfg,
        defaultSerie: effectiveSerie ?? undefined,
      });
      const res = await client.emit(fgoInput);
      return res as unknown as Record<string, unknown>;
    },
  };

  // ── previewStornoInput ─────────────────────────────────────────────────────
  // Returns the payload that would be sent to FGO storno — no FGO call, no DB write.
  const previewStornoInputHandler: ActionHandler<
    z.infer<typeof stornoInputSchema>,
    z.infer<typeof debugOutputSchema>
  > = {
    input: stornoInputSchema,
    output: debugOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      await clientProvider(); // încarcă storedSecrets înainte de emitConfigProvider
      const cfg = emitConfigProvider();
      return {
        Numar: existing.number,
        Serie: existing.series,
        ...(cfg.platformUrl ? { PlatformaUrl: cfg.platformUrl } : {}),
      };
    },
  };

  // ── testStornoInvoice ──────────────────────────────────────────────────────
  // Calls FGO storno — returns raw response. No DB write.
  const testStornoInvoiceHandler: ActionHandler<
    z.infer<typeof stornoInputSchema>,
    z.infer<typeof debugOutputSchema>
  > = {
    input: stornoInputSchema,
    output: debugOutputSchema,
    handle: async (input) => {
      const ctx = ctxProvider();
      const api = getSdkApi(ctx);
      const existing = await loadExistingInvoice(api, input.orderId, 'invoice');
      const client = await clientProvider();
      const cfg = emitConfigProvider();
      const res = await client.storno(existing.number, existing.series, cfg.platformUrl);
      return res;
    },
  };

  return {
    emitInvoice: emitHandler as unknown as ActionHandler<unknown, unknown>,
    cancelInvoice: cancelHandler as unknown as ActionHandler<unknown, unknown>,
    fgoCancelDirect: cancelDirectHandler as unknown as ActionHandler<unknown, unknown>,
    stornoInvoice: stornoHandler as unknown as ActionHandler<unknown, unknown>,
    emitReturnInvoice: emitReturnHandler as unknown as ActionHandler<unknown, unknown>,
    getInvoiceStatus: statusHandler as unknown as ActionHandler<unknown, unknown>,
    getInvoicePdf: pdfHandler as unknown as ActionHandler<unknown, unknown>,
    recordPayment: recordPaymentHandler as unknown as ActionHandler<unknown, unknown>,
    previewEmitInput: previewEmitInputHandler as unknown as ActionHandler<unknown, unknown>,
    testEmitInvoice: testEmitInvoiceHandler as unknown as ActionHandler<unknown, unknown>,
    previewStornoInput: previewStornoInputHandler as unknown as ActionHandler<unknown, unknown>,
    testStornoInvoice: testStornoInvoiceHandler as unknown as ActionHandler<unknown, unknown>,
  };
}
