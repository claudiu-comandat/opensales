import { saveLightOffer } from './light.js';

import type { EmagClient } from '../client.js';

/**
 * Update de stoc via `offer/save` (light) — formatul confirmat de eMAG:
 * body = array „gol" `[{ id, stock: [{ warehouse_id, value }] }]` (NU `{ data: [...] }`).
 *
 * `id` = id-ul intern de SELLER al ofertei (la noi `syncState.emag_offer_id`,
 * = `offer.id` din eMAG). Trimitem DOAR stocul → fără re-validare de documentație.
 * Același endpoint actualizează și preț/status (vezi `updatePrice`).
 */
export const updateStock = async (
  client: EmagClient,
  offerId: number,
  value: number,
  warehouseId = 1,
): Promise<unknown> => {
  return saveLightOffer(client, { id: offerId, stock: [{ warehouse_id: warehouseId, value }] });
};

/** Variantă pentru update pe mai multe warehouse-uri într-un single request. */
export const updateStockMulti = async (
  client: EmagClient,
  offerId: number,
  stock: { warehouse_id: number; value: number }[],
): Promise<unknown> => {
  return saveLightOffer(client, { id: offerId, stock });
};
