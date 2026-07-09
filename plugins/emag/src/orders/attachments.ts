import type { EmagClient } from '../client.js';
import type { OrderAttachment } from './types.js';

/**
 * Doc § 5.1.3 — order/attachments/read.
 *
 * Returnează lista atașamentelor (factură, garanție, AWB, manual) pentru o
 * comandă. Filtrul: `{ data: { id: orderId } }` — fără `data` wrapper eMAG
 * ignoră filtrul și returnează toate comenzile.
 */
export function readAttachments(client: EmagClient, orderId: number): Promise<OrderAttachment[]> {
  return client.read<OrderAttachment[]>('order/attachments', { data: { id: orderId } });
}

/**
 * Doc § 5.1.3 — order/attachments/save.
 *
 * Upload factură (type=1) sau garanție (type=3) pentru o comandă.
 * Pentru garanții este obligatoriu `order_product_id`.
 */
export function saveAttachment(client: EmagClient, attachment: OrderAttachment): Promise<unknown> {
  return client.save('order/attachments', { data: [attachment] });
}
