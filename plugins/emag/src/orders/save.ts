import type { EmagClient } from '../client.js';
import type { EmagOrder } from './types.js';

/**
 * Doc § 5 — order/save.
 *
 * Pattern-ul cel mai comun: pull comanda din eMAG (status=1, new), procesare
 * locală, push înapoi cu `status=2` (in progress) sau `status=3` (prepared).
 *
 * Doc IMPORTANT: când actualizezi o comandă trebuie să trimiți TOATE câmpurile
 * citite inițial. Helper-ul ăsta nu face deep merge; caller-ul trebuie să
 * trimită payload-ul complet (de obicei mutat dintr-un EmagOrder citit
 * anterior cu readOrders).
 */
export function saveOrder(client: EmagClient, order: EmagOrder): Promise<unknown> {
  // eMAG order/save așteaptă un ARRAY de comenzi, nu un obiect ("Expected list
  // of arrays, single array received"). Vezi cancelOrder/stornoOrder mai jos.
  return client.save('order', [order]);
}

/**
 * Doc § 5.2 — order/acknowledge/{id}.
 *
 * "Order acknowledge is the only method of marking the order status as
 * 'in progress'. It is available only for 3P orders." (doc § 5.2)
 *
 * Trebuie apelat după ce ai salvat comanda în DB-ul propriu pentru a opri
 * notificările repetate de la eMAG.
 */
export function acknowledgeOrder(client: EmagClient, orderId: number): Promise<unknown> {
  return client.call(`order/acknowledge/${orderId}`, {});
}

/**
 * Doc § 5 (4.4.7) — order/{orderId}/unlock-courier.
 *
 * Endpoint adăugat în 4.4.7. Se folosește când eMAG a setat un courier
 * preferat (`enforced_vendor_courier_accounts`) dar seller-ul are nevoie
 * să-l deblocheze pentru a folosi alt courier.
 */
export function unlockCourier(client: EmagClient, orderId: number): Promise<unknown> {
  return client.call(`order/${orderId}/unlock-courier`, {});
}

/**
 * Înregistrează (sau suprascrie) URL-ul de callback la eMAG.
 * eMAG permite un singur callback URL per cont — setarea unui URL nou
 * îl suprascrie pe cel existent.
 *
 * Endpoint: POST /api-3/order/setcallback
 * Body: { callback_url: "https://..." }
 */
export function registerCallback(client: EmagClient, callbackUrl: string): Promise<unknown> {
  return client.call('order/setcallback', { callback_url: callbackUrl });
}

/**
 * Anulează o comandă pe eMAG folosind order/save cu status=0.
 * eMAG doc § 5 — status 0 = cancelled; reason_cancellation = numeric ID motivul anulării.
 */
export function cancelOrder(
  client: EmagClient,
  orderId: number,
  reasonId: number,
): Promise<unknown> {
  return client.save('order', [{ id: orderId, status: 0, reason_cancellation: reasonId }]);
}

/**
 * Marchează o comandă finalizată (status=4) ca returnată total (status=5).
 * eMAG doc § 5 — funcționează doar în intervalul legal de retur.
 */
export function stornoOrder(client: EmagClient, orderId: number): Promise<unknown> {
  return client.save('order', [{ id: orderId, status: 5 }]);
}

/**
 * Storno parțial — reduce cantitățile produselor returnate via is_storno=true.
 * eMAG doc § 5 — status 5 se setează automat când toate produsele ajung la qty=0.
 * Nu funcționează pentru comenzi plătite cu Online Card.
 */
export function partialStornoOrder(
  client: EmagClient,
  orderId: number,
  products: { id: number; quantity: number; status: number }[],
): Promise<unknown> {
  return client.save('order', [{ id: orderId, is_storno: true, products }]);
}
