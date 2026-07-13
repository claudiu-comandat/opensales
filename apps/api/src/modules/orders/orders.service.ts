import { Inject, Injectable } from '@nestjs/common';
import { DB_TOKEN, schema } from '@opensales/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, notInArray, or, sql } from 'drizzle-orm';
import { v7 as uuidv7 } from 'uuid';

import type { Database } from '@opensales/db';

import { DomainError } from '../../errors/domain.error.js';
import { PluginEventsBus } from '../plugins/events/plugin-events.bus.js';

import { canTransition, isCancellation, type OrderStatus } from './status-state-machine.js';

import type {
  OrderFirstItem,
  OrderSummaryItem,
  ReturnIndexOrder,
} from './dto/order-response.dto.js';
import type { StockChangedPayload } from '../events/platform-events.payloads.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import type { ListOrdersDto } from './dto/list-orders.dto.js';

interface StockOpRecord {
  productId: string;
  quantityBefore: number;
  quantityAfter: number;
}

@Injectable()
export class OrdersService {
  constructor(
    @Inject(DB_TOKEN) private readonly db: Database,
    private readonly events: PluginEventsBus,
  ) {}

  async list(input: ListOrdersDto): Promise<{
    data: schema.Order[];
    total: number;
    firstItems: Map<string, OrderFirstItem>;
    allItemsByOrder: Map<string, OrderSummaryItem[]>;
    hasUnmatchedByOrder: Map<string, boolean>;
  }> {
    const filters = [];

    // --- Multi-value filters ---
    if (input.status && input.status.length > 0)
      filters.push(inArray(schema.orders.status, input.status));
    if (input.pluginId) filters.push(eq(schema.orders.pluginId, input.pluginId));
    if (input.marketplaceInclude && input.marketplaceInclude.length > 0)
      filters.push(inArray(schema.orders.marketplace, input.marketplaceInclude));
    if (input.marketplaceExclude && input.marketplaceExclude.length > 0)
      filters.push(
        or(
          isNull(schema.orders.marketplace),
          notInArray(schema.orders.marketplace, input.marketplaceExclude),
        ) ?? sql`true`,
      );
    if (input.deliveryMode && input.deliveryMode.length > 0)
      filters.push(inArray(schema.orders.deliveryMode, input.deliveryMode));
    if (input.paymentMethod && input.paymentMethod.length > 0) {
      const pmConds = input.paymentMethod.map(
        (m) => sql`(${schema.orders.rawPayload}->>'payment_mode_id')::int = ${m}`,
      );
      filters.push(or(...pmConds) ?? sql`false`);
    }

    // --- Date range ---
    if (input.placedAfter) filters.push(gte(schema.orders.placedAt, input.placedAfter));
    if (input.placedBefore) filters.push(lte(schema.orders.placedAt, input.placedBefore));

    // --- Full-text search ---
    if (input.search) {
      const term = `%${input.search}%`;
      filters.push(
        sql`(${schema.orders.customerName} ILIKE ${term}
          OR ${schema.orders.externalId} ILIKE ${term}
          OR ${schema.orders.customerPhone} ILIKE ${term}
          OR ${schema.orders.customerEmail} ILIKE ${term}
          OR EXISTS (SELECT 1 FROM order_items oi WHERE oi.order_id = ${schema.orders.id} AND oi.sku ILIKE ${term}))`,
      );
    }

    // --- Boolean tri-state filters (undefined = no filter, true = has, false = doesn't have) ---
    if (input.hasInvoice !== undefined)
      filters.push(
        input.hasInvoice
          ? sql`${schema.orders.invoice} IS NOT NULL`
          : sql`${schema.orders.invoice} IS NULL`,
      );
    if (input.hasAwb !== undefined)
      filters.push(
        input.hasAwb
          ? sql`${schema.orders.awbOutgoing} IS NOT NULL`
          : sql`${schema.orders.awbOutgoing} IS NULL`,
      );
    if (input.hasShipping !== undefined)
      filters.push(
        input.hasShipping
          ? sql`EXISTS (SELECT 1 FROM order_items WHERE order_id = ${schema.orders.id} AND sku = 'TRANSPORT')`
          : sql`NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = ${schema.orders.id} AND sku = 'TRANSPORT')`,
      );
    if (input.hasVoucher !== undefined)
      filters.push(
        input.hasVoucher
          ? sql`EXISTS (SELECT 1 FROM order_items WHERE order_id = ${schema.orders.id} AND sku = 'VOUCHER')`
          : sql`NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = ${schema.orders.id} AND sku = 'VOUCHER')`,
      );
    if (input.hasCancellationRequest !== undefined)
      filters.push(
        input.hasCancellationRequest
          ? sql`${schema.orders.cancellationRequest} IS NOT NULL`
          : sql`${schema.orders.cancellationRequest} IS NULL`,
      );
    if (input.hasUnmatchedItems !== undefined)
      filters.push(
        input.hasUnmatchedItems
          ? sql`EXISTS (SELECT 1 FROM order_items WHERE order_id = ${schema.orders.id} AND product_id IS NULL AND sku NOT IN ('TRANSPORT', 'VOUCHER'))`
          : sql`NOT EXISTS (SELECT 1 FROM order_items WHERE order_id = ${schema.orders.id} AND product_id IS NULL AND sku NOT IN ('TRANSPORT', 'VOUCHER'))`,
      );

    const where = filters.length ? and(...filters) : undefined;

    const [rows, totalRows] = await Promise.all([
      this.db
        .select()
        .from(schema.orders)
        .where(where)
        .orderBy(desc(schema.orders.placedAt))
        .limit(100)
        .offset((input.page - 1) * 100),
      this.db
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.orders)
        .where(where),
    ]);

