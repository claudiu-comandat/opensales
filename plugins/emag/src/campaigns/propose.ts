import type { EmagClient } from '../client.js';
import type { CampaignProposalPayload, CampaignProposalResult } from './types.js';

/**
 * Doc § 4 — campaign_proposals/save.
 *
 * Propune o ofertă într-o campanie eMAG existentă (Black Friday, Stock Busters,
 * MultiDeals, etc.). Caller-ul trebuie să cunoască deja `campaign_id` (vine
 * via partner manager sau via UI-ul de marketplace) și să respecte regulile
 * specifice tipului de campanie:
 *
 *   - Campanii standard: trimit `sale_price`, `stock`, opțional
 *     `voucher_discount` (4.4.7+) și `not_available_post_campaign` (4.4.7+).
 *   - Campanii MultiDeals: trimit `date_intervals[]` (4.4.8+) cu cel puțin un
 *     interval; fiecare interval trebuie să aibă `index` unic, max 30.
 *
 * NOTĂ: cheile `original_sale_price` și `post_campaign_original_sale_price`
 * au fost ELIMINATE în 4.4.7 — funcția aici acceptă doar tipul curent
 * `CampaignProposalPayload` care nu le include.
 */
export function proposeCampaign(
  client: EmagClient,
  payload: CampaignProposalPayload,
): Promise<CampaignProposalResult> {
  return client.save<CampaignProposalResult>('campaign_proposals', payload);
}
