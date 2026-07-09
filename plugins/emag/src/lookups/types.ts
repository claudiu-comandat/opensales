/**
 * eMAG lookup types — modelate după doc 4.5.1, secțiunile 2.1-2.3 și 8.
 *
 * "Lookup" = endpoint-uri readonly de catalog: categorii (cu caracteristicile
 * și family_types), VAT rates, handling time și invoice categories. Folosite
 * pentru a popula UI-uri de configurare și pentru a valida payload-urile
 * trimise pe `product_offer/save`.
 *
 * Tipurile sunt deliberat permisive pe câmpurile opționale — eMAG omite valori
 * când nu sunt aplicabile. Numele câmpurilor sunt păstrate exact ca în API
 * (snake_case) pentru a evita transformări inutile la nivelul clientului.
 */

/**
 * Doc § 2.1 — type_id pe characteristic. Indică tipul de valori pe care îl
 * acceptă o caracteristică.
 */
export const CharacteristicTypeId = {
  /** Single-value: numeric (ex: 20, 1, 30, 40) */
  Numeric: 1,
  /** Multi-value: numeric + unit (ex: 30 cm, 45 m, 20 GB) */
  NumericWithUnit: 2,
  /** Multi-value: text fixed (max 255 chars) */
  TextFixed: 11,
  /** Single-value: boolean (Yes / No / N/A) */
  Boolean: 20,
  /** Multi-value: resolution (ex: 100 x 200) */
  Resolution: 30,
  /** Multi-value: volume (Width x Height x Depth - Depth 2) */
  Volume: 40,
  /** Single-value: size (ex: 36 EU, XL INTL) */
  Size: 60,
} as const;

export type CharacteristicTypeIdValue =
  (typeof CharacteristicTypeId)[keyof typeof CharacteristicTypeId];

/**
 * Limbi disponibile pentru parametrul `language` de la category/read (4.4.4+).
 */
export const CategoryLanguage = {
  EN: 'EN',
  RO: 'RO',
  HU: 'HU',
  BG: 'BG',
  PL: 'PL',
  GR: 'GR',
  DE: 'DE',
} as const;

export type CategoryLanguageValue = (typeof CategoryLanguage)[keyof typeof CategoryLanguage];

/**
 * Doc § 2.1 — characteristic family_type metadata. Determină modul de display
 * al variantei (thumbnails, combobox, graphic selection).
 */
export interface FamilyTypeCharacteristic {
  characteristic_id: number;
  /**
   * 1 = Thumbnails, 2 = Combobox, 3 = Graphic Selection.
   */
  characteristic_family_type_id?: number;
  /** Foldable: family-members folded ca un singur item în listing-ul eMAG. */
  is_foldable?: number;
  display_order?: number;
}

/**
 * Doc § 2.1 — family type definition.
 */
export interface FamilyType {
  id: number;
  name: string;
  characteristics?: FamilyTypeCharacteristic[];
}

/**
 * Doc § 2.1 — category characteristic.
 *
 * `values` apare DOAR când citim o singură categorie (cu id în filtre); pentru
 * listing nu vine. Folosim `valuesCurrentPage` / `valuesPerPage` în filtrele
 * de read pentru a pagina valorile (vezi categories.ts).
 *
 * `tags` (4.4.6+): unele caracteristici (ex. Size — id 6506) au tags
 * (`original`, `converted`); pentru ele trebuie trimise multiple valori cu
 * `tag` distinct la save.
 */
export interface CategoryCharacteristic {
  id: number;
  name: string;
  /**
   * Type id — see CharacteristicTypeId for known values, but eMAG can return
   * unknown numeric ids when adding new characteristic types.
   */
  type_id?: number;
  display_order?: number;
  is_mandatory?: number;
  is_filter?: number;
  allow_new_value?: number;
  /** Valori posibile — disponibil doar pe single-category read. */
  values?: string[];
  /** Tags — disponibil pe characteristics care le suportă (4.4.6+). */
  tags?: string[];
  /** Marcat câmp required — alias pentru is_mandatory în unele răspunsuri. */
  required?: number;
}

/**
 * Doc § 2.1 — category (read response per element).
 */
