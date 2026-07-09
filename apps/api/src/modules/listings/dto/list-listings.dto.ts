import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listListingsSchema = z.object({
  productId: z.string().uuid().optional(),
  pluginId: z.string().uuid().optional(),
  status: z.enum(['draft', 'active', 'pending_approval', 'paused', 'rejected', 'error']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export class ListListingsDto extends createZodDto(listListingsSchema) {}
