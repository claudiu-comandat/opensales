import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { eq } from 'drizzle-orm';

import { trendyolStorefrontFor } from '../marketplaces/marketplace-catalog.js';
import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';

export interface AwbLabelResult {
  pdfBase64: string;
  contentType: string | undefined;
}

@Injectable()
export class TrendyolAwbService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
  ) {}

  async getLabel(orderId: string): Promise<AwbLabelResult> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    if (!order.pluginId) throw new NotFoundException('Comenzile manuale nu suportă AWB Trendyol');

    const awb = order.awbOutgoing as Record<string, unknown> | null;
    // Folosim trendyol_tracking_number (Trendyol Pays) pentru getCommonLabel.
    // awb.number poate fi cargoSenderNumber (curier propriu) — nu funcționează cu getCommonLabel.
    const cargoTrackingNumber =
      typeof awb?.trendyol_tracking_number === 'string' && awb.trendyol_tracking_number
        ? awb.trendyol_tracking_number
        : null;
    if (!cargoTrackingNumber) {
      throw new NotFoundException(
        `Comanda ${orderId} nu are un AWB generat de Trendyol (Trendyol Pays). ` +
          `PDF-ul este disponibil doar pentru comenzile cu transport asigurat de Trendyol.`,
      );
    }

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin) {
      throw new NotFoundException('Plugin-ul Trendyol pentru această comandă nu este activ');
    }

    const result = (await invokeAction(loadedPlugin.instance, 'getAwbLabel', {
      cargoTrackingNumber,
      storeFrontCode: order.marketplace ? trendyolStorefrontFor(order.marketplace) : undefined,
    })) as { pdfBase64: string; contentType?: string };

    return {
      pdfBase64: result.pdfBase64,
      contentType: result.contentType,
    };
  }
}
