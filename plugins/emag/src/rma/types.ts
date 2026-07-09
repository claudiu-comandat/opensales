/**
 * eMAG RMA (Return Merchandise Authorization) types — modelate după doc 4.5.1,
 * secțiunea 7 (Processing return requests).
 *
 * Note importante de versiune:
 *   - 4.4.3: au fost adăugate cheile `return_reason` și `observations` la nivel
 *     de produs pe rma/read și rma/save.
 *   - 4.4.6: au fost ELIMINATE cheile `customer_email`, `id` (la nivel root —
 *     `id` rămâne ca seller-internal id, dar nu mai e returnat de eMAG ca
 *     identificator extern) și `invoice_number` din rma/read și rma/save.
 *     Aici păstrăm câmpurile ca opționale ca să nu trântim parsing pe răspunsuri
 *     mai vechi care le mai pot conține. Caller-ul trebuie să nu se bazeze pe
 *     ele când lucrează cu API >= 4.4.6.
 *   - 4.4.7: filtrul de tip `date` pe rma/read a fost rebotezat în
 *     `date_start` și `date_end`.
 *   - 4.4.8: a fost adăugată cheia `type` pe rma/save (Required) și un filtru
 *     `type` pe rma/read pentru a separa cererile fulfilled by eMAG (2) de
 *     cele fulfilled by seller (3).
 *   - 4.5.0: a fost adăugată cheia `currency` pe rma/read și rma/save.
 */

/** Doc § 7 — Status matrix pentru cereri de retur. */
export const RmaStatus = {
  Incomplete: 1,
  New: 2,
  Acknowledged: 3,
  Refused: 4,
  Canceled: 5,
  Received: 6,
  Finalized: 7,
} as const;

export type RmaStatusCode = (typeof RmaStatus)[keyof typeof RmaStatus];

/** Doc § 7 — `type` flag (4.4.8). */
export const RmaFulfillmentType = {
  ByEmag: 2,
  BySeller: 3,
} as const;

export type RmaFulfillmentCode = (typeof RmaFulfillmentType)[keyof typeof RmaFulfillmentType];

/** Doc § 7 — pickup_method la nivel AWB. */
export const RmaPickupMethod = {
  EmagCourier: 1,
  SellerCourier: 2,
  SentByClient: 3,
} as const;

export type RmaPickupMethodCode = (typeof RmaPickupMethod)[keyof typeof RmaPickupMethod];

/**
 * Doc § 7 — Produs returnat din lista `products[]`.
 *
 * `return_reason` (4.4.3+) și `observations` (4.4.3+) sunt câmpurile cheie
 * adăugate când eMAG a îmbunătățit fluxul de retur. `observations` poate fi
 * Optional sau Required în funcție de motivul ales (vezi tabelul de hierarchy
 * din docul eMAG: 0 = no notes, 1 = optional notes, 2 = mandatory notes).
 */
export interface RmaProduct {
  /** eMAG-internal id pe linia de produs returnat (Required pe save). */
  id: number;
  product_emag_id?: number;
  product_id?: number;
  product_name?: string;
  quantity?: number;
  /** ID-ul motivului de retur ales de client (4.4.3+). */
  return_reason?: number;
  /** Note libere (4.4.3+). Required dacă return_reason e mandatory. */
  observations?: string;
  diagnostic?: number;
  reject_reason?: number;
  refund_value?: string | number;
}

/** Doc § 7 — `awbs[]` la nivel de cerere de retur. */
export interface RmaAwb {
  reservation_id?: number;
  pickup_country?: string;
  pickup_suburb?: string;
  pickup_city?: string;
  pickup_address?: string;
  pickup_address_id?: number;
  pickup_zipcode?: string;
  pickup_date?: string;
  pickup_locality_id?: number;
  pickup_method?: RmaPickupMethodCode;
  return_reason?: number;
}

/**
 * Doc § 7 — Envelope full pentru rma/read și rma/save.
 *
 * Câmpurile marcate ca Optional în doc rămân opționale aici pentru a tolera
 * platformele și versiunile diferite. Câmpurile eliminate în 4.4.6
 * (`customer_email`, `id` ca extern, `invoice_number`) sunt declarate ca
 * opționale pentru compat backwards.
 */
export interface EmagRma {
  /** eMAG system ID — primary external key. Required pe save. */
  emag_id: number;
  /** Seller-internal id (Optional/legacy). */
  id?: number;
  /** Order id de pe care provine returul. Required pe save. */
  order_id: number;
  /** Type (4.4.8) — Required pe save: 2 = FBE, 3 = seller-fulfilled. */
  type: RmaFulfillmentCode;
  /** Status curent al cererii. */
  status?: RmaStatusCode;
  /** Optional/legacy (eliminat în 4.4.6 — păstrat pentru compat). */
  invoice_number?: string;
  /** Data introducerii cererii (eMAG returnează ca string YYYY-MM-DD HH:ii:ss). */
  date?: string;
  customer_name?: string;
  customer_company?: string;
  customer_phone?: string;
  /** ELIMINAT în 4.4.6 — declarat opțional pentru compat backwards cu API-uri vechi. */
  customer_email?: string;
  /** Lista de produse returnate. */
  products?: RmaProduct[];
  /**
   * Lista de produse refundate (informativ; populat de eMAG după ce
   * decontarea e finalizată).
   */
  products_refunded?: RmaProduct[];
  awbs?: RmaAwb[];
  /** Currency (4.5.0) — important pentru BG. */
  currency?: string;
}

/** Doc § 7.1 — Filtre disponibile la rma/read. */
export interface RmaReadFilters {
  id?: number;
  emag_id?: number;
  order_id?: number;
  product_id?: number;
  product_emag_id?: number;
  request_status?: RmaStatusCode;
  /** 4.4.7+ — în versiunile vechi era `date`. */
  date_start?: string;
  /** 4.4.7+. */
  date_end?: string;
  /** 4.4.8+ — filter pe tip retur. */
  type?: RmaFulfillmentCode;
  itemsPerPage?: number;
  currentPage?: number;
}

export interface RmaReadResult {
  items: EmagRma[];
  currentPage: number;
  itemsPerPage: number;
  totalCount?: number;
}

/**
 * Doc § 7 — Payload-ul minim pentru rma/save (update status / observations).
 *
 * eMAG cere ca update-ul să trimită toate câmpurile relevante (similar
 * cu order/save). În practică, caller-ul trebuie să pornească de la o
 * cerere `EmagRma` citită anterior și să muteze status-ul / observațiile.
 *
 * `type` este Required din 4.4.8.
 */
export type RmaSavePayload = EmagRma;
