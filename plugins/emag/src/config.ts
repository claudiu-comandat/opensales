import { z } from 'zod';

/**
 * eMAG platforms — fiecare cu URL propriu de marketplace API.
 * Doc: secțiunea 1.1 Conventions, ediția 4.5.1.
 */
export const EMAG_PLATFORMS = {
  'emag-ro': {
    label: 'eMAG Romania',
    apiUrl: 'https://marketplace-api.emag.ro/api-3',
    siteUrl: 'https://marketplace.emag.ro',
    locale: 'ro_RO',
    defaultCurrency: 'RON',
  },
  'emag-bg': {
    label: 'eMAG Bulgaria',
    apiUrl: 'https://marketplace-api.emag.bg/api-3',
    siteUrl: 'https://marketplace.emag.bg',
    locale: 'bg_BG',
    defaultCurrency: 'BGN',
  },
  'emag-hu': {
    label: 'eMAG Hungary',
    apiUrl: 'https://marketplace-api.emag.hu/api-3',
    siteUrl: 'https://marketplace.emag.hu',
    locale: 'hu_HU',
    defaultCurrency: 'HUF',
  },
  'fd-ro': {
    label: 'FashionDays Romania',
    apiUrl: 'https://marketplace-ro-api.fashiondays.com/api-3',
    siteUrl: 'https://marketplace-ro.fashiondays.com',
    locale: 'ro_RO',
    defaultCurrency: 'RON',
  },
  'fd-bg': {
    label: 'FashionDays Bulgaria',
    apiUrl: 'https://marketplace-bg-api.fashiondays.com/api-3',
    siteUrl: 'https://marketplace-bg.fashiondays.com',
    locale: 'bg_BG',
    defaultCurrency: 'BGN',
  },
} as const;

export type EmagPlatformKey = keyof typeof EMAG_PLATFORMS;
export type EmagPlatformConfig = (typeof EMAG_PLATFORMS)[EmagPlatformKey];

/**
 * Secret schema validat la onConfigure. Stocat criptat în /plugins/emag/data/.
 *
 * `username` și `password` — credențialele API furnizate de eMAG.
 *   Sunt aceleași pentru toate platformele active (emag-ro/bg/hu/fd-ro/fd-bg).
 *   Pentru cont test/staging, eMAG furnizează separat un username dedicat.
 *
 * Platformele active se configurează prin `enabledMarketplaces` în secțiunea de config.
 */
export const SecretSchema = z.object({
  username: z.string().min(1, 'Username eMAG obligatoriu'),
  password: z.string().min(1, 'Password eMAG obligatoriu'),
});

export type EmagSecrets = z.infer<typeof SecretSchema>;

export function resolveApiUrl(platform: EmagPlatformKey): string {
  return EMAG_PLATFORMS[platform].apiUrl;
}

export function resolveDefaultCurrency(platform: EmagPlatformKey): string {
  return EMAG_PLATFORMS[platform].defaultCurrency;
}
