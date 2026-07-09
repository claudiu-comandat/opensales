import { z } from 'zod';

// ─── Batch update (stoc / preț / enabled) ─────────────────────────────────────
// Skroutz Products API: POST /merchants/products/batch
// Prețul este integer în cenți (ex. 2999 = €29.99) — exact ca amount_minor.

export const VariationUpdateSchema = z.object({
  variation_id: z.string().min(1),
  quantity: z.number().int().min(0),
  enabled: z.boolean(),
  /** Preț în cenți (integer). */
  price: z.number().int().min(0),
});

export type VariationUpdate = z.infer<typeof VariationUpdateSchema>;

export const ProductUpdateSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().min(0),
  enabled: z.boolean(),
  /** Preț în cenți (integer). */
  price: z.number().int().min(0),
  variations: z.array(VariationUpdateSchema).optional(),
});

export type ProductUpdate = z.infer<typeof ProductUpdateSchema>;

// Skroutz acceptă max 500 produse per request.
export const UpdateInventoryInputSchema = z.object({
  data: z.array(ProductUpdateSchema).min(1).max(500),
});

export type UpdateInventoryInput = z.infer<typeof UpdateInventoryInputSchema>;

export const BatchErrorSchema = z.object({
  code: z.string(),
  messages: z.array(z.string()),
});

export const UpdateInventoryOutputSchema = z.object({
  success: z.boolean(),
  /** Numărul de produse trimise în batch. */
  count: z.number().int().min(0),
  /** Erorile returnate de Skroutz (gol când totul a reușit). */
  errors: z.array(BatchErrorSchema).optional(),
});

export type UpdateInventoryOutput = z.infer<typeof UpdateInventoryOutputSchema>;

// ─── setOfferActive — focalizat pe activare/dezactivare ofertă ────────────────
// Trimite un singur produs (sau variație) cu enabled=true/false; păstrează
// quantity/price obligatorii cerute de API.

export const SetOfferActiveInputSchema = z.object({
  product_id: z.string().min(1),
  enabled: z.boolean(),
  quantity: z.number().int().min(0),
  /** Preț în cenți (integer). */
  price: z.number().int().min(0),
});

export type SetOfferActiveInput = z.infer<typeof SetOfferActiveInputSchema>;

// ─── generateProductFeed — postare produse (XML Feed) ─────────────────────────
// Products API NU creează produse noi. Crearea/postarea catalogului se face
// exclusiv prin XML Feed. Aici generăm conținutul XML conform specificației.

export const FeedVariationSchema = z.object({
  variationId: z.string().min(1).max(200),
  availability: z.string().min(1).max(100),
  size: z.string().min(1).max(64),
  quantity: z.number().int().min(0).max(10_000_000),
  /** Preț în cenți (integer); convertit la euro cu 2 zecimale în XML. */
  priceMinor: z.number().int().min(0).optional(),
  link: z.string().url().optional(),
  mpn: z.string().max(80).optional(),
  ean: z.string().max(80).optional(),
  outlet: z.enum(['Y', 'N']).optional(),
});

export type FeedVariation = z.infer<typeof FeedVariationSchema>;

export const FeedProductSchema = z.object({
  uid: z.string().min(1).max(200),
  name: z.string().min(1).max(300),
  link: z.string().url().max(1000),
  image: z.string().max(400),
  additionalImages: z.array(z.string().url().max(400)).max(15).optional(),
  category: z.string().min(1).max(250),
  /** Preț cu TVA în cenți (integer); convertit la euro cu 2 zecimale în XML. */
  priceMinor: z.number().int().min(0),
  /** Cotă TVA (procent, 0–100). */
  vat: z.number().min(0).max(100),
  availability: z.string().min(1).max(60),
  manufacturer: z.string().min(1).max(100),
  mpn: z.string().min(1).max(80),
  ean: z.string().max(13).optional(),
  size: z.string().max(500).optional(),
  weight: z.number().min(0).optional(),
  color: z.string().max(100).optional(),
  description: z.string().min(1).max(10_000),
  quantity: z.number().int().min(0).max(10_000_000),
  variations: z.array(FeedVariationSchema).optional(),
});

export type FeedProduct = z.infer<typeof FeedProductSchema>;

export const GenerateProductFeedInputSchema = z.object({
  /** Data creării feed-ului (folosită de Skroutz pentru a detecta feed-uri vechi). */
  createdAt: z.string().optional(),
  products: z.array(FeedProductSchema).min(1),
});

export type GenerateProductFeedInput = z.infer<typeof GenerateProductFeedInputSchema>;

export const GenerateProductFeedOutputSchema = z.object({
  /** Conținutul XML al feed-ului, gata de servit către SkroutzBot. */
  xml: z.string(),
  /** Numărul de produse incluse. */
  productCount: z.number().int().min(0),
});

export type GenerateProductFeedOutput = z.infer<typeof GenerateProductFeedOutputSchema>;