export interface EmagCategory {
  id: number;
  name: string;
  /** 0 = seller-ul NU poate publica în categorie, 1 = poate. */
  is_allowed: number;
  parent_id?: number;
  is_ean_mandatory?: number;
  is_warranty_mandatory?: number;
  /** Disponibil doar la single-category read. */
  characteristics?: CategoryCharacteristic[];
  /** Disponibil doar la single-category read. */
  family_types?: FamilyType[];
}

/**
 * Doc § 2.1 — category/read filtre. Pagination la nivel de categorii
 * (4.4.7+) folosește currentPage/itemsPerPage; paginarea valorilor de
 * caracteristică (când id e dat) folosește valuesCurrentPage/valuesPerPage.
 */
export interface CategoryReadFilters {
  /** Citește o singură categorie cu characteristics + family_types. */
  id?: number;
  /** Limba pentru name-uri (4.4.4+). */
  language?: CategoryLanguageValue;
  /** Pagination la nivel de categorii. */
  currentPage?: number;
  itemsPerPage?: number;
  /** Pagination la nivel de values pe caracteristică (când id e setat). */
  valuesCurrentPage?: number;
  valuesPerPage?: number;
}

/** Output normalizat pentru readCategories. */
export interface CategoryReadResult {
  items: EmagCategory[];
  currentPage: number;
  itemsPerPage: number;
  totalCount?: number;
}

/**
 * Doc § 2.2 — VAT rate. `value` e exprimat ca decimal (ex. 0.19 pentru 19%).
 */
export interface EmagVatRate {
  /** Id-ul folosit pe `product_offer.vat_id`. */
  id: number;
  name?: string;
  /** Rata VAT, exprimată ca decimal (0.19 pentru 19%). */
  value: number;
}

/**
 * Doc § 2.3 — handling time. Singurul câmp util e `value` (nr. de zile).
 */
export interface EmagHandlingTime {
  /** Număr de zile (ex. 0..14). */
  value: number;
  name?: string;
}

/**
 * Doc § 8.1 — invoice category descriptor (din `/api-3/invoice/categories`).
 */
export interface EmagInvoiceCategory {
  id: number;
  name: string;
  description?: string;
}

/**
 * Doc § 8.2 — invoice (vendor invoice). `vendor_invoice` denotează factura
 * platformei către vendor (commission, fees, storno).
 */
export interface EmagInvoice {
  id?: number;
  /** Series + number (ex. "C-MKTP-100001"). */
  number: string;
  /** Invoice category (FC, etc.) — vine pe key `category` în răspuns. */
  category?: string;
  /** Invoice name. */
  name?: string;
  /** Tipul facturii (alias pentru `category` la unele rute). */
  type?: string;
  date?: string;
  is_storno?: number;
  /** Numărul facturii pe care o stornează (când is_storno=1). */
  reversal_for?: string;
  /** URL către PDF-ul facturii (când e disponibil). */
  vendor_invoice?: string;
  total_amount?: number | string;
  currency?: string;
}

/**
 * Doc § 8.2 — filtre pentru invoice/read.
 */
export interface InvoiceReadFilters {
  /** Categorie (din invoice/categories). */
  category?: string;
  /** Series + number. */
  number?: string;
  /** YYYY-MM-DD. */
  date_start?: string;
  /** YYYY-MM-DD. */
  date_end?: string;
  itemsPerPage?: number;
  currentPage?: number;
}

/** Output normalizat pentru readInvoices. */
export interface InvoiceReadResult {
  items: EmagInvoice[];
  currentPage: number;
  itemsPerPage: number;
  totalResults?: number;
}

/**
 * Doc § 8.3 — customer invoice. Aceeași formă ca EmagInvoice, dar emisă pe
 * orderId (nu pe vendor) — categoria e `normal` sau `storno`.
 */
export interface EmagCustomerInvoice extends EmagInvoice {
  /** Order-ul pentru care s-a emis factura. */
  order_id?: number | string;
}

/**
 * Doc § 8.3 — filtre pentru customer-invoice/read.
 */
export interface CustomerInvoiceReadFilters {
  /** "normal" sau "storno". */
  category?: 'normal' | 'storno';
  order_id?: string | number;
  number?: string;
  date_start?: string;
  date_end?: string;
  itemsPerPage?: number;
  currentPage?: number;
}

/** Output normalizat pentru readCustomerInvoices. */
export interface CustomerInvoiceReadResult {
  items: EmagCustomerInvoice[];
  currentPage: number;
  itemsPerPage: number;
  totalResults?: number;
}
