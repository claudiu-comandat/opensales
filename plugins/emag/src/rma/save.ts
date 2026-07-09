import type { EmagClient } from '../client.js';
import type { RmaSavePayload } from './types.js';

/**
 * Doc § 7 — rma/save.
 *
 * Folosit pentru a actualiza status-ul unei cereri de retur (e.g. acknowledge,
 * refuse, finalize), pentru a adăuga observații sau pentru a marca produse
 * primite. Endpoint-ul este atât pentru insert cât și pentru update — distincția
 * o face câmpul `emag_id` (Required).
 *
 * Restricții importante:
 *   - `type` este Required din 4.4.8 (`2` = FBE, `3` = fulfilled by seller).
 *   - `emag_id` și `order_id` sunt Required.
 *   - Tranzițiile de status sunt restrânse de matricea din doc § 7.2:
 *       2 → 3, 5
 *       3 → 3, 5, 6
 *       4 → 4
 *       5 → 5
 *       6 → 4, 6, 7
 *       7 → 7
 *     Caller-ul este responsabil să respecte matricea; eMAG va răspunde cu
 *     `isError:true` dacă tranziția e invalidă.
 *
 * Spre deosebire de order/save (care cere FULL payload-ul), rma/save acceptă
 * un payload parțial — câmpurile lipsă rămân neschimbate. În practică,
 * recomandarea eMAG este totuși să trimitem cererea completă citită anterior
 * și să modificăm doar ce e necesar.
 */
export function saveRma(client: EmagClient, payload: RmaSavePayload): Promise<unknown> {
  return client.save('rma', payload);
}
