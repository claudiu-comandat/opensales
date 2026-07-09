import type { EmagClient } from '../client.js';
import type { EmagCommissionResponse } from './types.js';

/**
 * Citește comisionul eMAG pentru o ofertă existentă. Doc 2.12 (4.4.3+).
 *
 * Endpoint: `api/v1/commission/estimate/{extId}` — eMAG documentează aici
 * varianta `commission/{offerId}` la nivel de marketplace API. Folosim path-ul
 * standard `commission/{id}` pe care `client.call` îl POST-uiește.
 *
 * Comisionul e procentual și depinde de categoria produsului + segmentarea
 * vendorului. Util pentru calcul de margin pe produs înainte de listare.
 */
export const readCommission = async (
  client: EmagClient,
  offerId: number,
): Promise<EmagCommissionResponse> => {
  return client.call<EmagCommissionResponse>(`api/v1/commission/estimate/${String(offerId)}`, {});
};
