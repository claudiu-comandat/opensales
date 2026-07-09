import { type schema } from '@opensales/db';

/**
 * Agregarea erorilor pentru ofertele cu „Documentație respinsă” (status `rejected`).
 *
 * Funcție pură (fără DB) — primește liniile brute (un listing respins + SKU-ul
 * produsului) și le grupează pe canal (eMAG / Trendyol) și apoi pe mesajul de
 * eroare, ca să răspundă la: ce erori am primit, câte produse afectează fiecare
 * și care sunt exact SKU-urile afectate.
 */

/** Eticheta prietenoasă per prefix de platformă. */
const CHANNEL_LABELS: Record<string, string> = {
  emag: 'eMAG',
  fd: 'FashionDays',
  trendyol: 'Trendyol',
  temu: 'Temu',
  skroutz: 'Skroutz',
};

/** Mesaj folosit când un listing e respins dar nu avem niciun detaliu. */
const NO_DETAIL = 'Documentație respinsă — fără detalii';

/** O linie brută: un listing respins + SKU-ul produsului asociat. */
export interface RejectedListingRow {
  listingId: string;
  productId: string;
  sku: string;
  /** Codul de platformă, ex. `emag-ro`, `trendyol-de`. */
  platform: string;
  syncState: schema.ListingSyncState;
  lastSyncedAt: string | null;
}

/** Un SKU afectat de o eroare. */
export interface RejectedSku {
  sku: string;
  productId: string;
  listingId: string;
  platform: string;
  lastSyncedAt: string | null;
}

/** O eroare distinctă + produsele/SKU-urile afectate de ea. */
export interface RejectedErrorGroup {
  /** Mesajul de eroare exact, așa cum a fost primit de la marketplace. */
  error: string;
  /** Câte produse distincte sunt afectate de această eroare. */
  productCount: number;
  /** Câte oferte sunt afectate (poate fi > productCount dacă același produs e respins pe mai multe țări). */
  listingCount: number;
  /** SKU-urile afectate, ordonate alfanumeric. */
  skus: RejectedSku[];
}

/** Toate erorile dintr-un canal (eMAG, Trendyol, …). */
export interface RejectedChannelReport {
  /** Cheia canalului: prefixul platformei (`emag`, `trendyol`, …). */
  channel: string;
  /** Etichetă prietenoasă: `eMAG`, `Trendyol`. */
  label: string;
  productCount: number;
  listingCount: number;
  /** Grupuri de erori, ordonate descrescător după numărul de produse afectate. */
  groups: RejectedErrorGroup[];
}

export interface RejectedListingsReport {
  totalListings: number;
  totalProducts: number;
  channels: RejectedChannelReport[];
}

/** Prefixul platformei → cheia canalului (`emag-ro` → `emag`). */
function channelKey(platform: string): string {
  const dash = platform.indexOf('-');
  if (dash > 0) return platform.slice(0, dash);
  return platform.length > 0 ? platform : 'necunoscut';
}

function channelLabel(key: string): string {
  return CHANNEL_LABELS[key] ?? key;
}

/**
 * Extrage mesajele de eroare ale unui listing respins, în ordinea de prioritate:
 * `reject_reasons` (mesaje localizate, deja parsate din răspunsul marketplace-ului),
 * apoi `last_error.message`, apoi un mesaj generic. Deduplică în cadrul aceluiași listing.
 */
function reasonsForListing(state: schema.ListingSyncState): string[] {
  const out: string[] = [];
  const rr = state.reject_reasons;
  if (Array.isArray(rr)) {
    for (const r of rr) {
      const text = String(r).trim();
      if (text.length > 0) out.push(text);
    }
  }
  if (out.length === 0 && state.last_error && typeof state.last_error.message === 'string') {
    const text = state.last_error.message.trim();
    if (text.length > 0) out.push(text);
  }
  if (out.length === 0) out.push(NO_DETAIL);
  return [...new Set(out)];
}

interface ErrorAccumulator {
  productIds: Set<string>;
  /** Cheie = listingId, ca să nu numărăm de două ori aceeași ofertă. */
  skus: Map<string, RejectedSku>;
}

export function aggregateRejectedListings(rows: RejectedListingRow[]): RejectedListingsReport {
  const byChannel = new Map<string, Map<string, ErrorAccumulator>>();
  const channelProducts = new Map<string, Set<string>>();
  const channelListings = new Map<string, Set<string>>();
  const allProducts = new Set<string>();

  for (const row of rows) {
    const ch = channelKey(row.platform);
    allProducts.add(row.productId);

    const chProducts = channelProducts.get(ch) ?? new Set<string>();
    chProducts.add(row.productId);
    channelProducts.set(ch, chProducts);

    const chListings = channelListings.get(ch) ?? new Set<string>();
    chListings.add(row.listingId);
    channelListings.set(ch, chListings);

    const errMap = byChannel.get(ch) ?? new Map<string, ErrorAccumulator>();
    byChannel.set(ch, errMap);

    for (const error of reasonsForListing(row.syncState)) {
      const acc = errMap.get(error) ?? { productIds: new Set<string>(), skus: new Map() };
      acc.productIds.add(row.productId);
      if (!acc.skus.has(row.listingId)) {
        acc.skus.set(row.listingId, {
          sku: row.sku,
          productId: row.productId,
          listingId: row.listingId,
          platform: row.platform,
          lastSyncedAt: row.lastSyncedAt,
        });
      }
      errMap.set(error, acc);
    }
  }

  const channels: RejectedChannelReport[] = [];
  for (const [ch, errMap] of byChannel) {
    const groups: RejectedErrorGroup[] = [];
    for (const [error, acc] of errMap) {
      const skus = [...acc.skus.values()].sort((a, b) =>
        a.sku.localeCompare(b.sku, undefined, { numeric: true }),
      );
      groups.push({
        error,
        productCount: acc.productIds.size,
        listingCount: acc.skus.size,
        skus,
      });
    }
    groups.sort(
      (a, b) =>
        b.productCount - a.productCount ||
        b.listingCount - a.listingCount ||
        a.error.localeCompare(b.error),
    );
    channels.push({
      channel: ch,
      label: channelLabel(ch),
      productCount: channelProducts.get(ch)?.size ?? 0,
      listingCount: channelListings.get(ch)?.size ?? 0,
      groups,
    });
  }
  channels.sort((a, b) => b.productCount - a.productCount || a.label.localeCompare(b.label));

  return {
    totalListings: rows.length,
    totalProducts: allProducts.size,
    channels,
  };
}
