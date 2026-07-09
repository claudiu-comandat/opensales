import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listProductsSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  /** Filtrează produsele care au o ofertă pe acest marketplace (ex. 'emag-ro', 'trendyol-bg'). */
  marketplace: z.string().optional(),
  /** Filtrează produsele care au cel puțin o ofertă cu statusul dat (ex. 'rejected'). */
  listingStatus: z.string().optional(),
  /** Când true, ascunde produsele cu stoc 0 de mai mult de 14 zile. */
  relevantOnly: z.coerce.boolean().optional(),
});

export class ListProductsDto extends createZodDto(listProductsSchema) {}
