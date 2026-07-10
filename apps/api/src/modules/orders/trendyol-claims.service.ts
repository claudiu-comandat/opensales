import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { type Database, DB_TOKEN, schema } from '@opensales/db';
import { invokeAction } from '@opensales/plugin-sdk';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { Logger } from 'nestjs-pino';

import type { Plugin } from '@opensales/plugin-sdk';

import { LoadedPluginsRegistry } from '../plugins/loader/loaded-plugins.registry.js';

import { OrderReturnsService } from './order-returns.service.js';
import { approvedReturnLines, flattenClaim, type FlatClaim } from './trendyol-claim.mapper.js';

const TRENDYOL_PACKAGE = '@opensales-plugin/trendyol';

/** Statusuri de claim ne-finalizate (doc Trendyol § 8) — cele acționabile pentru operator. */
const PENDING_STATUSES = ['Created', 'WaitingInAction', 'InAnalysis', 'Unresolved'] as const;

export interface RejectClaimInput {
  claimId: string;
  claimItemIdList: string[];
  claimIssueReasonId: number;
  description: string;
  imageBase64?: string | undefined;
}

export interface StornoResult {
  emitted: boolean;
  reason?: string;
  orderReturnId?: string;
  invoiceStorno?: schema.OrderInvoice | null;
  invoiceReissue?: schema.OrderInvoice | null;
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}

/**
 * Rezolvarea claim-urilor Trendyol (listare / aprobare / respingere) + emiterea storno-ului
 * la aprobare. Consumat de n8n (webhook-urile `retur-*-trendyol-*`), la rândul lui apelat din
 * storage-apk.
 */
