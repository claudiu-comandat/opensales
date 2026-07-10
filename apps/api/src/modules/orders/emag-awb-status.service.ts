import { Inject, Injectable } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, eq, isNotNull, or, sql } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';
import { PluginRegistryService } from '../plugins/registry/plugin-registry.service.js';
import { type LoadedPlugin } from '../plugins/types.js';

import { marketplaceToPlatform } from './emag-awb-issue.service.js';

type OrderAwbStatus = schema.OrderAwb['status'];

const TERMINAL_STATUSES: OrderAwbStatus[] = ['delivered', 'returned', 'cancelled'];

interface AwbStatusPayload {
  code: string;
  name: string;
  description: string;
}

interface AwbReadResult {
  emag_id: number;
  status?: AwbStatusPayload;
  [key: string]: unknown;
}

function mapEmagAwbStatus(code: string): OrderAwbStatus {
  switch (code) {
    case 'DLV':
      return 'delivered';
    case 'RET':
      return 'returned';
    case 'CAN':
      return 'cancelled';
    default:
      return 'in_transit';
  }
}

@Injectable()
export class EmagAwbStatusService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly registry: PluginRegistryService,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly logger: Logger,
  ) {}

  /**
   * Parcurge toate comenzile pluginului care au un AWB emis prin API (cu emag_id)
   * și status non-terminal, apelează awb/read pentru fiecare și actualizează statusul.
   */
  async syncForPlugin(pluginId: string): Promise<void> {
    const plugin = await this.registry.findById(pluginId);
    if (plugin?.status !== 'active') {
      this.logger.warn({ pluginId }, 'AWB status sync skipped — plugin not active');
      return;
    }

    const loadedPlugin = this.loaded.getById(pluginId);
    if (!loadedPlugin) {
      this.logger.warn({ pluginId }, 'AWB status sync skipped — plugin not loaded');
      return;
    }

    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.pluginId, pluginId),
          or(isNotNull(sql`awb_outgoing->>'emag_id'`), isNotNull(sql`awb_return->>'emag_id'`)),
        ),
      );

    let updated = 0;
    for (const order of rows) {
      updated += await this.syncAwbColumn(loadedPlugin, order, 'outgoing');
      updated += await this.syncAwbColumn(loadedPlugin, order, 'return');
    }

    this.logger.log({ pluginId, updated }, 'AWB status sync completed');
  }

  private async syncAwbColumn(
    loadedPlugin: LoadedPlugin,
    order: schema.Order,
    direction: 'outgoing' | 'return',
  ): Promise<number> {
    const awb = direction === 'outgoing' ? order.awbOutgoing : order.awbReturn;
    if (!awb?.emag_id) return 0;
    if (TERMINAL_STATUSES.includes(awb.status)) return 0;

    let items: AwbReadResult[];
    try {
      items = (await invokeAction(loadedPlugin.instance, 'readAwb', {
        emag_id: awb.emag_id,
        // Citește statusul AWB de pe țara comenzii (emag-hu ≠ emag-ro), altfel eMAG respinge.
        platform: marketplaceToPlatform(order.marketplace) ?? undefined,
      })) as AwbReadResult[];
    } catch (err) {
      this.logger.warn(
        { orderId: order.id, emagId: awb.emag_id, err },
        'awb/read failed — skipping',
      );
      return 0;
    }

    const item = items[0];
    if (!item?.status?.code) return 0;

    const newStatus = mapEmagAwbStatus(item.status.code);
    if (newStatus === awb.status) return 0;

    const updated: schema.OrderAwb = { ...awb, status: newStatus };
    if (direction === 'outgoing') {
      await this.db
        .update(schema.orders)
        .set({ awbOutgoing: updated, updatedAt: new Date() })
        .where(eq(schema.orders.id, order.id));
    } else {
      await this.db
        .update(schema.orders)
        .set({ awbReturn: updated, updatedAt: new Date() })
        .where(eq(schema.orders.id, order.id));
    }

    this.logger.log(
      { orderId: order.id, emagId: awb.emag_id, oldStatus: awb.status, newStatus },
      'AWB status updated',
    );
    return 1;
  }
}
