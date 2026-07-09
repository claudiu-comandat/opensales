import type { EmagClient } from '../client.js';
import type { EmagHandlingTime } from './types.js';

/**
 * Doc § 2.3 — handling_time/read. Endpoint readonly, fără filtre. Răspunsul
 * e o listă cu valorile valide de handling_time (zile între primirea comenzii
 * și expediere). Tipic: 0..14 zile.
 *
 * Folosit pentru a valida câmpul `handling_time.value` din `product_offer/save`.
 */
export const readHandlingTime = async (client: EmagClient): Promise<EmagHandlingTime[]> => {
  const raw = await client.read<EmagHandlingTime[] | { results?: EmagHandlingTime[] }>(
    'handling_time',
  );
  if (Array.isArray(raw)) return raw;
  return raw.results ?? [];
};
