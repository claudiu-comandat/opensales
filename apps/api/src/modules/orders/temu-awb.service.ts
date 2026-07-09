import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { eq } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { AwbService } from '../awb/awb.service.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';

export interface ConfirmTemuAwbInput {
  trackingCompany: string;
  trackingNumber: string;
  /** Override the sub-order SN list; defaults to [order.externalId]. */
  orderSnList?: string[];
}

interface ConfirmShipmentResult {
  success: boolean;
  failedList?: Record<string, unknown>[];
}

@Injectable()
export class TemuAwbService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly awbService: AwbService,
    private readonly logger: Logger,
  ) {}

  async confirm(orderId: string, input: ConfirmTemuAwbInput): Promise<schema.OrderAwb> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    if (!order.pluginId) throw new NotFoundException('Comenzile manuale nu suportă AWB Temu');

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin) {
      throw new NotFoundException('Plugin-ul Temu pentru această comandă nu este activ');
    }

    const parentOrderSn = order.externalId;
    const orderSnList = input.orderSnList ?? [parentOrderSn];

    const result = (await invokeAction(loadedPlugin.instance, 'confirmShipment', {
      packageList: [
        {
          parentOrderSn,
          orderSnList,
          trackingCompany: input.trackingCompany,
          trackingNumber: input.trackingNumber,
        },
      ],
    })) as ConfirmShipmentResult;

    if (!result.success || (result.failedList?.length ?? 0) > 0) {
      const first = result.failedList?.[0];
      const reason = first ? JSON.stringify(first) : 'confirmShipment eșuat';
      throw new Error(`Temu AWB: ${reason}`);
    }

    this.logger.log(
      { orderId, trackingNumber: input.trackingNumber, trackingCompany: input.trackingCompany },
      'Temu shipment confirmat',
    );

    return this.awbService.set(orderId, 'outgoing', {
      number: input.trackingNumber,
      carrierPluginId: order.pluginId,
      status: 'issued',
      issuedAt: new Date(),
      tracking: input.trackingCompany,
    });
  }
}
