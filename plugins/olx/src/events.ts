import type { OlxAdvert } from './adverts/types.js';

/** Marketplace identifier embedded in every emitted listing event. */
export const OLX_MARKETPLACE = 'olx';

/** Subset of platform events this plugin emits (see PLATFORM_EVENTS in the SDK). */
export type ListingEventName = 'listing.created' | 'listing.updated' | 'listing.deleted';

/**
 * Payload pe care platforma îl primește la fiecare schimbare de anunț. `externalId`
 * (id-ul propriu al vânzătorului) permite maparea înapoi la produsul din OpenSales.
 */
export interface ListingEventPayload {
  marketplace: typeof OLX_MARKETPLACE;
  pluginId: string;
  advertId: number;
  externalId?: string;
  status?: string;
  command?: string;
}

export interface ListingEvent {
  event: ListingEventName;
  payload: ListingEventPayload;
}

function fromAdvert(event: ListingEventName, pluginId: string, advert: OlxAdvert): ListingEvent {
  const payload: ListingEventPayload = {
    marketplace: OLX_MARKETPLACE,
    pluginId,
    advertId: advert.id,
  };
  if (advert.external_id !== null && advert.external_id !== undefined) {
    payload.externalId = advert.external_id;
  }
  if (advert.status !== undefined) payload.status = advert.status;
  return { event, payload };
}

/** Anunț nou publicat (POST /adverts). */
export const advertCreatedEvent = (pluginId: string, advert: OlxAdvert): ListingEvent =>
  fromAdvert('listing.created', pluginId, advert);

/** Anunț actualizat (PUT /adverts/{id}). */
export const advertUpdatedEvent = (pluginId: string, advert: OlxAdvert): ListingEvent =>
  fromAdvert('listing.updated', pluginId, advert);

/** Anunț șters (DELETE /adverts/{id}) — răspunsul e 204, deci avem doar id-ul. */
export const advertDeletedEvent = (pluginId: string, advertId: number): ListingEvent => ({
  event: 'listing.deleted',
  payload: { marketplace: OLX_MARKETPLACE, pluginId, advertId },
});

/**
 * Schimbare de status prin comandă (activate/deactivate/finish/extend) — răspunsul
 * e 204, deci marcăm un `listing.updated` cu numele comenzii aplicate.
 */
export const advertCommandEvent = (
  pluginId: string,
  advertId: number,
  command: string,
): ListingEvent => ({
  event: 'listing.updated',
  payload: { marketplace: OLX_MARKETPLACE, pluginId, advertId, command },
});
