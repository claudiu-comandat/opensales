import type { EmagClient } from '../client.js';
import type { EmagRma, RmaReadFilters, RmaReadResult } from './types.js';

/**
 * Doc § 7.1 — RMA pagination defaults.
 *
 * Doc-ul eMAG nu specifică un default pentru rma/read; folosim aceeași limită
 * conservatoare de 100/pagină ca pentru orders ca să nu lovim limitele.
 */
const DEFAULT_ITEMS_PER_PAGE = 100;
const DEFAULT_CURRENT_PAGE = 1;

interface RawRmaReadResponse {
  results?: EmagRma[];
  currentPage?: number;
  itemsPerPage?: number;
  noOfItems?: number;
  totalCount?: number;
}

/**
 * Cleanup helper — elimină câmpurile undefined din filtre. Important pentru
 * rma/read pentru că eMAG nu acceptă valori `null` pe filtre opționale.
 */
function compactFilters(filters: RmaReadFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null) out[key] = val;
  }
  return out;
}

/**
 * Read RMAs cu paginare. Filtrele acceptate sunt cele din doc § 7.1:
 *   - id, emag_id, order_id, product_id, product_emag_id, request_status
 *   - date_start, date_end (4.4.7+; înainte erau un singur `date`)
 *   - type (4.4.8+)
 */
export async function readRmas(
  client: EmagClient,
  filters: RmaReadFilters = {},
): Promise<RmaReadResult> {
  const itemsPerPage = filters.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE;
  const currentPage = filters.currentPage ?? DEFAULT_CURRENT_PAGE;
  const body = compactFilters({ ...filters, itemsPerPage, currentPage });
  const raw = await client.call<RawRmaReadResponse | EmagRma[]>('rma/read', body);
  const items = Array.isArray(raw) ? raw : (raw.results ?? []);
  const totalCount = !Array.isArray(raw) ? (raw.noOfItems ?? raw.totalCount) : undefined;
  const result: RmaReadResult = {
    items,
    currentPage,
    itemsPerPage,
  };
  if (totalCount !== undefined) result.totalCount = totalCount;
  return result;
}

/**
 * Count RMAs (doc § 7). Returnează numărul total de cereri care match-uiesc
 * filtrele furnizate.
 */
export async function countRmas(
  client: EmagClient,
  filters: Omit<RmaReadFilters, 'itemsPerPage' | 'currentPage'> = {},
): Promise<number> {
  const body = compactFilters(filters);
  const raw = await client.count<{ noOfItems?: number | string }>('rma', body);
  const n = typeof raw.noOfItems === 'string' ? Number(raw.noOfItems) : raw.noOfItems;
  return Number.isFinite(n) ? Number(n) : 0;
}
