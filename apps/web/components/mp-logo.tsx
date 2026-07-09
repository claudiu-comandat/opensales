import type { ReactElement } from 'react';

interface MPLogoProps {
  name: string;
  size?: number;
  className?: string;
  logoDataUri?: string;
}

interface LogoConfig {
  bg: string;
  text: string;
  fsFactor: number;
  fw: number;
  fill: string;
}

/**
 * Real brand logos shipped as SVG files in `/public/logos`.
 * `src` is the public path; `aspect` = intrinsic width / height, used to keep
 * the wordmark un-distorted while pinning its height to `size`.
 */
interface BrandLogo {
  src: string;
  aspect: number;
}

const BRAND_LOGOS: Record<string, BrandLogo> = {
  emag: { src: '/logos/emag.svg', aspect: 500 / 133 },
  trendyol: { src: '/logos/trendyol.svg', aspect: 111 / 45 },
  temu: { src: '/logos/temu.svg', aspect: 68.38 / 16.47 },
  olx: { src: '/logos/olx.svg', aspect: 98 / 56 },
  fashion: { src: '/logos/fashion.svg', aspect: 185.5 / 183.7 },
  smartbill: { src: '/logos/smartbill.svg', aspect: 566 / 150 },
};

const LOGO_MAP: Record<string, LogoConfig> = {
  emag: { bg: '#E11D1D', text: 'e', fsFactor: 0.6, fw: 800, fill: '#fff' },
  trendyol: { bg: '#F27A1A', text: 'T', fsFactor: 0.54, fw: 700, fill: '#fff' },
  temu: { bg: '#FF6600', text: 'T', fsFactor: 0.54, fw: 700, fill: '#fff' },
  altex: { bg: '#E60012', text: 'A', fsFactor: 0.54, fw: 700, fill: '#fff' },
  fashion: { bg: '#222222', text: 'FD', fsFactor: 0.37, fw: 700, fill: '#fff' },
  olx: { bg: '#3DB54A', text: 'OLX', fsFactor: 0.33, fw: 800, fill: '#fff' },
  skroutz: { bg: '#F37021', text: 'S', fsFactor: 0.54, fw: 800, fill: '#fff' },
  shopify: { bg: '#5E8E3E', text: 'S', fsFactor: 0.54, fw: 700, fill: '#fff' },
  amazon: { bg: '#232F3E', text: 'a', fsFactor: 0.58, fw: 700, fill: '#FF9900' },
  cel: { bg: '#003DA5', text: 'cel', fsFactor: 0.34, fw: 700, fill: '#fff' },
  pcgarage: { bg: '#1E3A8A', text: 'PC', fsFactor: 0.37, fw: 700, fill: '#fff' },
  easysales: { bg: '#2F47E0', text: 'ES', fsFactor: 0.37, fw: 700, fill: '#fff' },
  baselinker: { bg: '#111111', text: 'BL', fsFactor: 0.37, fw: 700, fill: '#fff' },
  manual: { bg: '#4A4F5C', text: '·', fsFactor: 0.6, fw: 700, fill: '#fff' },
};

/** Derives short marketplace name from a plugin package string.
 *  '@opensales-plugin/emag' → 'emag' */
export function packageToLogoName(pkg: string): string {
  const match = /@opensales-plugin\/(.+)/.exec(pkg);
  return match?.[1] ?? pkg;
}

const FALLBACK_LOGO: LogoConfig = {
  bg: '#4A4F5C',
  text: '·',
  fsFactor: 0.6,
  fw: 700,
  fill: '#fff',
};

/**
 * Marketplace logo. Renders the real brand SVG when one exists, pinned to
 * `size` in height. Priority: logoDataUri (from plugin manifest, served
 * inline) → BRAND_LOGOS (static public assets) → colored initial fallback.
 */
export function MPLogo({
  name,
  size = 20,
  className = '',
  logoDataUri,
}: MPLogoProps): ReactElement {
  if (logoDataUri) {
    return (
      <img
        src={logoDataUri}
        alt={name}
        height={size}
        className={className}
        style={{
          height: size,
          maxWidth: size * 4,
          objectFit: 'contain',
          flexShrink: 0,
          display: 'inline-block',
          verticalAlign: 'middle',
        }}
      />
    );
  }

  const brand = BRAND_LOGOS[name];
  if (brand) {
    return (
      <img
        src={brand.src}
        alt={name}
        height={size}
        width={Math.round(size * brand.aspect)}
        className={className}
        style={{
          height: size,
          width: Math.round(size * brand.aspect),
          objectFit: 'contain',
          flexShrink: 0,
          display: 'inline-block',
          verticalAlign: 'middle',
        }}
      />
    );
  }

  const m = LOGO_MAP[name] ?? FALLBACK_LOGO;
  const r = Math.round(size * 0.24);
  const fs = size * m.fsFactor;

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      style={{ flexShrink: 0, display: 'inline-block', verticalAlign: 'middle' }}
      aria-hidden="true"
    >
      <rect width={size} height={size} rx={r} fill={m.bg} />
      <text
        x={size / 2}
        y={size / 2 + 0.5}
        textAnchor="middle"
        dominantBaseline="central"
        fontFamily="'IBM Plex Sans', system-ui, sans-serif"
        fontSize={fs}
        fontWeight={m.fw}
        fill={m.fill}
      >
        {m.text}
      </text>
    </svg>
  );
}
