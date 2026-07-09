import type { EmagClient } from '../client.js';
import type { EmagOrder, OrderReadFilters, OrderReadResult } from './types.js';

/**
 * Doc § 5.4 — order/read filters. Constants pentru pagination defaults.
 *
 * eMAG returnează implicit ultimele 100 de comenzi. Limita superioară per
 * pagină e 100 (verificat în doc); pentru >100 trebuie folosită paginarea.
 */
const DEFAULT_ITEMS_PER_PAGE = 100;
const DEFAULT_CURRENT_PAGE = 1;

interface RawOrderReadResponse {
  /** Unele platforme expun rezultatele direct în results (array). */
  results?: EmagOrder[];
  currentPage?: number;
  itemsPerPage?: number;
  noOfItems?: number;
  totalCount?: number;
}

/**
 * Cleanup helper — elimină din filtre câmpurile undefined ca să nu trimitem
 * `{ status: undefined }` în payload-ul JSON (eMAG e capricios cu null vs absent).
 */
function compactFilters(filters: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null) out[key] = val;
  }
  return out;
}

/**
 * Read orders cu paginare. Returnează un obiect normalizat care expune lista,
 * pagina curentă și totalul (când e disponibil).
 *
 * Pentru iterarea completă, caller-ul ar trebui să verifice
 * `result.items.length === result.itemsPerPage` și să crească `currentPage`
 * până când răspunsul e mai mic decât pagina, sau să folosească
 * `countOrders` pentru a calcula numărul total de pagini.
 */
export async function readOrders(
  client: EmagClient,
  filters: OrderReadFilters | Record<string, unknown> = {},
): Promise<OrderReadResult> {
  const f = filters as { itemsPerPage?: number; currentPage?: number };
  const itemsPerPage = f.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE;
  const currentPage = f.currentPage ?? DEFAULT_CURRENT_PAGE;
  const body = compactFilters({ ...filters, itemsPerPage, currentPage });
  // Use callEnvelope so we keep the metadata at the root (noOfItems,
  // currentPage, itemsPerPage). EmagClient.read/call unwrap `results` and
  // would discard the pagination info we need here.
  const envelope = await client.callEnvelope<EmagOrder[]>('order/read', body);
  const items: EmagOrder[] = Array.isArray(envelope.results) ? envelope.results : [];
  const meta = envelope as RawOrderReadResponse;
  const totalCount = meta.noOfItems ?? meta.totalCount;
  const result: OrderReadResult = {
    items,
    currentPage,
    itemsPerPage,
  };
  if (totalCount !== undefined) result.totalCount = totalCount;
  return result;
}

/**
 * Count orders (doc § 5.4). Returnează numărul total de comenzi care match-uiesc
 * filtrele furnizate. Folosit pentru a calcula numărul total de pagini.
 */
export async function countOrders(
  client: EmagClient,
  filters: Omit<OrderReadFilters, 'itemsPerPage' | 'currentPage'> | Record<string, unknown> = {},
): Promise<number> {
  const body = compactFilters(filters);
  const raw = await client.count<{ noOfItems?: number | string }>('order', body);
  const n = typeof raw.noOfItems === 'string' ? Number(raw.noOfItems) : raw.noOfItems;
  return Number.isFinite(n) ? Number(n) : 0;
}
