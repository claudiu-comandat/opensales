export const PLATFORM_EVENTS = [
  'product.created',
  'product.updated',
  'product.deleted',
  'stock.changed',
  'listing.created',
  'listing.updated',
  'listing.deleted',
  'order.created',
  'order.status_changed',
  'order.cancelled',
  'awb.outgoing.issued',
  'awb.return.issued',
  'invoice.issued',
  'invoice.storno.issued',
] as const;

export type PlatformEventName = (typeof PLATFORM_EVENTS)[number];
export type EventName = PlatformEventName | `custom.${string}`;

export function isPlatformEvent(name: string): name is PlatformEventName {
  return (PLATFORM_EVENTS as readonly string[]).includes(name);
}

export function isCustomEvent(name: string): name is `custom.${string}` {
  return name.startsWith('custom.');
}
