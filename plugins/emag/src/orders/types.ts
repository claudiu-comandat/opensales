/**
 * eMAG order types — modelate după doc 4.5.1, secțiunea 5 (Processing orders).
 *
 * Tipurile sunt deliberat permisive pe câmpurile opționale (Optional în doc):
 * eMAG poate omite câmpuri când nu sunt aplicabile. Pentru fiecare câmp am
 * păstrat numele exact din API (snake_case) ca să evităm transformări inutile
 * la nivelul clientului.
 */

/** Doc § 5.3 — Order status matrix. */
export const OrderStatus = {
  Cancelled: 0,
  New: 1,
  InProgress: 2,
  Prepared: 3,
  Finalized: 4,
  Returned: 5,
} as const;

export type OrderStatusCode = (typeof OrderStatus)[keyof typeof OrderStatus];

/** Doc § 5.1 — payment_mode_id values. */
export const PaymentMode = {
  CashOnDelivery: 1,
  BankTransfer: 2,
  CardOnline: 3,
} as const;

export type PaymentModeCode = (typeof PaymentMode)[keyof typeof PaymentMode];

/** Doc § 5.1 — type field. 2 = fulfilled by eMAG (FBE), 3 = fulfilled by seller. */
export const OrderFulfillmentType = {
  ByEmag: 2,
  BySeller: 3,
} as const;

export type OrderFulfillmentCode = (typeof OrderFulfillmentType)[keyof typeof OrderFulfillmentType];

/** Doc § 5.1 — delivery_mode. */
export type DeliveryMode = 'courier' | 'pickup';

/** Voucher split — apare la nivel de comandă, produs, recycle_warranty și shipping_tax. */
export interface OrderVoucherSplit {
  voucher_id?: number;
  value?: number;
  vat_value?: number;
  vat?: number;
  offered_by?: string;
  voucher_name?: string;
}

/** Voucher la nivel de comandă (doc § 5.1). */
export interface OrderVoucher {
  voucher_id?: number;
  modified?: string;
  created?: string;
  status?: number;
  sale_price_vat?: string | number;
  sale_price?: string | number;
  voucher_name?: string;
  vat?: string | number;
  issue_date?: string;
}

/** Recycle warranty — doc § 5.1.1. */
export interface RecycleWarranty {
  quantity?: number;
  sale_price?: number;
  vat_rate?: number;
  product_name?: string;
  recycle_warranty_voucher_split?: OrderVoucherSplit[];
}

/** Doc § 5.1.1 — Product field in order details. */
export interface OrderProduct {
  /** eMAG-internal order product line id. Folosit la order/save. */
  id: number;
  product_id?: number;
  product_voucher_split?: OrderVoucherSplit[];
  status: number;
  part_number?: string;
  ext_part_number?: string;
  created?: string;
  modified?: string;
  currency?: string;
  quantity: number;
  sale_price: number | string;
  details?: string;
  recycle_warranties?: RecycleWarranty[];
  serial_numbers?: string;
  product_name?: string;
  vat?: number | string;
  initial_qty?: number;
  storno_qty?: number;
  cancellation_reason?: number;
}

/** Doc § 5.1.2 — Customer fields in order details. */
export interface OrderCustomer {
  id?: number;
  name?: string;
  email?: string;
  company?: string;
  gender?: string;
  code?: string;
  registration_number?: string;
  bank?: string;
  iban?: string;
  fax?: string;
  legal_entity?: number;
  is_vat_payer?: number;
  phone_1?: string;
  phone_2?: string;
  phone_3?: string;
  billing_name?: string;
  billing_phone?: string;
  billing_country?: string;
  billing_suburb?: string;
  billing_city?: string;
  billing_locality_id?: string;
  billing_street?: string;
  billing_postal_code?: string;
  shipping_country?: string;
  shipping_suburb?: string;
  shipping_city?: string;
  shipping_locality_id?: string;
  shipping_street?: string;
  shipping_postal_code?: string;
  shipping_contact?: string;
  shipping_phone?: string;
  liable_person?: string;
}

/** Doc § 5.1 — `details` (locker info). */
export interface OrderDetails {
  locker_id?: string;
  locker_name?: string;
  locker_delivery_eligible?: number;
  courier_external_office_id?: string;
}

