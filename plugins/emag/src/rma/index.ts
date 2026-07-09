/**
 * eMAG RMA module — wave 4.
 *
 * Re-exportă tipurile și funcțiile pure (`readRmas`, `countRmas`, `saveRma`)
 * și expune `rmaActions` — handler-ele pe care plugin-ul le poate înregistra
 * la `actions:` în `definePlugin`.
 *
 * Convenția pentru handler-e:
 *   - Primesc clientul EmagClient ca primul argument.
 *   - Întorc Promise<unknown> ca să fie compatibile cu interfața generică
 *     a action handlers.
 */

import { readRmas } from './read.js';
import { saveRma } from './save.js';

import type { EmagClient } from '../client.js';
import type { RmaReadFilters, RmaSavePayload } from './types.js';

export * from './types.js';
export { readRmas, countRmas } from './read.js';
export { saveRma } from './save.js';

/**
 * `syncRma` — trage toate cererile de retur care match-uiesc filtrele.
 * Caller-ul (orchestrator-ul de plugin) decide cum să le persiste local.
 */
const syncRma = (client: EmagClient, filters: RmaReadFilters = {}): Promise<unknown> => {
  return readRmas(client, filters);
};

/**
 * `saveRma` (action) — wrapper peste funcția pură care permite înregistrarea
 * directă în registry-ul de actions al pluginului.
 */
const saveRmaAction = (client: EmagClient, payload: RmaSavePayload): Promise<unknown> => {
  return saveRma(client, payload);
};

export const rmaActions = {
  syncRma,
  saveRma: saveRmaAction,
} as const;
