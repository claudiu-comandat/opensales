import {
  ConfirmShipmentInputSchema,
  ConfirmShipmentOutputSchema,
  GetLogisticsCompaniesInputSchema,
  GetLogisticsCompaniesOutputSchema,
} from './types.js';

import type { TemuClient } from '../client.js';

export interface FulfillmentActionContext {
  client: TemuClient;
}

export const fulfillmentActions = {
  confirmShipment: {
    description: 'Confirmă expedierea comenzilor cu tracking — bg.logistics.shipment.v2.confirm.',
    input: ConfirmShipmentInputSchema,
    output: ConfirmShipmentOutputSchema,
    async handler(
      input: {
        packageList: {
          parentOrderSn: string;
          orderSnList: string[];
          trackingCompany: string;
          trackingNumber: string;
        }[];
      },
      { client }: FulfillmentActionContext,
    ) {
      const parsed = ConfirmShipmentInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>(
        'bg.logistics.shipment.v2.confirm',
        { data: { packageList: parsed.packageList } },
      );
      return {
        success: true,
        failedList: (result.failedList as Record<string, unknown>[]) ?? [],
      };
    },
  },

  getLogisticsCompanies: {
    description: 'Listă curieri disponibili pentru o regiune — bg.logistics.companies.get.',
    input: GetLogisticsCompaniesInputSchema,
    output: GetLogisticsCompaniesOutputSchema,
    async handler(input: { regionId: number }, { client }: FulfillmentActionContext) {
      const parsed = GetLogisticsCompaniesInputSchema.parse(input);
      const result = await client.call<Record<string, unknown>>('bg.logistics.companies.get', {
        data: { regionId: parsed.regionId },
      });
      return (result.logisticsList as Record<string, unknown>[]) ?? [];
    },
  },
} as const;

export type FulfillmentActions = typeof fulfillmentActions;
