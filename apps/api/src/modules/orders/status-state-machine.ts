export type OrderStatus =
  | 'new'
  | 'processing'
  | 'packed'
  | 'shipped'
  | 'delivered'
  | 'undelivered'
  | 'returned'
  | 'cancelled'
  | 'refunded';

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['shipped', 'cancelled'],
  shipped: ['delivered', 'undelivered', 'returned'],
  delivered: ['returned'],
  undelivered: ['returned', 'cancelled'],
  returned: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export function isCancellation(from: OrderStatus, to: OrderStatus): boolean {
  return to === 'cancelled' && canTransition(from, 'cancelled');
}
