import type { EmagClient } from '../client.js';
import type { Address, AddressFilters } from './types.js';

/**
 * Citește adresele salvate în contul vânzătorului (doc § 6.8, 4.4.9).
 * Folosit pentru a obține `address_id`-uri pe care apoi le pasezi pe awb/save.
 */
export const readAddresses = (
  client: EmagClient,
  filters: AddressFilters = {},
): Promise<Address[]> => client.read<Address[]>('addresses', { ...filters });
