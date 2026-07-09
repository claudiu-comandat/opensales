import { z } from 'zod';

export const adjustStockSchema = z.object({
  productId: z.string().uuid(),
  delta: z
    .number()
    .int()
    .refine((n) => n !== 0, 'delta must be non-zero'),
  reason: z.string().max(200).optional(),
});

export type AdjustStockDto = z.infer<typeof adjustStockSchema>;
