import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const updateOrderStatusSchema = z.object({
  status: z.enum([
    'processing',
    'packed',
    'shipped',
    'delivered',
    'returned',
    'cancelled',
    'refunded',
  ]),
});

export class UpdateOrderStatusDto extends createZodDto(updateOrderStatusSchema) {}
