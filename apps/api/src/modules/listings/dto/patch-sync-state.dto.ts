import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const patchSyncStateSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  price_amount_minor: z
    .union([z.string(), z.number(), z.bigint()])
    .transform((v) => String(v))
    .optional(),
  price_currency: z.string().length(3).optional(),
  stock_quantity: z.number().int().nonnegative().optional(),
  characteristics: z.array(z.unknown()).optional(),
  temu: z
    .object({
      specDetails: z.array(z.unknown()).optional(),
      goodsServicePromise: z
        .object({
          costTemplateId: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type PatchSyncStateDto = z.infer<typeof patchSyncStateSchema>;

export class PatchSyncStateDtoClass extends createZodDto(patchSyncStateSchema) {}
