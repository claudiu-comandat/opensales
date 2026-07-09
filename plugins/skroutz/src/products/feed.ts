import type { FeedProduct, FeedVariation, GenerateProductFeedInput } from './types.js';

/** Escapează caracterele speciale XML dintr-un text. */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

/** Convertește un preț în cenți (amount_minor) la string euro cu 2 zecimale. */
export function minorToEuros(minor: number): string {
  return (minor / 100).toFixed(2);
}

function tag(name: string, value: string): string {
  return `    <${name}>${escapeXml(value)}</${name}>`;
}

function buildVariation(v: FeedVariation): string {
  const lines: string[] = ['      <variation>'];
  lines.push(`        <variationid>${escapeXml(v.variationId)}</variationid>`);
  lines.push(`        <availability>${escapeXml(v.availability)}</availability>`);
  lines.push(`        <size>${escapeXml(v.size)}</size>`);
  lines.push(`        <quantity>${v.quantity}</quantity>`);
  if (v.priceMinor !== undefined) {
    lines.push(`        <price>${minorToEuros(v.priceMinor)}</price>`);
  }
  if (v.link !== undefined) lines.push(`        <link>${escapeXml(v.link)}</link>`);
  if (v.mpn !== undefined) lines.push(`        <mpn>${escapeXml(v.mpn)}</mpn>`);
  if (v.ean !== undefined) lines.push(`        <ean>${escapeXml(v.ean)}</ean>`);
  if (v.outlet !== undefined) lines.push(`        <outlet>${v.outlet}</outlet>`);
  lines.push('      </variation>');
  return lines.join('\n');
}

function buildProduct(p: FeedProduct): string {
  const lines: string[] = ['  <product>'];
  lines.push(tag('uid', p.uid));
  lines.push(tag('name', p.name));
  lines.push(tag('link', p.link));
  lines.push(tag('image', p.image));
  for (const img of p.additionalImages ?? []) {
    lines.push(tag('additional_image', img));
  }
  lines.push(tag('category', p.category));
  lines.push(`    <price>${minorToEuros(p.priceMinor)}</price>`);
  lines.push(`    <vat>${p.vat.toFixed(2)}</vat>`);
  lines.push(tag('availability', p.availability));
  lines.push(tag('manufacturer', p.manufacturer));
  lines.push(tag('mpn', p.mpn));
  if (p.ean !== undefined) lines.push(tag('ean', p.ean));
  if (p.size !== undefined) lines.push(tag('size', p.size));
  if (p.weight !== undefined) lines.push(`    <weight>${p.weight}</weight>`);
  if (p.color !== undefined) lines.push(tag('color', p.color));
  lines.push(tag('description', p.description));
  lines.push(`    <quantity>${p.quantity}</quantity>`);
  if (p.variations && p.variations.length > 0) {
    lines.push('    <variations>');
    for (const v of p.variations) {
      lines.push(buildVariation(v));
    }
    lines.push('    </variations>');
  }
  lines.push('  </product>');
  return lines.join('\n');
}

/**
 * Construiește feed-ul XML Skroutz conform specificației Products > XML Feed.
 * Crearea produselor pe Skroutz se face exclusiv prin acest feed (Products API
 * nu creează produse noi).
 */
export function buildProductFeed(input: GenerateProductFeedInput): string {
  const createdAt = input.createdAt ?? new Date().toISOString().slice(0, 16).replace('T', ' ');
  const productsXml = input.products.map(buildProduct).join('\n');
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<mywebstore>',
    `  <created_at>${escapeXml(createdAt)}</created_at>`,
    '  <products>',
    productsXml,
    '  </products>',
    '</mywebstore>',
  ].join('\n');
}
