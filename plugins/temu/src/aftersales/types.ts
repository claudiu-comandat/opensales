import { z } from 'zod';

// ─── syncAftersales ───────────────────────────────────────────────────────────

export const SyncAftersalesInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(100).default(20),
  /** Status cerere retur. Omite pentru toate. */
  status: z.number().int().optional(),
  createTimeStart: z.number().int().optional(),
  createTimeEnd: z.number().int().optional(),
  updateTimeStart: z.number().int().optional(),
  updateTimeEnd: z.number().int().optional(),
});

export type SyncAftersalesInput = z.infer<typeof SyncAftersalesInputSchema>;

export const SyncAftersalesOutputSchema = z.object({
  aftersales: z.array(z.record(z.unknown())),
  total: z.number().optional(),
  page: z.number(),
  pageSize: z.number(),
});

export type SyncAftersalesOutput = z.infer<typeof SyncAftersalesOutputSchema>;

// ─── refundOrder ──────────────────────────────────────────────────────────────

export const RefundOrderInputSchema = z.object({
  /** Numărul comenzii parente */
  parentOrderSn: z.string().min(1),
  /** Lista de sub-comenzi pentru care se face rambursare */
  orderSnList: z.array(z.string()).min(1),
  /** Motivul rambursării */
  refundReason: z.string().optional(),
});

export type RefundOrderInput = z.infer<typeof RefundOrderInputSchema>;

export const RefundOrderOutputSchema = z.object({
  success: z.boolean(),
  refundSn: z.string().optional(),
});

export type RefundOrderOutput = z.infer<typeof RefundOrderOutputSchema>;