@Injectable()
export class TrendyolClaimsService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly loaded: LoadedPluginsRegistry,
    private readonly orderReturns: OrderReturnsService,
    private readonly logger: Logger,
  ) {}

  private instance(): Plugin {
    const inst = this.loaded.getByPackage(TRENDYOL_PACKAGE)?.instance;
    if (!inst) throw new NotFoundException('Plugin-ul Trendyol nu este instalat sau activ');
    return inst;
  }

  private async fetchRawClaims(status: string): Promise<Record<string, unknown>[]> {
    const raw = asRecord(
      await invokeAction(this.instance(), 'getClaims', { claimItemStatus: status, size: 200 }),
    );
    const content = Array.isArray(raw?.content) ? raw.content : [];
    return content.filter((c): c is Record<string, unknown> => asRecord(c) !== null);
  }

  /**
   * Claim-urile pending, în forma PLATĂ pe care o consumă storage-apk (claimId, awbs,
   * claimLineItemIdList, items[{barcode, quantity}]) — structura reală Trendyol e nested.
   */
  async listClaims(): Promise<FlatClaim[]> {
    const byId = new Map<string, FlatClaim>();
    for (const status of PENDING_STATUSES) {
      let raws: Record<string, unknown>[] = [];
      try {
        raws = await this.fetchRawClaims(status);
      } catch (err) {
        this.logger.warn(
          { status, error: err instanceof Error ? err.message : String(err) },
          'Trendyol getClaims a eșuat pentru un status',
        );
        continue;
      }
      for (const raw of raws) {
        const flat = flattenClaim(raw);
        // Un claim poate reveni la mai multe filtre → dedupe pe claimId. Sar peste claim-urile
        // fără linii acționabile (WaitingInAction) — nu are ce aproba/respinge operatorul.
        if (flat && flat.claimLineItemIdList.length > 0) byId.set(flat.claimId, flat);
      }
    }
    return Array.from(byId.values());
  }

  async listReasons(): Promise<unknown> {
    return invokeAction(this.instance(), 'getClaimIssueReasons', {});
  }

  /**
   * Aprobă claim-ul la Trendyol, apoi emite storno-ul în OpenSales (parțial/total, după unitățile
   * aprobate). Aprobarea (acțiunea față de client) e primară: dacă storno-ul local nu poate fi făcut
   * cu certitudine (comandă negăsită, linii nepotrivite, factură lipsă), aprobarea rămâne validă și
   * raportăm de ce n-a mers storno-ul — de reconciliat manual via POST /orders/:id/return.
   */
  async approve(
    claimId: string,
    claimLineItemIdList: string[],
  ): Promise<{ claimApproved: true; storno: StornoResult }> {
    await invokeAction(this.instance(), 'approveClaim', { claimId, claimLineItemIdList });
    this.logger.log({ claimId, items: claimLineItemIdList.length }, 'Trendyol claim approved');

    const storno = await this.recordStorno(claimId, claimLineItemIdList).catch(
      (err): StornoResult => ({
        emitted: false,
        reason: err instanceof Error ? err.message : String(err),
      }),
    );
    if (!storno.emitted) {
      this.logger.warn({ claimId, reason: storno.reason }, 'Trendyol approve: storno neemis');
    }
    return { claimApproved: true, storno };
  }

  private async recordStorno(claimId: string, approvedIds: string[]): Promise<StornoResult> {
    const raws = asRecord(
      await invokeAction(this.instance(), 'getClaims', { claimIds: [claimId], size: 1 }),
    );
    const raw = (Array.isArray(raws?.content) ? raws.content : []).map(asRecord).find(Boolean);
    if (!raw) return { emitted: false, reason: 'Claim negăsit la Trendyol pentru storno' };

    const orderNumber = typeof raw.orderNumber === 'string' ? raw.orderNumber : undefined;
    if (!orderNumber) return { emitted: false, reason: 'orderNumber lipsă din claim' };

    const lines = approvedReturnLines(raw, approvedIds);
    if (lines.length === 0) return { emitted: false, reason: 'Nicio linie aprobată în claim' };

    const [order] = await this.db
      .select({ id: schema.orders.id })
      .from(schema.orders)
      .where(
        and(
          eq(schema.orders.externalId, orderNumber),
          like(schema.orders.marketplace, 'trendyol-%'),
        ),
      )
      .limit(1);
    if (!order) {
      return {
        emitted: false,
        reason: `Comanda OpenSales pentru orderNumber ${orderNumber} negăsită`,
      };
    }

    const orderItems = await this.db
      .select({ sku: schema.orderItems.sku, productId: schema.orderItems.productId })
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, order.id));
    const skuSet = new Set(orderItems.map((i) => i.sku));
    const skuByProductId = new Map<string, string>();
    for (const i of orderItems) if (i.productId) skuByProductId.set(i.productId, i.sku);

    // Fallback pentru comenzile unde order_items.sku e SKU-ul NOSTRU intern (order-sync a rezolvat
    // produsul prin EAN), deci nu e nici merchantSku nici barcode Trendyol: rezolvăm barcode/merchantSku
    // → produs (products.ean / products.sku) → order_item prin productId.
    const barcodes = lines.map((l) => l.barcode).filter(Boolean);
    const merchantSkus = lines.map((l) => l.merchantSku).filter(Boolean);
    const products =
      barcodes.length > 0 || merchantSkus.length > 0
        ? await this.db
            .select({ id: schema.products.id, sku: schema.products.sku, ean: schema.products.ean })
            .from(schema.products)
            .where(
              or(
                merchantSkus.length > 0 ? inArray(schema.products.sku, merchantSkus) : undefined,
                barcodes.length > 0 ? inArray(schema.products.ean, barcodes) : undefined,
              ),
            )
        : [];
    const productIdByBarcode = new Map<string, string>();
    const productIdByMerchantSku = new Map<string, string>();
    for (const p of products) {
      if (p.ean) productIdByBarcode.set(p.ean, p.id);
      productIdByMerchantSku.set(p.sku, p.id);
    }

    const items: { sku: string; quantity: number }[] = [];
    const unmatched: string[] = [];
    for (const line of lines) {
      let sku: string | null = null;
      if (skuSet.has(line.merchantSku)) sku = line.merchantSku;
      else if (skuSet.has(line.barcode)) sku = line.barcode;
      else {
        const pid =
          productIdByMerchantSku.get(line.merchantSku) ?? productIdByBarcode.get(line.barcode);
        if (pid) sku = skuByProductId.get(pid) ?? null;
      }
      if (!sku) {
        unmatched.push(line.barcode || line.merchantSku || line.productName);
        continue;
      }
      items.push({ sku, quantity: line.quantity });
    }
    if (unmatched.length > 0) {
      // Nu emitem storno parțial pe o potrivire incompletă — riscul de factură greșită > câștig.
      return {
        emitted: false,
        reason: `Linii de claim nepotrivite pe comandă (${unmatched.join(', ')}) — storno de făcut manual`,
      };
    }

    const orderReturn = await this.orderReturns.processPartialReturnBySku(order.id, items, {
      source: 'trendyol_claim',
      sourceReference: claimId,
    });
    // `emitted` reflectă dacă FGO a emis efectiv storno-ul — un rând existent fără invoiceStorno
    // (retry pe un attempt anterior eșuat) NU înseamnă succes.
    if (!orderReturn.invoiceStorno) {
      return {
        emitted: false,
        reason:
          'Retur înregistrat dar factura storno nu a fost emisă — necesită verificare manuală',
        orderReturnId: orderReturn.id,
      };
    }
    return {
      emitted: true,
      orderReturnId: orderReturn.id,
      invoiceStorno: orderReturn.invoiceStorno,
      invoiceReissue: orderReturn.invoiceReissue,
    };
  }

  async reject(input: RejectClaimInput): Promise<unknown> {
    const result = await invokeAction(this.instance(), 'rejectClaim', input);
    this.logger.log(
      { claimId: input.claimId, reasonId: input.claimIssueReasonId },
      'Trendyol claim rejected',
    );
    return result;
  }
}
