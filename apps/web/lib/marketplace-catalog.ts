export interface MarketplaceInfo {
  code: string;
  pluginPackage: string;
  label: string;
}

const EMAG = '@opensales-plugin/emag';
const TRENDYOL = '@opensales-plugin/trendyol';
const TEMU = '@opensales-plugin/temu';
const SKROUTZ = '@opensales-plugin/skroutz';

export const MARKETPLACES: readonly MarketplaceInfo[] = [
  { code: 'emag-ro', pluginPackage: EMAG, label: 'eMAG Romania' },
  { code: 'emag-bg', pluginPackage: EMAG, label: 'eMAG Bulgaria' },
  { code: 'emag-hu', pluginPackage: EMAG, label: 'eMAG Hungary' },
  { code: 'fd-ro', pluginPackage: EMAG, label: 'FashionDays Romania' },
  { code: 'fd-bg', pluginPackage: EMAG, label: 'FashionDays Bulgaria' },
  { code: 'trendyol-de', pluginPackage: TRENDYOL, label: 'Trendyol Germany' },
  { code: 'trendyol-sa', pluginPackage: TRENDYOL, label: 'Trendyol Saudi Arabia' },
  { code: 'trendyol-ae', pluginPackage: TRENDYOL, label: 'Trendyol UAE' },
  { code: 'trendyol-kw', pluginPackage: TRENDYOL, label: 'Trendyol Kuwait' },
  { code: 'trendyol-ro', pluginPackage: TRENDYOL, label: 'Trendyol Romania' },
  { code: 'trendyol-gr', pluginPackage: TRENDYOL, label: 'Trendyol Greece' },
  { code: 'trendyol-sk', pluginPackage: TRENDYOL, label: 'Trendyol Slovakia' },
  { code: 'trendyol-cz', pluginPackage: TRENDYOL, label: 'Trendyol Czechia' },
  { code: 'trendyol-bg', pluginPackage: TRENDYOL, label: 'Trendyol Bulgaria' },
  { code: 'temu-eu', pluginPackage: TEMU, label: 'Temu Europe' },
  { code: 'temu-us', pluginPackage: TEMU, label: 'Temu United States' },
  { code: 'temu-global', pluginPackage: TEMU, label: 'Temu Global' },
  { code: 'skroutz-gr', pluginPackage: SKROUTZ, label: 'Skroutz Greece' },
];

export function supportedMarketplacesForPackage(pluginPackage: string): MarketplaceInfo[] {
  return MARKETPLACES.filter((m) => m.pluginPackage === pluginPackage);
}

export function marketplaceLabel(code: string): string {
  return MARKETPLACES.find((m) => m.code === code)?.label ?? code;
}
