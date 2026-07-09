import type { EmagClient } from '../client.js';
import type { EmagFindByEansItem } from './types.js';

/**
 * Caută produse existente pe eMAG după EAN via
 * `documentation/find_by_eans/read`. Doc 2.10.
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
  const results = await client.read<EmagFindByEansItem[] | EmagFindByEansItem>(
    'documentation/find_by_eans',
    { eans },
  );
  return Array.isArray(results) ? results : [results];
};
