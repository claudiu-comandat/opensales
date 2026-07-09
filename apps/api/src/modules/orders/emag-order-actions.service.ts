import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, eq, isNotNull } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { StockService } from '../stock/stock.service.js';

const FGO_PACKAGE = '@opensales-plugin/fgo';

@Injectable()
export class EmagOrderActionsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly registry: PluginRegistryService,
    private readonly stock: StockService,
    private readonly logger: Logger,
  ) {}

  async createStorno(orderId: string): Promise<{ series: string; number: string }> {
    await this.getOrder(orderId);
    const fgoRecord = await this.registry.findByPackageName(FGO_PACKAGE);
    const fgoPlugin = fgoRecord ? this.loaded.getById(fgoRecord.id) : null;
    if (!fgoPlugin) throw new NotFoundException('Plugin-ul FGO nu este instalat sau activ');

    const result = (await invokeAction(fgoPlugin.instance, 'stornoInvoice', {
      orderId,
    })) as { series: string; number: string };

    this.logger.log(
      { orderId, series: result.series, number: result.number },
      'storno invoice created',
    );
    return result;
  }

  async stornoPartial(
    orderId: string,
    products: { id: number; quantity: number }[],
  ): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order.pluginId)
      throw new NotFoundException('Comenzile manuale nu suportă storno parțial eMAG');

    const emagPlugin = this.loaded.getById(order.pluginId);
    if (!emagPlugin)
      throw new NotFoundException('Plugin-ul eMAG pentru această comandă nu este activ');

    const emagOrderId = parseInt(order.externalId, 10);
    if (isNaN(emagOrderId))
      throw new NotFoundException('ID extern invalid pentru storno parțial eMAG');

    await invokeAction(emagPlugin.instance, 'emagStornoPartial', {
      orderId: emagOrderId,
      products,
    });

    this.logger.log(
      { orderId, emagOrderId, productsCount: products.length },
      'eMAG partial storno applied',
    );
  }

  async cancelOrder(orderId: string, reasonId: number): Promise<void> {
    const order = await this.getOrder(orderId);
    if (!order.pluginId) throw new NotFoundException('Comenzile manuale nu suportă anulare eMAG');
    const emagPlugin = this.loaded.getById(order.pluginId);
    if (!emagPlugin) {
      throw new NotFoundException('Plugin-ul eMAG pentru această comandă nu este activ');
    }

    const emagOrderId = parseInt(order.externalId, 10);
    if (isNaN(emagOrderId)) throw new NotFoundException('ID extern invalid pentru anulare eMAG');

    await invokeAction(emagPlugin.instance, 'cancelOrder', {
      orderId: emagOrderId,
      reasonId,
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

    this.logger.log({ orderId, emagOrderId, reasonId }, 'eMAG order cancelled');
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

  private async getOrder(orderId: string): Promise<schema.Order> {
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
      .limit(1);
    if (rows.length === 0) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    return rows[0] as schema.Order;
  }
}
