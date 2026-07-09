import type { EmagClient } from '../client.js';
import type { Locality, LocalityCountResult, LocalityFilters } from './types.js';

/**
 * Citește localități din baza eMAG (doc § 6.6).
 * Filtrele utile: country_code (4.4.7, înlocuiește vechiul "country"),
 * region2 (județ), name (search), zipcode (4.4.7), iso2 (4.4.8).
 */
export const readLocalities = (
  client: EmagClient,
  filters: LocalityFilters = {},
): Promise<Locality[]> => client.read<Locality[]>('locality', { ...filters });

/**
 * Numără localitățile care match-uiesc filtrul (doc § 6.5).
 * Endpoint: locality/count.
 */
export const countLocalities = (
  client: EmagClient,
  filters: LocalityFilters = {},
): Promise<LocalityCountResult> => client.count<LocalityCountResult>('locality', { ...filters });
