import type { EmagClient } from '../client.js';
import type { OrderVolumetry, OrderVolumetryFilters } from './types.js';

/**
 * Doc § 6.10 (4.5.1) — order/volumetry/read.
 *
 * Returnează volumetria fiecărui produs dintr-o comandă, scenariu valid:
 *  - quantity 1 per produs ȘI
 *  - un singur colet/plic.
 *
 * Folosit la emiterea AWB-ului ca alternativă la dimensiunile manuale.
 */
export async function readVolumetry(
  client: EmagClient,
  filters: OrderVolumetryFilters,
): Promise<OrderVolumetry> {
  const body: Record<string, unknown> = { order_id: filters.order_id };
  if (filters.type !== undefined) body.type = filters.type;
  if (filters.product_id !== undefined) body.product_id = filters.product_id;
  // EmagClient.read unwraps `results`. Pentru order/volumetry/read,
  // `results` conține obiectul cu `order_id`, `type`, `volumetric_data`.
  const raw = await client.read<OrderVolumetry | OrderVolumetry[]>('order/volumetry', body);
  if (Array.isArray(raw)) {
    return (
      raw[0] ?? {
        order_id: filters.order_id,
        ...(filters.type !== undefined ? { type: filters.type } : {}),
        volumetric_data: [],
      }
    );
  }
  return raw;
}
