/**
 * Tipuri pentru AWB & Shipping (doc § 6 + § 7 + § 8 + § 9).
 *
 * Acoperă endpoint-urile:
 *   - awb/save, awb/read, awb/read_pdf (§ 6.1, 6.2, 6.3)
 *   - awb/package/read, awb/package/save (§ 6.9, nou în 4.5.1)
 *   - locality/read, locality/count (§ 6.5, 6.6)
 *   - courier_accounts/read (§ 6.7)
 *   - addresses/read (§ 6.8, nou în 4.4.9)
 */

/**
 * Sender / Receiver pe AWB. eMAG cere aceleași câmpuri pe ambele părți, cu mici
 * diferențe (legal_entity e relevant doar pe receiver).
 */
export interface AwbParty {
  /** Numele expeditorului/destinatarului (3..255). */
  name: string;
  /** Persoană de contact (1..255). */
  contact: string;
  /** Telefon principal (8..11 cifre, opțional cu '+' la început). */
  phone1: string;
  /** Telefon secundar (opțional, aceleași constrângeri). */
  phone2?: string;
  /** Doar pe receiver: 0 = persoană fizică, 1 = persoană juridică. */
  legal_entity?: 0 | 1;
  /**
   * ID-ul adresei salvate în contul tău (4.4.9). Dacă e furnizat pe S (la
   * comenzi) sau pe R (la retururi), eMAG folosește adresa stocată indiferent
   * de celelalte câmpuri trimise.
   */
  address_id?: string;
  /** ID-ul localității din baza eMAG (1..4294967295). */
  locality_id: number;
  /** Strada + numărul + alte detalii. */
  street: string;
  /** Cod poștal (opțional). */
  zipcode?: string;
}

/**
 * Pachet pe AWB. Câmpurile length/width/height au fost adăugate în 4.5.1.
 * Toate cele cinci sunt necesare la emiterea AWB-ului dacă pachetul e specificat.
 */
export interface AwbPackage {
  /** kg, double 0..99999. */
  weight: number;
  /** cm, double 0..99999 (4.5.1). */
  length: number;
  /** cm, double 0..99999 (4.5.1). */
  width: number;
  /** cm, double 0..99999 (4.5.1). */
  height: number;
}

/**
 * Pachet predefinit (awb/package/read + save, § 6.9). Spre deosebire de
 * AwbPackage, ăsta e un template salvat în cont, cu label și flag is_default.
 */
export interface AwbPackageTemplate {
  /** Numele dimensiunii (XS, S, M, L, XL). 0..5 char. */
  label: string;
  /** Lungime (cm). */
  length: number;
  /** Lățime (cm). */
  width: number;
  /** Înălțime (cm). */
  height: number;
  /** Greutate (kg). */
  weight: number;
  /** Pachet implicit la emitere AWB. */
  is_default: boolean;
}

/**
 * Payload-ul awb/save (request). Toate câmpurile opționale, cu excepția celor
 * marcate Required de eMAG: order_id (sau rma_id), sender, receiver,
 * envelope_number sau parcel_number, cod.
 */
export interface AwbSavePayload {
  /** ID-ul comenzii pe care se emite AWB. Obligatoriu pentru AWB de comandă. */
  order_id?: number;
  /** ID-ul cererii de retur (alternativ la order_id). */
  rma_id?: number;
  /** Tipul AWB (4.4.8): 1 = livrare client, 2 = pickup client. */
  type?: 1 | 2;
  /** Cont curier — id obținut din courier_accounts/read. */
  courier_account_id?: number;
  /** Date expeditor. */
  sender: AwbParty;
  /** Date destinatar. */
  receiver: AwbParty;
  /** Lista de pachete (optional, dar dacă e prezent toate cheile sunt obligatorii). */
  packages?: AwbPackage[];
  /** Colet supradimensionat (0/1). */
  is_oversize?: 0 | 1;
  /** Valoare asigurată. */
  insured_value?: number;
  /** Greutate totală (kg). Trebuie să fie suma greutăților din packages dacă e furnizat. */
  weight?: number;
  /** Număr de plicuri. */
  envelope_number?: number;
  /** Număr de colete. */
  parcel_number?: number;
  /** Observație (text liber, max 255). */
  observation?: string;
  /** Pickup point id (locker). 3..255 char. */
  locker_id?: string;
  /** Livrare în locker (0/1). */
  dropoff_locker?: 0 | 1;
  /** Cash on delivery. */
  cod?: number;
  /** Sender expects something back (0/1). */
  pickup_and_return?: 0 | 1;
  /** Unboxing permis la livrare (0/1) — adăugat 4.4.7. */
  unboxing?: 0 | 1;
  /** Data programată de pickup (ISO 8601) — adăugat 4.4.7. */
  date?: string;
  /** Moneda (eMAG BG cere acest câmp explicit pe awb/save din 4.5.0). */
  currency?: string;
}

/** Răspunsul awb/save. */
export interface AwbSaveResult {
  /**
   * ID-ul intern eMAG al AWB-ului emis (folosit pe awb/read_pdf).
   * Poate lipsi la nivel root — în unele versiuni de API e prezent doar în awb[0].emag_id.
   */
  emag_id?: number;
  /** Codurile de bară emise de curier. */
  awb?: AwbBarcode[];
  /** Costul transportului (dacă e disponibil în răspuns). */
  cost?: number;
  /** Moneda costului. */
  currency?: string;
}

