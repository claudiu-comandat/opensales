/**
 * Tipuri pentru endpoint-urile eMAG `product_offer`, `offer`, `offer_stock`,
 * `measurements`, `documentation/find_by_eans`, commission și smart-deals.
 *
 * Sursă: eMAG Marketplace API v4.5.1, secțiunile 2.4-2.12 + 3 (Updating stock)
 * + 4.4.3 (commission) + 4.4.8 (smart-deals).
 *
 * Toate câmpurile sunt opționale la nivel de tip pentru a permite payload-uri
 * parțiale (e.g. la `offer/save` light se trimite doar id + sale_price + stock).
 * Validarea de business o face eMAG; aici tipăm permisiv.
 */

/** Status offer pe eMAG: 0 = Inactive, 1 = Active, 2 = End of life. Doc 2.4. */
export type EmagOfferStatus = 0 | 1 | 2;

/** Validation status — codes returnate la product_offer/read. Doc 2.9. */
export type EmagValidationStatusCode = number;

/**
 * Caracteristică (cheie/valoare) atașată unui produs. Pentru caracteristici
 * cu mai multe valori se trimit obiecte multiple cu același `id`. Doc 2.5.
 */
export interface EmagCharacteristic {
  id: number;
  /** Valoarea caracteristicii (string, număr trimis ca string). */
  value: string;
  /** Tag opțional, doar pentru caracteristicile care îl acceptă. Doc 2.5. */
  tag?: string;
}

/** Imagine produs. `display_type` 0 = main, 1 = secondary. Doc 2.5. */
export interface EmagImage {
  display_type?: 0 | 1 | 2;
  url: string;
  /** Md5 opțional al binarului — eMAG îl recomandă pentru deduplicare. */
  hash?: string;
}

/** EAN trimis la save (string sau array de string-uri). */
export type EmagEan = string;

/** Stock per warehouse. Doc 2.5. */
export interface EmagStockItem {
  warehouse_id: number;
  value: number;
}

/** Handling time per warehouse. Doc 2.5. */
export interface EmagHandlingTimeItem {
  warehouse_id: number;
  value: number;
}

/** Family info — produsele în aceeași family au pagină comună. Doc 2.5. */
export interface EmagProductFamily {
  id: number;
  family_type_id: number;
  name?: string;
}

/** Atașament (manual, certificare, etc.). Doc 2.5. */
export interface EmagAttachment {
  url: string;
  display_type?: number;
  type?: string;
}

/**
 * GPSR — General Product Safety Regulation.
 * `manufacturer` și `eu_representative` au structura cu nume + adresă + email.
 * Doc 2.5 (4.4.7+).
 */
export interface EmagGpsrEntity {
  name: string;
  address: string;
  email?: string;
  phone?: string;
}

/**
 * Validation error returnat în `validation_status[].errors`. Doc 2.9.
 */
export interface EmagValidationError {
  code?: string;
  message?: string;
  field?: string;
}

/**
 * Bloc `validation_status` returnat de product_offer/read.
 * Doc 2.9 — "Product validation responses".
 */
export interface EmagValidationStatus {
  value: EmagValidationStatusCode;
  description?: string;
  errors?: EmagValidationError[];
  translation_validation_status?: EmagValidationStatusCode;
}

/**
 * Payload pentru `product_offer/save` (full update / new product).
 * Doc 2.4-2.6.1.
 *
 * IMPORTANT: la update-uri pe oferte existente, eMAG cere doar:
 *   id, status, sale_price, vat_id, handling_time, stock.
 * Restul câmpurilor se trimit doar la creare sau update de documentație.
 */
export interface EmagProductOfferPayload {
  /** Seller internal product id. Required. Integer 1..16777215. */
  id: number;
  /** Vendor product id (cod intern al seller-ului). */
  vendor_product_id?: string;
  category_id?: number;
  name?: string;
  description?: string;
  brand?: string;
  part_number?: string;
  /** Set de eMAG după validare; util la atașare ofertă pe produs existent. */
  part_number_key?: string;
  ean?: EmagEan[] | EmagEan;
  images?: EmagImage[];
  /** Forțează rescrierea integrală a listei de imagini. Doc 4.4.8+. */
  images_overwrite?: 0 | 1;
  characteristics?: EmagCharacteristic[];
  family?: EmagProductFamily;
  status?: EmagOfferStatus;
  /** Preț de vânzare fără TVA. */
  sale_price?: number;
  /** Preț recomandat / de listă fără TVA. */
  recommended_price?: number;
  currency?: string;
  vat_id?: number;
  stock?: EmagStockItem[];
  handling_time?: EmagHandlingTimeItem[];
  /** 1 = available for sale, 2 = unavailable, etc. Doc 2.4. */
  availability?: number;
  /** Limba conținutului. Doc 4.4.0+ / 4.4.6+. */
  source_language?: string;
  attachments?: EmagAttachment[];
  /** GPSR. Doc 4.4.7+. */
  manufacturer?: EmagGpsrEntity;
  eu_representative?: EmagGpsrEntity;
  safety_information?: string;
  /** Eligibilitate eMAG Club. Doc 4.4.6+. */
  emag_club?: 0 | 1;
  /** Indică dacă oferta poate participa la programul Genius. */
  genius_eligibility?: 0 | 1;
  genius_computed?: 0 | 1;
  /** Doar eMAG RO. Doc 4.4.8+. */
  green_tax?: number;
  /** Pentru promoții — preț minim eligibil pentru badge Smart Deals. */
  min_sale_price?: number;
  max_sale_price?: number;
  start_date?: string;
}

