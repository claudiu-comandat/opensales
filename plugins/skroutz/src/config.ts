import { z } from 'zod';

/**
 * Skroutz Marketplace (Smart Cart) — toate request-urile merg către un singur host.
 * Base URL: https://api.skroutz.gr
 *
 * Skroutz expune două token-uri separate, generate din pagini diferite ale
 * panoului de Merchant:
 *   - Orders API token  → Merchants > Services > Skroutz Marketplace
 *   - Products API token → Merchants > Products > Feed Updates
 * Ambele se trimit ca `Authorization: Bearer <token>`. Le stocăm separat ca
 * secrete și le selectăm în funcție de domeniul apelului.
 */
export const SKROUTZ_BASE_URL = 'https://api.skroutz.gr';

/**
 * Header `Accept` obligatoriu pe toate apelurile către API-ul Skroutz.
 * Versiunea API curentă este 3.0 (vendor media type).
 */
export const SKROUTZ_ACCEPT_HEADER = 'application/vnd.skroutz+json; version=3.0';

/**
 * Moneda pieței Skroutz este întotdeauna EUR (marketplace din Grecia).
 * Prețurile din Products API sunt în cenți (integer), exact ca `amount_minor`.
 */
export const SKROUTZ_CURRENCY = 'EUR';

/** Limita maximă de produse per request batch (Products API). */
export const SKROUTZ_BATCH_MAX = 500;

/**
 * Secret schema validat la `onConfigure`.
 *
 * `ordersToken`   — token pentru Orders API (accept/reject/upload invoice/etc.).
 * `productsToken` — token pentru Products API (batch update stoc/preț/enabled).
 * `webhookSecret` — secret opțional folosit la verificarea cererilor de webhook
 *                   (Skroutz nu semnează payload-ul; folosim un secret partajat
 *                   în URL/header pentru a respinge cererile neautorizate).
 */
export const SecretSchema = z.object({
  ordersToken: z.string().min(1, 'Skroutz ordersToken obligatoriu').optional(),
  productsToken: z.string().min(1, 'Skroutz productsToken obligatoriu').optional(),
  webhookSecret: z.string().min(1).optional(),
});

export type SkroutzSecrets = z.infer<typeof SecretSchema>;
