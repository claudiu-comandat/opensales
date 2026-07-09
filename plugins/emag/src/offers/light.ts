import type { EmagClient } from '../client.js';
import type { EmagLightOfferPayload } from './types.js';

/**
 * Light offer save — endpoint nou `offer/save` (doc 2.6.2).
 *
 * Spre deosebire de `product_offer/save`:
 *   - NU triggeruiește validare de documentație (text/imagini)
 *   - Doar câmpurile prezente în payload sunt actualizate
 *   - Permite update rapid de preț, stock, status, vat
 *
 * Recomandat pentru update-uri frecvente de preț/stock fără modificări de
 * conținut.
 */
export const saveLightOffer = async (
  client: EmagClient,
  payload: EmagLightOfferPayload,
): Promise<unknown> => {
  return client.save('offer', [payload]);
};

/** Bulk light save. */
export const saveLightOffers = async (
  client: EmagClient,
  payloads: EmagLightOfferPayload[],
): Promise<unknown> => {
  return client.save('offer', payloads);
};