/**
 * Payload pentru `offer/save` light update — doar offer-ul, fără documentație.
 * Doc 2.6.2.
 *
 * Doar câmpurile care trebuie actualizate se trimit. Acceptă: id, status,
 * sale_price, vat_id, recommended_price, currency, stock, handling_time,
 * min_sale_price, max_sale_price.
 */
export interface EmagLightOfferPayload {
  id: number;
  status?: EmagOfferStatus;
  sale_price?: number;
  recommended_price?: number;
  min_sale_price?: number;
  max_sale_price?: number;
  currency?: string;
  vat_id?: number;
  stock?: EmagStockItem[];
  handling_time?: EmagHandlingTimeItem[];
}

/**
 * Payload pentru `measurements/save`. Unități: milimetri și grame. Doc 2.7.
 */
export interface EmagMeasurementsPayload {
  /** Seller internal product id. */
  id: number;
  length: number;
  width: number;
  height: number;
  weight: number;
}

/** Filtre pentru `product_offer/read` și `count`. Doc 2.8. */
export interface EmagOffersReadFilters {
  status?: EmagOfferStatus;
  validation_status?: EmagValidationStatusCode;
  category_id?: number;
  brand?: string;
  part_number?: string;
  part_number_key?: string;
  ean?: string;
  /** Format ISO `YYYY-MM-DD HH:MM:SS`. */
  modifiedAfter?: string;
  modifiedBefore?: string;
  currentPage?: number;
  /** Maxim 100. Doc 1.3. */
  itemsPerPage?: number;
  /** Filtrare per-ofertă după ID-ul intern eMAG (returnează exact oferta cu statusul complet). */
  data?: { id: number };
}

/** Element returnat de product_offer/read. */
export interface EmagOfferReadItem {
  id: number;
  vendor_product_id?: string;
  category_id?: number;
  name?: string;
  brand?: string;
  part_number?: string;
  part_number_key?: string;
  ean?: string[];
  status?: EmagOfferStatus;
  sale_price?: number;
  recommended_price?: number;
  currency?: string;
  vat_id?: number;
  stock?: EmagStockItem[];
  handling_time?: EmagHandlingTimeItem[];
  general_stock?: number;
  estimated_stock?: number;
  reserved_stock?: number;
  buy_button_rank?: number;
  best_offer_sale_price?: number;
  ownership?: number;
  availability?: number;
  validation_status?: EmagValidationStatus[] | EmagValidationStatus;
  translation_validation_status?: EmagValidationStatus[] | EmagValidationStatus;
  offer_validation_status?: EmagValidationStatus[] | EmagValidationStatus;
  emag_club?: number;
  genius_eligibility?: number;
  genius_eligibility_type?: number;
  genius_computed?: number;
  green_tax?: number;
  attachments?: EmagAttachment[];
  manufacturer?: EmagGpsrEntity;
  eu_representative?: EmagGpsrEntity;
  safety_information?: string;
  /** Câmp meta — timestamp. */
  modified?: string;
  /** Restul câmpurilor pe care eMAG le poate adăuga ulterior. */
  [key: string]: unknown;
}

/**
 * Răspuns find_by_eans. Doc 2.10.
 *
 * Pentru fiecare EAN se returnează informații despre produsul deja existent
 * pe eMAG (dacă există): part_number_key, dacă vendor-ul are deja ofertă, etc.
 */
export interface EmagFindByEansItem {
  ean: string;
  part_number_key?: string;
  product_name?: string;
  brand_name?: string;
  category_name?: string;
  vendor_has_offer?: boolean;
  allow_to_add_offer?: boolean;
  hotness?: number;
  product_image?: string;
  site_url?: string;
}

/** Răspuns commission/{offerId}. Doc 2.12. */
export interface EmagCommissionResponse {
  value?: number;
  /** Procent — eMAG poate folosi `value` sau `percentage`. */
  percentage?: number;
  /** Marjă variabilă opțională per categorie. */
  category_id?: number;
  [key: string]: unknown;
}

/** Răspuns smart-deals-price-check. Doc 4.4.8. */
export interface EmagSmartDealsResponse {
  /** Preț target pentru a obține badge-ul. */
  target_price?: number;
  /** Discount minim necesar. */
  required_discount?: number;
  /** Indică dacă oferta primește deja badge-ul. */
  is_eligible?: boolean;
  currency?: string;
  [key: string]: unknown;
}