export interface AwbBarcode {
  emag_id: number;
  /** Câmpul returnat de eMAG ≥4.5 (fosta denumire: barcode). */
  awb_barcode?: string;
  /** Numărul AWB fără sufixul coletului (ex. "4EMGLN175641495"). */
  awb_number?: string;
  /** Alias legacy — prezent în unele răspunsuri mai vechi. */
  barcode?: string;
}

/**
 * Răspunsul awb/read. Format complex (level 1 + level 2 ca în doc § 6.2).
 * Definim doar câmpurile pe care le folosim — restul rămân la nivel de
 * `Record<string, unknown>` pentru cei care vor să le inspecteze.
 */
export interface AwbReadItem {
  emag_id: number;
  order_id?: number;
  rma_id?: number;
  /** 1 = delivery to customer, 2 = pickup from customer (returned only on RMA AWB). */
  awb_type?: 1 | 2;
  weight?: number;
  cash_on_delivery?: number;
  awb?: AwbBarcode[];
  type?: number;
  /** Statusul curent al AWB-ului (ex: { code: 'DLV', name: 'Delivered', description: '...' }). */
  status?: { code: string; name: string; description: string };
  /** Contul de curier asociat AWB-ului. */
  courier?: { courier_account_id: number; courier_name: string };
  /** Câmpuri suplimentare returnate de eMAG, lăsate untyped pentru flexibilitate. */
  [key: string]: unknown;
}

export interface AwbReadFilters {
  emag_id?: number;
  order_id?: number;
  rma_id?: number;
  itemsPerPage?: number;
  currentPage?: number;
}

/** Format paper pentru awb/read_pdf. */
export type AwbPdfFormat = 'A4' | 'A5' | 'A6' | 'ZPL';

export interface AwbPdfResult {
  /** Bytes brute returnate de eMAG. */
  bytes: Uint8Array;
  /** Content-Type-ul răspunsului (de obicei application/pdf). */
  contentType: string | null;
  /** HTTP status code. */
  status: number;
}

/* === awb/package === */

/** Filtre pentru awb/package/read. Lăsate flexibile — eMAG nu publică o listă strictă. */
export interface AwbPackageReadFilters {
  itemsPerPage?: number;
  currentPage?: number;
}

/** Payload pentru awb/package/save: lista de pachete predefinite (toate, cu valorile noi). */
export interface AwbPackageSavePayload {
  packages: AwbPackageTemplate[];
}

/* === courier_accounts === */

/**
 * Tipul contului courier (1=RMA, 2=Order, 3=RMA & Order, 4=Non Marketplace).
 */
export type CourierAccountType = 1 | 2 | 3 | 4;

/**
 * Proprietate cont curier. eMAG returnează un array de coduri:
 *   0 = Regular (HD), 2 = Lockers, 6 = Offices, 8 = Crossborder, 9 = BPO.
 */
export type CourierAccountProperty = 0 | 2 | 6 | 8 | 9;

export interface CourierAccount {
  account_id: number;
  account_display_name: string;
  courier_account_type: CourierAccountType;
  courier_name: string;
  /** Proprietățile contului — chei păstrate cu numele original `currier_account_properties`
   * (typo în doc), cât și varianta corectă pentru compat. */
  courier_account_properties?: CourierAccountProperty[];
  currier_account_properties?: CourierAccountProperty[];
  /** Y-m-d H:i:s. */
  created?: string;
  /** 1 = Active, 0 = Inactive. */
  status: 0 | 1;
  /** Țara din care curierul ridică comenzile (Alpha-2). Adăugat în 4.4.7. */
  pickup_country_code?: string;
}

export interface CourierAccountFilters {
  itemsPerPage?: number;
  currentPage?: number;
}

/* === locality === */

export interface Locality {
  emag_id: number;
  name: string;
  name_latin?: string;
  /** Doc-ul listează region(\\d+) ca un set de chei dinamice. */
  region1?: string;
  region2?: string;
  region3?: string;
  region4?: string;
  /** Țara (Alpha-2). În 4.4.7 cheia s-a redenumit din "country" în "country_code". */
  country_code?: string;
  /** Codul poștal (4.4.7). */
  zipcode?: string;
  /** Codul ISO2 al țării (4.4.8). Identic cu country_code în practică. */
  iso2?: string;
  /** Y-m-d H:i:s. */
  modified?: string;
}

export interface LocalityFilters {
  emag_id?: number;
  name?: string;
  region2?: string;
  /** Alpha-2: RO, BG, HU, PL, EL, DE. */
  country_code?: string;
  /** Cod poștal (4.4.7). */
  zipcode?: string;
  /** Cod ISO2 (4.4.8) — alias country_code. */
  iso2?: string;
  modified?: string;
  itemsPerPage?: number;
  currentPage?: number;
}

export interface LocalityCountResult {
  /** Numărul total de localități care match-uiesc filtrul. */
  noOfItems?: number;
  /** Variantă cunoscută în răspunsul eMAG. */
  noOfItemsTotal?: number;
}

/* === addresses (4.4.9) === */

export type AddressType = 1 | 2 | 3 | 4;

export interface Address {
  /** ID-ul adresei (string 0..21). */
  address_id: string;
  country_id?: number;
  /** Alpha-2. */
  country_code?: string;
  /** 1=return, 2=pickup, 3=invoice/HQ, 4=delivery estimates. */
  address_type_id: AddressType;
  locality_id?: number;
  /** Județ. */
  suburb?: string;
  city?: string;
  /** Stradă + nr. + restul. */
  address?: string;
  zipcode?: string;
  quarter?: string;
  floor?: string;
  is_default?: boolean;
}

export interface AddressFilters {
  address_id?: string;
  address_type_id?: AddressType;
  country_code?: string;
  itemsPerPage?: number;
  currentPage?: number;
}
