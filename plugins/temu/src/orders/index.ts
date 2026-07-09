import {
  GetOrderDetailInputSchema,
  GetOrderDetailOutputSchema,
  GetShippingInfoInputSchema,
  GetShippingInfoOutputSchema,
  SyncOrdersInputSchema,
  SyncOrdersOutputSchema,
} from './types.js';

import type { TemuClient } from '../client.js';

export interface OrderActionContext {
  client: TemuClient;
}

export const orderActions = {
  syncOrders: {
    description: 'Pull comenzile din Temu — bg.order.list.v2.get.',
    input: SyncOrdersInputSchema,
    output: SyncOrdersOutputSchema,
    async handler(
      input: {
        page?: number;
        pageSize?: number;
        status?: number;
        createTimeStart?: number;
        createTimeEnd?: number;
        updateTimeStart?: number;
        updateTimeEnd?: number;
        latestShipTimeStart?: number;
        latestShipTimeEnd?: number;
      },
      { client }: OrderActionContext,
    ) {
      const parsed = SyncOrdersInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>('bg.order.list.v2.get', {
        data: {
          page: parsed.page,
          pageSize: parsed.pageSize,
          ...(parsed.status !== undefined && { status: parsed.status }),
          ...(parsed.createTimeStart !== undefined && { createTimeStart: parsed.createTimeStart }),
          ...(parsed.createTimeEnd !== undefined && { createTimeEnd: parsed.createTimeEnd }),
          ...(parsed.updateTimeStart !== undefined && { updateTimeStart: parsed.updateTimeStart }),
          ...(parsed.updateTimeEnd !== undefined && { updateTimeEnd: parsed.updateTimeEnd }),
          ...(parsed.latestShipTimeStart !== undefined && {
            latestShipTimeStart: parsed.latestShipTimeStart,
          }),
          ...(parsed.latestShipTimeEnd !== undefined && {
            latestShipTimeEnd: parsed.latestShipTimeEnd,
          }),
        },
      });

      const orders = (result.orderInfoList as unknown[]) ?? [];
      return {
        orders: orders as Record<string, unknown>[],
        total: result.total as number | undefined,
        page: parsed.page,
        pageSize: parsed.pageSize,
      };
    },
  },

  getOrderDetail: {
    description: 'Detalii complete ale unei comenzi — bg.order.detail.v2.get.',
    input: GetOrderDetailInputSchema,
    output: GetOrderDetailOutputSchema,
    async handler(input: { parentOrderSn: string }, { client }: OrderActionContext) {
      const parsed = GetOrderDetailInputSchema.parse(input);
      return client.call<Record<string, unknown>>('bg.order.detail.v2.get', {
        data: { parentOrderSn: parsed.parentOrderSn },
      });
    },
  },

  getShippingInfo: {
    description: 'Adresa de livrare pentru o comandă — bg.order.shippinginfo.v2.get.',
    input: GetShippingInfoInputSchema,
    output: GetShippingInfoOutputSchema,
    async handler(input: { parentOrderSn: string }, { client }: OrderActionContext) {
      const parsed = GetShippingInfoInputSchema.parse(input);
      return client.call<Record<string, unknown>>('bg.order.shippinginfo.v2.get', {
        data: { parentOrderSn: parsed.parentOrderSn },
      });
    },
  },
} as const;

export type OrderActions = typeof orderActions;
