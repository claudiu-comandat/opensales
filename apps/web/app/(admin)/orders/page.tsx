import { OrdersTable, type OrderRow } from './orders-table.js';

import type { ReactElement } from 'react';

import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

interface OrdersListResponse {
  data: OrderRow[];
  totalPages: number;
  page: number;
  pageSize: number;
}

interface PluginItem {
  id: string;
  displayName?: string;
}

interface SearchParams {
  status?: string;
  placedAfter?: string;
  placedBefore?: string;
  page?: string;
  q?: string;
  marketplaceInclude?: string;
  hasInvoice?: string;
  hasAwb?: string;
  hasShipping?: string;
  hasVoucher?: string;
  hasUnmatchedItems?: string;
  paymentMethod?: string;
  deliveryMode?: string;
}

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}): Promise<ReactElement> {
  const sp = await searchParams;
  const page = Number(sp.page ?? 1);
  const pageSize = 100;
  const status = sp.status ?? '';
  const placedAfter = sp.placedAfter ?? '';
  const placedBefore = sp.placedBefore ?? '';
  const q = sp.q ?? '';
  const marketplaceInclude = sp.marketplaceInclude ?? '';
  const hasInvoice =
    sp.hasInvoice === 'true' ? true : sp.hasInvoice === 'false' ? false : undefined;
  const hasAwb = sp.hasAwb === 'true';
  const hasShipping = sp.hasShipping === 'true';
  const hasVoucher = sp.hasVoucher === 'true';
  const hasUnmatchedItems = sp.hasUnmatchedItems === 'true';
  const paymentMethod = sp.paymentMethod ?? '';
  const deliveryMode = sp.deliveryMode ?? '';

  let rows: OrderRow[] = [];
  let totalPages = 0;
  let loadError: string | null = null;

  try {
    const client = await getServerApiClient();
    const [data, pluginsData] = await Promise.all([
      client.get<OrdersListResponse>('/orders', {
        query: {
          status: status || undefined,
          placedAfter: placedAfter || undefined,
          placedBefore: placedBefore || undefined,
          search: q || undefined,
          marketplaceInclude: marketplaceInclude || undefined,
          hasInvoice: hasInvoice,
          hasAwb: hasAwb || undefined,
          hasShipping: hasShipping || undefined,
          hasVoucher: hasVoucher || undefined,
          hasUnmatchedItems: hasUnmatchedItems || undefined,
          paymentMethod: paymentMethod || undefined,
          deliveryMode: deliveryMode || undefined,
          page,
        },
      }),
      client.get<{ data: PluginItem[] }>('/plugins').catch(() => ({ data: [] })),
    ]);

    const pluginMap = Object.fromEntries(
      pluginsData.data.map((p) => [p.id, p.displayName ?? p.id]),
    );

    rows = data.data.map((r) => {
      const name = pluginMap[r.pluginId];
      return name !== undefined ? { ...r, pluginName: name } : r;
    });
    totalPages = data.totalPages;
  } catch {
    loadError = 'Nu s-au putut încărca comenzile.';
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="t-h1">Comenzi</h1>
        <p className="t-small mt-1">Gestionează comenzile primite din toate canalele.</p>
      </div>
      {loadError !== null ? (
        <p role="alert" className="text-[13px] text-danger">
          {loadError}
        </p>
      ) : (
        <OrdersTable
          rows={rows}
          totalPages={totalPages}
          page={page}
          pageSize={pageSize}
          status={status}
          placedAfter={placedAfter}
          placedBefore={placedBefore}
          search={q}
          marketplaceInclude={marketplaceInclude}
          hasInvoice={hasInvoice}
          hasAwb={hasAwb}
          hasShipping={hasShipping}
          hasVoucher={hasVoucher}
          hasUnmatchedItems={hasUnmatchedItems}
          paymentMethod={paymentMethod}
          deliveryMode={deliveryMode}
        />
      )}
    </div>
  );
}
