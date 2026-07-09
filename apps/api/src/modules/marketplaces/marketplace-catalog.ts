export const EMAG_PACKAGE = '@opensales-plugin/emag';
export const TRENDYOL_PACKAGE = '@opensales-plugin/trendyol';
export const TEMU_PACKAGE = '@opensales-plugin/temu';
export const SKROUTZ_PACKAGE = '@opensales-plugin/skroutz';

export interface MarketplaceInfo {
  code: string;
  pluginPackage: string;
  label: string;
  currency: string;
}

const ENTRIES: readonly MarketplaceInfo[] = [
  { code: 'emag-ro', pluginPackage: EMAG_PACKAGE, label: 'eMAG Romania', currency: 'RON' },
  { code: 'emag-bg', pluginPackage: EMAG_PACKAGE, label: 'eMAG Bulgaria', currency: 'EUR' },
  { code: 'emag-hu', pluginPackage: EMAG_PACKAGE, label: 'eMAG Hungary', currency: 'HUF' },
  { code: 'fd-ro', pluginPackage: EMAG_PACKAGE, label: 'FashionDays Romania', currency: 'RON' },
  { code: 'fd-bg', pluginPackage: EMAG_PACKAGE, label: 'FashionDays Bulgaria', currency: 'BGN' },
  {
    code: 'trendyol-de',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Germany',
    currency: 'EUR',
  },
  {
    code: 'trendyol-sa',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Saudi Arabia',
    currency: 'SAR',
  },
  { code: 'trendyol-ae', pluginPackage: TRENDYOL_PACKAGE, label: 'Trendyol UAE', currency: 'AED' },
  {
    code: 'trendyol-kw',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Kuwait',
    currency: 'KWD',
  },
  {
    code: 'trendyol-ro',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Romania',
    currency: 'RON',
  },
  {
    code: 'trendyol-gr',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Greece',
    currency: 'EUR',
  },
  {
    code: 'trendyol-sk',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Slovakia',
    currency: 'EUR',
  },
  {
    code: 'trendyol-cz',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Czechia',
    currency: 'CZK',
  },
  {
    code: 'trendyol-bg',
    pluginPackage: TRENDYOL_PACKAGE,
    label: 'Trendyol Bulgaria',
    currency: 'BGN',
  },
  { code: 'temu-eu', pluginPackage: TEMU_PACKAGE, label: 'Temu Europe', currency: 'EUR' },
  { code: 'temu-us', pluginPackage: TEMU_PACKAGE, label: 'Temu United States', currency: 'USD' },
  { code: 'temu-global', pluginPackage: TEMU_PACKAGE, label: 'Temu Global', currency: 'GBP' },
  { code: 'skroutz-gr', pluginPackage: SKROUTZ_PACKAGE, label: 'Skroutz Greece', currency: 'EUR' },
];

const BY_CODE = new Map<string, MarketplaceInfo>(ENTRIES.map((e) => [e.code, e]));

export function getMarketplace(code: string): MarketplaceInfo | undefined {
  return BY_CODE.get(code);
}

export function isKnownMarketplace(code: string): boolean {
  return BY_CODE.has(code);
}

export function pluginPackageForMarketplace(code: string): string | undefined {
  return BY_CODE.get(code)?.pluginPackage;
}

export function marketplaceCurrency(code: string): string | undefined {
  return BY_CODE.get(code)?.currency;
}

export function supportedMarketplacesForPackage(pluginPackage: string): MarketplaceInfo[] {
  return ENTRIES.filter((e) => e.pluginPackage === pluginPackage);
}

export function allMarketplaces(): MarketplaceInfo[] {
  return [...ENTRIES];
}

/** Trendyol storefront header value for a marketplace code (trendyol-ro -> RO). */
export function trendyolStorefrontFor(code: string): string | undefined {
  const prefix = 'trendyol-';
  if (!code.startsWith(prefix)) return undefined;
  return code.slice(prefix.length).toUpperCase();
}
