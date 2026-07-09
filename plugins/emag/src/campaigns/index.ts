/**
 * eMAG Campaigns module — wave 4.
 *
 * Re-exportă tipurile și funcția pură `proposeCampaign` și expune
 * `campaignActions` — handler-ele pe care plugin-ul le poate înregistra la
 * `actions:` în `definePlugin`.
 */

import { proposeCampaign } from './propose.js';

import type { EmagClient } from '../client.js';
import type { CampaignProposalPayload, CampaignProposalResult } from './types.js';

export * from './types.js';
export { proposeCampaign } from './propose.js';

const proposeCampaignAction = (
  client: EmagClient,
  payload: CampaignProposalPayload,
): Promise<CampaignProposalResult> => {
  return proposeCampaign(client, payload);
};

export const campaignActions = {
  proposeCampaign: proposeCampaignAction,
} as const;
