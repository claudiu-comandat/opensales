import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { updateProductSchema } from './update-product.dto.js';

/**
 * Bulk PATCH /products — un array de produse, fiecare cu `id` + câmpurile de
 * actualizat (aceeași schemă parțială ca update-ul single). Max 1000/request
 * (limita bulk Trendyol; eMAG e împărțit intern în loturi de 50).
 */
export const bulkUpdateProductSchema = z.object({
  products: z
    .array(updateProductSchema.extend({ id: z.string().uuid() }))
    .min(1)
    .max(1000),
});

export class BulkUpdateProductDto extends createZodDto(bulkUpdateProductSchema) {}
