import { z } from 'zod';

export const ORDER_STATUSES = [
  'Created',
  'Picking',
  'Invoiced',
  'Shipped',
  'Cancelled',
  'Delivered',
  'UnDelivered',
  'Returned',
  'Unsupplied',
  'Awaiting',
  'Unpacked',
  'AtCollectionPoint',
  'Verified',
] as const;

// ─── createWebhook ────────────────────────────────────────────────────────────

export const CreateWebhookInputSchema = z.object({
  url: z.string().url(),
  authenticationType: z.enum(['BASIC_AUTHENTICATION', 'API_KEY']),
  username: z.string().optional(),
  password: z.string().optional(),
  apiKey: z.string().optional(),
  statuses: z.array(z.enum(ORDER_STATUSES)).min(1),
});

export type CreateWebhookInput = z.infer<typeof CreateWebhookInputSchema>;

export const CreateWebhookOutputSchema = z.object({
  id: z.number().optional(),
  success: z.boolean(),
});

export type CreateWebhookOutput = z.infer<typeof CreateWebhookOutputSchema>;

// ─── listWebhooks ─────────────────────────────────────────────────────────────

export const ListWebhooksOutputSchema = z.array(z.record(z.unknown()));
export type ListWebhooksOutput = z.infer<typeof ListWebhooksOutputSchema>;

// ─── deleteWebhook ────────────────────────────────────────────────────────────

export const DeleteWebhookInputSchema = z.object({
  webhookId: z.number().int(),
});

export type DeleteWebhookInput = z.infer<typeof DeleteWebhookInputSchema>;

export const DeleteWebhookOutputSchema = z.object({ success: z.boolean() });
export type DeleteWebhookOutput = z.infer<typeof DeleteWebhookOutputSchema>;
