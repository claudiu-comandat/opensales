import {
  CreateWebhookInputSchema,
  CreateWebhookOutputSchema,
  DeleteWebhookInputSchema,
  DeleteWebhookOutputSchema,
  ListWebhooksOutputSchema,
} from './types.js';

import type { TrendyolClient } from '../client.js';

export interface WebhookActionContext {
  client: TrendyolClient;
}

export const webhookActions = {
  createWebhook: {
    description: 'Creează un abonament webhook pentru notificări de comenzi.',
    input: CreateWebhookInputSchema,
    output: CreateWebhookOutputSchema,
    async handler(
      input: {
        url: string;
        authenticationType: 'BASIC_AUTHENTICATION' | 'API_KEY';
        username?: string;
        password?: string;
        apiKey?: string;
        statuses: string[];
      },
      { client }: WebhookActionContext,
    ) {
      const parsed = CreateWebhookInputSchema.parse(input);
      const result = await client.post<Record<string, unknown>>(
        `/integration/order/sellers/${client.sellerId}/webhook-subscriptions`,
        parsed,
      );
      return {
        id: result.id as number | undefined,
        success: true,
      };
    },
  },

  listWebhooks: {
    description: 'Listează abonamentele webhook existente.',
    input: ListWebhooksOutputSchema.optional().default([]),
    output: ListWebhooksOutputSchema,
    async handler(_input: unknown, { client }: WebhookActionContext) {
      const result = await client.get<Record<string, unknown>[]>(
        `/integration/order/sellers/${client.sellerId}/webhook-subscriptions`,
      );
      return Array.isArray(result) ? result : [];
    },
  },

  deleteWebhook: {
    description: 'Șterge un abonament webhook.',
    input: DeleteWebhookInputSchema,
    output: DeleteWebhookOutputSchema,
    async handler(input: { webhookId: number }, { client }: WebhookActionContext) {
      const parsed = DeleteWebhookInputSchema.parse(input);
      await client.delete<void>(
        `/integration/order/sellers/${client.sellerId}/webhook-subscriptions/${parsed.webhookId}`,
      );
      return { success: true };
    },
  },
} as const;

export type WebhookActions = typeof webhookActions;
