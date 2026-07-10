import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { eq } from 'drizzle-orm';

import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';

import { marketplaceToPlatform } from './emag-awb-issue.service.js';

export interface AwbPdfResult {
  pdfBase64: string;
  contentType: string | undefined;
}

export interface AwbPdfBytesResult {
  bytes: Uint8Array;
  contentType: string;
}

@Injectable()
export class EmagAwbPdfService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
  ) {}

  async getLabel(orderId: string): Promise<AwbPdfResult> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    if (!order.pluginId) throw new NotFoundException('Comenzile manuale nu suportă AWB eMAG');

    const awb = order.awbOutgoing as Record<string, unknown> | null;
    const emagId = typeof awb?.emag_id === 'number' ? awb.emag_id : null;
    if (!emagId) {
      throw new NotFoundException(
        `Comanda ${orderId} nu are emag_id stocat. Emite AWB-ul întâi sau re-emite dacă a apărut o eroare anterioară.`,
      );
    }

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin) {
      throw new NotFoundException('Plugin-ul eMAG pentru această comandă nu este activ');
    }

    const result = (await invokeAction(loadedPlugin.instance, 'readAwbPdf', {
      emag_id: emagId,
      format: 'A6',
      // Rutează citirea spre țara pe care s-a emis AWB-ul (emag-hu ≠ emag-ro).
      platform: marketplaceToPlatform(order.marketplace) ?? undefined,
    })) as { bytes: Uint8Array; contentType: string | null };

    const pdfBase64 = Buffer.from(result.bytes).toString('base64');
    return {
      pdfBase64,
      contentType: result.contentType ?? 'application/pdf',
    };
  }

  async getPdf(orderId: string): Promise<AwbPdfBytesResult> {
    const order = await this.db.query.orders.findFirst({
      where: eq(schema.orders.id, orderId),
    });
    if (!order) throw new NotFoundException(`Comanda ${orderId} nu a fost găsită`);
    if (!order.pluginId) throw new NotFoundException('Comenzile manuale nu suportă AWB eMAG');

    const awb = order.awbOutgoing as Record<string, unknown> | null;
    const emagId = typeof awb?.emag_id === 'number' ? awb.emag_id : null;
    if (!emagId) {
      throw new NotFoundException(`Comanda ${orderId} nu are emag_id stocat. Emite AWB-ul întâi.`);
    }

    const loadedPlugin = this.loaded.getById(order.pluginId);
    if (!loadedPlugin) {
      throw new NotFoundException('Plugin-ul eMAG pentru această comandă nu este activ');
    }

    const result = (await invokeAction(loadedPlugin.instance, 'readAwbPdf', {
      emag_id: emagId,
      format: 'A6',
      // Rutează citirea spre țara pe care s-a emis AWB-ul (emag-hu ≠ emag-ro).
      platform: marketplaceToPlatform(order.marketplace) ?? undefined,
    })) as { bytes: Uint8Array; contentType: string | null };

    return {
      bytes: result.bytes,
      contentType: result.contentType ?? 'application/pdf',
    };
  }
}
