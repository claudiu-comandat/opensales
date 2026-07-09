/**
 * eMAG Campaigns types — modelate după doc 4.5.1, secțiunea 4
 * (Proposing offers in campaigns).
 *
 * Note importante de versiune:
 *   - 4.4.7: au fost ELIMINATE cheile `original_sale_price` și
 *     `post_campaign_original_sale_price` din campaign_proposals/save.
 *     Aici NU le includem deloc — payload-ul TypeScript trebuie să fie aliniat
 *     cu API-ul curent.
 *   - 4.4.7: au fost ADĂUGATE `voucher_discount` și `not_available_post_campaign`.
 *   - 4.4.8: a fost adăugată cheia `date_intervals` cu sub-câmpurile
 *     `start_date {date, timezone_type, timezone}`, `end_date {...}`,
 *     `voucher_discount`, `index`. Folosit pentru campanii MultiDeals.
 */

/**
 * Interval de dată cu metadata de timezone — sub-obiect din `date_intervals[]`.
 *
 * Format conform docului § 4 (4.4.8+):
 *   { date: "YYYY-MM-DD HH:MM:SS.ssssss", timezone_type: 3, timezone: "Europe/Bucharest" }
 */
export interface CampaignIntervalDate {
  /** Format `YYYY-MM-DD HH:MM:SS.ssssss`. */
  date: string;
  /** Identificator de tip timezone (3 = Europe/Bucharest). */
  timezone_type: number;
  /** Numele timezone-ului. */
  timezone: string;
}

/**
 * Interval de discount pentru campanii MultiDeals (doc § 4, 4.4.8+).
 *
 * Pentru campaniile MultiDeals trebuie să trimitem cel puțin un interval cu
 * `start_date`, `end_date`, `voucher_discount` și `index` (1-based, unic,
 * incremental, max 30 intervale).
 */
export interface CampaignDateInterval {
  start_date: CampaignIntervalDate;
  end_date: CampaignIntervalDate;
  /** Discount procentual aplicat în acest interval (e.g. 10 pentru 10%). */
  voucher_discount: number;
  /** Indexul intervalului. Unic. Incremental. Max 30. */
  index: number;
}

/**
 * Doc § 4 — Payload pentru campaign_proposals/save.
 *
 * Atenție:
 *   - `original_sale_price` și `post_campaign_original_sale_price` au fost
 *     ELIMINATE în 4.4.7 — NU le includem.
 *   - `voucher_discount` la nivel root vs `voucher_discount` în interiorul
 *     `date_intervals[]` — primul e folosit pentru campanii standard cu
 *     voucher unic, al doilea pentru MultiDeals.
 */
export interface CampaignProposalPayload {
  /** Seller-internal product id (Required). */
  id: number;
  /** Sale price fără VAT disponibil în campanie (Required). */
  sale_price: number;
  /** Stoc disponibil pentru campanie (Required, 0–255). */
  stock: number;
  /** Cantitate maximă per comandă (Required pentru campanii cu stock-in-site). */
  max_qty_per_order?: number;
  /** Preț după sfârșitul campaniei (Optional). */
  post_campaign_sale_price?: number;
  /** ID-ul intern eMAG al campaniei (Required). */
  campaign_id: number;
  /** 4.4.7+: 1 = oferta nu mai e activă post-campaign; 0/absent = rămâne. */
  not_available_post_campaign?: 0 | 1;
  /** 4.4.7+: Discount procentual (min 10, max 100). */
  voucher_discount?: number;
  /** 4.4.8+: Pentru campanii MultiDeals — listă de intervale cu discount. */
  date_intervals?: CampaignDateInterval[];
}

/**
 * Răspunsul standard eMAG la campaign_proposals/save este wrap-uit în
 * EmagResponse — `results` e de obicei un boolean sau o entitate gol-ish.
 * Tipul aici rămâne `unknown` pentru că folosim `.save()` din EmagClient
 * care unwrap-uiește deja învelișul.
 */
export type CampaignProposalResult = unknown;
