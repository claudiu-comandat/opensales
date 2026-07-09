import { type ReactElement } from 'react';

import { ProductsTable, type ProductRow } from './products-table.js';

import type { ActiveImportBatch } from './import-batch-indicator.js';
import type { ImportSourcePlugin } from './import-source-dropdown.js';

import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

interface ProductsListResponse {
  data: ProductRow[];
  total: number;
  page: number;
  pageSize: number;
}

interface ProductsStatsResponse {
  totalProducts: number;
  totalStock: number;
  lowStockCount: number;
  noStockCount: number;
}

interface SearchParams {
  search?: string;
  isActive?: string;
  marketplace?: string;
  listingStatus?: string;
  relevantOnly?: string;
  page?: string;
  pageSize?: string;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);
  const pageSize = Number(sp.pageSize ?? 50);
  const search = sp.search ?? '';
  const isActive = sp.isActive ?? '';
  const marketplace = sp.marketplace ?? '';
  const listingStatus = sp.listingStatus ?? '';
  // Default true; false only when explicitly set to 'false' in the URL.
  const relevantOnly = sp.relevantOnly !== 'false';

  let rows: ProductRow[] = [];
  let total = 0;
  let loadError: string | null = null;
  let globalStats: ProductsStatsResponse = {
    totalProducts: 0,
    totalStock: 0,
    lowStockCount: 0,
    noStockCount: 0,
  };
  let plugins: ImportSourcePlugin[] = [];
  let activeBatch: ActiveImportBatch | null = null;

  try {
    const client = await getServerApiClient();
    const [data, statsData, pluginsData, batchData] = await Promise.all([
      client.get<ProductsListResponse>('/products', {
        query: {
          search: search || undefined,
          isActive: isActive || undefined,
          marketplace: marketplace || undefined,
          listingStatus: listingStatus || undefined,
          relevantOnly: relevantOnly || undefined,
          page,
          pageSize,
        },
      }),
      client.get<ProductsStatsResponse>('/products/stats'),
      client
        .get<{ data: ImportSourcePlugin[] }>('/plugins')
        .catch((): { data: ImportSourcePlugin[] } => ({ data: [] })),
      client
        .get<ActiveImportBatch | null>('/import/products/active')
        .catch((): ActiveImportBatch | null => null),
    ]);
    rows = data.data;
    total = data.total;
    globalStats = statsData;
    plugins = pluginsData.data ?? [];
    activeBatch = batchData;
  } catch {
    loadError = 'Nu s-au putut încărca produsele.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="t-h1">Produse</h1>
        <p className="t-small mt-1">Catalog produse cu stoc, preț și status pe canale.</p>
      </div>
      {loadError !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {loadError}
        </p>
      ) : (
        <ProductsTable
          rows={rows}
          total={total}
          page={page}
          pageSize={pageSize}
          search={search}
          isActive={isActive}
          marketplace={marketplace}
          listingStatus={listingStatus}
          relevantOnly={relevantOnly}
          globalStats={globalStats}
          plugins={plugins}
          activeBatch={activeBatch}
        />
      )}
    </div>
  );
}