    // Batch-fetch all items for each order — used for first-item display, item count, and breakdown popover.
    const firstItems = new Map<string, OrderFirstItem>();
    const allItemsByOrder = new Map<string, OrderSummaryItem[]>();
    const hasUnmatchedByOrder = new Map<string, boolean>();
    const orderIds = rows.map((r) => r.id);
    if (orderIds.length > 0) {
      const itemRows = await this.db
        .select()
        .from(schema.orderItems)
        .where(inArray(schema.orderItems.orderId, orderIds))
        .orderBy(asc(schema.orderItems.createdAt));

      // Group items by order and track the first item per order.
      // Skip virtual line items (TRANSPORT/VOUCHER) — those are order-level adjustments
      // shown only on the order detail page, not in the table summary or popover.
      const firstByOrder = new Map<string, schema.OrderItem>();
      const itemGroups = new Map<string, schema.OrderItem[]>();
      for (const item of itemRows) {
        if (item.sku !== 'TRANSPORT' && item.sku !== 'VOUCHER' && item.productId === null) {
          hasUnmatchedByOrder.set(item.orderId, true);
        }
        if (item.sku === 'TRANSPORT' || item.sku === 'VOUCHER') continue;
        if (!firstByOrder.has(item.orderId)) {
          firstByOrder.set(item.orderId, item);
        }
        const list = itemGroups.get(item.orderId) ?? [];
        list.push(item);
        itemGroups.set(item.orderId, list);
      }

      // Enrich with canonical product name + image from local products table (all items, not just first).
      const productIds = Array.from(
        new Set(itemRows.map((i) => i.productId).filter((v): v is string => v !== null)),
      );
      const productLookup = new Map<string, { name: string; imageUrl: string | null }>();
      if (productIds.length > 0) {
        const productRows = await this.db
          .select({
            id: schema.products.id,
            name: schema.products.name,
            images: schema.products.images,
          })
          .from(schema.products)
          .where(inArray(schema.products.id, productIds));
        for (const row of productRows) {
          productLookup.set(row.id, { name: row.name, imageUrl: row.images?.[0]?.url ?? null });
        }
      }

      for (const [orderId, item] of firstByOrder) {
        const product = item.productId ? productLookup.get(item.productId) : undefined;
        firstItems.set(orderId, {
          name: product?.name ?? item.name,
          sku: item.sku,
          imageUrl: product?.imageUrl ?? null,
          quantity: item.quantity,
        });
      }

      for (const [orderId, items] of itemGroups) {
        allItemsByOrder.set(
          orderId,
          items.map((item) => {
            const product = item.productId ? productLookup.get(item.productId) : undefined;
            return { name: product?.name ?? item.name, sku: item.sku, quantity: item.quantity };
          }),
        );
      }
    }

