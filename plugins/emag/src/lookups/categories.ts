import type { EmagClient } from '../client.js';
import type { CategoryReadFilters, CategoryReadResult, EmagCategory } from './types.js';

/**
 * Doc § 2.1 — category/read defaults. eMAG returnează by default primele 100
 * de categorii, sortate ascendent după id. Pagination keys (4.4.7+) sunt
 * `currentPage` și `itemsPerPage`. Pentru un singur category id, există în
 * plus `valuesCurrentPage` / `valuesPerPage` pentru paginarea valorilor de
 * caracteristică.
 */
const DEFAULT_ITEMS_PER_PAGE = 100;
const DEFAULT_CURRENT_PAGE = 1;

interface RawCategoryReadResponse {
  /** Pe unele rute eMAG expune lista direct ca array. */
  results?: EmagCategory[];
  currentPage?: number;
  itemsPerPage?: number;
  noOfItems?: number;
  totalCount?: number;
}

/**
 * Cleanup helper — elimină câmpurile undefined din filtre. eMAG e capricios
 * cu `null` vs absent, așa că trimitem doar key-urile setate.
 */
function compactFilters(filters: CategoryReadFilters): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(filters)) {
    if (val !== undefined && val !== null) out[key] = val;
  }
  return out;
}

/**
 * Read categories cu paginare. Returnează un obiect normalizat care expune
 * lista, pagina curentă și totalul (când e disponibil).
 *
 * Note:
 *   - Pentru a obține `characteristics[]` și `family_types[]`, trebuie să
 *     setezi `filters.id` (single-category read).
 *   - Pentru caracteristici cu multe valori, folosește `valuesCurrentPage` /
 *     `valuesPerPage` (max 256 valori per pagină — vezi doc § 2.1).
 *   - `language` (4.4.4+) controlează limba name-urilor; default = limba
 *     platformei (RO pe emag-ro, BG pe emag-bg, etc.).
 */
export const readCategories = async (
  client: EmagClient,
  filters: CategoryReadFilters = {},
): Promise<CategoryReadResult> => {
  const itemsPerPage = filters.itemsPerPage ?? DEFAULT_ITEMS_PER_PAGE;
  const currentPage = filters.currentPage ?? DEFAULT_CURRENT_PAGE;
  const body = compactFilters({ ...filters, itemsPerPage, currentPage });
  // EmagClient.read unwraps `results`; pentru category/read, eMAG poate
  // returna fie un array direct (lista de categorii) fie un obiect cu
  // metadata. Apelăm prin `read` și acceptăm ambele forme.
  const raw = await client.read<RawCategoryReadResponse | EmagCategory[]>('category', body);
  const items: EmagCategory[] = Array.isArray(raw) ? raw : (raw.results ?? []);
  const totalCount = !Array.isArray(raw) ? (raw.noOfItems ?? raw.totalCount) : undefined;
  const result: CategoryReadResult = {
    items,
    currentPage,
    itemsPerPage,
  };
  if (totalCount !== undefined) result.totalCount = totalCount;
  return result;
};

/**
 * Count categories (doc § 2.1). Returnează numărul total de categorii care
 * match-uiesc filtrele furnizate. Folosit pentru a calcula numărul total de
 * pagini.
 */
export const countCategories = async (
  client: EmagClient,
  filters: Omit<CategoryReadFilters, 'itemsPerPage' | 'currentPage'> = {},
): Promise<number> => {
  const body = compactFilters(filters);
  const raw = await client.count<{ noOfItems?: number | string }>('category', body);
  const n = typeof raw.noOfItems === 'string' ? Number(raw.noOfItems) : raw.noOfItems;
  return Number.isFinite(n) ? Number(n) : 0;
};
