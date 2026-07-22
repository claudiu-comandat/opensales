import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, eq, isNotNull } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { trendyolStorefrontFor } from '../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { StockService } from '../stock/stock.service.js';

@Injectable()
export class TrendyolOrderActionsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly stock: StockService,
    private readonly logger: Logger,
  ) {}

  async cancelOrder(orderId: string, reasonId: number): Promise<void> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    if (!order.pluginId)
      throw new NotFoundException('Comenzile manuale nu suportă anulare Trendyol');

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin)
      throw new NotFoundException('Plugin-ul Trendyol pentru această comandă nu este activ');

    const raw = order.rawPayload as Record<string, unknown> | null;
    if (!raw) throw new NotFoundException('rawPayload lipsă — nu se poate anula pe Trendyol');

    const packageId = typeof raw.shipmentPackageId === 'number' ? raw.shipmentPackageId : null;
    if (!packageId) throw new NotFoundException('shipmentPackageId lipsă din rawPayload');

    const rawLines = raw.lines as Record<string, unknown>[] | undefined;
    if (!Array.isArray(rawLines) || rawLines.length === 0)
      throw new NotFoundException('Liniile comenzii lipsesc din rawPayload');

    const lines = rawLines
      .map((line) => ({
        lineId:
          typeof line.id === 'number'
            ? line.id
            : typeof line.lineId === 'number'
              ? line.lineId
              : NaN,
        quantity: typeof line.quantity === 'number' ? line.quantity : 1,
      }))
      .filter((l) => !isNaN(l.lineId));

    if (lines.length === 0)
      throw new NotFoundException('Nu s-au putut extrage linii valide din rawPayload');

    await invokeAction(loadedPlugin.instance, 'cancelPackage', {
      packageId,
      reasonId,
      lines,
      // Pachetul aparține storefront-ului comenzii — fără el, plugin-ul rutează
      // implicit pe RO și Trendyol respinge cu 400 "storefront not matched"
      // pentru comenzile din alte țări.
      storeFrontCode: order.marketplace ? trendyolStorefrontFor(order.marketplace) : undefined,
    });

    // Comanda devine terminală → eliberează rezervarea de stoc dacă era activă.
    if (order.stockReservationClaimed) {
      const stockItems = await this.loadStockItems(orderId);
      if (stockItems.length > 0) await this.stock.releaseReservation(stockItems);
    }

    await this.db
      .update(schema.orders)
      .set({ status: 'cancelled', stockReservationClaimed: false, updatedAt: new Date() })
      .where(eq(schema.orders.id, orderId));

    this.logger.log(
      { orderId, packageId, reasonId, linesCount: lines.length },
      'Trendyol order cancelled',
    );
  }

  private async loadStockItems(
    orderId: string,
  ): Promise<{ productId: string; quantity: number }[]> {
    const rows = await this.db
      .select({ productId: schema.orderItems.productId, quantity: schema.orderItems.quantity })
      .from(schema.orderItems)
      .where(and(eq(schema.orderItems.orderId, orderId), isNotNull(schema.orderItems.productId)));
    return rows.filter((r): r is { productId: string; quantity: number } => r.productId !== null);
  }
}
