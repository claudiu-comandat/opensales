import { Injectable } from '@nestjs/common';
import {
  SDK_API_GATEWAY_KEYS,
  type ListingUpsertInput,
  type ListingUpsertOutput,
  type OrderAwbInput,
  type OrderInvoiceInput,
  type OrderListInput,
  type OrderListOutput,
  type ProductListInput,
  type ProductListItem,
  type ProductListOutput,
  type ProductUpdateInput,
  type SdkApiClient,
  type StockAdjustInput,
  type StockAdjustOutput,
} from '@opensales/plugin-sdk';

import { PermissionGatewayService } from '../gateway/permission-gateway.service.js';

/**
 * Builds a per-plugin instance of the typed `SdkApiClient`.
 *
 * Each method delegates to `PermissionGatewayService.invoke`, which performs
 * the permission check and dispatches to the handler registered by the
 * relevant domain module. Domain-side handler registration is wired in a
 * follow-up task — this factory is purely the SDK-facing contract.
 */
@Injectable()
export class SdkApiFactory {
  constructor(private readonly gateway: PermissionGatewayService) {}

  build(pluginId: string): SdkApiClient {
    const invoke = <O>(key: string, input: unknown): Promise<O> =>
      this.gateway.invoke<O>(pluginId, key, input);

    const keys = SDK_API_GATEWAY_KEYS;

    return {
      products: {
        list: (input: ProductListInput) => invoke<ProductListOutput>(keys.products.list, input),
        get: (id: string) => invoke<ProductListItem | null>(keys.products.get, { id }),
        update: (id: string, partial: ProductUpdateInput) =>
          invoke<ProductListItem>(keys.products.update, { id, partial }),
      },
      stock: {
        adjust: (input: StockAdjustInput) => invoke<StockAdjustOutput>(keys.stock.adjust, input),
      },
      listings: {
        upsert: (input: ListingUpsertInput) =>
          invoke<ListingUpsertOutput>(keys.listings.upsert, input),
      },
      orders: {
        list: (input: OrderListInput) => invoke<OrderListOutput>(keys.orders.list, input),
        get: (id: string) => invoke<unknown>(keys.orders.get, { id }),
        updateStatus: (id: string, status: string) =>
          invoke<void>(keys.orders.updateStatus, { id, status }),
        updateAwbOutgoing: (id: string, awb: OrderAwbInput) =>
          invoke<void>(keys.orders.updateAwbOutgoing, { id, awb }),
        updateAwbReturn: (id: string, awb: OrderAwbInput) =>
          invoke<void>(keys.orders.updateAwbReturn, { id, awb }),
        updateInvoice: (id: string, invoice: OrderInvoiceInput) =>
          invoke<void>(keys.orders.updateInvoice, { id, invoice }),
        updateInvoiceStorno: (id: string, invoice: OrderInvoiceInput) =>
          invoke<void>(keys.orders.updateInvoiceStorno, { id, invoice }),
      },
    };
  }
}
