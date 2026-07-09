import {
  RefundOrderInputSchema,
  RefundOrderOutputSchema,
  SyncAftersalesInputSchema,
  SyncAftersalesOutputSchema,
} from './types.js';

import type { TemuClient } from '../client.js';

export interface AftersalesActionContext {
  client: TemuClient;
}

export const aftersalesActions = {
  syncAftersales: {
    description: 'Pull cererile de retur/aftersales din Temu.',
    input: SyncAftersalesInputSchema,
    output: SyncAftersalesOutputSchema,
    async handler(
      input: {
        page?: number;
        pageSize?: number;
        status?: number;
        createTimeStart?: number;
        createTimeEnd?: number;
        updateTimeStart?: number;
        updateTimeEnd?: number;
      },
      { client }: AftersalesActionContext,
    ) {
      const parsed = SyncAftersalesInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>('bg.aftersale.list.get', {
        data: {
          page: parsed.page,
          pageSize: parsed.pageSize,
          ...(parsed.status !== undefined && { status: parsed.status }),
          ...(parsed.createTimeStart !== undefined && { createTimeStart: parsed.createTimeStart }),
          ...(parsed.createTimeEnd !== undefined && { createTimeEnd: parsed.createTimeEnd }),
          ...(parsed.updateTimeStart !== undefined && { updateTimeStart: parsed.updateTimeStart }),
          ...(parsed.updateTimeEnd !== undefined && { updateTimeEnd: parsed.updateTimeEnd }),
        },
      });
      return {
        aftersales: (result.aftersaleList as Record<string, unknown>[]) ?? [],
        total: result.total as number | undefined,
        page: parsed.page,
        pageSize: parsed.pageSize,
      };
    },
  },

  refundOrder: {
    description: 'Inițiază rambursare pentru o comandă.',
    input: RefundOrderInputSchema,
    output: RefundOrderOutputSchema,
    async handler(
      input: { parentOrderSn: string; orderSnList: string[]; refundReason?: string },
      { client }: AftersalesActionContext,
    ) {
      const parsed = RefundOrderInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>('bg.aftersale.refund.apply', {
        data: {
          parentOrderSn: parsed.parentOrderSn,
          orderSnList: parsed.orderSnList,
          ...(parsed.refundReason !== undefined && { refundReason: parsed.refundReason }),
        },
      });
      return {
        success: true,
        refundSn: result.refundSn as string | undefined,
      };
    },
  },
} as const;

export type AftersalesActions = typeof aftersalesActions;
