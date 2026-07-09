import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createProductSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(255),
  description: z.string().max(10_000).optional().nullable(),
  priceAmountMinor: z.coerce.bigint().nonnegative(),
  priceCurrency: z.string().length(3).toUpperCase(),
  stockQuantity: z.number().int().nonnegative().default(0),
  images: z.array(z.object({ url: z.string().url(), alt: z.string().optional() })).default([]),
  attributes: z.record(z.unknown()).default({}),
  isActive: z.boolean().default(true),
  brand: z.string().max(255).optional().nullable(),
  ean: z.string().max(64).optional().nullable(),
  vatRate: z.number().int().min(0).max(100).optional().nullable(),
  purchasePriceAmountMinor: z.coerce.bigint().nonnegative().optional().nullable(),
  fullPriceAmountMinor: z.coerce.bigint().nonnegative().optional().nullable(),
  weightGrams: z.number().int().nonnegative().optional().nullable(),
  heightMm: z.number().int().nonnegative().optional().nullable(),
  widthMm: z.number().int().nonnegative().optional().nullable(),
  lengthMm: z.number().int().nonnegative().optional().nullable(),
  warrantyMonths: z.number().int().min(0).max(600).optional().nullable(),
  handlingTimeDays: z.number().int().min(0).max(30).optional().nullable(),
  numberOfPackages: z.number().int().min(1).max(99).optional().nullable(),
});

export class CreateProductDto extends createZodDto(createProductSchema) {}
