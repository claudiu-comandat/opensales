import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createOrderSchema = z.object({
  externalId: z.string().min(1).optional(),
  pluginId: z.string().uuid().nullable().optional(),
  totalAmountMinor: z.coerce.bigint().nonnegative(),
  totalCurrency: z.string().length(3).toUpperCase(),
  customerEmail: z.string().email().optional(),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  billingAddress: z.record(z.unknown()).default({}),
  shippingAddress: z.record(z.unknown()).default({}),
  deliveryMode: z.enum(['courier', 'pickup']).optional(),
  paymentStatus: z.string().optional(),
  placedAt: z.coerce.date(),
  items: z
    .array(
      z.object({
        productId: z.string().uuid().nullable(),
        sku: z.string().min(1),
        name: z.string().min(1),
        quantity: z.number().int().positive(),
        unitPriceAmountMinor: z.coerce.bigint().nonnegative(),
        unitPriceCurrency: z.string().length(3).toUpperCase(),
        attributes: z.record(z.unknown()).default({}),
      }),
    )
    .min(1),
});

export class CreateOrderDto extends createZodDto(createOrderSchema) {}
