import { z } from 'zod';

/**
 * Trendyol International Marketplace storefronts.
 * storeFrontCode este trimis ca Header în fiecare request.
 * Doc: Section 3 — Regions & Storefront Codes
 */
export const TRENDYOL_STOREFRONTS = {
  DE: { label: 'Germany (DACH)', region: 'DACH', defaultCurrency: 'EUR' },
  SA: { label: 'Saudi Arabia (Gulf)', region: 'GULF', defaultCurrency: 'SAR' },
  AE: { label: 'United Arab Emirates (Gulf)', region: 'GULF', defaultCurrency: 'AED' },
  KW: { label: 'Kuwait (Gulf)', region: 'GULF', defaultCurrency: 'KWD' },
  RO: { label: 'Romania (CEE)', region: 'CEE', defaultCurrency: 'RON' },
  GR: { label: 'Greece (CEE)', region: 'CEE', defaultCurrency: 'EUR' },
  SK: { label: 'Slovakia (CEE)', region: 'CEE', defaultCurrency: 'EUR' },
  CZ: { label: 'Czechia (CEE)', region: 'CEE', defaultCurrency: 'CZK' },
  BG: { label: 'Bulgaria (CEE)', region: 'CEE', defaultCurrency: 'BGN' },
} as const;

export type TrendyolStoreFrontCode = keyof typeof TRENDYOL_STOREFRONTS;

/**
 * Secret schema validat la onConfigure.
 *
 * `sellerId`      — ID-ul vânzătorului (apare în toate URL-urile).
 * `apiKey`        — API Key din Seller Panel > Account Details > Integration Details.
 * `apiSecretKey`  — API Secret Key din același loc.
 * `userAgent`     — Format: "{sellerId} - {IntegrationCompanyName}". Obligatoriu (403 fără el).
 * `stage`         — Dacă true, folosește stageapigw.trendyol.com.
 *
 * Storefront-ul activ se configurează prin `enabledMarketplaces` în secțiunea de config.
 */
export const SecretSchema = z.object({
  sellerId: z.string().min(1, 'sellerId Trendyol obligatoriu'),
  apiKey: z.string().min(1, 'apiKey Trendyol obligatoriu'),
  apiSecretKey: z.string().min(1, 'apiSecretKey Trendyol obligatoriu'),
  userAgent: z.string().min(1, 'userAgent Trendyol obligatoriu (ex: "1234 - OpenSales")'),
  stage: z.boolean().default(false),
});

export type TrendyolSecrets = z.infer<typeof SecretSchema>;

export function resolveBaseUrl(stage: boolean): string {
  return stage ? 'https://stageapigw.trendyol.com' : 'https://apigw.trendyol.com';
}

export function resolveDefaultCurrency(storeFrontCode: TrendyolStoreFrontCode): string {
  return TRENDYOL_STOREFRONTS[storeFrontCode].defaultCurrency;
}
