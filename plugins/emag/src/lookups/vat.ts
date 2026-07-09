import type { EmagClient } from '../client.js';
import type { EmagVatRate } from './types.js';

/**
 * Doc § 2.2 — vat/read. Endpoint readonly, fără filtre. Răspunsul e o listă
 * (array) de VAT rates disponibile pentru platforma curentă.
 *
 * Folosit pentru a popula UI-uri de configurare (vat_id pe product_offer/save)
 * și pentru healthcheck-ul plugin-ului (e cel mai cheap call).
 */
export const readVat = async (client: EmagClient): Promise<EmagVatRate[]> => {
  const raw = await client.read<EmagVatRate[] | { results?: EmagVatRate[] }>('vat');
  if (Array.isArray(raw)) return raw;
  return raw.results ?? [];
};
