import type { EmagClient } from '../client.js';
import type { EmagFindByEansItem } from './types.js';

/**
 * Caută produse existente pe eMAG după EAN via `documentation/find_by_eans`. Doc 2.10.
 *
 * Spre deosebire de resursele CRUD (`product_offer`, `vat`, `category`...), acest
 * endpoint e o acțiune standalone FĂRĂ sufix `/read` — de aceea folosim `client.call`
 * direct în loc de `client.read` (care ar adăuga automat `/read` și ar da 404 "no
 * Route matched").
 *
 * Util înainte de a crea un produs nou — dacă EAN-ul există deja pe eMAG,
 * vendor-ul ar trebui să atașeze ofertă pe produsul existent (cap. 2.11)
 * folosind `part_number_key`-ul returnat aici, nu să creeze duplicat.
 *
 * eMAG limitează la maxim 100 EAN-uri per request.
 */
export const findByEans = async (
  client: EmagClient,
  eans: string[],
): Promise<EmagFindByEansItem[]> => {
  if (eans.length === 0) return [];
  const results = await client.call<EmagFindByEansItem[] | EmagFindByEansItem>(
    'documentation/find_by_eans',
    { eans },
  );
  return Array.isArray(results) ? results : [results];
};
