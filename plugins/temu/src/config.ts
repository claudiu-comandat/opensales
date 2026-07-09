import { z } from 'zod';

/**
 * Temu platform regions — fiecare cu URL de API și monedă implicită.
 * Docs: Self-developed Application for Sellers → API Request URLs
 */
export const TEMU_PLATFORMS = {
  'temu-eu': {
    label: 'Temu Europe',
    apiUrl: 'https://openapi-b-eu.temu.com/openapi/router',
    siteUrl: 'https://seller.temu.com',
    locale: 'en_EU',
    defaultCurrency: 'EUR',
  },
  'temu-us': {
    label: 'Temu United States',
    apiUrl: 'https://openapi-b-us.temu.com/openapi/router',
    siteUrl: 'https://seller.temu.com',
    locale: 'en_US',
    defaultCurrency: 'USD',
  },
  'temu-global': {
    label: 'Temu Global',
    apiUrl: 'https://openapi-b-global.temu.com/openapi/router',
    siteUrl: 'https://seller.temu.com',
    locale: 'en_GB',
    defaultCurrency: 'GBP',
  },
} as const;

export type TemuPlatformKey = keyof typeof TEMU_PLATFORMS;
export type TemuPlatformConfig = (typeof TEMU_PLATFORMS)[TemuPlatformKey];

/**
 * Secret schema validat la onConfigure.
 *
 * `platform`     — codul regiunii (temu-eu / temu-us / temu-global).
 * `appKey`       — application key din Temu Partner Platform.
 * `appSecret`    — application secret, folosit la semnarea requesturilor (URL param).
 * `accessToken`  — OAuth token obținut după autorizarea vânzătorului.
 *                  Poate fi actualizat ulterior prin acțiunea createAccessToken.
 */
export const SecretSchema = z.object({
  platform: z.enum(Object.keys(TEMU_PLATFORMS) as [TemuPlatformKey, ...TemuPlatformKey[]]),
  appKey: z.string().min(1, 'appKey Temu obligatoriu'),
  appSecret: z.string().min(1, 'appSecret Temu obligatoriu'),
  accessToken: z.string().min(1, 'accessToken Temu obligatoriu'),
});

export type TemuSecrets = z.infer<typeof SecretSchema>;

export function resolveApiUrl(platform: TemuPlatformKey): string {
  return TEMU_PLATFORMS[platform].apiUrl;
}

export function resolveDefaultCurrency(platform: TemuPlatformKey): string {
  return TEMU_PLATFORMS[platform].defaultCurrency;
}