    return {
      data: rows,
      total: totalRows[0]?.count ?? 0,
      firstItems,
      allItemsByOrder,
      hasUnmatchedByOrder,
    };
  }

  /**
   * Index SLAB pentru procesarea retururilor din app-ul de depozit: doar comenzile cu AWB
   * (livrare sau retur) din ultimele 3 luni — un colet neridicat/returnat nu e mai vechi de
   * atât — cu strictul necesar potrivirii după AWB și storno-ului. App-ul îl încarcă o dată
   * în cache, apoi caută local la fiecare scanare (fără request per scanare).
   */
  async returnIndex(): Promise<ReturnIndexOrder[]> {
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(
        sql`(${schema.orders.awbOutgoing} IS NOT NULL OR ${schema.orders.awbReturn} IS NOT NULL)
          AND ${schema.orders.placedAt} >= now() - interval '3 months'`,
      )
      .orderBy(desc(schema.orders.placedAt));
    if (rows.length === 0) return [];

    const itemRows = await this.db
      .select({
        orderId: schema.orderItems.orderId,
        sku: schema.orderItems.sku,
        name: schema.orderItems.name,
        quantity: schema.orderItems.quantity,
      })
      .from(schema.orderItems)
      .where(
        inArray(
          schema.orderItems.orderId,
          rows.map((r) => r.id),
        ),
      );

    const itemsByOrder = new Map<string, OrderSummaryItem[]>();
    for (const it of itemRows) {
      // Sar peste liniile sintetice (transport/voucher) — nu sunt produse de returnat.
      if (it.sku === 'TRANSPORT' || it.sku === 'VOUCHER') continue;
      const list = itemsByOrder.get(it.orderId) ?? [];
      list.push({ sku: it.sku, name: it.name, quantity: it.quantity });
      itemsByOrder.set(it.orderId, list);
    }

    return rows.map((o) => ({
      id: o.id,
      externalId: o.externalId,
      marketplace: o.marketplace,
      status: o.status,
      awbNumber: o.awbOutgoing?.number ?? null,
      awbReturn: o.awbReturn?.number ? { number: o.awbReturn.number } : null,
      customer: { name: o.customerName },
      allItems: itemsByOrder.get(o.id) ?? [],
    }));
  }

  async get(id: string): Promise<{
    order: schema.Order;
    items: schema.OrderItem[];
    productLookup: Map<string, { name: string; imageUrl: string | null }>;
  }> {
    const rows = await this.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, id))
      .limit(1);
    const order = rows[0];
    if (!order) throw DomainError.notFound(`Order not found: ${id}`);
    const items = await this.db
      .select()
      .from(schema.orderItems)
      .where(eq(schema.orderItems.orderId, id))
      .orderBy(asc(schema.orderItems.createdAt));

    const productIds = Array.from(
      new Set(items.map((i) => i.productId).filter((v): v is string => v !== null)),
    );
    const productLookup = new Map<string, { name: string; imageUrl: string | null }>();
    if (productIds.length > 0) {
      const productRows = await this.db
        .select({
          id: schema.products.id,
          name: schema.products.name,
          images: schema.products.images,
        })
        .from(schema.products)
        .where(inArray(schema.products.id, productIds));
      for (const row of productRows) {
        productLookup.set(row.id, {
          name: row.name,
          imageUrl: row.images?.[0]?.url ?? null,
        });
      }
    }

    return { order, items, productLookup };
  }

  async create(input: CreateOrderDto): Promise<{ order: schema.Order; items: schema.OrderItem[] }> {
    const { order, items, stockChanges } = await this.db.transaction(async (tx) => {
      // 1) Decrement stock for items with productId (inline — avoids nested transaction)
      const stockOps = input.items.filter((i) => i.productId !== null);
      const txStockChanges: StockOpRecord[] = [];
      for (const op of stockOps) {
        if (!op.productId) continue;
        const result = await tx.execute<{
          id: string;
          before: number;
          after: number;
        }>(sql`
          UPDATE products
          SET stock_quantity = stock_quantity - ${op.quantity}, updated_at = now()
          WHERE id = ${op.productId} AND stock_quantity >= ${op.quantity}
          RETURNING id,
                    stock_quantity + ${op.quantity} AS before,
                    stock_quantity AS after
        `);
        if (result.length === 0) {
          const probe = await tx
            .select({ q: schema.products.stockQuantity })
            .from(schema.products)
            .where(eq(schema.products.id, op.productId))
            .limit(1);
          const available = probe[0]?.q ?? 0;
          throw DomainError.validation(
            `Insufficient stock for product ${op.productId}: requested ${op.quantity}, available ${available}`,
          );
        }
        const r = result[0];
        if (r) {
          txStockChanges.push({
            productId: r.id,
            quantityBefore: Number(r.before),
            quantityAfter: Number(r.after),
          });
        }
      }

      // 2) Insert order
      const orderId = uuidv7();
      const orderRows = await tx
        .insert(schema.orders)
        .values({
          id: orderId,
          externalId: input.externalId ?? `MANUAL-${uuidv7()}`,
          pluginId: input.pluginId ?? null,
          status: 'new',
          totalAmountMinor: input.totalAmountMinor,
          totalCurrency: input.totalCurrency,
          customerEmail: input.customerEmail ?? null,
          customerPhone: input.customerPhone ?? null,
          customerName: input.customerName ?? null,
          billingAddress: input.billingAddress,
          shippingAddress: input.shippingAddress,
          deliveryMode: input.deliveryMode ?? null,
          paymentStatus: input.paymentStatus ?? null,
          placedAt: input.placedAt,
        })
        .returning();
      const insertedOrder = orderRows[0];
      if (!insertedOrder) throw DomainError.conflict('Order insert returned no row');

      // 3) Insert items (totalAmountMinor is generated — not included)
      const insertedItems = await tx
        .insert(schema.orderItems)
        .values(
          input.items.map((i) => ({
            id: uuidv7(),
            orderId,
            productId: i.productId ?? null,
            sku: i.sku,
            name: i.name,
            quantity: i.quantity,
            unitPriceAmountMinor: i.unitPriceAmountMinor,
            unitPriceCurrency: i.unitPriceCurrency,
            attributes: i.attributes,
          })),
        )
        .returning();

      return { order: insertedOrder, items: insertedItems, stockChanges: txStockChanges };
    });

    // Emit AFTER commit
    this.events.emitFromPlatform('order.created', {
      orderId: order.id,
      externalId: order.externalId,
      pluginId: order.pluginId,
    });
    for (const change of stockChanges) {
      const payload: StockChangedPayload = { ...change, reason: 'order' };
      this.events.emitFromPlatform('stock.changed', payload);
    }
    return { order, items };
  }

  /**
   * Hard-delete all orders and their items from the platform DB. Does not
   * propagate to plugins/marketplaces — used to wipe local state so a fresh
   * sync can re-import with correct data. Stock is not re-adjusted (these
   * orders may have been from external syncs that didn't decrement stock).
   */
  async deleteAll(): Promise<number> {
    return this.db.transaction(async (tx) => {
      await tx.delete(schema.orderItems);
      const deleted = await tx.delete(schema.orders).returning({ id: schema.orders.id });
      return deleted.length;
    });
  }

  /**
   * Manual matching: linkează un order item fără produs la un produs din catalog.
   * Actualizează productId + sku pe order_item și creează/actualizează listing-ul
   * produsului pe plugin-ul comenzii (pentru Trendyol — viitoarele sync-uri vor
   * rezolva automat același barcode).
   */
  async matchItem(
    orderId: string,
    itemId: string,
    productId: string,
  ): Promise<{ item: schema.OrderItem; product: schema.Product }> {
    const [order, item, product] = await Promise.all([
      this.db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1)
        .then((r) => r[0]),
      this.db
        .select()
        .from(schema.orderItems)
        .where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.orderId, orderId)))
        .limit(1)
        .then((r) => r[0]),
      this.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, productId))
        .limit(1)
        .then((r) => r[0]),
    ]);

    if (!order) throw DomainError.notFound(`Order not found: ${orderId}`);
    if (!item) throw DomainError.notFound(`Item not found: ${itemId}`);
    if (!product) throw DomainError.notFound(`Product not found: ${productId}`);
    if (item.productId !== null) throw DomainError.conflict('Item is already matched to a product');
    if (item.sku === 'TRANSPORT' || item.sku === 'VOUCHER')
      throw DomainError.conflict('Cannot match virtual line items');

    // itemSku = barcode Trendyol (valoarea setată de mapper când productId = null)
    const barcode = item.sku;

    // 1. Actualizăm order_items: setăm productId + sku canonic al produsului
    const [updatedItem] = await this.db
      .update(schema.orderItems)
      .set({ productId, sku: product.sku, updatedAt: new Date() })
      .where(eq(schema.orderItems.id, itemId))
      .returning();
    if (!updatedItem) throw DomainError.conflict('Failed to update order item');

    // 2. Creăm/actualizăm listing pentru viitoare sync-uri (doar Trendyol)
    if (order.marketplace?.startsWith('trendyol') && order.pluginId) {
      const platform = 'trendyol';

      const [existingListing] = await this.db
        .select()
        .from(schema.listings)
        .where(
          and(
            eq(schema.listings.productId, productId),
            eq(schema.listings.pluginId, order.pluginId),
            eq(schema.listings.platform, platform),
          ),
        )
        .limit(1);

      if (existingListing) {
        const current = existingListing.syncState ?? {};
        const existing = Array.isArray(current.manual_match_barcodes)
          ? (current.manual_match_barcodes as string[])
          : [];
        if (!existing.includes(barcode)) {
          await this.db
            .update(schema.listings)
            .set({
              syncState: { ...current, manual_match_barcodes: [...existing, barcode] },
              updatedAt: new Date(),
            })
            .where(eq(schema.listings.id, existingListing.id));
        }
      } else {
        // Creăm listing nou cu barcode ca externalListingId (prefixat 'manual:' pentru claritate)
        await this.db
          .insert(schema.listings)
          .values({
            id: uuidv7(),
            productId,
            pluginId: order.pluginId,
            externalListingId: `manual:${barcode}`,
            platform,
            status: 'active',
            syncState: {
              manual_match_barcodes: [barcode],
              marketplace: order.marketplace ?? '',
            },
          })
          .onConflictDoUpdate({
            // Dacă prefixul 'manual:' coincide cu un externalListingId existent
            target: [schema.listings.pluginId, schema.listings.externalListingId],
            set: {
              productId,
              updatedAt: new Date(),
            },
          });
      }
    }

    return { item: updatedItem, product };
  }

  /**
   * Substituie un articol dintr-o comandă cu un alt produs din catalog.
   * Modificarea este locală (nu se propagă pe marketplace).
   * La prima substituire se salvează valorile originale (sku/name/productId) pentru audit.
   */
  async substituteItem(
    orderId: string,
    itemId: string,
    newProductId: string,
  ): Promise<{ item: schema.OrderItem; product: schema.Product }> {
    const [order, item, product] = await Promise.all([
      this.db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, orderId))
        .limit(1)
        .then((r) => r[0]),
      this.db
        .select()
        .from(schema.orderItems)
        .where(and(eq(schema.orderItems.id, itemId), eq(schema.orderItems.orderId, orderId)))
        .limit(1)
        .then((r) => r[0]),
      this.db
        .select()
        .from(schema.products)
        .where(eq(schema.products.id, newProductId))
        .limit(1)
        .then((r) => r[0]),
    ]);

    if (!order) throw DomainError.notFound(`Order not found: ${orderId}`);
    if (!item) throw DomainError.notFound(`Item not found: ${itemId}`);
    if (!product) throw DomainError.notFound(`Product not found: ${newProductId}`);
    if (order.marketplace === null)
      throw DomainError.conflict('Cannot substitute items on manual orders');
    if (item.sku === 'TRANSPORT' || item.sku === 'VOUCHER')
      throw DomainError.conflict('Cannot substitute virtual line items');

    // Păstrăm valorile originale doar la prima substituire
    const isFirstSubstitution = item.substitutedAt === null;

    const [updatedItem] = await this.db
      .update(schema.orderItems)
      .set({
        productId: newProductId,
        sku: product.sku,
        name: product.name,
        ...(isFirstSubstitution
          ? {
              originalSku: item.sku,
              originalName: item.name,
              originalProductId: item.productId ?? null,
            }
          : {}),
        substitutedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.orderItems.id, itemId))
      .returning();
    if (!updatedItem) throw DomainError.conflict('Failed to substitute order item');

    return { item: updatedItem, product };
  }

  async deleteManual(id: string): Promise<void> {
    const { stockChanges } = await this.db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.orders).where(eq(schema.orders.id, id)).limit(1);
      const order = rows[0];
      if (!order) throw DomainError.notFound(`Order not found: ${id}`);
      if (order.pluginId !== null) {
        throw DomainError.conflict(
          'Only manual orders (without a marketplace plugin) can be deleted',
        );
      }

      const txStockChanges: StockOpRecord[] = [];
      if (order.status !== 'cancelled') {
        const items = await tx
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, id));
        for (const item of items) {
          if (!item.productId) continue;
          const result = await tx.execute<{ id: string; before: number; after: number }>(sql`
            UPDATE products
            SET stock_quantity = stock_quantity + ${item.quantity}, updated_at = now()
            WHERE id = ${item.productId}
            RETURNING id,
                      stock_quantity - ${item.quantity} AS before,
                      stock_quantity AS after
          `);
          const r = result[0];
          if (r) {
            txStockChanges.push({
              productId: r.id,
              quantityBefore: Number(r.before),
              quantityAfter: Number(r.after),
            });
          }
        }
      }

      await tx.delete(schema.orderItems).where(eq(schema.orderItems.orderId, id));
      await tx.delete(schema.orders).where(eq(schema.orders.id, id));
      return { stockChanges: txStockChanges };
    });

    for (const change of stockChanges) {
      const payload: StockChangedPayload = { ...change, reason: 'cancel' };
      this.events.emitFromPlatform('stock.changed', payload);
    }
  }

  async updateStatus(id: string, newStatus: OrderStatus): Promise<schema.Order> {
    const { row, fromStatus, restockChanges } = await this.db.transaction(async (tx) => {
      const currentRows = await tx
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, id))
        .limit(1);
      const current = currentRows[0];
      if (!current) throw DomainError.notFound(`Order not found: ${id}`);

      const txFromStatus = current.status;
      if (!canTransition(txFromStatus, newStatus)) {
        throw DomainError.conflict(`Cannot transition order from ${txFromStatus} to ${newStatus}`);
      }

      // If cancelling, restock items
      const txRestockChanges: StockOpRecord[] = [];
      if (isCancellation(txFromStatus, newStatus)) {
        const items = await tx
          .select()
          .from(schema.orderItems)
          .where(eq(schema.orderItems.orderId, id));
        for (const item of items) {
          if (!item.productId) continue;
          const result = await tx.execute<{
            id: string;
            before: number;
            after: number;
          }>(sql`
            UPDATE products
            SET stock_quantity = stock_quantity + ${item.quantity}, updated_at = now()
            WHERE id = ${item.productId}
            RETURNING id,
                      stock_quantity - ${item.quantity} AS before,
                      stock_quantity AS after
          `);
          const r = result[0];
          if (r) {
            txRestockChanges.push({
              productId: r.id,
              quantityBefore: Number(r.before),
              quantityAfter: Number(r.after),
            });
          }
        }
      }

      const updatedRows = await tx
        .update(schema.orders)
        .set({ status: newStatus, updatedAt: new Date() })
        .where(eq(schema.orders.id, id))
        .returning();
      const updatedRow = updatedRows[0];
      if (!updatedRow) throw DomainError.notFound(`Order not found after update: ${id}`);
      return {
        row: updatedRow,
        fromStatus: txFromStatus,
        restockChanges: txRestockChanges,
      };
    });

    // Emit AFTER commit
    this.events.emitFromPlatform('order.status_changed', {
      orderId: id,
      statusBefore: fromStatus,
      statusAfter: newStatus,
    });
    if (newStatus === 'cancelled') {
      this.events.emitFromPlatform('order.cancelled', { orderId: id });
    }
    for (const change of restockChanges) {
      const payload: StockChangedPayload = { ...change, reason: 'cancel' };
      this.events.emitFromPlatform('stock.changed', payload);
    }
    return row;
  }
}
