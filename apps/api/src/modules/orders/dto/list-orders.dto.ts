import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Normalizează un query param care poate fi:
 *   - undefined → []  (filtrul nu e aplicat)
 *   - string single   → [string]
 *   - string cu virgule "a,b" → ["a","b"]
 *   - string[] (NestJS repeating params) → string[]
 *   - alt scalar      → [scalar]
 * Rezultatul e validat ca z.array(itemSchema).
 */
/**
 * Normalizează un query param boolean care vine ca string din HTTP:
 *   - "false" / "0" → false
 *   - "true"  / "1" → true
 *   - undefined / null / "" → undefined (filtrul nu e aplicat)
 * z.coerce.boolean() NU funcționează — orice string non-gol (inclusiv "false") e coercizat la true.
 */
function boolParam() {
  return z
    .preprocess((v): boolean | undefined => {
      if (v === undefined || v === null || v === '') return undefined;
      if (v === 'false' || v === '0') return false;
      if (v === 'true' || v === '1') return true;
      return Boolean(v);
    }, z.boolean().optional())
    .optional();
}

function multiParam<T extends z.ZodTypeAny>(itemSchema: T) {
  return z
    .preprocess((v): unknown[] => {
      if (v === undefined || v === null) return [];
      if (Array.isArray(v)) return v as unknown[];
      if (typeof v === 'string') return v.length > 0 ? v.split(',') : [];
      return [v];
    }, z.array(itemSchema))
    .optional();
}

const ORDER_STATUS_VALUES = [
  'new',
  'processing',
  'packed',
  'shipped',
  'delivered',
  'undelivered',
  'returned',
  'cancelled',
  'refunded',
] as const;

export const listOrdersSchema = z.object({
  /**
   * Unul sau mai multe statusuri (repetate sau virgulă-separate).
   * Ex: status=new&status=processing  sau  status=new,processing
   */
  status: multiParam(z.enum(ORDER_STATUS_VALUES)),
  pluginId: z.string().uuid().optional(),
  placedAfter: z.coerce.date().optional(),
  placedBefore: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  /** Full-text search across externalId, customerName, customerPhone, customerEmail, and item SKU. Internal use (web app). */
  search: z.string().optional(),
  /**
   * Lookup exact după AWB (de livrare sau de retur) — folosit de app-ul de depozit la
   * procesarea retururilor, ca să găsească o comandă după AWB-ul scanat fără a descărca
   * toată lista. Aplică automat și filtru de recență (max 3 luni): un colet neridicat nu
   * e niciodată mai vechi de atât.
   */
  awb: z.string().trim().min(1).optional(),
  /**
   * Include: returnează doar comenzile cu marketplace-ul în lista dată.
   * Ex: marketplaceInclude=emag-ro  sau  marketplaceInclude=emag-ro,fbe-ro
   */
  marketplaceInclude: multiParam(z.string().min(1)),
  /**
   * Exclude: returnează comenzile cu marketplace-ul ÎN AFARA listei date.
   * Comenzile fără marketplace (null) trec filtrul.
   * Ex: marketplaceExclude=temu  sau  marketplaceExclude=temu,trendyol-ro
   */
  marketplaceExclude: multiParam(z.string().min(1)),
  /**
   * true  → comenzile CU factură
   * false → comenzile FĂRĂ factură
   * (omis) → fără filtru
   */
  hasInvoice: boolParam(),
  /** true = cu AWB, false = fără AWB. */
  hasAwb: boolParam(),
  /** true = cu linie TRANSPORT, false = fără. */
  hasShipping: boolParam(),
  /** true = cu linie VOUCHER, false = fără. */
  hasVoucher: boolParam(),
  /**
   * Unul sau mai mulți payment_mode_id (1=Ramburs, 2=Transfer Bancar, 3=Card Online).
   * Ex: paymentMethod=1  sau  paymentMethod=1,3
   */
  paymentMethod: multiParam(z.coerce.number().int().min(1)),
  /**
   * Unul sau mai multe moduri de livrare.
   * Ex: deliveryMode=pickup  sau  deliveryMode=pickup,courier
   */
  deliveryMode: multiParam(z.enum(['pickup', 'courier'])),
  /** true = cu cerere de anulare, false = fără cerere de anulare. */
  hasCancellationRequest: boolParam(),
  /**
   * true  → comenzile cu MINIM UN produs neidentificat (productId=null, nu linie virtuală)
   * false → comenzile unde TOATE produsele sunt identificate
   */
  hasUnmatchedItems: boolParam(),
});

export class ListOrdersDto extends createZodDto(listOrdersSchema) {}
