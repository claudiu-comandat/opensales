import type { EmagClient } from '../client.js';
import type { EmagOfferReadItem, EmagOffersReadFilters } from './types.js';

/**
 * Variantă internă a filtrelor — permite explicit `undefined` pe cheile
 * opționale, ceea ce e necesar când caller-ul produce un obiect dintr-un
 * `z.infer<>` (Zod marchează cheile optional ca `T | undefined`, ceea ce
 * intră în conflict cu `exactOptionalPropertyTypes: true`).
 */
type OffersReadFiltersLoose = {
  [K in keyof EmagOffersReadFilters]?: EmagOffersReadFilters[K] | undefined;
};

/**
 * Citește oferte/produse de pe eMAG via `product_offer/read`. Doc 2.8.
 *
 * eMAG primește filtrele în body-ul POST cu `currentPage` / `itemsPerPage`
 * la nivel root + restul filtrelor inline. Returnează un array de oferte.
 */
export const readOffers = async (
  client: EmagClient,
  filters: OffersReadFiltersLoose = {},
): Promise<EmagOfferReadItem[]> => {
  const body = buildReadBody(filters);
  const results = await client.read<EmagOfferReadItem[] | EmagOfferReadItem>('product_offer', body);
  return Array.isArray(results) ? results : [results];
};

/**
 * Numără ofertele care match-uiesc filtrele via `product_offer/count`. Doc 2.8.
 *
 * Răspunsul standard eMAG conține `noOfItems`, dar uneori `noOfPages`/`itemsPerPage`.
 * Returnăm un wrapper care expune `noOfItems` numeric.
 */
export const countOffers = async (
  client: EmagClient,
  filters: OffersReadFiltersLoose = {},
): Promise<{ noOfItems: number; noOfPages?: number; itemsPerPage?: number }> => {
  const body = buildReadBody(filters);
  const raw = await client.count<{
    noOfItems?: number | string;
    noOfPages?: number | string;
    itemsPerPage?: number | string;
  }>('product_offer', body);
  const noOfItems = toNumber(raw.noOfItems);
  const out: { noOfItems: number; noOfPages?: number; itemsPerPage?: number } = { noOfItems };
  if (raw.noOfPages !== undefined) out.noOfPages = toNumber(raw.noOfPages);
  if (raw.itemsPerPage !== undefined) out.itemsPerPage = toNumber(raw.itemsPerPage);
  return out;
};

const buildReadBody = (filters: OffersReadFiltersLoose): Record<string, unknown> => {
  const body: Record<string, unknown> = {};
  if (filters.currentPage !== undefined) body.currentPage = filters.currentPage;
  if (filters.itemsPerPage !== undefined) body.itemsPerPage = filters.itemsPerPage;
  if (filters.status !== undefined) body.status = filters.status;
  if (filters.validation_status !== undefined) body.validation_status = filters.validation_status;
  if (filters.category_id !== undefined) body.category_id = filters.category_id;
  if (filters.brand !== undefined) body.brand = filters.brand;
  if (filters.part_number !== undefined) body.part_number = filters.part_number;
  if (filters.part_number_key !== undefined) body.part_number_key = filters.part_number_key;
  if (filters.ean !== undefined) body.ean = filters.ean;
  if (filters.data !== undefined) body.data = filters.data;
  // eMAG documentează `modified` ca obiect cu `from`/`to` (datetime ISO).
  if (filters.modifiedAfter !== undefined || filters.modifiedBefore !== undefined) {
    const modified: Record<string, string> = {};
    if (filters.modifiedAfter !== undefined) modified.from = filters.modifiedAfter;
    if (filters.modifiedBefore !== undefined) modified.to = filters.modifiedBefore;
    body.modified = modified;
  }
  return body;
};

const toNumber = (val: number | string | undefined): number => {
  if (typeof val === 'number') return val;
  if (typeof val === 'string') {
    const n = Number(val);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
};
