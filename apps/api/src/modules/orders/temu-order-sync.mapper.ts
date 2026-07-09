import { v7 as uuidv7 } from 'uuid';

import type { schema } from '@opensales/db';

export type TemuOrderListItem = Record<string, unknown>;
export type TemuOrderDetail = Record<string, unknown>;
export type TemuShippingInfo = Record<string, unknown>;

type OrderStatus = schema.Order['status'];

const STATUS_MAP: Record<number, OrderStatus> = {
  1: 'new',
  2: 'processing',
  3: 'cancelled',
  4: 'shipped',
  5: 'delivered',
};

/**
 * Collect skuExtCode values from goodsList — used by the sync service to
 * resolve productIdBySku in a single DB roundtrip per order.
 */
export function collectSkuCandidatesFromDetail(detail: TemuOrderDetail): string[] {
  const out: string[] = [];
  const goodsList = detail.goodsList as Record<string, unknown>[] | undefined;
  for (const item of goodsList ?? []) {
    const sku = item.skuExtCode as string | undefined;
    if (sku) out.push(sku);
  }
  return out;
}

export function mapTemuOrderToDb(
  listItem: TemuOrderListItem,
  detail: TemuOrderDetail,
  shipping: TemuShippingInfo,
  pluginId: string,
  currency: string,
  productIdBySku: Map<string, string>,
): { order: typeof schema.orders.$inferInsert; items: (typeof schema.orderItems.$inferInsert)[] } {
  const status = STATUS_MAP[(listItem.status as number) ?? 0] ?? 'new';

  const rawAmount = (detail.orderAmount ?? listItem.orderAmount ?? 0) as number;
  const totalAmountMinor = BigInt(Math.round(rawAmount * 100));

  const customerName =
    (shipping.receiptName as string | undefined) ??
    (detail.buyerName as string | undefined) ??
    null;
  const customerEmail =
    (shipping.mail as string | undefined) ?? (detail.buyerEmail as string | undefined) ?? null;
  const customerPhone = (shipping.mobile as string | undefined) ?? null;

  const shippingAddress: schema.OrderAddress = {
    name: shipping.receiptName as string | undefined,
    street: shipping.addressLine1 as string | undefined,
    street2: shipping.addressLine2 as string | undefined,
    city: shipping.regionName3 as string | undefined,
    county: shipping.regionName2 as string | undefined,
    country: shipping.regionName1 as string | undefined,
    zip: shipping.postCode as string | undefined,
    phone: shipping.mobile as string | undefined,
  };

  const placedAt = listItem.createTime
    ? new Date((listItem.createTime as number) * 1000)
    : new Date();

  const orderId = uuidv7();

  const order: typeof schema.orders.$inferInsert = {
    id: orderId,
    pluginId,
    externalId: listItem.parentOrderSn as string,
    status,
    totalAmountMinor,
    totalCurrency: currency,
    customerName,
    customerEmail,
    customerPhone,
    billingAddress: {},
    shippingAddress,
    awbOutgoing: null,
    placedAt,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const goodsList = (detail.goodsList as Record<string, unknown>[] | undefined) ?? [];
  const items: (typeof schema.orderItems.$inferInsert)[] = goodsList.map((g) => {
    const skuExtCode = (g.skuExtCode as string | undefined) ?? '';
    const goodsName = (g.goodsName as string | undefined) ?? skuExtCode;
    const quantity = (g.quantity as number | undefined) ?? 1;
    const price = (g.price as number | undefined) ?? 0;
    const unitPriceAmountMinor = BigInt(Math.round(price * 100));
    const productId = skuExtCode ? (productIdBySku.get(skuExtCode) ?? null) : null;

    return {
      id: uuidv7(),
      orderId,
      productId,
      sku: skuExtCode,
      name: goodsName,
      quantity,
      unitPriceAmountMinor,
      unitPriceCurrency: currency,
    };
  });

  return { order, items };
}
