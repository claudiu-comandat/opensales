import { z } from 'zod';

/** Mesaj OLX. Spec: components/schemas/Message (acceptat permisiv). */
export const olxMessageSchema = z
  .object({
    id: z.number().optional(),
    thread_id: z.number().optional(),
    text: z.string().optional(),
    created_at: z.string().optional(),
    type: z.string().optional(),
  })
  .passthrough();
export type OlxMessage = z.infer<typeof olxMessageSchema>;

export const readMessagesInputSchema = z.object({
  threadId: z.number(),
});
export type ReadMessagesInput = z.infer<typeof readMessagesInputSchema>;

export const readMessagesOutputSchema = z.object({
  messages: z.array(olxMessageSchema),
});
export type ReadMessagesOutput = z.infer<typeof readMessagesOutputSchema>;

export const sendMessageInputSchema = z.object({
  threadId: z.number(),
  text: z.string().min(1),
  attachments: z.array(z.object({ url: z.string().url() })).optional(),
});
export type SendMessageInput = z.infer<typeof sendMessageInputSchema>;

export const sendMessageOutputSchema = z.object({
  sent: z.literal(true),
});
export type SendMessageOutput = z.infer<typeof sendMessageOutputSchema>;