/** Doc § 3.1.3 / § 5 — order attachment. */
export interface OrderAttachment {
  /** Doc requires either order_id (invoice) or order_product_id (warranty). */
  order_id?: number;
  order_type?: OrderFulfillmentCode;
  order_product_id?: number;
  name?: string;
  url: string;
  /** 1 = invoice, 3 = warranty, 4 = user manual, 8 = user guide, 10 = AWB, 11 = proforma. */
  type?: number;
  force_download?: number;
}

/** Doc § 5.1 — eMAG order shape returned by `order/read`. */
export interface EmagOrder {
  id: number;
  status: OrderStatusCode;
  is_complete?: number;
  type?: OrderFulfillmentCode;
  payment_mode_id?: PaymentModeCode;
  detailed_payment_method?: string;
  delivery_mode?: DeliveryMode;
  details?: OrderDetails;
  date?: string;
  modified?: string;
  payment_status?: number;
  cashed_co?: number;
  cashed_cod?: number;
  shipping_tax?: number | string;
  shipping_tax_voucher_split?: OrderVoucherSplit[];
  customer?: OrderCustomer;
  products: OrderProduct[];
  attachments?: OrderAttachment[];
  vouchers?: OrderVoucher[];
  is_storno?: boolean;
  /** Doc § 5.1: cancellation_reason a fost redenumit reason_cancellation în 4.4.7. */
  reason_cancellation?: number;
  cancellation_reason?: number;
  enforced_vendor_courier_accounts?: string[] | null;
  /** Adăugat în 4.4.7 — eligibilitate locker chiar dacă delivery_mode != pickup. */
  locker_delivery_eligible?: number;
  /** Adăugat în 4.4.7 — id-ul oficiului courier-ului ales. */
  courier_external_office_id?: string;
  recycle_warranties?: RecycleWarranty[];
}

/** Doc § 5.1 — eMAG cancellation reasons. Listă neexhaustivă, expusă pentru convenience. */
export const OrderCancellationReason = {
  OutOfStock: 1,
  CancelledByClient: 2,
  ClientCannotBeContacted: 3,
  CourierDeliveryTermTooLarge: 15,
  TransportTaxTooLarge: 16,
  LongDeliveryTerm: 17,
  BetterOfferElsewhere: 18,
  PaymentNotPaid: 19,
  CourierUndelivered: 20,
  Others: 21,
  IncompleteAuto: 22,
  ClientChangedMind: 23,
  ByCustomerRequest: 24,
  FailedDelivery: 25,
  LateShipment: 26,
  IrrelevantOrder: 27,
  CanceledBySuperAdmin: 28,
  BlacklistedCustomer: 29,
  NoVatInvoice: 30,
  PartnerRequested: 31,
  DeliveryEstimateTooLong: 32,
  ProductNoLongerAvailable: 33,
  OtherReasons: 34,
  DeliveryTooExpensive: 35,
  BetterPriceElsewhere: 36,
  AnotherEmagOrder: 37,
  DoesNotNeedProduct: 38,
  InstalmentsOnly: 39,
  OtherReasonsEis: 40,
  OutOfStockInstalments: 41,
  ProductNoLongerAvailableInstalments: 42,
  DeliveryEstimateTooLongInstalments: 43,
} as const;

export type OrderCancellationReasonCode =
  (typeof OrderCancellationReason)[keyof typeof OrderCancellationReason];

/** Doc § 5.4 — order/read filters. */
export interface OrderReadFilters {
  itemsPerPage?: number;
  currentPage?: number;
  id?: number;
  status?: OrderStatusCode | OrderStatusCode[];
  payment_mode_id?: PaymentModeCode | PaymentModeCode[];
  is_complete?: 0 | 1;
  type?: OrderFulfillmentCode;
  createdBefore?: string;
  createdAfter?: string;
  modifiedBefore?: string;
  modifiedAfter?: string;
}

/** Răspuns paginat normalizat returnat de helper-ul `readOrders`. */
export interface OrderReadResult {
  items: EmagOrder[];
  currentPage: number;
  itemsPerPage: number;
  /** Numărul total de iteme din răspunsul eMAG, dacă a fost expus. */
  totalCount?: number;
}

/** Doc § 6.10 — order/volumetry/read. */
export interface OrderVolumetryItem {
  product_id: number;
  weight: number;
  length: number;
  width: number;
  height: number;
}

export interface OrderVolumetry {
  order_id: number;
  type?: OrderFulfillmentCode;
  volumetric_data: OrderVolumetryItem[];
}

export interface OrderVolumetryFilters {
  order_id: number;
  type?: OrderFulfillmentCode;
  product_id?: number;
}
