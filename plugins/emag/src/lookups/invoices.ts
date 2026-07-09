import type { EmagClient } from '../client.js';
import type {
  CustomerInvoiceReadFilters,
  CustomerInvoiceReadResult,
  EmagCustomerInvoice,
  EmagInvoice,
  EmagInvoiceCategory,
  InvoiceReadFilters,
  InvoiceReadResult,
} from './types.js';

/**
 * Doc § 8 — endpoint-uri Invoice API.
 *
 * Notă: spre deosebire de category/vat/handling_time (care trăiesc pe rădăcina
 * `MARKETPLACE_API_URL`), invoice rules trăiesc pe `/api-3/...`. Clientul
 * eMAG construiește URL-ul concatenând `apiUrl + '/' + path`, iar `apiUrl`
 * include deja `/api-3`. Pentru a evita dublarea, trimitem path-uri relative
 * (fără prefixul `/api-3/`).
 */
const INVOICE_DEFAULT_ITEMS_PER_PAGE = 100;
const INVOICE_DEFAULT_CURRENT_PAGE = 1;

interface RawInvoiceListResponse<T> {
  total_results?: number | string;
  invoices?: T[];
  /** Pe unele platforme răspunsul vine pe `results`. */
  results?: T[];
}

const compactFilters = <F extends Record<string, unknown>>(filters: F): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null) out[key] = val;
  }
  return out;
};

const toNumberOrUndefined = (v: number | string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
};

/**
 * Doc § 8.1 — `/api-3/invoice/categories/read`. Returnează lista de categorii
 * de facturi disponibile pentru vendor (FC, etc.). Trebuie apelat înainte de
 * `readInvoices` ca să afli categoriile valide pentru filtrare.
 */
export const readInvoiceCategories = async (client: EmagClient): Promise<EmagInvoiceCategory[]> => {
  const raw = await client.read<EmagInvoiceCategory[] | { results?: EmagInvoiceCategory[] }>(
    'invoice/categories',
  );
  if (Array.isArray(raw)) return raw;
  return raw.results ?? [];
};

/**
 * Doc § 8.2 — `/api-3/invoice/read`. Citește lista de facturi pentru vendor
 * (commission, fees, storno). Default 100 invoice-uri / pagină, max 1000.
 *
 * Note:
 *   - `category` trebuie să fie unul din rezultatele `readInvoiceCategories`.
 *   - `date_start` / `date_end` sunt în format `YYYY-MM-DD`.
 */
export const readInvoices = async (
  client: EmagClient,
  filters: InvoiceReadFilters = {},
): Promise<InvoiceReadResult> => {
  const itemsPerPage = filters.itemsPerPage ?? INVOICE_DEFAULT_ITEMS_PER_PAGE;
  const currentPage = filters.currentPage ?? INVOICE_DEFAULT_CURRENT_PAGE;
  const body = compactFilters({ ...filters, itemsPerPage, currentPage });
  const raw = await client.call<RawInvoiceListResponse<EmagInvoice>>('invoice/read', body);
  const items: EmagInvoice[] = raw.invoices ?? raw.results ?? [];
  const totalResults = toNumberOrUndefined(raw.total_results);
  const result: InvoiceReadResult = {
    items,
    currentPage,
    itemsPerPage,
  };
  if (totalResults !== undefined) result.totalResults = totalResults;
  return result;
};

/**
 * Doc § 8.3 — `/api-3/customer-invoice/read`. Citește facturile emise către
 * customer (B2C / B2B), legate de un order. Aceeași formă ca invoice/read,
 * dar `category` e doar `'normal'` sau `'storno'`, și are `order_id`.
 */
export const readCustomerInvoices = async (
  client: EmagClient,
  filters: CustomerInvoiceReadFilters = {},
): Promise<CustomerInvoiceReadResult> => {
  const itemsPerPage = filters.itemsPerPage ?? INVOICE_DEFAULT_ITEMS_PER_PAGE;
  const currentPage = filters.currentPage ?? INVOICE_DEFAULT_CURRENT_PAGE;
  const body = compactFilters({ ...filters, itemsPerPage, currentPage });
  const raw = await client.call<RawInvoiceListResponse<EmagCustomerInvoice>>(
    'customer-invoice/read',
    body,
  );
  const items: EmagCustomerInvoice[] = raw.invoices ?? raw.results ?? [];
  const totalResults = toNumberOrUndefined(raw.total_results);
  const result: CustomerInvoiceReadResult = {
    items,
    currentPage,
    itemsPerPage,
  };
  if (totalResults !== undefined) result.totalResults = totalResults;
  return result;
};
