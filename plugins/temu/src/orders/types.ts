import { z } from 'zod';

// ─── syncOrders ───────────────────────────────────────────────────────────────

export const SyncOrdersInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  status: z.number().int().optional(),
  createTimeStart: z.number().int().optional(),
  createTimeEnd: z.number().int().optional(),
  updateTimeStart: z.number().int().optional(),
  updateTimeEnd: z.number().int().optional(),
  latestShipTimeStart: z.number().int().optional(),
  latestShipTimeEnd: z.number().int().optional(),
});

export type SyncOrdersInput = z.infer<typeof SyncOrdersInputSchema>;

export const SyncOrdersOutputSchema = z.object({
  orders: z.array(z.record(z.unknown())),
  total: z.number().optional(),
  page: z.number(),
  pageSize: z.number(),
});

export type SyncOrdersOutput = z.infer<typeof SyncOrdersOutputSchema>;

// ─── getOrderDetail ───────────────────────────────────────────────────────────

export const GetOrderDetailInputSchema = z.object({
  parentOrderSn: z.string().min(1),
});

export type GetOrderDetailInput = z.infer<typeof GetOrderDetailInputSchema>;

export const GetOrderDetailOutputSchema = z.record(z.unknown());

export type GetOrderDetailOutput = z.infer<typeof GetOrderDetailOutputSchema>;

// ─── getShippingInfo ──────────────────────────────────────────────────────────

export const GetShippingInfoInputSchema = z.object({
  parentOrderSn: z.string().min(1),
});

export type GetShippingInfoInput = z.infer<typeof GetShippingInfoInputSchema>;

export const GetShippingInfoOutputSchema = z.record(z.unknown());

export type GetShippingInfoOutput = z.infer<typeof GetShippingInfoOutputSchema>;
