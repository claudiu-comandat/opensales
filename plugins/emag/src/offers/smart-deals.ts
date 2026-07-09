import type { EmagClient } from '../client.js';
import type { EmagSmartDealsResponse } from './types.js';

/**
 * Verifică prețul target pentru badge-ul Smart Deals la o ofertă.
 * Endpoint: `/api-3/smart-deals-price-check`. Doc 4.4.8+.
 *
 * Returnează:
 *   - target_price: prețul sub care oferta primește badge-ul
 *   - required_discount: % discount necesar față de prețul recomandat
 *   - is_eligible: indică dacă oferta primește deja badge-ul
 *
 * eMAG recalculează zilnic — un check valid azi nu e neapărat valid mâine.
 */
export const checkSmartDealsPrice = async (
  client: EmagClient,
  offerId: number,
): Promise<EmagSmartDealsResponse> => {
  // smart-deals-price-check primește offerId ca query/body. eMAG documentează
  // ambele forme; trimitem ca body pentru consistență cu restul endpoint-urilor.
  return client.read<EmagSmartDealsResponse>('smart-deals-price-check', { offerId });
};
