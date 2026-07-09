export const PERMISSIONS = [
  'products:read',
  'products:write',
  'listings:read',
  'listings:write',
  'orders:read',
  'orders:write',
  'orders:status:write',
  'stock:read',
  'stock:write',
  'awb:emit',
  'awb:read',
  'invoice:emit',
  'invoice:read',
  'events:subscribe',
  'events:emit',
  'http:outbound',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}
