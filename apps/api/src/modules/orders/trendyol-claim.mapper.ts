/**
 * Transformă structura reală (nested) a unui claim Trendyol în forma plată pe care o consumă
 * storage-apk (via n8n) și în liniile de retur folosite pentru storno.
 *
 * Structura reală (doc Trendyol "Getting Returned Orders"):
 *   content[] = claim:
 *     { claimId, orderNumber, claimDate, cargoTrackingNumber, cargoSenderNumber,
 *       items[]: { orderLine: { barcode, merchantSku, productName, ... },
 *                  claimItems[]: { id (=claimLineItemId), claimItemStatus: { name } } } }
 *
 * IMPORTANT: cantitatea NU e un câmp — fiecare unitate returnată e un `claimItems[]` separat.
 * Cantitatea per linie = numărul de claimItems (într-un status dat).
 */

/** Doar claimItems în acest status pot fi aprobate/respinse (doc Trendyol). */
const ACTIONABLE_STATUS = 'WaitingInAction';

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
}
function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}
function asStringLoose(v: unknown): string | undefined {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && !Number.isNaN(v)) return String(v);
  return undefined;
}
function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export interface FlatClaimItem {
  barcode: string;
  merchantSku: string;
  productName: string;
  quantity: number;
}

export interface FlatClaim {
  claimId: string;
  orderNumber: string;
  claimDate: number | null;
  customerClaimItemReason: string | null;
  /** AWB-uri de potrivit la scanare (tracking retur Trendyol + tracking curier propriu). */
  awbs: string[];
  /** ID-urile claimItems în WaitingInAction — trimise la approve/reject. */
  claimLineItemIdList: string[];
  items: FlatClaimItem[];
}

/** O linie de retur pregătită pentru storno: SKU-uri candidate + cantitate aprobată. */
export interface ClaimReturnLine {
  /** merchantSku Trendyol — de potrivit pe order_items.sku (cazul produselor listate de noi). */
  merchantSku: string;
  /** barcode Trendyol — de potrivit pe order_items.sku (cazul fallback din order-sync). */
  barcode: string;
  productName: string;
  quantity: number;
}

interface ParsedItem {
  barcode: string;
  merchantSku: string;
  productName: string;
  /** [claimLineItemId, status] pentru fiecare unitate returnată de pe această linie. */
  units: { id: string; status: string }[];
  reason: string | undefined;
}

function parseItems(raw: Record<string, unknown>): ParsedItem[] {
  return asArray(raw.items)
    .map((it): ParsedItem | null => {
      const item = asRecord(it);
      if (!item) return null;
      const orderLine = asRecord(item.orderLine) ?? {};
      const claimItems = asArray(item.claimItems);
      const units = claimItems
        .map((ci) => {
          const c = asRecord(ci);
          if (!c) return null;
          const id = asStringLoose(c.id);
          if (!id) return null;
          const status = asString(asRecord(c.claimItemStatus)?.name) ?? '';
          return { id, status };
        })
        .filter((u): u is { id: string; status: string } => u !== null);
      const firstReason =
        asString(asRecord(asRecord(claimItems[0])?.customerClaimItemReason)?.name) ?? undefined;
      return {
        barcode: asStringLoose(orderLine.barcode) ?? '',
        merchantSku: asStringLoose(orderLine.merchantSku) ?? '',
        productName: asString(orderLine.productName) ?? '',
        units,
        reason: firstReason,
      };
    })
    .filter((x): x is ParsedItem => x !== null);
}

/** Forma plată pentru storage-apk (via n8n). Cantitatea = nr. de unități WaitingInAction. */
export function flattenClaim(raw: Record<string, unknown>): FlatClaim | null {
  const claimId = asStringLoose(raw.claimId) ?? asStringLoose(raw.id);
  const orderNumber = asStringLoose(raw.orderNumber);
  if (!claimId || !orderNumber) return null;

  const parsed = parseItems(raw);
  const awbs = [
    asStringLoose(raw.cargoTrackingNumber),
    asStringLoose(raw.cargoSenderNumber),
  ].filter((a): a is string => Boolean(a));
  const claimLineItemIdList: string[] = [];
  const items: FlatClaimItem[] = [];
  let reason: string | null = null;
  for (const p of parsed) {
    const actionable = p.units.filter((u) => u.status === ACTIONABLE_STATUS);
    if (actionable.length === 0) continue;
    for (const u of actionable) claimLineItemIdList.push(u.id);
    items.push({
      barcode: p.barcode,
      merchantSku: p.merchantSku,
      productName: p.productName,
      quantity: actionable.length,
    });
    if (!reason && p.reason) reason = p.reason;
  }

  return {
    claimId,
    orderNumber,
    claimDate: typeof raw.claimDate === 'number' ? raw.claimDate : null,
    customerClaimItemReason: reason,
    awbs,
    claimLineItemIdList,
    items,
  };
}

/**
 * Din claim-ul brut + lista de claimLineItemIds APROBATE, construiește liniile de retur
 * (grupate pe produs, cantitate = câte unități aprobate). Folosit pentru storno.
 */
export function approvedReturnLines(
  raw: Record<string, unknown>,
  approvedIds: string[],
): ClaimReturnLine[] {
  const approved = new Set(approvedIds);
  const lines: ClaimReturnLine[] = [];
  for (const p of parseItems(raw)) {
    const qty = p.units.filter((u) => approved.has(u.id)).length;
    if (qty === 0) continue;
    lines.push({
      merchantSku: p.merchantSku,
      barcode: p.barcode,
      productName: p.productName,
      quantity: qty,
    });
  }
  return lines;
}
