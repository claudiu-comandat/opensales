import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const upsertListingSchema = z.object({
  productId: z.string().uuid(),
  pluginId: z.string().uuid(),
  externalListingId: z.string().min(1).max(255),
  platform: z.string().max(50).default(''),
  status: z.enum(['draft', 'active', 'paused', 'error']).optional(),
  syncState: z.record(z.unknown()).optional(),
});

export class UpsertListingDto extends createZodDto(upsertListingSchema) {}
