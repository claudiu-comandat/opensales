import { Inject, Injectable, type OnApplicationBootstrap } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { eq } from 'drizzle-orm';

import type { Database } from '@opensales/db';
import type { OrderInvoiceInput } from '@opensales/plugin-sdk';

import { InvoiceService } from '../invoice/invoice.service.js';
import { PermissionGatewayService } from '../plugins/gateway/permission-gateway.service.js';

import { OrdersService } from './orders.service.js';

/**
 * Registers gateway handlers for the orders domain so plugins can call
 * `api.orders.get()`, `api.orders.updateInvoice()`, and
 * `api.orders.updateInvoiceStorno()`.
 *
 * The `orders.get` response includes `marketplaceInvoiceSeries` resolved
 * from the marketplace plugin's `config.invoiceSeries` field, so invoicing
 * plugins (e.g. FGO) can apply the correct series per marketplace without
 * storing it in their own secrets.
 */
@Injectable()
export class OrdersGatewayHandlers implements OnApplicationBootstrap {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly orders: OrdersService,
    private readonly invoice: InvoiceService,
    private readonly gateway: PermissionGatewayService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.registerOrdersGet();
    this.registerUpdateInvoice();
    this.registerUpdateInvoiceStorno();
  }

  private registerOrdersGet(): void {
    this.gateway.registerHandler('orders.get', 'orders:read', async (_pluginId, rawInput) => {
      const { id } = rawInput as { id: string };
      const { order, items, productLookup } = await this.orders.get(id);

      // Resolve the invoice series configured on the marketplace plugin (null for manual orders).
      const [pluginRow] = order.pluginId
        ? await this.db
            .select({ config: schema.plugins.config })
            .from(schema.plugins)
            .where(eq(schema.plugins.id, order.pluginId))
            .limit(1)
        : [];
      const cfg = pluginRow?.config ?? {};
      let marketplaceInvoiceSeries: string | null = null;
      if (cfg.invoiceSeriesMode === 'per_country') {
        const byMp = cfg.invoiceSeriesByMarketplace;
        const mp = order.marketplace;
        let seriesForMp =
          byMp && typeof byMp === 'object' && mp
            ? (byMp as Record<string, unknown>)[mp]
            : undefined;
        // Fallback: fbe-XX → emag-XX (FBE orders share the same invoice series as regular eMAG per country)
        if (typeof seriesForMp !== 'string' && mp?.startsWith('fbe-')) {
          const fallbackMp = 'emag-' + mp.slice(4);
          seriesForMp = byMp ? (byMp as Record<string, unknown>)[fallbackMp] : undefined;
        }
        marketplaceInvoiceSeries = typeof seriesForMp === 'string' ? seriesForMp : null;
      } else {
        marketplaceInvoiceSeries = typeof cfg.invoiceSeries === 'string' ? cfg.invoiceSeries : null;
      }

      return {
        id: order.id,
        externalId: order.externalId,
        pluginId: order.pluginId,
        marketplace: order.marketplace,
        deliveryMode: order.deliveryMode ?? undefined,
        totalAmountMinor: order.totalAmountMinor,
        totalCurrency: order.totalCurrency,
        customerEmail: order.customerEmail ?? undefined,
        customerPhone: order.customerPhone ?? undefined,
        customerName: order.customerName ?? undefined,
        billingAddress: order.billingAddress as Record<string, unknown>,
        shippingAddress: order.shippingAddress as Record<string, unknown>,
        ...(order.shippingCostMinor !== null ? { shippingCostMinor: order.shippingCostMinor } : {}),
        ...(order.vouchersMinor !== null ? { vouchersMinor: order.vouchersMinor } : {}),
        invoice: order.invoice,
        invoiceStorno: order.invoiceStorno,
        marketplaceInvoiceSeries,
        /** Tipul comenzii din rawPayload eMAG: 2 = FBE (fulfillment by eMAG), 3 = fulfillment by seller. */
        orderType:
          typeof (order.rawPayload as Record<string, unknown> | null)?.type === 'number'
            ? ((order.rawPayload as Record<string, unknown>).type as number)
            : null,
        /** ID-ul pachetului Trendyol (shipmentPackageId din rawPayload) — necesar pentru atasarea facturii. */
        shipmentPackageId:
          typeof (order.rawPayload as Record<string, unknown> | null)?.shipmentPackageId ===
          'number'
            ? ((order.rawPayload as Record<string, unknown>).shipmentPackageId as number)
            : null,
        items: items.map((i) => {
          const product = i.productId ? productLookup.get(i.productId) : undefined;
          return {
            sku: i.sku,
            name: product?.name ?? i.name,
            quantity: i.quantity,
            unitPriceAmountMinor: i.unitPriceAmountMinor,
            unitPriceCurrency: i.unitPriceCurrency,
            productId: i.productId ?? undefined,
            attributes: i.attributes,
          };
        }),
      };
    });
  }

  private registerUpdateInvoice(): void {
    this.gateway.registerHandler(
      'orders.updateInvoice',
      'invoice:emit',
      async (_pluginId, rawInput) => {
        const { id, invoice } = rawInput as { id: string; invoice: OrderInvoiceInput };
        await this.invoice.set(id, 'invoice', {
          series: invoice.series,
          number: invoice.number,
          pdfUrl: invoice.pdfUrl,
          status: invoice.status,
          issuedAt: new Date(invoice.issuedAt),
        });
      },
    );
  }

  private registerUpdateInvoiceStorno(): void {
    this.gateway.registerHandler(
      'orders.updateInvoiceStorno',
      'invoice:emit',
      async (_pluginId, rawInput) => {
        const { id, invoice } = rawInput as { id: string; invoice: OrderInvoiceInput };
        await this.invoice.set(id, 'storno', {
          series: invoice.series,
          number: invoice.number,
          pdfUrl: invoice.pdfUrl,
          status: invoice.status,
          issuedAt: new Date(invoice.issuedAt),
        });
      },
    );
  }
}
