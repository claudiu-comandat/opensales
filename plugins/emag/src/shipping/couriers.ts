import type { EmagClient } from '../client.js';
import type { CourierAccount, CourierAccountFilters } from './types.js';

/**
 * Citește conturile de curier disponibile (doc § 6.7). În răspuns apare
 * `pickup_country_code` (4.4.7) — folosit pentru ruta cross-border.
 */
export const readCourierAccounts = (
  client: EmagClient,
  filters: CourierAccountFilters = {},
): Promise<CourierAccount[]> => client.read<CourierAccount[]>('courier_accounts', { ...filters });
