import { type schema } from '@opensales/db';

export interface ListingResponse {
  id: string;
  productId: string;
  pluginId: string;
  externalListingId: string;
  status: string;
  syncState: schema.ListingSyncState;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toResponse(l: schema.Listing): ListingResponse {
  return {
    id: l.id,
    productId: l.productId,
    pluginId: l.pluginId,
    externalListingId: l.externalListingId,
    status: l.status,
    syncState: l.syncState,
    lastSyncedAt: l.lastSyncedAt?.toISOString() ?? null,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}
