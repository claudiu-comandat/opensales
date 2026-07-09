import { ListingsView } from './listings-view.js';

import type { ReactElement } from 'react';

import { getServerApiClient } from '@/lib/server-api-client';

export const dynamic = 'force-dynamic';

export interface EmagValidationInfo {
  value: number;
  description?: string;
  errors?: unknown[];
}

export interface ListingRow {
  id: string;
  productId: string;
  pluginId: string;
  externalListingId: string;
  status: string;
  lastSyncedAt: string | null;
  syncState?: {
    validation_status?: EmagValidationInfo;
    offer_validation_status?: EmagValidationInfo;
    reject_reasons?: string[];
    last_error?: { message: string; at: string } | null;
  };
}

export interface ListingsPageSearchParams {
  pluginId?: string;
  status?: string;
}

interface ListListingsResponse {
  data: ListingRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface PluginGroup {
  pluginId: string;
  rows: ListingRow[];
}

export function groupByPlugin(rows: ListingRow[]): PluginGroup[] {
  const map = new Map<string, ListingRow[]>();
  for (const row of rows) {
    const list = map.get(row.pluginId);
    if (list) {
      list.push(row);
    } else {
      map.set(row.pluginId, [row]);
    }
  }
  return Array.from(map.entries())
    .map(([pluginId, groupRows]) => ({ pluginId, rows: groupRows }))
    .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
}

async function fetchListings(params: ListingsPageSearchParams): Promise<ListListingsResponse> {
  try {
    return await (
      await getServerApiClient()
    ).get<ListListingsResponse>('/listings', {
      query: {
        pluginId: params.pluginId,
        status: params.status,
        pageSize: 200,
      },
    });
  } catch {
    return { data: [], total: 0, page: 1, pageSize: 200 };
  }
}

export default async function ListingsPage({
  searchParams,
}: {
  searchParams?: Promise<ListingsPageSearchParams>;
}): Promise<ReactElement> {
  const sp = (await searchParams) ?? {};
  const result = await fetchListings(sp);
  const groups = groupByPlugin(result.data);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="t-h1">Listings</h1>
          <p className="t-small mt-1">Sincronizări produse pe canale externe.</p>
        </div>
        <span className="text-[12px] text-ink-500" data-testid="listings-total">
          {result.total} total
        </span>
      </header>
      <ListingsView
        groups={groups}
        initialPluginId={sp.pluginId ?? ''}
        initialStatus={sp.status ?? ''}
      />
    </div>
  );
}
