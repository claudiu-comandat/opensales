import { acquireSaveOfferSlot } from './save-rate-limiter.js';

import type { EmagClient } from '../client.js';
import type { EmagProductOfferPayload } from './types.js';

/**
 * Trimite un produs/ofertă către eMAG via `product_offer/save`. Doc 2.4-2.6.1.
 *
 * Folosește pentru:
 *   - Creare produs nou (full documentation: name, description, characteristics,
 *     family, images, etc.)
 *   - Update integral al ofertei existente (id + status + sale_price + vat_id +
 *     handling_time + stock — minimul mandatory).
 *
 * Pentru update lightweight de preț/stock fără validare documentație folosește
 * `saveLightOffer` (offer/save) — doc 2.6.2.
 *
 * Body trimis: `{ "data": [ payload ] }` — format bulk eMAG (doc 1.4).
 * Rate limit: 150 lansări/minut shared across toate platformele (ro/bg/hu).
 */
export const saveProductOffer = async (
  client: EmagClient,
  payload: EmagProductOfferPayload,
): Promise<unknown> => {
  await acquireSaveOfferSlot();
  return client.save('product_offer', { data: [payload] });
};

/**
 * Bulk variant — trimite până la 50 produse per request.
 *
 * Body trimis: `{ "data": [ ...payloads ] }` — format bulk eMAG (doc 1.4).
 * Rate limit: 150 lansări/minut shared across toate platformele (ro/bg/hu).
 */
export const saveProductOffers = async (
  client: EmagClient,
  payloads: EmagProductOfferPayload[],
): Promise<unknown> => {
  await acquireSaveOfferSlot();
  return client.save('product_offer', { data: payloads });
};
