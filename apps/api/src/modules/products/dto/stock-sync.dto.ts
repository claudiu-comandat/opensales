import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const stockSyncSchema = z.object({
  // ponytail: plafon generos peste dimensiunea reală a catalogului (~20k produse) —
  // doar ca să nu accepte un payload nemărginit de la un feed extern stricat.
  result: z
    .array(
      z.object({
        sku: z.string().min(1),
        quantity: z.preprocess(
          (v) => (typeof v === 'string' ? parseInt(v, 10) : v),
          z.number().int().nonnegative(),
        ),
      }),
    )
    .max(100_000),
});

export class StockSyncDto extends createZodDto(stockSyncSchema) {}
