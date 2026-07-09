import { z } from 'zod';

/**
 * Preț OpenSales — întotdeauna `amountMinor` (bigint, în subunități) + `currency`
 * (ISO-4217). OLX cere `value` în unități MAJORE (number), deci conversia se face
 * la graniță (vezi money.ts). NICIODATĂ float pentru stocare.
 */
export const moneySchema = z.object({
  amountMinor: z.bigint(),
  currency: z.string().length(3),
});
export type Money = z.infer<typeof moneySchema>;

/** Preț OLX brut (unități majore). Spec: advert.price. */
export const olxPriceSchema = z.object({
  value: z.number(),
  currency: z.string(),
  negotiable: z.boolean().optional(),
  trade: z.boolean().optional(),
  budget: z.boolean().optional(),
});
export type OlxPrice = z.infer<typeof olxPriceSchema>;

/** Atribut trimis pe un advert. Spec: advert.attributes[]. */
export const advertAttributeSchema = z.object({
  code: z.string(),
  value: z.string().nullable().optional(),
  values: z.array(z.string()).nullable().optional(),
});
export type AdvertAttribute = z.infer<typeof advertAttributeSchema>;

export const advertLocationSchema = z.object({
  city_id: z.number(),
  district_id: z.number().nullable().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const advertContactSchema = z.object({
  name: z.string(),
  phone: z.string().optional(),
});

/**
 * Input pentru createAdvert — modelul OpenSales (preț ca Money). Mapăm către
 * payload-ul OLX în actions.ts.
 */
export const createAdvertInputSchema = z.object({
  title: z.string().min(16).max(150),
  description: z.string().min(80).max(9000),
  categoryId: z.number(),
  advertiserType: z.enum(['private', 'business']),
  contact: advertContactSchema,
  location: advertLocationSchema,
  attributes: z.array(advertAttributeSchema).optional(),
  price: moneySchema.optional(),
  images: z.array(z.object({ url: z.string().url() })).optional(),
  externalId: z.string().optional(),
  externalUrl: z.string().url().optional(),
  autoExtendEnabled: z.boolean().optional(),
});
export type CreateAdvertInput = z.infer<typeof createAdvertInputSchema>;

export const updateAdvertInputSchema = createAdvertInputSchema.partial().extend({
  advertId: z.number(),
});
export type UpdateAdvertInput = z.infer<typeof updateAdvertInputSchema>;

/** Advert returnat de OLX. Acceptăm permisiv câmpurile dincolo de cele cheie. */
export const olxAdvertSchema = z
  .object({
    id: z.number(),
    status: z.string().optional(),
    url: z.string().optional(),
    title: z.string().optional(),
    category_id: z.number().optional(),
    external_id: z.string().nullable().optional(),
    price: olxPriceSchema.nullable().optional(),
    valid_to: z.string().optional(),
  })
  .passthrough();
export type OlxAdvert = z.infer<typeof olxAdvertSchema>;

export const advertEnvelopeSchema = z.object({ data: olxAdvertSchema });
export type AdvertEnvelope = z.infer<typeof advertEnvelopeSchema>;

export const deleteAdvertInputSchema = z.object({ advertId: z.number() });
export type DeleteAdvertInput = z.infer<typeof deleteAdvertInputSchema>;

export const syncAdvertsInputSchema = z.object({
  offset: z.number().optional(),
  limit: z.number().optional(),
  externalId: z.string().optional(),
  categoryIds: z.array(z.number()).optional(),
});
export type SyncAdvertsInput = z.infer<typeof syncAdvertsInputSchema>;

export const syncAdvertsOutputSchema = z.object({ adverts: z.array(olxAdvertSchema) });
export type SyncAdvertsOutput = z.infer<typeof syncAdvertsOutputSchema>;

/** Comenzi pe advert. Spec: POST /adverts/{id}/commands. */
export const advertCommandInputSchema = z
  .object({
    advertId: z.number(),
    command: z.enum(['activate', 'deactivate', 'finish', 'extend']),
    isSuccess: z.boolean().optional(),
  })
  .refine((v) => v.command !== 'deactivate' || typeof v.isSuccess === 'boolean', {
    message: 'isSuccess is required for the deactivate command',
    path: ['isSuccess'],
  });
export type AdvertCommandInput = z.infer<typeof advertCommandInputSchema>;
